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
 *
 * `idle`, `checking`, and `error` all render nothing — the button only
 * surfaces when there's a real update the user can act on. Failed checks
 * stay silent; the next boot-time check will retry.
 *
 * The component shares the visual language of the topbar buttons in
 * App.tsx (28×28 hit target, no rounded corners, hover = bg-bg-hover) but
 * extends to a wider pill in `downloading` so the percentage fits.
 *
 * Why no popover with full release notes? The full-text changelog lives on
 * GitHub Releases (one click away) and putting it inside a popover here
 * would dilute the brutalist topbar. The button is a single decisive
 * action; the user reads the notes on the website if they want them.
 *
 * Accessibility:
 *   - Each state has a distinct `aria-label` describing the action.
 *   - The dot indicator is `aria-hidden`; status is conveyed by the label.
 *   - Disabled during `downloading` so the install can't be re-fired.
 */
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

export function UpdateButton({
  state,
  dismissed,
  onInstall,
  onRestart,
}: Props) {
  // Hidden in idle, checking, error, and when the user dismissed the
  // "available" notification. The button only surfaces when there's a
  // real update the user can act on — failed checks go quiet and the
  // next boot-time check will retry.
  if (
    state.status === "idle" ||
    state.status === "checking" ||
    state.status === "error"
  )
    return null;
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
        <span
          aria-hidden
          className="absolute top-[6px] right-[5px] w-[5px] h-[5px] bg-text"
        />
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

  // Defensive fallback — every renderable status is handled above. If the
  // state machine ever grows a new status, default to hidden so we don't
  // accidentally surface a bare button.
  return null;
}
