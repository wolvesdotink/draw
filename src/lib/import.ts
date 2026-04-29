/**
 * Import flow primitives.
 *
 * The pipeline: native file picker → Rust read → JSON validation → write to
 * drawings/. The fs plugin scope is locked to $APPDATA/drawings/**, so we
 * read external files via the custom `import_read_file` Tauri command (see
 * src-tauri/src/lib.rs) rather than broadening fs scope. This keeps the
 * import path explicit and auditable.
 *
 * `validateExcalidrawJson` mirrors the type check in `loadDrawing` (see
 * excalidraw-io.ts) but does NOT call `loadDrawing` — that function reads
 * from $APPDATA-relative paths and is not appropriate for arbitrary user
 * input.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Open the native file picker. Returns absolute path, or null if user cancelled. */
export async function pickExcalidrawFile(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Excalidraw", extensions: ["excalidraw", "json"] },
    ],
  });
  // Tauri 2 returns a string for single-file pick, null when cancelled.
  if (picked === null) return null;
  if (Array.isArray(picked)) return picked[0] ?? null;
  return picked;
}

/** Read the picked file via the Rust command. Throws on read errors. */
export async function readImportedFile(absPath: string): Promise<string> {
  return await invoke<string>("import_read_file", { path: absPath });
}

/**
 * Get the basename (last path segment) from an absolute path. Strips any
 * trailing extension for use as a default name in NewItemDialog.
 *
 * macOS-only app, so forward-slash paths only. Handles both "/foo/bar.ext"
 * and "bar.ext" inputs.
 */
export function basenameFromAbsPath(absPath: string): string {
  const idx = absPath.lastIndexOf("/");
  const base = idx === -1 ? absPath : absPath.slice(idx + 1);
  const dotIdx = base.lastIndexOf(".");
  // Don't strip leading-dot files (".rcfile" stays as ".rcfile") — but those
  // shouldn't appear here anyway since the filter is .excalidraw / .json.
  if (dotIdx <= 0) return base;
  return base.slice(0, dotIdx);
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate the contents of a picked file are a parseable Excalidraw drawing.
 *
 * We surface specific error strings for:
 *   - non-JSON: parse error from the underlying parser
 *   - .excalidrawlib (library) files: not supported
 *   - other JSON shapes: generic "not an excalidraw file"
 *
 * On success, the caller can write the original `text` bytes verbatim to
 * drawings/ — autosave will normalize on first edit via `saveDrawing`.
 */
export function validateExcalidrawJson(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Couldn't parse JSON: ${(err as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "File doesn't look like JSON object." };
  }
  const obj = parsed as { type?: unknown };
  if (obj.type === "excalidrawlib") {
    return {
      ok: false,
      error:
        "That's an Excalidraw library file. Only drawings can be imported.",
    };
  }
  if (obj.type !== "excalidraw") {
    const got = typeof obj.type === "string" ? obj.type : "missing";
    return {
      ok: false,
      error: `Not an Excalidraw drawing (type=${got}).`,
    };
  }
  return { ok: true };
}
