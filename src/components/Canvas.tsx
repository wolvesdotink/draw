/**
 * Excalidraw canvas wrapper.
 *
 * The `key` prop is the source of truth for "what file is open". When `key`
 * changes, React unmounts the previous Excalidraw and mounts a new one — which
 * means `initialData` re-applies. This is the cleanest way to switch files.
 *
 * Side effects:
 *   - undo history is wiped per file (correct — undo should be per-document)
 *   - zoom/scroll are reset per file (also correct — drawings have independent viewports)
 */
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { FC } from "react";
import type { ExcalidrawScene } from "../lib/excalidraw-io";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { Theme } from "../lib/state";

interface CanvasProps {
  /** The active file's rel path. Used as `key` for clean remount on switch. */
  filePath: string;
  /** A version number bumped on explicit reload (so we can force remount even on same path). */
  loadVersion: number;
  initialScene: ExcalidrawScene;
  theme: Theme;
  onAPI: (api: ExcalidrawImperativeAPI) => void;
  onChange: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
}

export const Canvas: FC<CanvasProps> = ({
  filePath,
  loadVersion,
  initialScene,
  theme,
  onAPI,
  onChange,
}) => {
  return (
    <div className="canvas absolute inset-0 flex">
      <Excalidraw
        key={`${filePath}::${loadVersion}`}
        initialData={{
          elements: initialScene.elements,
          appState: initialScene.appState,
          files: initialScene.files,
          scrollToContent: true,
        }}
        excalidrawAPI={onAPI}
        onChange={onChange}
        theme={theme}
      />
    </div>
  );
};
