/**
 * Search primitives for the command palette.
 *
 * Three pure helpers, no I/O:
 *   - fuzzyMatch:        subsequence scorer for short labels (file names,
 *                        command titles). Returns a score + the matched
 *                        character positions so the UI can bold them.
 *   - extractDrawingText: pull the searchable text out of a raw .excalidraw
 *                        JSON string (text element contents + frame names),
 *                        normalised to a single line.
 *   - matchContent:      token-AND substring match over a drawing's extracted
 *                        text, returning a snippet window for the result row.
 *
 * Kept I/O-free so it's trivially unit-testable and reusable from the index
 * hook without dragging in Tauri's fs layer.
 */

export interface FuzzyResult {
  /** Higher is better. Only comparable within a single query. */
  score: number;
  /** Indices into the target string that matched, ascending. For highlighting. */
  positions: number[];
}

/**
 * Case-insensitive subsequence fuzzy match. Every character of `query` must
 * appear in `target` in order. Rewards consecutive runs and word-boundary
 * starts, and gently prefers shorter, earlier-matching targets. Returns null
 * when the query isn't a subsequence of the target.
 *
 * An empty query trivially matches everything with a neutral score — callers
 * lean on this to show the full list before the user types.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query === "") return { score: 0, positions: [] };

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let qi = 0;
  let prevMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;

    let charScore = 1;
    // Consecutive with the previous matched char reads as a contiguous run.
    if (ti === prevMatch + 1) charScore += 3;
    // Start of a word (string start or after a separator) is a strong signal.
    if (ti === 0 || /[\s/_.-]/.test(t[ti - 1])) charScore += 4;

    score += charScore;
    positions.push(ti);
    prevMatch = ti;
    qi++;
  }

  if (qi < q.length) return null; // ran out of target before matching all of query

  // Tie-breakers: shorter targets and earlier first-match float up.
  score -= target.length * 0.05;
  score -= positions[0] * 0.2;

  return { score, positions };
}

interface RawElement {
  type?: string;
  text?: string;
  name?: string;
  isDeleted?: boolean;
}
interface RawScene {
  elements?: RawElement[];
}

/**
 * Extract the searchable text from a raw .excalidraw JSON string. Collects the
 * `text` of every (non-deleted) text element and the `name` of every frame,
 * collapsed onto a single whitespace-normalised line so snippet offsets stay
 * stable. Returns "" for malformed JSON or drawings with no text.
 */
export function extractDrawingText(raw: string): string {
  let scene: RawScene;
  try {
    scene = JSON.parse(raw) as RawScene;
  } catch {
    return "";
  }
  const elements = Array.isArray(scene.elements) ? scene.elements : [];
  const parts: string[] = [];
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    if (el.type === "text" && typeof el.text === "string" && el.text.trim()) {
      parts.push(el.text.trim());
    } else if (el.type === "frame" && typeof el.name === "string" && el.name.trim()) {
      parts.push(el.name.trim());
    }
  }
  return parts.join("  ·  ").replace(/\s+/g, " ").trim();
}

export interface ContentMatch {
  /** A window of the drawing's text around the first matched token. */
  snippet: string;
  /** Higher is better. Only comparable within a single query. */
  score: number;
}

const SNIPPET_LEAD = 24;
const SNIPPET_LEN = 120;

/**
 * Match `query` against a drawing's extracted text. The query is split into
 * whitespace tokens; every token must appear (case-insensitive substring) for
 * a hit — so "rate limit" finds a drawing containing both words in any order.
 * Returns a snippet anchored on the earliest matched token, or null on no hit.
 *
 * `lower` is the pre-lowercased copy of `text`; the index keeps it around so
 * we don't re-lowercase the whole corpus on every keystroke.
 */
export function matchContent(query: string, text: string, lower: string): ContentMatch | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let earliest = Infinity;
  let hitCount = 0;
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx === -1) return null; // every token is required
    if (idx < earliest) earliest = idx;
    hitCount++;
  }

  const start = Math.max(0, earliest - SNIPPET_LEAD);
  const end = Math.min(text.length, start + SNIPPET_LEN);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;

  // Earlier matches and more distinct tokens covered rank higher; long files
  // are nudged down so a tight match beats an incidental one in a huge drawing.
  const score = hitCount * 10 - earliest * 0.05 - text.length * 0.001;

  return { snippet, score };
}
