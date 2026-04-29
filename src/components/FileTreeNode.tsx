/**
 * One row in the sidebar tree. Handles its own expand/collapse state via
 * a parent-managed Set of expanded paths.
 *
 * Click on a file → onSelectFile(path)
 * Click on a folder → toggle expand
 * Right-click anywhere → onContextMenu(node, x, y)
 *
 * Drag-and-drop:
 *   - Every row is draggable. The dragged path travels in
 *     `dataTransfer` under "text/x-drawing-path" — we also notify the parent
 *     synchronously via onDragStartItem so it can compute valid drop targets
 *     (cycle / no-op detection needs the source path before the drop fires).
 *   - Folders accept drops; files don't. Drops on file rows or empty space in
 *     the sidebar fall through to the Sidebar's root drop handler.
 *   - To keep file-row drags from being claimed as "drop to root" by the
 *     Sidebar's container handler, file rows still stopPropagation on
 *     dragover — they just never preventDefault, so the cursor reads
 *     "no-drop". This prevents accidental moves when grazing over a sibling.
 */
import { useMemo, type DragEvent, type FC, type MouseEvent } from "react";
import type { TreeNode } from "../hooks/useFileTree";
import { parentRel, stripExt } from "../lib/paths";
import {
  ChevronDown,
  ChevronRight,
  FolderIcon,
  FolderOpenIcon,
  NibIcon,
} from "./icons";

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  expanded: Set<string>;
  /** Path of the item currently being dragged (null if no drag is active). */
  dragSource: string | null;
  /**
   * Path of the folder currently highlighted as the drop target. "" for the
   * implicit root drop zone, null when nothing is hovered.
   */
  dragOverPath: string | null;
  onToggleExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
  onDragStartItem: (path: string) => void;
  onDragEndItem: () => void;
  onDragEnterDir: (path: string) => void;
  onDragLeaveDir: (path: string) => void;
  onDropOnDir: (targetPath: string) => void;
}

/** Pure: can `source` be dropped into `target` without creating a cycle / no-op? */
function canDropInto(source: string | null, targetPath: string): boolean {
  if (source === null) return false;
  if (source === targetPath) return false;
  // Already directly inside this folder — moving in would be a no-op.
  if (parentRel(source) === targetPath) return false;
  // Folder being dragged into one of its own descendants.
  if (targetPath.startsWith(`${source}/`)) return false;
  return true;
}

