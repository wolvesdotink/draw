/**
 * Single-button error/info dialog. Replaces window.alert().
 *
 * Brutalist styling lifted verbatim from ConfirmOverwriteDialog — see
 * ConfirmDialog.tsx for the full notes. Esc closes. Backdrop click
 * closes. There is only one button (OK), so it's the implicit default.
 *
 * Driven by `useDialog().alert(...)` from src/hooks/useDialog.tsx.
 */
import { useEffect, type FC } from "react";

export interface AlertDialogProps {
  title: string;
  body: string;
  /** Label for the close button. Defaults to "OK". */
  okLabel?: string;
  onClose: () => void;
}

export const AlertDialog: FC<AlertDialogProps> = ({ title, body, okLabel = "OK", onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const btnBase =
    "border-2 border-border bg-bg text-text px-4 py-[8px] text-[12px] font-mono font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[210] animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        background: "color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.65))",
      }}
    >
      <div className="relative bg-bg text-text border-2 border-border px-7 py-6 min-w-[420px] max-w-[520px] animate-pop-in brutal-shadow-pop">
        <header className="flex items-center gap-2.5 mb-4">
          <h3 className="m-0 text-[14px] font-mono font-bold tracking-wider leading-none uppercase">
            {title}
          </h3>
        </header>
        <p className="m-0 mb-6 text-[12.5px] leading-relaxed font-mono text-text whitespace-pre-wrap">
          {body}
        </p>
        <div className="flex items-center justify-end">
          <button
            type="button"
            autoFocus
            className={`${btnBase} bg-text text-bg hover:not-disabled:bg-bg hover:not-disabled:text-text active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px]`}
            onClick={onClose}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
