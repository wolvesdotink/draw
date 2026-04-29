/**
 * Sidebar with file tree and right-click context menu.
 *
 * Stripped down to its purpose: a list of drawings. The global controls
 * (theme, new drawing, sidebar toggle) live in the App-level topbar so the
 * sidebar can be a single quiet column of file rows — no branding, no chrome.
 *
 * Owns:
 *   - expanded folder state (Set<string>)
 *   - context menu state (which node was clicked, where)
 *   - "new item" / "rename" dialog state
 *
 * All file-system mutations are delegated to useFileTree (passed as props).
 */
import { useCallback, useEffect, useMemo, useState, type FC } from "react";
import type { TreeNode, UseFileTreeResult } from "../hooks/useFileTree";
import { FileTreeNode } from "./FileTreeNode";
import { NewItemDialog, type DialogMode } from "./NewItemDialog";
import { parentRel } from "../lib/paths";
import { FolderIcon, NibIcon } from "./icons";

interface SidebarProps {
  fileTree: UseFileTreeResult;
  activePath: string | null;
  onSelectFile: (path: string) => void;
  /** Called when the active file is about to be deleted, so the canvas closes. */
  onActiveFileRemoved: () => void;
  /** Called when the active file's path changes (rename of file or ancestor folder). */
  onActiveFileMoved: (newPath: string) => void;
  /** Persisted expand state from app state. */
  initialExpanded: Record<string, boolean>;
  onExpandedChange: (expanded: Record<string, boolean>) => void;
}

interface ContextMenuState {
  node: TreeNode | null; // null means root
  x: number;
  y: number;
}

interface DialogState {
  mode: DialogMode;
  /** Where the new item should be placed (for newFile/newFolder) — parent dir rel path. */
  parentDir: string;
  /** Existing path being renamed. */
  targetPath?: string;
  /** Initial value for input. */
  initialValue?: string;
  /** Existing kind (for rename — file vs dir). */
  targetKind?: "file" | "dir";
}

/** Walk the tree and tally drawings + folders. */
function tallyTree(nodes: TreeNode[]): { files: number; folders: number } {
  let files = 0;
  let folders = 0;
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.kind === "file") files += 1;
      else {
        folders += 1;
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return { files, folders };
}

