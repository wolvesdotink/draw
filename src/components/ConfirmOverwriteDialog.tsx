/**
 * Three-way prompt shown when an import would clobber an existing file.
 *
 * Mirrors NewItemDialog's brutalist styling. Buttons:
 *   Overwrite — primary, danger-tinted; replaces the existing file.
 *   Rename    — returns control to caller to reopen NewItemDialog.
 *   Cancel    — closes everything; no changes on disk.
 *
 * Esc cancels. Backdrop click cancels. No keyboard default action — the
 * destructive button must be clicked deliberately.
 */
import { useEffect, type FC } from "react";
import { ImportIcon } from "./icons";

interface ConfirmOverwriteDialogProps {
  /** rel path of the existing file, e.g. "work/foo.excalidraw". */
  existingPath: string;
  onOverwrite: () => void;
  onRename: () => void;
  onCancel: () => void;
}

export const ConfirmOverwriteDialog: FC<ConfirmOverwriteDialogProps> = ({
  existingPath,
  onOverwrite,
  onRename,
  onCancel,
}) => {
  // Esc closes
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
        background:
          "color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.65))",
      }}
    >
      <div className="relative bg-bg text-text border-2 border-border px-7 py-6 min-w-[420px] max-w-[480px] animate-pop-in brutal-shadow-pop">
        <header className="flex items-center gap-2.5 mb-2">
          <span className="inline-flex items-center justify-center w-7 h-7 bg-text text-bg border-2 border-border">
            <ImportIcon size={15} />
          </span>
          <h3 className="m-0 text-[14px] font-mono font-bold tracking-wider leading-none uppercase">
            File exists
          </h3>
        </header>
        <p className="mt-0 mb-5 ml-[42px] text-[10.5px] font-mono uppercase tracking-wider text-text-muted truncate">
          {existingPath}
        </p>

        <p className="m-0 mb-6 text-[12.5px] leading-relaxed font-mono text-text">
          A drawing with that name already exists at this location. Overwrite
          it, pick a different name, or cancel the import.
        </p>

        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            type="button"
            className={`${btnBase} hover:not-disabled:bg-bg-hover`}
            onClick={onCancel}
          >
            CANCEL
          </button>
          <button
            type="button"
            className={`${btnBase} hover:not-disabled:bg-bg-hover`}
            onClick={onRename}
          >
            RENAME
          </button>
          <button
            type="button"
            className={`${btnBase} bg-danger text-bg border-danger hover:not-disabled:bg-bg hover:not-disabled:text-danger active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px]`}
            onClick={onOverwrite}
          >
            OVERWRITE
          </button>
        </div>
      </div>
    </div>
  );
};
