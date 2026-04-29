/**
 * File tree state for the sidebar.
 *
 * Strategy: do a full recursive re-read of drawings/ on every mutation.
 * For 50–500 files this is single-digit milliseconds; not worth incremental updates.
 *
 * All paths in this module are "rel" (relative to drawings root).
 */
import { useCallback, useEffect, useState } from "react";
import { mkdir, readDir, remove, rename, exists, writeAtomic } from "../lib/fs";
import { writeEmptyDrawing } from "../lib/excalidraw-io";
import {
  basename,
  DRAWINGS_DIR,
  ensureExt,
  isValidName,
  joinRel,
  parentRel,
  toAppDataPath,
} from "../lib/paths";

export type NodeKind = "dir" | "file";

export interface TreeNode {
  /** rel path, e.g. "work/foo.excalidraw" or "work" or "" for root */
  path: string;
  /** display name (last path segment) */
  name: string;
  kind: NodeKind;
  /** Only present for dirs. */
  children?: TreeNode[];
}

async function readTreeRecursive(relDir: string): Promise<TreeNode[]> {
  const entries = await readDir(toAppDataPath(relDir));
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    // skip hidden + tmp + .DS_Store
    if (entry.name.startsWith(".") || entry.name.endsWith(".tmp")) continue;

    const childRel = joinRel(relDir, entry.name);

    if (entry.isDirectory) {
      const children = await readTreeRecursive(childRel);
      nodes.push({
        path: childRel,
        name: entry.name,
        kind: "dir",
        children,
      });
    } else if (entry.isFile && entry.name.endsWith(".excalidraw")) {
      nodes.push({
        path: childRel,
        name: entry.name,
        kind: "file",
      });
    }
  }

  // dirs first, then files; alphabetical within each group
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

export interface UseFileTreeResult {
  tree: TreeNode[];
  loading: boolean;
  error: Error | null;
  /** Refresh the entire tree from disk. */
  refresh: () => Promise<void>;
  /**
   * Create a new drawing. Returns the rel path of the created file.
   * `parentDirRel` is the parent folder ("" = root). `name` is without extension.
   */
  createFile: (parentDirRel: string, name: string) => Promise<string>;
  /** Create a new folder. Returns the rel path of the created dir. */
  createFolder: (parentDirRel: string, name: string) => Promise<string>;
  /** Rename a file or folder. Returns the new rel path. */
  rename: (rel: string, newName: string) => Promise<string>;
  /**
   * Move a file or folder into a different parent folder, preserving its leaf
   * name. `newParentDirRel` is "" for the drawings root. Returns the new rel
   * path. Throws if the move would create a cycle (folder into its own
   * descendant) or if a sibling with the same name already exists at the
   * destination.
   */
  move: (rel: string, newParentDirRel: string) => Promise<string>;
  /** Delete a file or folder (recursively for folders). */
  remove: (rel: string, isDir: boolean) => Promise<void>;
  /**
   * Import a drawing — write `contents` (raw .excalidraw JSON text) to the
   * given parent dir under `name` (without extension). Mirrors `createFile`
   * but uses caller-provided contents instead of an empty scene.
   *
   * If `opts.overwrite` is false (default) and the target file already
   * exists, throws — callers route through `ConfirmOverwriteDialog` and
   * retry with `overwrite: true`. Returns the rel path of the written file.
   */
  importFile: (
    parentDirRel: string,
    name: string,
    contents: string,
    opts?: { overwrite?: boolean },
  ) => Promise<string>;
}