export const Sidebar: FC<SidebarProps> = ({
  fileTree,
  activePath,
  onSelectFile,
  onActiveFileRemoved,
  onActiveFileMoved,
  initialExpanded,
  onExpandedChange,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const out = new Set<string>();
    for (const [k, v] of Object.entries(initialExpanded)) {
      if (v) out.add(k);
    }
    return out;
  });
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  /**
   * In-app drag state. `dragSource` is the rel path of the row currently being
   * dragged; `dragOverPath` is the rel path of the folder highlighted as the
   * drop target ("" for root, null for nothing).
   *
   * Both clear on dragend regardless of whether the drop succeeded — covers
   * the "user dropped outside the window / hit Escape" case so we never get
   * stuck with a stale highlight.
   */
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const tally = useMemo(() => tallyTree(fileTree.tree), [fileTree.tree]);

  const persistExpanded = useCallback(
    (next: Set<string>) => {
      const obj: Record<string, boolean> = {};
      for (const p of next) obj[p] = true;
      onExpandedChange(obj);
    },
    [onExpandedChange],
  );

  const toggleExpand = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        persistExpanded(next);
        return next;
      });
    },
    [persistExpanded],
  );

  const handleContextMenu = useCallback((node: TreeNode, x: number, y: number) => {
    setMenu({ node, x, y });
  }, []);

  // Close context menu on any click elsewhere or Esc
  useEffect(() => {
    if (menu === null) return;
    const onPointerDown = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    // Defer attaching pointerdown by one tick so the click that opened the menu doesn't immediately close it
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openCreateFileDialog = (parentDir: string) => {
    setDialog({ mode: "newFile", parentDir });
    setMenu(null);
  };

  const openCreateFolderDialog = (parentDir: string) => {
    setDialog({ mode: "newFolder", parentDir });
    setMenu(null);
  };

  const openRenameDialog = (node: TreeNode) => {
    setDialog({
      mode: "rename",
      parentDir: parentRel(node.path),
      targetPath: node.path,
      initialValue: node.name,
      targetKind: node.kind,
    });
    setMenu(null);
  };

  const handleDelete = async (node: TreeNode) => {
    setMenu(null);
    const isActive = node.path === activePath;
    const isAncestorOfActive =
      node.kind === "dir" &&
      activePath !== null &&
      activePath.startsWith(`${node.path}/`);
    const label = node.kind === "dir" ? "folder" : "drawing";
    const confirmed = window.confirm(
      `Delete ${label} "${node.name}"?${node.kind === "dir" ? " This will delete its contents too." : ""}`,
    );
    if (!confirmed) return;
    if (isActive || isAncestorOfActive) onActiveFileRemoved();
    try {
      await fileTree.remove(node.path, node.kind === "dir");
    } catch (e) {
      window.alert(`Couldn't delete: ${(e as Error).message}`);
    }
  };

  const submitDialog = async (name: string) => {
    if (dialog === null) return;
    try {
      if (dialog.mode === "newFile") {
        const newPath = await fileTree.createFile(dialog.parentDir, name);
        // Auto-expand the parent folder so the new file is visible
        if (dialog.parentDir) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(dialog.parentDir);
            persistExpanded(next);
            return next;
          });
        }
        onSelectFile(newPath);
      } else if (dialog.mode === "newFolder") {
        const newPath = await fileTree.createFolder(dialog.parentDir, name);
        if (dialog.parentDir) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(dialog.parentDir);
            next.add(newPath);
            persistExpanded(next);
            return next;
          });
        } else {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(newPath);
            persistExpanded(next);
            return next;
          });
        }
      } else if (dialog.mode === "rename" && dialog.targetPath) {
        const newPath = await fileTree.rename(dialog.targetPath, name);
        // If we renamed a file (or dir) that contained the active path, update.
        const wasActive = activePath === dialog.targetPath;
        const wasAncestor =
          dialog.targetKind === "dir" &&
          activePath !== null &&
          activePath.startsWith(`${dialog.targetPath}/`);
        if (wasActive) {
          onActiveFileMoved(newPath);
        } else if (wasAncestor && activePath) {
          const tail = activePath.slice(dialog.targetPath.length); // e.g. "/foo.excalidraw"
          onActiveFileMoved(`${newPath}${tail}`);
        }
      }
      setDialog(null);
    } catch (e) {
      // re-throw so the dialog displays the error
      throw e;
    }
  };

  const handleRootContextMenu = (e: React.MouseEvent) => {
    // FileTreeNode rows already stopPropagation in their own contextmenu
    // handler, so anything that bubbles up here is genuinely "not on a
    // row" — the empty-state hint, the loading/error message, the
    // padding around the list, etc. We used to require
    // e.target === e.currentTarget which broke right-click on the empty
    // state because the user almost always clicked the hint <p>, not
    // the bare scroll container.
    e.preventDefault();
    setMenu({ node: null, x: e.clientX, y: e.clientY });
  };

  // ---------- Drag / drop ----------
  const handleDragStartItem = useCallback((path: string) => {
    setDragSource(path);
    setDragOverPath(null);
  }, []);

  const handleDragEndItem = useCallback(() => {
    setDragSource(null);
    setDragOverPath(null);
  }, []);

  const handleDragEnterDir = useCallback((path: string) => {
    setDragOverPath(path);
  }, []);

  const handleDragLeaveDir = useCallback((_path: string) => {
    // Clear unconditionally — the next dragenter will set it again. Keeping
    // it simple avoids the classic "dragenter on child fires before dragleave
    // on parent" flicker fight.
    setDragOverPath(null);
  }, []);

  const performMove = useCallback(
    async (sourcePath: string, targetParentDir: string) => {
      // Compute active-file fate before the FS hit so we can reopen post-move.
      const isDir = !sourcePath.endsWith(".excalidraw");
      const wasActive = activePath === sourcePath;
      const wasAncestor =
        isDir &&
        activePath !== null &&
        activePath.startsWith(`${sourcePath}/`);
      try {
        const newPath = await fileTree.move(sourcePath, targetParentDir);
        // Auto-expand the destination so the user can see what they just did.
        if (targetParentDir !== "") {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.add(targetParentDir);
            persistExpanded(next);
            return next;
          });
        }
        if (wasActive) {
          onActiveFileMoved(newPath);
        } else if (wasAncestor && activePath !== null) {
          // Active file lived inside the moved folder — rewrite its prefix.
          const tail = activePath.slice(sourcePath.length); // e.g. "/foo.excalidraw"
          onActiveFileMoved(`${newPath}${tail}`);
        }
      } catch (e) {
        window.alert(`Couldn't move: ${(e as Error).message}`);
      }
    },
    [fileTree, activePath, onActiveFileMoved, persistExpanded],
  );

  const handleDropOnDir = useCallback(
    (targetPath: string) => {
      const src = dragSource;
      setDragSource(null);
      setDragOverPath(null);
      if (src === null) return;
      void performMove(src, targetPath);
    },
    [dragSource, performMove],
  );

  // Root drop zone — fires when the dragover/drop bubbled past every row
  // (file rows stopPropagation but never preventDefault, folder rows always
  // claim). The only events that reach here are drops in genuinely empty
  // space below the file list.
  const handleRootDragOver = (e: React.DragEvent) => {
    if (dragSource === null) return;
    // Already at root? No-op move; don't claim the event.
    if (parentRel(dragSource) === "") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverPath !== "") setDragOverPath("");
  };

  const handleRootDrop = (e: React.DragEvent) => {
    if (dragSource === null) return;
    if (parentRel(dragSource) === "") return;
    e.preventDefault();
    const src = dragSource;
    setDragSource(null);
    setDragOverPath(null);
    void performMove(src, "");
  };

  // Spring-load: a folder hovered for ~700ms during a drag auto-expands so
  // the user can navigate into it without releasing first. Mirrors Finder.
  useEffect(() => {
    if (dragSource === null) return;
    if (dragOverPath === null || dragOverPath === "") return;
    if (expanded.has(dragOverPath)) return;
    const id = setTimeout(() => {
      setExpanded((prev) => {
        if (prev.has(dragOverPath)) return prev;
        const next = new Set(prev);
        next.add(dragOverPath);
        persistExpanded(next);
        return next;
      });
    }, 700);
    return () => clearTimeout(id);
  }, [dragSource, dragOverPath, expanded, persistExpanded]);

  // Shared utility chains — brutalist: no rounded corners, hard borders, mono labels.
  const ctxItemBtn =
    "w-full text-left flex items-center gap-2.5 px-3 py-2 text-[12px] font-mono uppercase tracking-wider bg-transparent border-0 text-text hover:bg-text hover:text-bg cursor-pointer";
  const ctxItemDanger = `${ctxItemBtn} !text-danger hover:!text-bg hover:!bg-danger`;
  const kbd =
    "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 border border-border-strong bg-bg text-[10px] font-mono text-text-muted leading-none";

  return (
    <aside className="flex flex-col h-full w-full">
      {/* Hard mono header rule. */}
      <div className="flex items-center gap-2 pl-4 pr-3 pt-3 pb-2 flex-none border-b-2 border-border">
        <span
          className="text-[10px] uppercase tracking-[0.24em] font-mono font-bold text-text"
          aria-hidden
        >
          DRAWINGS
        </span>
        <div className="flex-1 h-0.5 bg-border" />
        <span className="text-[10px] font-mono font-bold text-text tabular-nums">
          [{tally.files}]
        </span>
      </div>

      <div
        className={`scroll-quiet flex-1 overflow-y-auto overflow-x-hidden pt-0.5 pb-3 ${
          dragSource !== null && dragOverPath === ""
            ? "drop-target-root"
            : ""
        }`}
        onContextMenu={handleRootContextMenu}
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {fileTree.loading && fileTree.tree.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-text-muted italic">Loading…</p>
        ) : fileTree.error ? (
          <p className="px-4 py-6 text-[12px] text-danger">
            Error: {fileTree.error.message}
          </p>
        ) : fileTree.tree.length === 0 ? (
          <div className="px-4 py-5 text-[12px] text-text-muted leading-relaxed">
            <p className="m-0">
              Press <span className={kbd}>⌘N</span> or right-click here to begin.
            </p>
          </div>
        ) : (
          <ul className="list-none m-0 p-0" role="tree">
            {fileTree.tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                activePath={activePath}
                expanded={expanded}
                dragSource={dragSource}
                dragOverPath={dragOverPath}
                onToggleExpand={toggleExpand}
                onSelectFile={onSelectFile}
                onContextMenu={handleContextMenu}
                onDragStartItem={handleDragStartItem}
                onDragEndItem={handleDragEndItem}
                onDragEnterDir={handleDragEnterDir}
                onDragLeaveDir={handleDragLeaveDir}
                onDropOnDir={handleDropOnDir}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer — hard top rule, mono caps, structural feel */}
      <footer className="flex-none border-t-2 border-border px-4 py-2.5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-text-muted select-none">
        <span className="tabular-nums">
          {tally.files} {tally.files === 1 ? "DRAWING" : "DRAWINGS"}
          {tally.folders > 0 && ` / ${tally.folders} ${tally.folders === 1 ? "FOLDER" : "FOLDERS"}`}
        </span>
        <span className="flex items-center gap-1">
          <span className={kbd}>⌘N</span>
          <span>NEW</span>
        </span>
      </footer>

      {menu !== null && (
        <ul
          className="fixed bg-bg border-2 border-border min-w-[220px] z-[100] py-0 list-none m-0 animate-pop-in"
          style={{ top: menu.y, left: menu.x, boxShadow: "var(--shadow-popover)" }}
          // The window-level "close menu on pointerdown" listener fires
          // before React dispatches the menu item's click. Without
          // stopping pointerdown here, React 18's automatic flush after
          // the pointerdown handler unmounts the menu before click runs —
          // which silently swallows every menu action. Stop it at the UL.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.node === null ? (
            <>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openCreateFileDialog("")}
                >
                  <NibIcon size={14} className="text-text-muted" />
                  New drawing
                </button>
              </li>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openCreateFolderDialog("")}
                >
                  <FolderIcon size={14} className="text-text-muted" />
                  New folder
                </button>
              </li>
            </>
          ) : menu.node.kind === "dir" ? (
            <>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openCreateFileDialog(menu.node!.path)}
                >
                  <NibIcon size={14} className="text-text-muted" />
                  New drawing in here
                </button>
              </li>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openCreateFolderDialog(menu.node!.path)}
                >
                  <FolderIcon size={14} className="text-text-muted" />
                  New folder in here
                </button>
              </li>
              <li
                className="my-1 h-px mx-2 bg-border"
                role="separator"
                aria-hidden
              />
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openRenameDialog(menu.node!)}
                >
                  <span className="w-3.5 inline-flex justify-center text-text-muted">
                    ✎
                  </span>
                  Rename
                </button>
              </li>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemDanger}
                  onClick={() => handleDelete(menu.node!)}
                >
                  <span className="w-3.5 inline-flex justify-center">×</span>
                  Delete folder…
                </button>
              </li>
            </>
          ) : (
            <>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemBtn}
                  onClick={() => openRenameDialog(menu.node!)}
                >
                  <span className="w-3.5 inline-flex justify-center text-text-muted">
                    ✎
                  </span>
                  Rename
                </button>
              </li>
              <li className="m-0 p-0">
                <button
                  type="button"
                  className={ctxItemDanger}
                  onClick={() => handleDelete(menu.node!)}
                >
                  <span className="w-3.5 inline-flex justify-center">×</span>
                  Delete drawing
                </button>
              </li>
            </>
          )}
        </ul>
      )}

      {dialog !== null && (
        <NewItemDialog
          mode={dialog.mode}
          initialValue={dialog.initialValue}
          context={
            dialog.mode === "rename"
              ? `Renaming ${dialog.targetKind === "dir" ? "folder" : "drawing"} “${dialog.initialValue}”`
              : dialog.parentDir
                ? `Inside /${dialog.parentDir}`
                : "At root"
          }
          onSubmit={submitDialog}
          onCancel={() => setDialog(null)}
        />
      )}
    </aside>
  );
};
