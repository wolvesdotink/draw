/**
 * Auto-save with debounce and race-safe path tracking.
 *
 * The trickiest piece in this app. Concerns:
 *
 *   1) Excalidraw's `onChange` fires on every render — we debounce to ~500ms.
 *
 *   2) When the user switches files mid-pending-save, the save MUST land at the
 *      previous path, not the new one. We capture the path inside the pending
 *      record at change-time, never read it at flush-time.
 *
 *   3) `excalidrawAPI` is set via a callback prop and resolves AFTER mount. We
 *      gate change handling until both `api` and `path` are present.
 *
 *   4) On file switch, callers must invoke `flushPending()` BEFORE calling
 *      useActiveFile.open(newPath). useAutoSave does not know about path
 *      transitions otherwise.
 *
 *   5) `onChange` fires for non-content events too (selection, cursor moves).
 *      We skip those by fingerprinting elements via per-element `version`
 *      (bumped by Excalidraw's `mutateElement`) plus a few persistable
 *      appState fields. Reference-comparing the elements array is NOT enough
 *      — Excalidraw mutates element objects in place without swapping the
 *      array, so a ref check misses move/resize/restyle of existing shapes.
 */
import { useCallback, useEffect, useRef } from "react";
import { saveDrawing, type ExcalidrawScene } from "../lib/excalidraw-io";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const DEBOUNCE_MS = 1000;

interface PendingSave {
  path: string;
  getSnapshot: () => ExcalidrawScene;
}

interface SeenSnapshot {
  /**
   * Rolling hash of (length, per-element version). Excalidraw mutates element
   * objects in place via `mutateElement` (bumping `element.version`) without
   * replacing the elements array, so a plain reference check on the array
   * misses move/resize/rotate/restyle/text-edit of existing shapes. The
   * fingerprint catches those because `version` bumps on every mutation.
   */
  elementsFingerprint: number;
  filesCount: number;
  // Persistable appState fields whose changes we DO want to trigger saves
  bgColor: string | undefined;
  gridSize: number | null | undefined;
}

function fingerprintElements(elements: readonly ExcalidrawElement[]): number {
  let h = elements.length | 0;
  for (let i = 0; i < elements.length; i++) {
    // Math.imul keeps the result in int32. Mixing with `i` separates
    // permutations (reorder without version bumps still shifts the hash).
    h = (Math.imul(h, 31) + Math.imul(elements[i].version | 0, 1_000_003) + i) | 0;
  }
  return h;
}

export interface UseAutoSaveResult {
  /** Pass to <Excalidraw onChange={...}> */
  onChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  /** Pass to <Excalidraw excalidrawAPI={...}> */
  onAPI: (api: ExcalidrawImperativeAPI) => void;
  /**
   * Set the path that subsequent onChange events will be associated with.
   * Pass null when no file is open. Caller MUST `await flushPending()` before
   * changing path.
   */
  setActivePath: (path: string | null) => void;
  /** Force-flush any pending debounced save. Returns when the disk write completes. */
  flushPending: () => Promise<void>;
}

export function useAutoSave(): UseAutoSaveResult {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const activePathRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeenRef = useRef<SeenSnapshot | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const flushPending = useCallback(async (): Promise<void> => {
    // Wait for any in-flight write to finish first so we don't reorder writes to the same path.
    if (inFlightRef.current) {
      await inFlightRef.current.catch(() => {});
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending === null) return;

    const snapshot = pending.getSnapshot();
    const writePromise = saveDrawing(pending.path, snapshot);
    inFlightRef.current = writePromise;
    try {
      await writePromise;
    } finally {
      if (inFlightRef.current === writePromise) {
        inFlightRef.current = null;
      }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushPending();
    }, DEBOUNCE_MS);
  }, [flushPending]);

  const onChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const path = activePathRef.current;
      if (path === null || apiRef.current === null) return;

      const filesCount = Object.keys(files).length;
      const fp = fingerprintElements(elements);
      const seen = lastSeenRef.current;
      const persistableChanged =
        seen === null ||
        seen.elementsFingerprint !== fp ||
        seen.filesCount !== filesCount ||
        seen.bgColor !== appState.viewBackgroundColor ||
        seen.gridSize !== (appState.gridSize as number | null | undefined);

      if (!persistableChanged) return;

      lastSeenRef.current = {
        elementsFingerprint: fp,
        filesCount,
        bgColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize as number | null | undefined,
      };

      // Capture path at change-time. If the user switches files, the captured
      // path here remains correct for this pending save.
      pendingRef.current = {
        path,
        getSnapshot: () => ({
          elements,
          appState,
          files,
        }),
      };
      scheduleSave();
    },
    [scheduleSave],
  );

  const onAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  const setActivePath = useCallback((path: string | null) => {
    activePathRef.current = path;
    // Reset seen snapshot — different file, different baseline.
    lastSeenRef.current = null;
  }, []);

  // Cleanup on unmount: flush any pending save synchronously-ish.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      // Best-effort flush. If a pending save exists, fire it but don't await
      // (cleanup is sync). The OS will let it finish.
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) {
        void saveDrawing(pending.path, pending.getSnapshot()).catch(() => {});
      }
      apiRef.current = null;
    };
  }, []);

  return { onChange, onAPI, setActivePath, flushPending };
}
