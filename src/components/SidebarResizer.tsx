/**
 * Drag handle on the sidebar's right edge for resizing the sidebar.
 *
 * Uses pointer events for smooth dragging. Clamps width to [min, max].
 * The parent owns the width state — we just emit live updates as the user drags.
 *
 * Visual: a 1px hairline at rest, expanding to a 4px terracotta beam during
 * hover/drag with a 3-dot grip rail centered vertically.
 */
import { useCallback, useEffect, useRef, useState, type FC, type PointerEvent } from "react";

interface SidebarResizerProps {
  width: number;
  min?: number;
  max?: number;
  onWidthChange: (next: number) => void;
  /** Called once when drag ends, with the final width. Use to debounce-persist. */
  onCommit?: (next: number) => void;
}

export const SidebarResizer: FC<SidebarResizerProps> = ({
  width,
  min = 180,
  max = 600,
  onWidthChange,
  onCommit,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHover, setIsHover] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const lastWidthRef = useRef(width);

  // Keep latest width visible to listeners that close over it
  lastWidthRef.current = width;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    setIsDragging(true);
  };

  // Use document-level listeners while dragging so we don't lose the move events
  // when the cursor strays off the handle
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: globalThis.PointerEvent) => {
      const delta = e.clientX - startXRef.current;
      const next = Math.min(max, Math.max(min, startWidthRef.current + delta));
      lastWidthRef.current = next;
      onWidthChange(next);
    };
    const onUp = () => {
      setIsDragging(false);
      onCommit?.(lastWidthRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging, max, min, onWidthChange, onCommit]);

  // Double-click resets to default 260
  const handleDoubleClick = useCallback(() => {
    onWidthChange(260);
    onCommit?.(260);
  }, [onWidthChange, onCommit]);

  const active = isDragging || isHover;

  return (
    <div
      className="flex-none relative w-0 cursor-col-resize z-10 group"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onPointerEnter={() => setIsHover(true)}
      onPointerLeave={() => setIsHover(false)}
    >
      {/* Hit area wider than the visual line for forgiving grab targeting */}
      <div className="absolute inset-y-0 -left-2 -right-1" aria-hidden />

      {/* Hard rail — 2px solid block when active, transparent at rest
          (the sidebar wrapper already provides a 2px right border). */}
      <div
        className="absolute inset-y-0 -left-0.5 w-1"
        style={{
          background: active ? "var(--accent)" : "transparent",
        }}
        aria-hidden
      />

      {/* Grip block (visible on hover/drag) — 3 stacked squares */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1"
        style={{ opacity: active ? 1 : 0 }}
        aria-hidden
      >
        <span className="block w-[3px] h-[3px] bg-accent-text" />
        <span className="block w-[3px] h-[3px] bg-accent-text" />
        <span className="block w-[3px] h-[3px] bg-accent-text" />
      </div>
    </div>
  );
};
