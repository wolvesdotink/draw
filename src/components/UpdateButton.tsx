/**
 * UpdateButton — topbar update affordance.
 *
 * Hidden by default. Surfaces only when the updater state machine in
 * `useUpdater` reports something the user can act on:
 *
 *   available   →  ↑ icon + small accent dot. Click installs.
 *   downloading →  mono percentage in a brutal bordered pill. Not clickable.
 *   ready       →  ⟲ icon, full-inverse styling (bg-text / text-bg). Click
 *                  relaunches the app on the new version.
 *   error       →  ↑ icon + red accent dot. Click opens a small anchored
 *                  popover with RETRY + MANUAL DL actions. The full error
 *                  string is exposed via the icon's `title` tooltip — we
 *                  keep the topbar minimal and reveal detail on hover.
 *
 * `idle` and `checking` render nothing.
 *
 * The component shares the visual language of the topbar buttons in
 * App.tsx (28×28 hit target, no rounded corners, hover = bg-bg-hover) but
 * extends to a wider pill in `downloading` so the percentage fits.
 *
 * Why a popover for the error state? Without an actionable affordance the
 * user has no way to recover when the auto-updater fails (e.g. signature
 * mismatch, gzip error, AppleScript admin prompt cancelled). The popover
 * gives them a retry path and a manual-download fallback without dragging
 * a full modal in front of the canvas.
 *
 * Accessibility:
 *   - Each state has a distinct `aria-label` describing the action.
 *   - The dot indicator is `aria-hidden`; status is conveyed by the label.
 *   - Disabled during `downloading` so the install can't be re-fired.
 *   - The error popover closes on outside click and `Escape`.
 */
import { useEffect, useRef, useState } from "react";
import type { UpdaterState } from "../hooks/useUpdater";
import { RestartIcon, UpdateIcon } from "./icons";

type Props = {
  state: UpdaterState;
  dismissed: boolean;
  onInstall: () => void;
  onRestart: () => void;
};

/** Match the topbar button base in App.tsx — keep the visual language unified. */
const TOPBAR_BTN =
  "h-7 inline-flex items-center justify-center bg-transparent border-0 text-text-muted leading-none hover:bg-bg-hover hover:text-text active:bg-text active:text-bg cursor-pointer";

/** Repo releases page — manual-DMG fallback when the in-app updater fails. */
const RELEASES_URL = "https://github.com/wolvesdotink/draw/releases/latest";

