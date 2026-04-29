/**
 * Orchestrates the Import flow's state machine and dialog rendering.
 *
 *   idle
 *     │ start(absPath?)            (toolbar / Cmd+I / drag-drop)
 *     ▼
 *   reading                        ← await pickExcalidrawFile (if no absPath)
 *     │                              + readImportedFile + validate
 *     │ ok                           on error: window.alert → idle
 *     ▼
 *   naming   ← NewItemDialog
 *     │ submit(name, folder)
 *     ▼
 *   (existence check on chosen target)
 *     │ taken          │ free
 *     ▼                ▼
 *   confirmOverwrite   writing (overwrite=false)
 *     │                │
 *     │ Overwrite      │ on success: open the new file
 *     ▼                ▼
 *   writing(overwrite=true) → open the new file → idle
 *
 *     Rename in confirmOverwrite → naming (NewItemDialog remounts; folder
 *     order is reshuffled so the previously-selected folder stays first)
 *     Cancel anywhere → idle
 *
 * App.tsx hands us:
 *   - importFile (from useFileTree) — does the write
 *   - existsRel — `(rel) => Promise<boolean>`, used for the conflict check
 *   - openImportedFile — the open-after-write hook (mirrors handleSelectFile)
 *   - folderChoices — full list, shown in NewItemDialog dropdown
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { NewItemDialog, type FolderChoice } from "../components/NewItemDialog";
import { ConfirmOverwriteDialog } from "../components/ConfirmOverwriteDialog";
import {
  basenameFromAbsPath,
  pickExcalidrawFile,
  readImportedFile,
  validateExcalidrawJson,
} from "../lib/import";
import { ensureExt, joinRel, stripExt } from "../lib/paths";

interface PendingImport {
  /** Original absolute path for display only. */
  sourceAbsPath: string;
  /** Raw text bytes ready to write. */
  contents: string;
  /** Pre-filled name, sans extension. */
  initialName: string;
}

type FlowState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "naming"; pending: PendingImport; nameOverride?: string; folderOverride?: string }
  | {
      kind: "confirmOverwrite";
      pending: PendingImport;
      name: string;
      folder: string;
      existingRel: string;
    }
  | {
      kind: "writing";
      pending: PendingImport;
      name: string;
      folder: string;
      overwrite: boolean;
    };

export interface UseImportFlowArgs {
  importFile: (
    parentDirRel: string,
    name: string,
    contents: string,
    opts?: { overwrite?: boolean },
  ) => Promise<string>;
  existsRel: (rel: string) => Promise<boolean>;
  openImportedFile: (rel: string) => Promise<void>;
  folderChoices: FolderChoice[];
}

/**
 * Pre-read content provided directly (drag-drop entry — file already read
 * via the DOM File API because Tauri's webview drag-drop is disabled to
 * allow HTML5 in-app drag-drop).
 */
export interface ImportSource {
  /** Filename including extension, e.g. "sketch.excalidraw". */
  name: string;
  /** Raw text already read from the file. */
  contents: string;
}

export interface UseImportFlowResult {
  /**
   * Begin an import. Three entry shapes:
   *   - `undefined`         → open native file picker (Cmd+I, toolbar button)
   *   - `string` (absPath)  → read file via Rust command, skip picker
   *   - `ImportSource`      → use pre-read content directly (drag-drop)
   */
  start: (source?: string | ImportSource) => Promise<void>;
  /** True iff any import dialog/processing is currently visible/active. */
  isOpen: boolean;
  /** Render this in the App tree to mount whichever dialog is current. */
  dialogs: ReactNode;
}

