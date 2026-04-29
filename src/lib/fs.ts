/**
 * Typed wrappers around @tauri-apps/plugin-fs.
 *
 * All ops resolve under BaseDirectory.AppData, so paths passed in are relative
 * to ~/Library/Application Support/<bundle-id>/.
 *
 * writeAtomic() writes to a sibling .tmp file then renames, preventing partial-write
 * corruption on crash.
 */
import {
  BaseDirectory,
  exists as fsExists,
  mkdir as fsMkdir,
  readDir as fsReadDir,
  readTextFile as fsReadTextFile,
  remove as fsRemove,
  rename as fsRename,
  stat as fsStat,
  writeTextFile as fsWriteTextFile,
} from "@tauri-apps/plugin-fs";

const baseOpt = { baseDir: BaseDirectory.AppData } as const;

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export async function exists(path: string): Promise<boolean> {
  try {
    return await fsExists(path, baseOpt);
  } catch {
    return false;
  }
}

export async function readTextFile(path: string): Promise<string> {
  return await fsReadTextFile(path, baseOpt);
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  await fsWriteTextFile(path, contents, baseOpt);
}

export async function mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
  await fsMkdir(path, { ...baseOpt, recursive: opts?.recursive ?? true });
}

export async function remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
  await fsRemove(path, { ...baseOpt, recursive: opts?.recursive ?? false });
}

export async function rename(from: string, to: string): Promise<void> {
  await fsRename(from, to, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData });
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const entries = await fsReadDir(path, baseOpt);
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory,
    isFile: e.isFile,
  }));
}

export async function stat(path: string) {
  return await fsStat(path, baseOpt);
}

/**
 * Atomic write: write to <path>.tmp then rename to <path>.
 * APFS rename is atomic — readers will see either the old contents or the full new contents.
 *
 * If the rename fails, we attempt to clean up the .tmp file. Callers should handle the throw.
 */
export async function writeAtomic(path: string, contents: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeTextFile(tmp, contents);
  try {
    await rename(tmp, path);
  } catch (err) {
    // Best-effort cleanup. Bootstrap also sweeps stale .tmp files on launch.
    try {
      await remove(tmp);
    } catch {
      /* swallow — sweep will get it */
    }
    throw err;
  }
}

/**
 * Sweep stale .tmp files under a directory tree. Called on app bootstrap to
 * clean up after crashes mid-writeAtomic. Files newer than maxAgeMs are kept
 * (an in-flight write from a previous, still-alive process — though that's
 * impossible for us since we're single-instance).
 */
export async function sweepStaleTmp(rootPath: string, maxAgeMs = 60_000): Promise<number> {
  const now = Date.now();
  let removed = 0;

  async function walk(dir: string): Promise<void> {
    let entries: DirEntry[];
    try {
      entries = await readDir(dir);
    } catch {
      return; // dir doesn't exist or unreadable
    }

    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(full);
      } else if (entry.isFile && entry.name.endsWith(".tmp")) {
        try {
          const s = await stat(full);
          const mtime = s.mtime ? new Date(s.mtime).getTime() : 0;
          if (now - mtime > maxAgeMs) {
            await remove(full);
            removed++;
          }
        } catch {
          /* ignore individual sweep errors */
        }
      }
    }
  }

  await walk(rootPath);
  return removed;
}
