/**
 * useUpdater — Tauri auto-update state machine.
 *
 * Lifecycle:
 *   idle → checking → available → downloading → ready
 *                  ↘ idle (no update)        ↘ error (any failure)
 *
 * On mount we do ONE silent background check after a short boot-quiet delay
 * (so the app paints first, then we phone home). The button consumer can
 * also kick off `checkNow()` on demand. After install completes, the user
 * triggers `restart()` themselves — we never auto-relaunch the app while
 * they might have unsaved canvas state in flight.
 *
 * Dev-mode behavior:
 *   The updater plugin needs a signed bundle to do anything. In `pnpm tauri
 *   dev` and in the browser-only Vite build, every call throws. We catch
 *   those throws, log once, and stay in `idle` — there's nothing useful the
 *   user can do about it.
 *
 * The updater endpoint, public key, and version checks are all configured
 * in src-tauri/tauri.conf.json under `plugins.updater`. This hook does NOT
 * know the URL — that's baked into the binary at build time.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdaterState = {
  status: UpdaterStatus;
  /** Version string of the available/installed update (e.g. "0.2.0"). */
  newVersion: string | null;
  /** Release notes / changelog markdown, if the manifest provided one. */
  notes: string | null;
  /** Bytes downloaded so far (during `downloading`). */
  downloaded: number;
  /** Total bytes to download (during `downloading`). 0 until first chunk. */
  totalBytes: number;
  /** Last error message; only meaningful when status === "error". */
  error: string | null;
};

const initialState: UpdaterState = {
  status: "idle",
  newVersion: null,
  notes: null,
  downloaded: 0,
  totalBytes: 0,
  error: null,
};

/** Wait this long after mount before the first silent check (ms). */
const BOOT_QUIET_MS = 4000;

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>(initialState);
  /** Holds the Update handle returned by `check()` so install/restart can use it. */
  const updateRef = useRef<Awaited<
    ReturnType<typeof import("@tauri-apps/plugin-updater").check>
  > | null>(null);
  /**
   * If true, the user explicitly dismissed the current update notification
   * for this session — we hide the banner but keep the handle so they can
   * still trigger install via the menu.
   */
  const [dismissed, setDismissed] = useState(false);

  const checkNow = useCallback(async () => {
    setDismissed(false);
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      // Lazy import — keeps the module out of the dev/browser bundle path
      // on first paint and lets the catch below cover the "plugin not
      // present" case cleanly.
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        updateRef.current = null;
        setState({ ...initialState, status: "idle" });
        return;
      }
      updateRef.current = update;
      setState({
        status: "available",
        newVersion: update.version ?? null,
        notes: update.body ?? null,
        downloaded: 0,
        totalBytes: 0,
        error: null,
      });
    } catch (e) {
      // Most common reason in production: no network. Most common in dev:
      // plugin not active. We surface error in state for diagnostics, but
      // the topbar button stays hidden — the next boot check will retry.
      updateRef.current = null;
      setState({
        ...initialState,
        status: "error",
        error: (e as Error).message ?? String(e),
      });
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setState((s) => ({ ...s, status: "downloading", downloaded: 0, totalBytes: 0 }));
    try {
      await update.downloadAndInstall((event) => {
        // The plugin emits one of three event shapes per the Tauri 2 docs:
        //   { event: "Started",  data: { contentLength } }
        //   { event: "Progress", data: { chunkLength    } }
        //   { event: "Finished" }
        if (event.event === "Started") {
          const total = (event.data as { contentLength?: number }).contentLength ?? 0;
          setState((s) => ({ ...s, totalBytes: total }));
        } else if (event.event === "Progress") {
          const chunk = (event.data as { chunkLength?: number }).chunkLength ?? 0;
          setState((s) => ({ ...s, downloaded: s.downloaded + chunk }));
        } else if (event.event === "Finished") {
          setState((s) => ({ ...s, status: "ready" }));
        }
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "error",
        error: (e as Error).message ?? String(e),
      }));
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState((s) => ({
        ...s,
        status: "error",
        error: (e as Error).message ?? String(e),
      }));
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  // ---------- Boot-time silent check ----------
  useEffect(() => {
    const t = window.setTimeout(() => {
      void checkNow();
    }, BOOT_QUIET_MS);
    return () => window.clearTimeout(t);
  }, [checkNow]);

  return { state, dismissed, checkNow, install, restart, dismiss };
}