export function useImportFlow({
  importFile,
  existsRel,
  openImportedFile,
  folderChoices,
}: UseImportFlowArgs): UseImportFlowResult {
  const [state, setState] = useState<FlowState>({ kind: "idle" });

  const reset = useCallback(() => setState({ kind: "idle" }), []);

  const start = useCallback(
    async (source?: string | ImportSource) => {
      // Block re-entry while a flow is already active.
      setState((prev) => (prev.kind === "idle" ? { kind: "reading" } : prev));

      try {
        // Branch 1: caller already has the file's contents in hand (drag-drop).
        // Skip both the picker and the Rust read.
        if (typeof source === "object" && source !== null) {
          const result = validateExcalidrawJson(source.contents);
          if (!result.ok) {
            window.alert(result.error);
            setState({ kind: "idle" });
            return;
          }
          // `source.name` is just the bare filename (no directory); strip
          // the .excalidraw extension for the dialog's pre-fill.
          const initialName = stripExt(source.name);
          setState({
            kind: "naming",
            pending: {
              // No real path — show the filename for context, since the
              // dialog uses sourceAbsPath only for display.
              sourceAbsPath: source.name,
              contents: source.contents,
              initialName,
            },
          });
          return;
        }

        // Branch 2: absPath supplied or picker needed.
        let picked = source ?? null;
        if (picked === null) {
          picked = await pickExcalidrawFile();
        }
        if (picked === null) {
          // Cancelled in picker.
          setState({ kind: "idle" });
          return;
        }

        const contents = await readImportedFile(picked);
        const result = validateExcalidrawJson(contents);
        if (!result.ok) {
          window.alert(result.error);
          setState({ kind: "idle" });
          return;
        }

        const initialName = basenameFromAbsPath(picked);
        setState({
          kind: "naming",
          pending: { sourceAbsPath: picked, contents, initialName },
        });
      } catch (err) {
        window.alert(`Couldn't import: ${(err as Error).message}`);
        setState({ kind: "idle" });
      }
    },
    [],
  );

  // ---- handlers wired into the rendered dialogs ----

  const handleNamingSubmit = useCallback(
    async (name: string, folder?: string) => {
      const current = state;
      if (current.kind !== "naming") return;
      const targetFolder = folder ?? "";
      const filename = ensureExt(name);
      const rel = joinRel(targetFolder, filename);

      const taken = await existsRel(rel);
      if (taken) {
        setState({
          kind: "confirmOverwrite",
          pending: current.pending,
          name,
          folder: targetFolder,
          existingRel: rel,
        });
        return;
      }

      setState({
        kind: "writing",
        pending: current.pending,
        name,
        folder: targetFolder,
        overwrite: false,
      });
      try {
        const written = await importFile(targetFolder, name, current.pending.contents);
        await openImportedFile(written);
        setState({ kind: "idle" });
      } catch (err) {
        // Bounce back to naming so the user can fix it; surface error there.
        // NewItemDialog supports thrown errors → setError, but we already
        // exited 'naming' to 'writing'. Re-throwing won't help. Use alert.
        window.alert(`Couldn't import: ${(err as Error).message}`);
        setState({
          kind: "naming",
          pending: current.pending,
          nameOverride: name,
          folderOverride: targetFolder,
        });
      }
    },
    [state, existsRel, importFile, openImportedFile],
  );

  const handleNamingCancel = useCallback(() => reset(), [reset]);

  const handleOverwrite = useCallback(async () => {
    const current = state;
    if (current.kind !== "confirmOverwrite") return;
    const { pending, name, folder } = current;
    setState({ kind: "writing", pending, name, folder, overwrite: true });
    try {
      const written = await importFile(folder, name, pending.contents, {
        overwrite: true,
      });
      await openImportedFile(written);
      setState({ kind: "idle" });
    } catch (err) {
      window.alert(`Couldn't overwrite: ${(err as Error).message}`);
      // Bounce back to naming so the user can pick a different name.
      setState({
        kind: "naming",
        pending,
        nameOverride: name,
        folderOverride: folder,
      });
    }
  }, [state, importFile, openImportedFile]);

  const handleRenameFromConfirm = useCallback(() => {
    const current = state;
    if (current.kind !== "confirmOverwrite") return;
    setState({
      kind: "naming",
      pending: current.pending,
      nameOverride: current.name,
      folderOverride: current.folder,
    });
  }, [state]);

  const handleConfirmCancel = useCallback(() => reset(), [reset]);

  // ---- render ----

  // Reorder folder choices so the previously-selected folder is first. This
  // is how we pre-fill the dialog's folder dropdown without modifying
  // NewItemDialog (which uses folderChoices?.[0]?.path as the initial
  // useState value).
  const reorderedFolderChoices = useMemo(() => {
    if (state.kind !== "naming") return folderChoices;
    const desired = state.folderOverride;
    if (desired === undefined) return folderChoices;
    const idx = folderChoices.findIndex((c) => c.path === desired);
    if (idx <= 0) return folderChoices;
    return [folderChoices[idx], ...folderChoices.slice(0, idx), ...folderChoices.slice(idx + 1)];
  }, [folderChoices, state]);

  let dialogs: ReactNode = null;
  if (state.kind === "naming") {
    const initialValue = state.nameOverride ?? state.pending.initialName;
    dialogs = (
      <NewItemDialog
        // key forces a remount whenever we re-enter the naming state, so the
        // dialog's lazy useState initializer runs again with the new
        // initialValue / reordered folderChoices.
        key={`import-${initialValue}-${state.folderOverride ?? ""}`}
        mode="newFile"
        context={`Import ${state.pending.sourceAbsPath}`}
        initialValue={initialValue}
        folderChoices={reorderedFolderChoices}
        onSubmit={handleNamingSubmit}
        onCancel={handleNamingCancel}
      />
    );
  } else if (state.kind === "confirmOverwrite") {
    dialogs = (
      <ConfirmOverwriteDialog
        existingPath={state.existingRel}
        onOverwrite={handleOverwrite}
        onRename={handleRenameFromConfirm}
        onCancel={handleConfirmCancel}
      />
    );
  }

  const isOpen = state.kind !== "idle";

  return { start, isOpen, dialogs };
}