export const FileTreeNode: FC<FileTreeNodeProps> = ({
  node,
  depth,
  activePath,
  expanded,
  dragSource,
  dragOverPath,
  onToggleExpand,
  onSelectFile,
  onContextMenu,
  onDragStartItem,
  onDragEndItem,
  onDragEnterDir,
  onDragLeaveDir,
  onDropOnDir,
}) => {
  const isExpanded = expanded.has(node.path);
  const isActive = activePath === node.path;

  const displayName = useMemo(
    () => (node.kind === "file" ? stripExt(node.name) : node.name),
    [node.kind, node.name],
  );

  const handleClick = () => {
    if (node.kind === "dir") {
      onToggleExpand(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(node, e.clientX, e.clientY);
  };

  // ---- Drag source ----
  const isBeingDragged = dragSource === node.path;

  const handleDragStart = (e: DragEvent<HTMLButtonElement>) => {
    // Don't bubble — only one source per drag.
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/x-drawing-path", node.path);
    onDragStartItem(node.path);
  };

  const handleDragEnd = (e: DragEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onDragEndItem();
  };

  // ---- Drop target (folders only) ----
  const acceptsDrop = node.kind === "dir" && canDropInto(dragSource, node.path);
  const isDropHover = acceptsDrop && dragOverPath === node.path;

  // Folder rows always claim drag events so the Sidebar's root drop zone
  // doesn't pick them up. Whether they actually accept the drop depends on
  // `acceptsDrop` — if false, we skip preventDefault and the cursor shows
  // "no-drop" while in-flight.
  const handleDragEnter =
    node.kind === "dir"
      ? (e: DragEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          if (acceptsDrop) {
            e.preventDefault();
            onDragEnterDir(node.path);
          }
        }
      : undefined;

  const handleDragOver =
    node.kind === "dir"
      ? (e: DragEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          if (acceptsDrop) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }
      : (e: DragEvent<HTMLButtonElement>) => {
          // File rows: claim the event so the root container doesn't treat
          // a stray drop on a sibling as "move to root", but never accept it.
          e.stopPropagation();
        };

  const handleDragLeave =
    node.kind === "dir"
      ? (e: DragEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          if (acceptsDrop) onDragLeaveDir(node.path);
        }
      : undefined;

  const handleDrop =
    node.kind === "dir"
      ? (e: DragEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          if (acceptsDrop) {
            e.preventDefault();
            onDropOnDir(node.path);
          }
        }
      : undefined;

  // Brutalist: active = inverted block (text/bg swap). Hover = subtle gray.
  //
  // NOTE: backgrounds are intentionally only set inside `rowState` (mutually
  // exclusive between active/inactive). Putting `bg-transparent` in the base
  // string here used to lose the cascade race against `bg-bg-active` in
  // Tailwind v4 — both live in the same utility layer and source order
  // decided the winner, leaving the active row visually unstyled (white text
  // on the inherited white background). Keep the bg out of `rowBase`.
  const rowBase =
    "tree-row group flex items-center gap-1.5 w-full text-left pr-2 py-[5px] text-[12.5px] leading-tight truncate select-none border-0 cursor-pointer";
  const rowState = isActive
    ? "bg-bg-active text-accent-text font-bold"
    : "bg-transparent text-text hover:bg-bg-hover";
  // Layered on top of base/active state during a drag.
  const dragState = isBeingDragged
    ? "opacity-40"
    : isDropHover
      ? "drop-target"
      : "";

  return (
    <li className="m-0 p-0" role="treeitem">
      <button
        type="button"
        className={`${rowBase} ${rowState} ${dragState}`}
        // Left padding scales with depth; CSS uses --depth for indent guides
        style={{
          paddingLeft: `${10 + depth * 14}px`,
          ["--depth" as string]: depth,
        }}
        data-active={isActive ? "true" : "false"}
        data-depth={depth}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        aria-expanded={node.kind === "dir" ? isExpanded : undefined}
        aria-grabbed={isBeingDragged ? true : undefined}
        title={node.path}
      >
        {/* Chevron column — present on dirs, blank on files for alignment */}
        <span
          className="w-3 flex-none inline-flex items-center justify-center text-text-faint group-hover:text-text-muted transition-colors duration-100"
          aria-hidden
        >
          {node.kind === "dir" ? (
            isExpanded ? (
              <ChevronDown size={11} />
            ) : (
              <ChevronRight size={11} />
            )
          ) : null}
        </span>

        {/* Type glyph — folder vs nib */}
        <span
          className={`flex-none inline-flex items-center justify-center ${
            isActive
              ? "text-accent-text"
              : node.kind === "dir"
                ? "text-text-muted group-hover:text-text"
                : "text-text-faint group-hover:text-text-muted"
          }`}
          aria-hidden
        >
          {node.kind === "dir" ? (
            isExpanded ? (
              <FolderOpenIcon size={14} />
            ) : (
              <FolderIcon size={14} />
            )
          ) : (
            <NibIcon size={14} />
          )}
        </span>

        <span className="truncate">{displayName}</span>
      </button>
      {node.kind === "dir" && isExpanded && node.children && node.children.length > 0 && (
        <ul className="list-none m-0 p-0" role="group">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expanded={expanded}
              dragSource={dragSource}
              dragOverPath={dragOverPath}
              onToggleExpand={onToggleExpand}
              onSelectFile={onSelectFile}
              onContextMenu={onContextMenu}
              onDragStartItem={onDragStartItem}
              onDragEndItem={onDragEndItem}
              onDragEnterDir={onDragEnterDir}
              onDragLeaveDir={onDragLeaveDir}
              onDropOnDir={onDropOnDir}
            />
          ))}
        </ul>
      )}
    </li>
  );
};
