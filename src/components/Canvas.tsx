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
import { memo, useCallback, useRef, type FC } from "react";
import { useCanvasZoomProxy } from "../hooks/useCanvasZoomProxy";
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

const CanvasImpl: FC<CanvasProps> = ({
  filePath,
  loadVersion,
  initialScene,
  theme,
  onAPI,
  onChange,
}) => {
  // Local handle on the API so the zoom proxy can read/write Excalidraw
  // state without depending on the parent's ref. We still forward the API
  // up to the caller via `onAPI` so useAutoSave and friends keep working.
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const getAPI = useCallback(() => apiRef.current, []);
  const { containerRef, dataGesture } = useCanvasZoomProxy(getAPI);

  const handleAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
      onAPI(api);
    },
    [onAPI],
  );

  return (
    <div ref={containerRef} className="canvas absolute inset-0 flex" data-gesture={dataGesture}>
      <Excalidraw
        key={`${filePath}::${loadVersion}`}
        initialData={{
          elements: initialScene.elements,
          appState: initialScene.appState,
          files: initialScene.files,
          scrollToContent: true,
        }}
        excalidrawAPI={handleAPI}
        onChange={onChange}
        theme={theme}
        // No ancestor of `.canvas` can scroll (overflow:hidden cascade in
        // app.css), so Excalidraw's scroll-listener bookkeeping is pure
        // overhead on every wheel/pointer event. Off → fewer offset
        // recalcs during zoom-pan.
        detectScroll={false}
      />
    </div>
  );
};

export const Canvas = memo(CanvasImpl);
