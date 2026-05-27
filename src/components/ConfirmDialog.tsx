/**
 * Generic two-button confirm dialog. Replaces window.confirm().
 *
 * Brutalist styling lifted verbatim from ConfirmOverwriteDialog — same
 * border-2, brutal-shadow-pop, animate-pop-in. Esc cancels. Backdrop
 * click cancels. The destructive variant flips the OK button to the
 * danger color (red on light, salmon on dark).
 *
 * Designed to be driven by the imperative `useDialog().confirm(...)`
 * API in src/hooks/useDialog.tsx — components rarely render this
 * directly.
 */
import { useEffect, type FC } from "react";

export interface ConfirmDialogProps {
  title: string;
  /** One-line subtitle under the title. Optional. Mono caps treatment. */
  subtitle?: string;
  body: string;
  /** Label for the affirmative button. Defaults to "OK". */
  okLabel?: string;
  /** Label for the negative button. Defaults to "CANCEL". */
  cancelLabel?: string;
  /** Tints the OK button with the danger color (e.g. delete confirm). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  title,
  subtitle,
  body,
  okLabel = "OK",
  cancelLabel = "CANCEL",
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  // Esc cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const btnBase =
    "border-2 border-border bg-bg text-text px-4 py-[8px] text-[12px] font-mono font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[210] animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        background: "color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.65))",
      }}
    >
      <div className="relative bg-bg text-text border-2 border-border px-7 py-6 min-w-[420px] max-w-[480px] animate-pop-in brutal-shadow-pop">
        <header className="flex items-center gap-2.5 mb-2">
          <h3 className="m-0 text-[14px] font-mono font-bold tracking-wider leading-none uppercase">
            {title}
          </h3>
        </header>
        {subtitle && (
          <p className="mt-0 mb-5 text-[10.5px] font-mono uppercase tracking-wider text-text-muted truncate">
            {subtitle}
          </p>
        )}
        <p className="m-0 mb-6 text-[12.5px] leading-relaxed font-mono text-text">{body}</p>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            className={`${btnBase} hover:not-disabled:bg-bg-hover`}
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              destructive
                ? `${btnBase} bg-danger text-bg border-danger hover:not-disabled:bg-bg hover:not-disabled:text-danger active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px]`
                : `${btnBase} bg-text text-bg hover:not-disabled:bg-bg hover:not-disabled:text-text active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px]`
            }
            onClick={onConfirm}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
