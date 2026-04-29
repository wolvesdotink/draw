/**
 * Path helpers.
 *
 * Two coordinate systems exist in this app:
 *   - "rel" paths: relative to drawings root, e.g. "work/foo.excalidraw"
 *     These are what we store in state, hand to the UI, and persist as lastOpenedPath.
 *   - "appdata" paths: relative to Tauri's AppData base dir, e.g. "drawings/work/foo.excalidraw"
 *     These are what we hand to plugin-fs together with BaseDirectory.AppData.
 *
 * We never deal in absolute paths in app code — plugin-fs + BaseDirectory.AppData handles that
 * for us, and capability scope is defined relative to $APPDATA.
 */
import { appDataDir, join } from "@tauri-apps/api/path";

export const DRAWINGS_DIR = "drawings";
export const STATE_FILE = "state.json";
export const DRAWING_EXT = ".excalidraw";

/** Prepend drawings/ to a rel path to get an appdata-relative path. */
export function toAppDataPath(rel: string): string {
  if (rel === "" || rel === "/") return DRAWINGS_DIR;
  // strip any leading slash to keep it relative
  const trimmed = rel.replace(/^\/+/, "");
  return `${DRAWINGS_DIR}/${trimmed}`;
}

/** Strip drawings/ prefix from an appdata-relative path. */
export function fromAppDataPath(appDataRel: string): string {
  if (appDataRel === DRAWINGS_DIR) return "";
  if (appDataRel.startsWith(`${DRAWINGS_DIR}/`)) {
    return appDataRel.slice(DRAWINGS_DIR.length + 1);
  }
  return appDataRel;
}

/** Memoized absolute path to drawings root. Used only for display / debug. */
let cachedAbsoluteRoot: string | null = null;
export async function getDrawingsAbsoluteRoot(): Promise<string> {
  if (cachedAbsoluteRoot !== null) return cachedAbsoluteRoot;
  const base = await appDataDir();
  cachedAbsoluteRoot = await join(base, DRAWINGS_DIR);
  return cachedAbsoluteRoot;
}

/** Join rel-to-drawings path segments without leading/trailing slashes. */
export function joinRel(...parts: string[]): string {
  return parts
    .filter((p) => p && p !== "/")
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** Parent rel path. "work/foo.excalidraw" → "work". "" if at root. */
export function parentRel(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? "" : rel.slice(0, idx);
}

/** File/dir basename. "work/foo.excalidraw" → "foo.excalidraw". */
export function basename(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx === -1 ? rel : rel.slice(idx + 1);
}

/** "foo.excalidraw" → "foo". Anything not ending in .excalidraw is returned as-is. */
export function stripExt(name: string): string {
  return name.endsWith(DRAWING_EXT) ? name.slice(0, -DRAWING_EXT.length) : name;
}

/** Ensure a name ends in .excalidraw (idempotent). */
export function ensureExt(name: string): string {
  return name.endsWith(DRAWING_EXT) ? name : `${name}${DRAWING_EXT}`;
}

/** Reject names containing path separators or NUL or starting with a dot. */
export function isValidName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.startsWith(".")) return false;
  return !/[\/\\\0]/.test(name);
}
