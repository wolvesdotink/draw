/**
 * CSS-proxy zoom for Excalidraw — buttery zoom on WKWebView.
 *
 * The problem
 * -----------
 * Excalidraw redraws the entire static canvas at every zoom value (the
 * renderer's memoization key includes zoom). On WKWebView the Canvas2D
 * rasterization is CPU-bound, so each frame of a zoom gesture is
 * expensive — pinch-zooming feels sluggish even on small drawings.
 *
 * The fix (Figma / Felt technique)
 * --------------------------------
 * During an active wheel-zoom gesture we DON'T propagate zoom into
 * Excalidraw's state. Instead we CSS-scale the `.excalidraw__canvas-wrapper`
 * (a single GPU-composited transform — essentially free) and accumulate
 * the running scale. When the gesture ends (~120ms idle, or interrupted
 * by pointerdown / plain pan), we clear the CSS transform and commit the
 * final zoom + scroll offset to Excalidraw via `updateScene`. The canvas
 * redraws ONCE, crisp, at the final zoom.
 *
 * What stays Excalidraw-native:
 *   - Plain wheel (no ctrl/meta) → pan via Excalidraw's handler.
 *   - Keyboard zoom shortcuts → Excalidraw handles directly.
 *   - Programmatic zoom via `updateScene` from elsewhere — unchanged.
 *
 * Why intercept at the capture phase:
 *   Excalidraw's wheel listener attaches to the canvas elements with
 *   `{ passive: false }`. We attach to the outer container with
 *   `{ capture: true }` and call `preventDefault` + `stopPropagation`
 *   so the zoom-intent event never reaches Excalidraw.
 *
 * Zoom-anchor math (verified against Excalidraw's `getStateForZoom`):
 *   appLayer  = cursorClient - appState.offset
 *   newScroll = scroll + appLayer/oldZoom - appLayer/newZoom
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

const GESTURE_IDLE_MS = 120;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
// Tuned so a single trackpad pinch frame (deltaY ≈ ±5–10) feels right.
// Exponential — keeps zoom-in and zoom-out symmetric and multiplicative.
const ZOOM_SENSITIVITY = 0.01;

type GestureFlag = "active" | undefined;

export interface UseCanvasZoomProxyResult {
  containerRef: React.RefObject<HTMLDivElement>;
  dataGesture: GestureFlag;
}

export function useCanvasZoomProxy(
  getAPI: () => ExcalidrawImperativeAPI | null,
): UseCanvasZoomProxyResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dataGesture, setDataGesture] = useState<GestureFlag>(undefined);

  // Capture the latest `getAPI` without re-running the effect (which would
  // tear down listeners). Refs read the freshest value at handler time.
  const getAPIRef = useRef(getAPI);
  getAPIRef.current = getAPI;

  // Stable flag setter for use inside listener closures.
  const setGesture = useCallback((next: GestureFlag) => {
    setDataGesture(next);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    // Gesture state (kept in closure — no React state churn per frame).
    let active = false;
    let scale = 1;
    let originClientX = 0;
    let originClientY = 0;
    let startZoom = 1;
    let startScrollX = 0;
    let startScrollY = 0;
    let startOffsetLeft = 0;
    let startOffsetTop = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let wrapperEl: HTMLElement | null = null;

    const clearIdleTimer = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const applyTransform = () => {
      if (wrapperEl === null) return;
      const tx = (1 - scale) * originClientX;
      const ty = (1 - scale) * originClientY;
      wrapperEl.style.transformOrigin = "0 0";
      wrapperEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    const clearTransform = () => {
      if (wrapperEl === null) return;
      wrapperEl.style.transform = "";
      wrapperEl.style.transformOrigin = "";
    };

    const resetState = () => {
      active = false;
      scale = 1;
      wrapperEl = null;
    };

    /**
     * Commit accumulated scale to Excalidraw and clear the CSS preview.
     * Safe to call from idle timer, pointerdown, plain wheel, or unmount.
     */
    const commit = () => {
      if (!active) return;
      clearIdleTimer();
      const api = getAPIRef.current();
      if (api !== null && wrapperEl !== null && wrapperEl.isConnected) {
        const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom * scale));
        const appLayerX = originClientX - startOffsetLeft;
        const appLayerY = originClientY - startOffsetTop;
        // `getStateForZoom` formula: keep the anchor (cursor) point fixed.
        const baseScrollX = startScrollX + appLayerX - appLayerX / startZoom;
        const baseScrollY = startScrollY + appLayerY - appLayerY / startZoom;
        const newScrollX = baseScrollX - (appLayerX - appLayerX / targetZoom);
        const newScrollY = baseScrollY - (appLayerY - appLayerY / targetZoom);
        api.updateScene({
          appState: {
            zoom: { value: targetZoom as NormalizedZoomValue },
            scrollX: newScrollX,
            scrollY: newScrollY,
          },
        });
      }
      clearTransform();
      resetState();
      setGesture(undefined);
    };

    /**
     * Abort the gesture without committing. Used when the wrapper element
     * disappears mid-gesture (e.g. Excalidraw remount on file switch).
     */
    const abort = () => {
      clearIdleTimer();
      clearTransform();
      resetState();
      setGesture(undefined);
    };

    const scheduleIdle = () => {
      clearIdleTimer();
      idleTimer = setTimeout(commit, GESTURE_IDLE_MS);
    };

    const handleWheel = (e: WheelEvent) => {
      // Plain wheel (no modifier) is pan-intent — let Excalidraw handle it.
      // If a zoom gesture is mid-flight, commit it first so pan runs against
      // the new (crisp) state rather than the CSS-scaled preview.
      if (!(e.ctrlKey || e.metaKey)) {
        if (active) commit();
        return;
      }

      // Zoom intent. We own the event.
      e.preventDefault();
      e.stopPropagation();

      // Normalize deltaY across deltaMode (PIXEL=0, LINE=1, PAGE=2).
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) deltaY *= 16;
      else if (e.deltaMode === 2) deltaY *= 100;

      if (!active) {
        const api = getAPIRef.current();
        if (api === null) return;
        const appState = api.getAppState();
        startZoom = appState.zoom.value;
        startScrollX = appState.scrollX;
        startScrollY = appState.scrollY;
        startOffsetLeft = appState.offsetLeft;
        startOffsetTop = appState.offsetTop;
        originClientX = e.clientX;
        originClientY = e.clientY;
        scale = 1;
        wrapperEl = container.querySelector(".excalidraw__canvas-wrapper");
        if (wrapperEl === null) return;
        active = true;
        setGesture("active");
      } else if (wrapperEl !== null && !wrapperEl.isConnected) {
        // Excalidraw remounted mid-gesture (file switch). Abort cleanly.
        abort();
        return;
      }

      scale *= Math.exp(-deltaY * ZOOM_SENSITIVITY);
      // Clamp the preview so it cannot exceed Excalidraw's commit range.
      const minScale = MIN_ZOOM / startZoom;
      const maxScale = MAX_ZOOM / startZoom;
      if (scale < minScale) scale = minScale;
      else if (scale > maxScale) scale = maxScale;
      applyTransform();
      scheduleIdle();
    };

    // Mid-gesture pointerdown distorts coordinate mapping (drag would start
    // in the CSS-scaled frame). Commit first so the click lands in the
    // committed, identity-transform frame.
    const handlePointerDown = () => {
      if (active) commit();
    };

    container.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    container.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });

    return () => {
      container.removeEventListener("wheel", handleWheel, { capture: true });
      container.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
      clearIdleTimer();
      // Don't try to commit on unmount — Excalidraw may be tearing down.
      // Just clear any stale inline transform so the wrapper unmounts clean.
      clearTransform();
    };
  }, [setGesture]);

  return { containerRef, dataGesture };
}