export function UpdateButton({ state, dismissed, onInstall, onRestart }: Props) {
  // Anchor + open state for the brutal popover that surfaces under the
  // error icon. Scoped here because no other component needs to know
  // about it; lifting it up would just create indirection.
  const [errorOpen, setErrorOpen] = useState(false);
  const errorWrapRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on outside click + Escape. Only wired when open so
  // we don't keep document-level listeners around in steady state.
  useEffect(() => {
    if (!errorOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (errorWrapRef.current && !errorWrapRef.current.contains(e.target as Node)) {
        setErrorOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setErrorOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [errorOpen]);

  // If the updater leaves the error state (e.g. a successful retry takes
  // us through downloading → ready), drop any stale popover-open state so
  // it doesn't reappear next time we re-enter error.
  useEffect(() => {
    if (state.status !== "error" && errorOpen) setErrorOpen(false);
  }, [state.status, errorOpen]);

  // Hidden in idle, checking, and when the user dismissed the
  // "available" notification. Errors now render an actionable affordance
  // instead of disappearing silently.
  if (state.status === "idle" || state.status === "checking") return null;
  if (state.status === "available" && dismissed) return null;

  if (state.status === "available") {
    return (
      <button
        type="button"
        data-no-drag
        className={`${TOPBAR_BTN} w-7 relative`}
        onClick={onInstall}
        title={`Update available${state.newVersion ? ` (${state.newVersion})` : ""} — click to install`}
        aria-label={`Install update${state.newVersion ? ` ${state.newVersion}` : ""}`}
      >
        <UpdateIcon size={15} />
        {/* Accent dot, top-right of the button — a hard 5×5 black square so
            it reads as a brutalist mark rather than a soft notification dot. */}
        <span aria-hidden className="absolute top-[6px] right-[5px] w-[5px] h-[5px] bg-text" />
      </button>
    );
  }

  if (state.status === "downloading") {
    const pct =
      state.totalBytes > 0
        ? Math.min(99, Math.floor((state.downloaded / state.totalBytes) * 100))
        : null;
    return (
      <div
        data-no-drag
        className="h-7 px-2 inline-flex items-center gap-1.5 border-2 border-border text-text font-mono text-[10px] uppercase tracking-[0.18em] select-none"
        title="Installing update"
        aria-live="polite"
      >
        <span aria-hidden className="pulse-line w-[18px]" />
        <span>{pct === null ? "DL" : `${pct}%`}</span>
      </div>
    );
  }

  if (state.status === "ready") {
    return (
      <button
        type="button"
        data-no-drag
        className="h-7 px-2 inline-flex items-center gap-1.5 bg-text text-bg border-0 leading-none cursor-pointer hover:bg-text active:bg-text font-mono text-[10px] uppercase tracking-[0.18em]"
        onClick={onRestart}
        title="Restart to apply the update"
        aria-label="Restart to apply the update"
      >
        <RestartIcon size={13} />
        <span>RESTART</span>
      </button>
    );
  }

  if (state.status === "error") {
    const errorMsg = state.error ?? "unknown error";
    const handleRetry = () => {
      setErrorOpen(false);
      onInstall();
    };
    const handleManualDl = async () => {
      setErrorOpen(false);
      try {
        // Lazy import — same pattern as useUpdater.ts so the browser-only
        // Vite build (no Tauri runtime) doesn't blow up on import resolution.
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(RELEASES_URL);
      } catch (err) {
        // Last-resort fallback: open in the same window. Better than swallowing.
        console.error("[updater] failed to open releases URL via opener:", err);
        window.open(RELEASES_URL, "_blank", "noopener");
      }
    };

    return (
      <div ref={errorWrapRef} className="relative inline-flex">
        <button
          type="button"
          data-no-drag
          className={`${TOPBAR_BTN} w-7 relative`}
          onClick={() => setErrorOpen((v) => !v)}
          title={`Update failed: ${errorMsg}`}
          aria-label="Update failed — click for actions"
          aria-haspopup="menu"
          aria-expanded={errorOpen}
        >
          <UpdateIcon size={15} />
          {/* Red accent dot — same hard 5×5 square as the available state,
              recoloured to the danger token to read as an error mark. */}
          <span aria-hidden className="absolute top-[6px] right-[5px] w-[5px] h-[5px] bg-danger" />
        </button>

        {errorOpen && (
          <div
            role="menu"
            data-no-drag
            className="absolute right-0 top-full mt-1 z-50 bg-bg border-2 border-border min-w-[160px] flex flex-col"
          >
            <button
              type="button"
              role="menuitem"
              className="h-8 px-3 inline-flex items-center justify-start text-left bg-transparent border-0 text-text font-mono text-[10px] uppercase tracking-[0.18em] cursor-pointer hover:bg-bg-hover active:bg-text active:text-bg"
              onClick={handleRetry}
            >
              RETRY
            </button>
            <button
              type="button"
              role="menuitem"
              className="h-8 px-3 inline-flex items-center justify-start text-left bg-transparent border-0 border-t-2 border-t-border text-text font-mono text-[10px] uppercase tracking-[0.18em] cursor-pointer hover:bg-bg-hover active:bg-text active:text-bg"
              onClick={handleManualDl}
            >
              MANUAL DL
            </button>
          </div>
        )}
      </div>
    );
  }

  // Defensive fallback — every renderable status is handled above. If the
  // state machine ever grows a new status, default to hidden so we don't
  // accidentally surface a bare button.
  return null;
}