export function useFileTree(): UseFileTreeResult {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const root = await readTreeRecursive("");
      setTree(root);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createFile = useCallback(
    async (parentDirRel: string, name: string): Promise<string> => {
      if (!isValidName(name)) throw new Error(`Invalid name: ${name}`);
      const filename = ensureExt(name);
      const rel = joinRel(parentDirRel, filename);
      if (await exists(toAppDataPath(rel))) {
        throw new Error(`A file named "${filename}" already exists.`);
      }
      // Make sure parent dir exists (the user could've created it as part of a path)
      if (parentDirRel) {
        await mkdir(toAppDataPath(parentDirRel), { recursive: true });
      }
      await writeEmptyDrawing(rel);
      await refresh();
      return rel;
    },
    [refresh],
  );

  const createFolder = useCallback(
    async (parentDirRel: string, name: string): Promise<string> => {
      if (!isValidName(name)) throw new Error(`Invalid name: ${name}`);
      const rel = joinRel(parentDirRel, name);
      if (await exists(toAppDataPath(rel))) {
        throw new Error(`A folder named "${name}" already exists.`);
      }
      await mkdir(toAppDataPath(rel), { recursive: true });
      await refresh();
      return rel;
    },
    [refresh],
  );

  const renameNode = useCallback(
    async (rel: string, newName: string): Promise<string> => {
      if (!isValidName(newName)) throw new Error(`Invalid name: ${newName}`);
      const parent = parentRel(rel);
      // For files, preserve .excalidraw extension if user dropped it
      const isFile = rel.endsWith(".excalidraw");
      const finalName = isFile ? ensureExt(newName) : newName;
      const newRel = joinRel(parent, finalName);
      if (newRel === rel) return rel;
      if (await exists(toAppDataPath(newRel))) {
        throw new Error(`"${finalName}" already exists at this location.`);
      }
      await rename(toAppDataPath(rel), toAppDataPath(newRel));
      await refresh();
      return newRel;
    },
    [refresh],
  );

  const moveNode = useCallback(
    async (rel: string, newParentDirRel: string): Promise<string> => {
      const name = basename(rel);
      const newRel = joinRel(newParentDirRel, name);
      // No-op: dropped back into the same parent folder.
      if (newRel === rel) return rel;

      // Folders can't be moved into themselves or any of their descendants —
      // that would orphan the subtree on disk and leave the UI in a bad state.
      const isDir = !rel.endsWith(".excalidraw");
      if (isDir) {
        if (newParentDirRel === rel || newParentDirRel.startsWith(`${rel}/`)) {
          throw new Error(
            "Can't move a folder into itself or one of its subfolders.",
          );
        }
      }

      if (await exists(toAppDataPath(newRel))) {
        throw new Error(`"${name}" already exists in the destination folder.`);
      }
      // Materialise the destination dir if the user dropped onto a path that
      // doesn't physically exist yet (shouldn't normally happen since drops
      // target visible folders, but cheap insurance).
      if (newParentDirRel) {
        await mkdir(toAppDataPath(newParentDirRel), { recursive: true });
      }
      await rename(toAppDataPath(rel), toAppDataPath(newRel));
      await refresh();
      return newRel;
    },
    [refresh],
  );

  const removeNode = useCallback(
    async (rel: string, isDir: boolean): Promise<void> => {
      await remove(toAppDataPath(rel), { recursive: isDir });
      await refresh();
    },
    [refresh],
  );

  const importFile = useCallback(
    async (
      parentDirRel: string,
      name: string,
      contents: string,
      opts?: { overwrite?: boolean },
    ): Promise<string> => {
      if (!isValidName(name)) throw new Error(`Invalid name: ${name}`);
      const filename = ensureExt(name);
      const rel = joinRel(parentDirRel, filename);
      const overwrite = opts?.overwrite === true;
      if (!overwrite && (await exists(toAppDataPath(rel)))) {
        throw new Error(`A file named "${filename}" already exists.`);
      }
      if (parentDirRel) {
        await mkdir(toAppDataPath(parentDirRel), { recursive: true });
      }
      await writeAtomic(toAppDataPath(rel), contents);
      await refresh();
      return rel;
    },
    [refresh],
  );

  return {
    tree,
    loading,
    error,
    refresh,
    createFile,
    createFolder,
    rename: renameNode,
    move: moveNode,
    remove: removeNode,
    importFile,
  };
}

/**
 * Bootstrap helper: ensure the drawings root directory exists.
 * Called once from App.tsx before mounting useFileTree consumers.
 */
export async function ensureDrawingsRoot(): Promise<void> {
  await mkdir(DRAWINGS_DIR, { recursive: true });
}

/** Walk the tree and return the node at a given rel path, or null. */
export function findNode(tree: TreeNode[], rel: string): TreeNode | null {
  if (rel === "") return null;
  for (const node of tree) {
    if (node.path === rel) return node;
    if (node.kind === "dir" && node.children) {
      const found = findNode(node.children, rel);
      if (found) return found;
    }
  }
  return null;
}

/** Flatten dirs from a tree into a list. Useful for "move to folder" pickers. */
export function flattenDirs(tree: TreeNode[], out: TreeNode[] = []): TreeNode[] {
  for (const node of tree) {
    if (node.kind === "dir") {
      out.push(node);
      if (node.children) flattenDirs(node.children, out);
    }
  }
  return out;
}
