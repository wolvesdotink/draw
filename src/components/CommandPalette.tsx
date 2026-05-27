/**
 * ⌘K command palette + fuzzy file switcher + in-drawing content search.
 *
 * One modal, three kinds of result:
 *   - Commands  — app actions (new, import, theme, …), fuzzy-matched on title.
 *   - Files     — every drawing, fuzzy-matched on name. The quick switcher.
 *   - In drawings — full-text matches inside drawing contents (text elements
 *                   + frame names), with a snippet. Powered by useDrawingIndex.
 *
 * Section order is intentional: an empty query reads as a launcher (Commands
 * first, then all files); typing reads as a switcher/search (Files first, then
 * Commands, then content matches). The selected row is always index 0 of the
 * flattened result list, so the obvious default is the top match.
 *
 * Keyboard: ↑/↓ or Tab/⇧Tab to move, ↵ to activate, Esc to close. The host
 * (App) owns the ⌘K toggle and unmounts this component to close it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { fuzzyMatch } from "../lib/search";
import { parentRel } from "../lib/paths";
import type { ContentHit } from "../hooks/useDrawingIndex";
import { NibIcon, ReturnKeyIcon, SearchIcon } from "./icons";

export interface Command {
  id: string;
  /** Shown in the row, mono uppercase. */
  title: string;
  /** Shortcut hint shown on the right, e.g. "⌘N". */
  hint?: string;
  /** Extra terms to match against (not displayed). */
  keywords?: string;
  icon?: ReactNode;
  run: () => void;
}

export interface PaletteFile {
  /** rel path including extension — what we open. */
  path: string;
  /** display name without extension. */
  name: string;
  /** parent folder rel path, "" for root. */
  dir: string;
}

interface CommandPaletteProps {
  commands: Command[];
  files: PaletteFile[];
  searchContent: (query: string) => ContentHit[];
  /** Bring the content index up to date. Called once on open. */
  prepareIndex: () => Promise<void>;
  onOpenFile: (rel: string) => void;
  onClose: () => void;
}

type Row =
  | { kind: "command"; command: Command; positions: number[] }
  | { kind: "file"; file: PaletteFile; positions: number[] }
  | { kind: "content"; hit: ContentHit };

type RenderItem =
  | { type: "header"; label: string; count: number }
  | { type: "row"; row: Row; index: number };

const EMPTY_QUERY_FILE_CAP = 40;
const TYPED_FILE_CAP = 14;

/** Bold the fuzzy-matched characters of a short label. */
const Highlighted: FC<{ text: string; positions: number[] }> = ({ text, positions }) => {
  if (positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const matched = set.has(i);
    let j = i;
    while (j < text.length && set.has(j) === matched) j++;
    const seg = text.slice(i, j);
    nodes.push(
      matched ? (
        <b key={i} className="font-bold">
          {seg}
        </b>
      ) : (
        <span key={i}>{seg}</span>
      ),
    );
    i = j;
  }
  return <>{nodes}</>;
};

/** Bold each query-token occurrence inside a content snippet. */
const HighlightedSnippet: FC<{ snippet: string; query: string }> = ({ snippet, query }) => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return <>{snippet}</>;
  const lower = snippet.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    let from = 0;
    let idx = lower.indexOf(tok, from);
    while (idx !== -1) {
      ranges.push([idx, idx + tok.length]);
      from = idx + tok.length;
      idx = lower.indexOf(tok, from);
    }
  }
  if (ranges.length === 0) return <>{snippet}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([s, e], k) => {
    if (s > cursor) nodes.push(<span key={`t${k}`}>{snippet.slice(cursor, s)}</span>);
    nodes.push(
      <b key={`m${k}`} className="font-bold">
        {snippet.slice(s, e)}
      </b>,
    );
    cursor = e;
  });
  if (cursor < snippet.length) nodes.push(<span key="end">{snippet.slice(cursor)}</span>);
  return <>{nodes}</>;
};

