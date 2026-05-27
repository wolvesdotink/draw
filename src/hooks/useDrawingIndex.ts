/**
 * In-memory full-text index of drawing contents, for the command palette's
 * "search inside drawings" results.
 *
 * Strategy: lazy + mtime-cached. The index is only (re)built when the palette
 * asks for it via refresh() — there's no background cost while you're just
 * drawing. refresh() stats every file and re-reads only the ones whose mtime
 * changed since last time (plus brand-new ones), and prunes entries for files
 * that have since been deleted. So the first open pays the full read; every
 * reopen is a cheap stack of stats unless something actually changed on disk.
 *
 * The cache lives in a ref so it survives across palette opens for the life of
 * the app session. Paths are "rel" (relative to the drawings root) throughout.
 *
 * Note on freshness: the index reflects what's on disk. The active file's
 * in-flight edits land within the 1s autosave debounce, so a content search
 * can momentarily miss the last keystrokes in the currently-open drawing.
 * Every other file is exact.
 */
import { useCallback, useRef } from "react";
import { readTextFile, stat } from "../lib/fs";
import { toAppDataPath } from "../lib/paths";
import { extractDrawingText, matchContent } from "../lib/search";

export interface IndexedFile {
  /** rel path including extension, e.g. "work/foo.excalidraw". */
  path: string;
  /** display name without extension, e.g. "foo". */
  name: string;
}

export interface ContentHit {
  path: string;
  name: string;
  snippet: string;
  score: number;
}

interface IndexEntry {
  text: string;
  lower: string;
  mtimeMs: number;
}

export interface UseDrawingIndexResult {
  /** Bring the index up to date with the given file list. Cheap when nothing changed. */
  refresh: () => Promise<void>;
  /** Rank content matches for a query. Reads the current cache; refresh() first. */
  search: (query: string, limit?: number) => ContentHit[];
}

export function useDrawingIndex(files: IndexedFile[]): UseDrawingIndexResult {
  const cacheRef = useRef<Map<string, IndexEntry>>(new Map());

  const refresh = useCallback(async () => {
    const cache = cacheRef.current;
    const seen = new Set<string>();

    await Promise.all(
      files.map(async (f) => {
        seen.add(f.path);
        try {
          const s = await stat(toAppDataPath(f.path));
          const mtimeMs = s.mtime ? new Date(s.mtime).getTime() : 0;
          const existing = cache.get(f.path);
          if (existing && existing.mtimeMs === mtimeMs) return; // unchanged — keep cached text
          const raw = await readTextFile(toAppDataPath(f.path));
          const text = extractDrawingText(raw);
          cache.set(f.path, { text, lower: text.toLowerCase(), mtimeMs });
        } catch {
          // Unreadable / mid-rename / corrupt — drop it so search doesn't surface stale text.
          cache.delete(f.path);
        }
      }),
    );

    // Prune entries for files that have disappeared from the tree.
    for (const key of [...cache.keys()]) {
      if (!seen.has(key)) cache.delete(key);
    }
  }, [files]);

  const search = useCallback(
    (query: string, limit = 8): ContentHit[] => {
      const q = query.trim();
      if (!q) return [];
      const cache = cacheRef.current;
      const hits: ContentHit[] = [];
      for (const f of files) {
        const entry = cache.get(f.path);
        if (!entry) continue;
        const m = matchContent(q, entry.text, entry.lower);
        if (m) hits.push({ path: f.path, name: f.name, snippet: m.snippet, score: m.score });
      }
      hits.sort((a, b) => b.score - a.score);
      return hits.slice(0, limit);
    },
    [files],
  );

  return { refresh, search };
}
