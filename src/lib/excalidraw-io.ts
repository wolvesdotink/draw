/**
 * Excalidraw scene serialize/deserialize.
 *
 * The on-disk format is the standard `.excalidraw` JSON shape:
 *   {
 *     type: "excalidraw",
 *     version: 2,
 *     source: "...",
 *     elements: [...],
 *     appState: { viewBackgroundColor, gridSize, ... },
 *     files: { [fileId]: BinaryFileData }   // base64 image data
 *   }
 *
 * We strip volatile appState fields (collaborators, cursors, ephemeral selection state)
 * before saving, so saves don't churn over things the user doesn't care about.
 */
import { readTextFile, writeAtomic } from "./fs";
import { toAppDataPath } from "./paths";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

export interface ExcalidrawScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

interface ExcalidrawDiskFormat {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

const SOURCE_TAG = "draw-desktop";

/**
 * Fields on appState that should NOT be persisted — they're collab / ephemeral / re-derivable.
 * We follow Excalidraw's own export logic for this list.
 */
const VOLATILE_APPSTATE_FIELDS: ReadonlyArray<keyof AppState> = [
  "collaborators",
  "cursorButton",
  "draggingElement",
  "editingElement",
  "editingGroupId",
  "editingTextElement",
  "errorMessage",
  "isLoading",
  "isResizing",
  "isRotating",
  "multiElement",
  "originSnapOffset",
  "pasteDialog",
  "pendingImageElementId",
  "resizingElement",
  "selectedElementsAreBeingDragged",
  "selectionElement",
  "showHyperlinkPopup",
  "showStats",
  "showWelcomeScreen",
  "snapLines",
  "startBoundElement",
  "suggestedBindings",
  "toast",
] as unknown as ReadonlyArray<keyof AppState>;

function pruneAppState(appState: Partial<AppState>): Partial<AppState> {
  const out: Record<string, unknown> = { ...appState };
  for (const field of VOLATILE_APPSTATE_FIELDS) {
    delete out[field as string];
  }
  return out as Partial<AppState>;
}

/** Default empty scene — used when creating a new file. */
export function emptyScene(): ExcalidrawScene {
  return {
    elements: [],
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null as unknown as number,
    },
    files: {},
  };
}

/**
 * Read a drawing from disk.
 * Throws if the file doesn't exist or is malformed.
 */
export async function loadDrawing(rel: string): Promise<ExcalidrawScene> {
  const text = await readTextFile(toAppDataPath(rel));
  let parsed: Partial<ExcalidrawDiskFormat>;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${rel} as JSON: ${(err as Error).message}`);
  }

  if (parsed.type !== "excalidraw") {
    throw new Error(`${rel} is not an excalidraw file (type=${parsed.type ?? "missing"})`);
  }

  return {
    elements: (parsed.elements ?? []) as readonly NonDeleted<ExcalidrawElement>[],
    appState: parsed.appState ?? {},
    files: parsed.files ?? {},
  };
}

/**
 * Write a drawing to disk atomically.
 */
export async function saveDrawing(rel: string, scene: ExcalidrawScene): Promise<void> {
  const payload: ExcalidrawDiskFormat = {
    type: "excalidraw",
    version: 2,
    source: SOURCE_TAG,
    elements: scene.elements,
    appState: pruneAppState(scene.appState),
    files: scene.files,
  };
  // Indent with 2 spaces to keep diffs readable if the user version-controls drawings/.
  const json = JSON.stringify(payload, null, 2);
  await writeAtomic(toAppDataPath(rel), json);
}

/** Serialize an empty scene as the initial contents of a newly created file. */
export async function writeEmptyDrawing(rel: string): Promise<void> {
  await saveDrawing(rel, emptyScene());
}