export const CommandPalette: FC<CommandPaletteProps> = ({
  commands,
  files,
  searchContent,
  prepareIndex,
  onOpenFile,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [indexReady, setIndexReady] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);

  // Focus the field on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Build / refresh the content index once on open. Mark ready even on failure
  // so the "Indexing…" hint never sticks.
  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setIndexReady(true);
    };
    void prepareIndex().then(done, done);
    return () => {
      cancelled = true;
    };
  }, [prepareIndex]);

  // Reset selection to the top whenever the query changes.
  useEffect(() => {
    setSelected(0);
  }, [query]);

  const indexing = query.trim() !== "" && !indexReady;

  const { renderItems, flatRows } = useMemo(() => {
    const q = query.trim();

    // --- Commands ---
    const cmdScored: Array<{ row: Row; score: number }> = [];
    for (const command of commands) {
      if (q === "") {
        cmdScored.push({ row: { kind: "command", command, positions: [] }, score: 0 });
        continue;
      }
      const byTitle = fuzzyMatch(q, command.title);
      const byKeywords = command.keywords ? fuzzyMatch(q, command.keywords) : null;
      if (!byTitle && !byKeywords) continue;
      const score = Math.max(byTitle?.score ?? -Infinity, byKeywords?.score ?? -Infinity);
      cmdScored.push({
        row: { kind: "command", command, positions: byTitle?.positions ?? [] },
        score,
      });
    }
    if (q !== "") cmdScored.sort((a, b) => b.score - a.score);

    // --- Files (by name) ---
    const fileScored: Array<{ row: Row; score: number; name: string }> = [];
    for (const file of files) {
      const m = fuzzyMatch(q, file.name);
      if (!m) continue;
      fileScored.push({
        row: { kind: "file", file, positions: m.positions },
        score: m.score,
        name: file.name,
      });
    }
    if (q === "") fileScored.sort((a, b) => a.name.localeCompare(b.name));
    else fileScored.sort((a, b) => b.score - a.score);
    const filesCapped = fileScored.slice(0, q === "" ? EMPTY_QUERY_FILE_CAP : TYPED_FILE_CAP);

    // --- In drawings (content) --- skip until the index is ready; dedupe
    // against files already shown by name so a drawing isn't listed twice.
    const nameMatched = new Set(
      filesCapped.map((r) => (r.row.kind === "file" ? r.row.file.path : "")),
    );
    const contentRows: Row[] =
      q === "" || !indexReady
        ? []
        : searchContent(q)
            .filter((h) => !nameMatched.has(h.path))
            .map((hit) => ({ kind: "content", hit }));

    const commandGroup = { label: "Commands", rows: cmdScored.map((r) => r.row) };
    const fileGroup = { label: "Files", rows: filesCapped.map((r) => r.row) };
    const contentGroup = { label: "In drawings", rows: contentRows };

    const ordered = q === "" ? [commandGroup, fileGroup] : [fileGroup, commandGroup, contentGroup];
    const groups = ordered.filter((g) => g.rows.length > 0);

    const items: RenderItem[] = [];
    const flat: Row[] = [];
    for (const group of groups) {
      items.push({ type: "header", label: group.label, count: group.rows.length });
      for (const row of group.rows) {
        items.push({ type: "row", row, index: flat.length });
        flat.push(row);
      }
    }
    return { renderItems: items, flatRows: flat };
  }, [query, commands, files, searchContent, indexReady]);

  const count = flatRows.length;
  const activeIndex = count === 0 ? -1 : Math.min(selected, count - 1);

  // Keep the selected row in view as the user arrows through.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const activate = useCallback(
    (row: Row) => {
      if (row.kind === "command") {
        onClose();
        row.command.run();
      } else if (row.kind === "file") {
        onOpenFile(row.file.path);
        onClose();
      } else {
        onOpenFile(row.hit.path);
        onClose();
      }
    },
    [onClose, onOpenFile],
  );

  const move = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setSelected((s) => {
        const cur = Math.min(s, count - 1);
        return (cur + delta + count) % count;
      });
    },
    [count],
  );

  const onKeyDown = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Tab":
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0) activate(flatRows[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
    // Defense-in-depth: keep palette keystrokes from reaching the canvas
    // behind it. (Excalidraw also ignores shortcuts while an input is focused.)
    e.stopPropagation();
  };

  const rowBase = "flex items-center gap-3 px-4 py-2 cursor-pointer select-none";

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center px-4 pt-[12vh] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ background: "color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.65))" }}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-[560px] flex-col overflow-hidden border-2 border-border bg-bg text-text brutal-shadow-pop animate-pop-in"
        onKeyDown={onKeyDown}
      >
        {/* Search field */}
        <div className="flex items-center gap-2.5 border-b-2 border-border px-4">
          <SearchIcon size={16} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            className="flex-1 border-0 bg-transparent py-3.5 text-[15px] text-text placeholder:text-text-faint"
            style={{ outline: "none" }}
            type="text"
            value={query}
            placeholder="Search drawings & commands…"
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search drawings and commands"
          />
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5" role="listbox">
          {flatRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] font-mono uppercase tracking-wider text-text-faint">
              {indexing ? "Indexing drawings…" : query.trim() ? "No matches" : "Type to search"}
            </div>
          ) : (
            renderItems.map((item) => {
              if (item.type === "header") {
                return (
                  <div
                    key={`h:${item.label}`}
                    className="px-4 pb-1 pt-2.5 text-[9.5px] font-mono font-bold uppercase tracking-[0.24em] text-text-faint"
                  >
                    {item.label}
                    {item.label === "In drawings" ? ` · ${item.count}` : ""}
                  </div>
                );
              }
              const { row, index } = item;
              const isSel = index === activeIndex;
              const tone = isSel ? "bg-accent text-accent-text" : "text-text hover:bg-bg-hover";
              const muted = isSel ? "text-accent-text" : "text-text-faint";

              if (row.kind === "command") {
                return (
                  <div
                    key={`c:${row.command.id}`}
                    ref={isSel ? selectedRowRef : undefined}
                    role="option"
                    aria-selected={isSel}
                    className={`${rowBase} ${tone}`}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => activate(row)}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {row.command.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-mono font-medium uppercase tracking-wider">
                      <Highlighted text={row.command.title} positions={row.positions} />
                    </span>
                    {row.command.hint && (
                      <span className={`shrink-0 text-[11px] font-mono tracking-wider ${muted}`}>
                        {row.command.hint}
                      </span>
                    )}
                  </div>
                );
              }

              if (row.kind === "file") {
                return (
                  <div
                    key={`f:${row.file.path}`}
                    ref={isSel ? selectedRowRef : undefined}
                    role="option"
                    aria-selected={isSel}
                    className={`${rowBase} ${tone}`}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => activate(row)}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <NibIcon size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <Highlighted text={row.file.name} positions={row.positions} />
                    </span>
                    {row.file.dir && (
                      <span
                        className={`shrink-0 truncate text-[10px] font-mono uppercase tracking-wider ${muted}`}
                      >
                        /{row.file.dir}
                      </span>
                    )}
                  </div>
                );
              }

              // content
              const dir = parentRel(row.hit.path);
              return (
                <div
                  key={`d:${row.hit.path}`}
                  ref={isSel ? selectedRowRef : undefined}
                  role="option"
                  aria-selected={isSel}
                  className={`${rowBase} items-start ${tone}`}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => activate(row)}
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    <NibIcon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px]">{row.hit.name}</span>
                      {dir && (
                        <span
                          className={`shrink-0 truncate text-[10px] font-mono uppercase tracking-wider ${muted}`}
                        >
                          /{dir}
                        </span>
                      )}
                    </div>
                    <div
                      className={`mt-0.5 truncate text-[11.5px] ${isSel ? "text-accent-text" : "text-text-muted"}`}
                    >
                      <HighlightedSnippet snippet={row.hit.snippet} query={query} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint bar */}
        <div className="flex items-center gap-3 border-t-2 border-border px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-text-faint">
          <span className="flex items-center gap-1.5">
            <span aria-hidden>↑↓</span> NAVIGATE
          </span>
          <span className="flex items-center gap-1.5">
            <ReturnKeyIcon size={11} /> OPEN
          </span>
          <span className="flex items-center gap-1.5">ESC CLOSE</span>
          <span className="ml-auto">
            {count} RESULT{count === 1 ? "" : "S"}
          </span>
        </div>
      </div>
    </div>
  );
};
