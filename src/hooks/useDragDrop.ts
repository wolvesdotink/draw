/**
 * Subscribes to OS file drops via standard HTML5 DOM events on the window.
 *
 * Why DOM events and not Tauri's `onDragDropEvent`?
 *   `dragDropEnabled` is set to **false** in `tauri.conf.json` so HTML5 DOM
 *   drag-and-drop works inside the webview (needed by the sidebar's
 *   file/folder drag-to-move). With Tauri's webview-level interception
 *   disabled, `onDragDropEvent` no longer fires — the cost of that flip is
 *   that we lose absolute file paths from OS drops, since browsers don't
 *   expose them. We work around that by reading dropped files via the
 *   `File` API (`file.text()` / `file.name`) and feeding the content
 *   directly into the import flow — no path needed.
 *
 * Behaviour:
 *   - Listens for `dragover` + `drop` on the window. Only OS file drops are
 *     handled (`dataTransfer.types.includes("Files")`); in-app drags carry
 *     `text/x-drawing-path` instead and bubble through untouched so the
 *     sidebar's row/root handlers see them.
 *   - Only `.excalidraw` files are considered. Other files and folders are
 *     silently ignored.
 *   - If multiple matching files are dropped, only the first is imported;
 *     the rest are logged at debug level. Matches the rest of the app
 *     which is single-file-focused.
 *   - When `disabled` is true (any modal already open), drops are ignored
 *     to prevent stacked dialogs.
 */
import { useEffect } from "react";

export interface DroppedFile {
  /** Filename without directory, with extension (e.g. "sketch.excalidraw"). */
  name: string;
  /** UTF-8 file contents. */
  contents: string;
}

interface UseDragDropArgs {
  onDrop: (file: DroppedFile) => void;
  disabled: boolean;
}

/** True iff this drag carries OS files (vs. an in-app HTML5 drag). */
function isFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  // `types` is a DOMStringList in some browsers; the `.includes` check works
  // identically for both via the iterable interface.
  for (const t of types) {
    if (t === "Files") return true;
  }
  return false;
}

export function useDragDrop({ onDrop, disabled }: UseDragDropArgs): void {
  useEffect(() => {
    // We need a dragover handler that calls preventDefault, otherwise the
    // browser refuses the drop. Only claim the event when it's a file drag —
    // in-app drags must reach the row/root handlers untouched.
    const onDragOver = (e: DragEvent) => {
      if (disabled) return;
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDropEvt = (e: DragEvent) => {
      if (disabled) return;
      if (!isFileDrag(e)) return;
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // Filter for .excalidraw, ignore folders (browsers report directories
      // as zero-byte File entries on most platforms; we don't try to recurse).
      const matches: File[] = [];
      for (const f of Array.from(files)) {
        if (f.name.toLowerCase().endsWith(".excalidraw")) matches.push(f);
      }

      if (matches.length === 0) {
        if (files.length > 0) {
          // eslint-disable-next-line no-console
          console.debug(
            `[import] drop ignored — no .excalidraw files among ${files.length} dropped`,
          );
        }
        return;
      }
      if (matches.length > 1) {
        // eslint-disable-next-line no-console
        console.info(
          `[import] taking first; ignored ${matches.length - 1} additional dropped file(s)`,
        );
      }

      const first = matches[0];
      void (async () => {
        try {
          const contents = await first.text();
          onDrop({ name: first.name, contents });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[import] couldn't read dropped file:", err);
        }
      })();
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDropEvt);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDropEvt);
    };
  }, [onDrop, disabled]);
}
