/**
 * App-level persisted state (state.json next to drawings/).
 *
 * Stored under appDataDir() at filename `state.json`. Writes are debounced 1s
 * because the user-driven mutations (sidebar resize, theme toggle, file switch)
 * can fire frequently.
 */
import { exists, readTextFile, writeAtomic } from "./fs";
import { STATE_FILE } from "./paths";

export type Theme = "light" | "dark";

export interface AppPersistedState {
  /** rel path of last opened file (relative to drawings/), or null. */
  lastOpenedPath: string | null;
  /** Sidebar pixel width. */
  sidebarWidth: number;
  /** Whether sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Theme for both Excalidraw canvas and the app chrome. */
  theme: Theme;
  /** Persisted folder expand-state, keyed by rel path. true = expanded. */
  expandedFolders: Record<string, boolean>;
}

const DEFAULT_STATE: AppPersistedState = {
  lastOpenedPath: null,
  sidebarWidth: 260,
  sidebarCollapsed: false,
  theme: "light",
  expandedFolders: {},
};

/** Read state.json. Returns DEFAULT_STATE if missing or unreadable. */
export async function readState(): Promise<AppPersistedState> {
  try {
    if (!(await exists(STATE_FILE))) return { ...DEFAULT_STATE };
    const text = await readTextFile(STATE_FILE);
    const parsed = JSON.parse(text) as Partial<AppPersistedState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    // Corrupt file? Treat as default. Next write will overwrite.
    return { ...DEFAULT_STATE };
  }
}

/** Write state.json atomically. */
export async function writeState(state: AppPersistedState): Promise<void> {
  await writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Debounced state writer. Multiple writeStateDebounced() calls within the
 * window collapse to one disk write.
 */
const DEBOUNCE_MS = 1000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: AppPersistedState | null = null;

export function writeStateDebounced(state: AppPersistedState): void {
  pendingState = state;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const toWrite = pendingState;
    pendingState = null;
    if (toWrite !== null) {
      void writeState(toWrite);
    }
  }, DEBOUNCE_MS);
}

/** Force-flush any pending debounced state write. Call before app close. */
export async function flushStateDebounced(): Promise<void> {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingState !== null) {
    const toWrite = pendingState;
    pendingState = null;
    await writeState(toWrite);
  }
}
