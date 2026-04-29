/**
 * Tracks which drawing file is currently open.
 *
 * Holds { path, initialScene }. The initialScene is loaded once when a path
 * becomes active; from there on Excalidraw owns the live state. Switching files
 * requires:
 *   1) flushing any pending auto-save for the current file (handled by caller)
 *   2) loading the next file's contents
 *   3) remounting <Excalidraw> via key={path} so initialData re-applies
 */
import { useCallback, useState } from "react";
import { exists } from "../lib/fs";
import { loadDrawing, type ExcalidrawScene } from "../lib/excalidraw-io";
import { toAppDataPath } from "../lib/paths";

export interface ActiveFile {
  path: string;
  initialScene: ExcalidrawScene;
  /**
   * Bumped each time we explicitly reload the file. Used as part of <Excalidraw key>
   * so we can force a remount even when the path stays the same (e.g. external edit).
   */
  loadVersion: number;
}

export interface UseActiveFileResult {
  active: ActiveFile | null;
  /** True while loading a new file. */
  loading: boolean;
  error: Error | null;
  /**
   * Open a file. The caller is responsible for flushing any pending save on the
   * previously-active file before calling this.
   */
  open: (rel: string) => Promise<void>;
  /** Close the active file. */
  close: () => void;
}

export function useActiveFile(): UseActiveFileResult {
  const [active, setActive] = useState<ActiveFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const open = useCallback(async (rel: string) => {
    setLoading(true);
    setError(null);
    try {
      const present = await exists(toAppDataPath(rel));
      if (!present) {
        // file vanished between sidebar render and click — clear and bail.
        setActive(null);
        throw new Error(`File no longer exists: ${rel}`);
      }
      const scene = await loadDrawing(rel);
      setActive((prev) => ({
        path: rel,
        initialScene: scene,
        loadVersion: (prev?.path === rel ? prev.loadVersion : 0) + 1,
      }));
    } catch (e) {
      setError(e as Error);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setActive(null);
    setError(null);
  }, []);

  return { active, loading, error, open, close };
}
