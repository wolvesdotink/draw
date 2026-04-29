/**
 * Modal dialog for entering a name when creating a new file or folder.
 * Also handles renaming existing items.
 *
 * Optionally renders a "target folder" dropdown for the newFile case — used
 * when invoked via global Cmd+N where there isn't an obvious parent folder
 * to drop the file into.
 */
import { useEffect, useRef, useState, type FC, type FormEvent } from "react";
import { isValidName, stripExt } from "../lib/paths";
import { FolderIcon, NibIcon, ReturnKeyIcon } from "./icons";

export type DialogMode = "newFile" | "newFolder" | "rename";

export interface FolderChoice {
  /** rel path of folder, "" for root. */
  path: string;
  /** display label, e.g. "(root)" or "/work" or "/work/sketches". */
  label: string;
}

interface NewItemDialogProps {
  mode: DialogMode;
  /** Initial value (e.g. existing name when renaming). */
  initialValue?: string;
  /** Display string for context (e.g. "in /work/" or "renaming foo.excalidraw"). */
  context?: string;
  /**
   * If provided (only meaningful for newFile/newFolder), renders a target
   * folder dropdown. The first entry is selected by default.
   */
  folderChoices?: FolderChoice[];
  onSubmit: (name: string, targetFolder?: string) => void | Promise<void>;
  onCancel: () => void;
}

export const NewItemDialog: FC<NewItemDialogProps> = ({
  mode,
  initialValue = "",
  context,
  folderChoices,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState(() => stripExt(initialValue));
  const [folder, setFolder] = useState<string>(folderChoices?.[0]?.path ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    if (!isValidName(trimmed)) {
      setError("Name can't contain / or \\, can't start with a dot, max 200 chars.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed, folderChoices ? folder : undefined);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  const title =
    mode === "newFile"
      ? "New drawing"
      : mode === "newFolder"
        ? "New folder"
        : "Rename";

  const placeholder =
    mode === "newFile"
      ? "diagram"
      : mode === "newFolder"
        ? "ideas"
        : "new name";

  const submitLabel = mode === "rename" ? "Rename" : "Create";

  // Brutalist chains: hard borders, no radii, mono labels.
  const fieldBase =
    "w-full px-3 py-2.5 border-2 border-border bg-bg text-text outline-none focus:bg-bg-hover placeholder:text-text-faint font-mono";
  const btnBase =
    "border-2 border-border bg-bg text-text px-4 py-[8px] text-[12px] font-mono font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  // Pick the right glyph
  const TitleGlyph =
    mode === "newFolder" ? FolderIcon : NibIcon;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[200] animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        // backdrop click cancels
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
      style={{
        background:
          "color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.65))",
      }}
    >
      <form
        className="relative bg-bg text-text border-2 border-border px-7 py-6 min-w-[420px] max-w-[480px] animate-pop-in brutal-shadow-pop"
        onSubmit={handleSubmit}
      >
        <header className="flex items-center gap-2.5 mb-2">
          <span className="inline-flex items-center justify-center w-7 h-7 bg-text text-bg border-2 border-border">
            <TitleGlyph size={15} />
          </span>
          <h3 className="m-0 text-[14px] font-mono font-bold tracking-wider leading-none uppercase">
            {title}
          </h3>
        </header>
        {context && (
          <p className="mt-0 mb-5 ml-[42px] text-[10.5px] font-mono uppercase tracking-wider text-text-muted truncate">
            {context}
          </p>
        )}

        <input
          ref={inputRef}
          className={`${fieldBase} text-[14px] aria-invalid:border-danger`}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          disabled={submitting}
          aria-invalid={error !== null}
          autoComplete="off"
          spellCheck={false}
        />

        {folderChoices && folderChoices.length > 1 && (
          <label className="flex flex-col gap-1.5 mt-3.5">
            <span className="text-[10px] uppercase tracking-[0.24em] font-mono font-bold text-text">
              IN FOLDER
            </span>
            <select
              className={`${fieldBase} text-[12px] py-2`}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              disabled={submitting}
            >
              {folderChoices.map((c) => (
                <option key={c.path} value={c.path}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && (
          <p className="mt-3 mb-0 text-[11px] font-mono uppercase tracking-wider text-danger flex items-start gap-1.5">
            <span aria-hidden className="mt-[1px]">!</span>
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 mt-6">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            <ReturnKeyIcon size={12} /> {submitLabel.toUpperCase()}
            <span className="mx-1 text-text-faint">·</span>
            ESC TO CANCEL
          </span>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              className={`${btnBase} hover:not-disabled:bg-bg-hover`}
              onClick={onCancel}
              disabled={submitting}
            >
              CANCEL
            </button>
            <button
              type="submit"
              className={`${btnBase} bg-accent text-accent-text hover:not-disabled:bg-bg hover:not-disabled:text-text active:not-disabled:translate-x-[2px] active:not-disabled:translate-y-[2px]`}
              disabled={submitting || !value.trim()}
            >
              {submitting ? "WORKING…" : submitLabel.toUpperCase()}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
