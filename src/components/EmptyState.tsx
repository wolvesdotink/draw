/**
 * Shown when no file is selected or the drawings/ directory is empty.
 *
 * Two flavors, both intentionally quiet:
 *  - hasFiles=true:  a single muted line — "Pick something."
 *  - hasFiles=false: a brief welcome + CTA, with the drafting-grid backdrop
 *                    as the only background flourish.
 *
 * The decorative SVGs (T-square, set-square, compass) and the "Welcome to
 * draw." headline were removed during the minimal pass.
 */
import type { FC } from "react";
import { PlusIcon, ReturnKeyIcon } from "./icons";

interface EmptyStateProps {
  hasFiles: boolean;
  onCreateFirst: () => void;
}

const Kbd: FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 border border-border bg-bg text-[10px] font-mono text-text leading-none">
    {children}
  </span>
);

export const EmptyState: FC<EmptyStateProps> = ({ hasFiles, onCreateFirst }) => {
  if (hasFiles) {
    return (
      <div className="relative h-full w-full overflow-hidden flex items-center justify-center p-8 drafting-grid bg-bg">
        <div className="text-center max-w-[320px] animate-rise">
          <p className="m-0 text-[12px] font-mono uppercase tracking-wider text-text-muted leading-relaxed">
            Pick a drawing — or press <Kbd>⌘N</Kbd>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg drafting-grid">
      <div className="relative h-full flex items-center justify-center p-8">
        <div className="max-w-[440px] text-center animate-rise">
          <h1 className="m-0 mb-5 text-[40px] font-mono font-bold uppercase tracking-tight leading-none text-text">
            DRAW.
          </h1>
          <div className="h-1 w-16 mx-auto bg-text mb-6" aria-hidden />
          <p className="m-0 mb-8 text-[13px] font-mono text-text-muted leading-relaxed">
            A LOCAL SPACE FOR SKETCHES &amp; DIAGRAMS.<br />
            FILES LIVE ON THIS MACHINE AS PLAIN{" "}
            <code className="font-mono text-[12px] text-text px-1 py-0.5 bg-bg border border-border">
              .excalidraw
            </code>
            .
          </p>

          <button
            type="button"
            onClick={onCreateFirst}
            className="group inline-flex items-center gap-2 bg-accent text-accent-text border-2 border-border pl-4 pr-5 py-2.5 text-[12px] font-mono font-bold uppercase tracking-wider cursor-pointer hover:bg-bg hover:text-text active:translate-x-[2px] active:translate-y-[2px] active:shadow-none brutal-shadow"
          >
            <PlusIcon size={14} />
            NEW DRAWING
          </button>

          {/* Hint row — mono caps, hairline dividers */}
          <div className="mt-8 flex items-center justify-center gap-3 text-[10px] font-mono uppercase tracking-wider text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘N</Kbd> NEW
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘S</Kbd> SAVE
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>⌘\</Kbd> SIDEBAR
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <ReturnKeyIcon size={12} className="text-text-muted" /> OPEN
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
