/**
 * App orchestrator.
 *
 * Layout (top → bottom):
 *   [topbar]    — full-width drag region, reserves 78px on the left for the
 *                 macOS traffic lights (overlaid by Tauri via titleBarStyle:
 *                 "Overlay"). Hosts global controls: theme, new drawing,
 *                 sidebar toggle.
 *   [sidebar | canvas]  — split below, exactly as before.
 *
 * Bootstrap (run once):
 *   1. Ensure ~/Library/Application Support/<bundle>/drawings/ exists.
 *   2. Sweep stale .tmp files (crash recovery).
 *   3. Read state.json — restore theme, sidebar settings, lastOpenedPath.
 *   4. If lastOpenedPath still exists on disk, open it.
 *
 * Per-event flow on file switch:
 *   1. autoSave.flushPending()  ← writes any pending change to the OLD path
 *   2. autoSave.setActivePath(null)  ← stop accepting onChange events
 *   3. activeFile.open(newPath)
 *   4. autoSave.setActivePath(newPath)
 *
 * Keyboard shortcuts:
 *   Cmd+N         — open new drawing dialog with folder picker
 *   Cmd+I         — open native picker to import an existing .excalidraw file
 *   Cmd+S         — force-flush autosave (no-op if nothing pending)
 *   Cmd+Backspace — delete active file (with confirm)
 *   Cmd+\         — toggle sidebar
 *
 * Import: also accepts drag-and-drop of .excalidraw files onto the window;
 * see useDragDrop + useImportFlow for the orchestration.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { EmptyState } from "./components/EmptyState";
import { NewItemDialog, type FolderChoice } from "./components/NewItemDialog";
import { SidebarResizer } from "./components/SidebarResizer";
import { UpdateButton } from "./components/UpdateButton";
import {
  FolderPlusIcon,
  ImportIcon,
  MoonIcon,
  PlusIcon,
  SidebarShowIcon,
  SunIcon,
} from "./components/icons";
import {
  useFileTree,
  ensureDrawingsRoot,
  findNode,
  flattenDirs,
} from "./hooks/useFileTree";
import { useActiveFile } from "./hooks/useActiveFile";
import { useAutoSave } from "./hooks/useAutoSave";
import { useDragDrop } from "./hooks/useDragDrop";
import { useImportFlow } from "./hooks/useImportFlow";
import { useUpdater } from "./hooks/useUpdater";
import { sweepStaleTmp, exists } from "./lib/fs";
import {
  readState,
  writeStateDebounced,
  flushStateDebounced,
  type AppPersistedState,
  type Theme,
} from "./lib/state";
import { DRAWINGS_DIR, basename, stripExt, toAppDataPath } from "./lib/paths";
import "./styles/app.css";

type BootStatus = "loading" | "ready" | "error";

/** Sidebar collapse/expand glyph — mirrored variant of SidebarShowIcon. */
function SidebarHideIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </svg>
  );
}

function App() {
  const [bootStatus, setBootStatus] = useState<BootStatus>("loading");
  const [bootError, setBootError] = useState<string | null>(null);
  const [persistedState, setPersistedState] = useState<AppPersistedState | null>(null);
  /**
   * Open dialog state for the App-level "New drawing" flow (Cmd+N or empty-state CTA).
   * If non-null, the dialog is shown; the targetParentDir is the user's selected folder.
   */
  const [newDrawingDialogOpen, setNewDrawingDialogOpen] = useState(false);
  /** Open dialog state for the App-level "New folder" flow (Cmd+Shift+N or topbar button). */
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  /** Live sidebar width while resizing (separate from persisted, to avoid debounced churn). */
  const [liveSidebarWidth, setLiveSidebarWidth] = useState<number | null>(null);

  const fileTree = useFileTree();
  const activeFile = useActiveFile();
  const autoSave = useAutoSave();
  // Background auto-update check + state. The button placed in the topbar
  // below stays hidden until something is actionable (update available,
  // download in progress, install ready, or check failed).
  const updater = useUpdater();

  // Refs for keeping latest values accessible from event listeners without re-binding.
  const persistedStateRef = useRef<AppPersistedState | null>(null);
  const activeFileRef = useRef(activeFile.active);
  activeFileRef.current = activeFile.active;

  // ---------- Persisted state mutation helper ----------
  const updatePersistedState = useCallback((patch: Partial<AppPersistedState>) => {
    setPersistedState((prev) => {
      const base = prev ?? persistedStateRef.current;
      if (!base) return prev;
      const next = { ...base, ...patch };
      persistedStateRef.current = next;
      writeStateDebounced(next);
      return next;
    });
  }, []);

  // ---------- Bootstrap ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureDrawingsRoot();
        await sweepStaleTmp(DRAWINGS_DIR);
        const state = await readState();
        if (cancelled) return;
        setPersistedState(state);
        persistedStateRef.current = state;
        setBootStatus("ready");
        // Try to restore lastOpenedPath
        if (state.lastOpenedPath) {
          if (await exists(toAppDataPath(state.lastOpenedPath))) {
            try {
              await activeFile.open(state.lastOpenedPath);
              autoSave.setActivePath(state.lastOpenedPath);
            } catch {
              updatePersistedState({ lastOpenedPath: null });
            }
          } else {
            updatePersistedState({ lastOpenedPath: null });
          }
        }
      } catch (e) {
        if (cancelled) return;
        setBootError((e as Error).message);
        setBootStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush state writes on unload
  useEffect(() => {
    const handler = () => {
      void flushStateDebounced();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, []);

  // ---------- File switching ----------
  const handleSelectFile = useCallback(
    async (rel: string) => {
      if (activeFile.active?.path === rel) return;
      try {
        await autoSave.flushPending();
        autoSave.setActivePath(null);
        await activeFile.open(rel);
        autoSave.setActivePath(rel);
        updatePersistedState({ lastOpenedPath: rel });
      } catch (e) {
        window.alert(`Couldn't open file: ${(e as Error).message}`);
      }
    },
    [activeFile, autoSave, updatePersistedState],
  );

  const handleActiveFileRemoved = useCallback(async () => {
    await autoSave.flushPending().catch(() => {});
    autoSave.setActivePath(null);
    activeFile.close();
    updatePersistedState({ lastOpenedPath: null });
  }, [activeFile, autoSave, updatePersistedState]);

  const handleActiveFileMoved = useCallback(
    async (newPath: string) => {
      autoSave.setActivePath(newPath);
      try {
        await activeFile.open(newPath);
        updatePersistedState({ lastOpenedPath: newPath });
      } catch (e) {
        autoSave.setActivePath(null);
        activeFile.close();
        updatePersistedState({ lastOpenedPath: null });
        window.alert(`After rename, couldn't reopen: ${(e as Error).message}`);
      }
    },
    [activeFile, autoSave, updatePersistedState],
  );

  // After deletion / rename, ensure the active file still exists in the new tree.
  useEffect(() => {
    if (!activeFile.active || fileTree.loading) return;
    const stillExists = findNode(fileTree.tree, activeFile.active.path) !== null;
    if (!stillExists) {
      void handleActiveFileRemoved();
    }
  }, [fileTree.tree, fileTree.loading, activeFile.active, handleActiveFileRemoved]);

  // ---------- App-level dialog (Cmd+N / empty-state CTA) ----------
  const folderChoices: FolderChoice[] = useMemo(() => {
    const choices: FolderChoice[] = [{ path: "", label: "(root)" }];
    for (const dir of flattenDirs(fileTree.tree)) {
      choices.push({ path: dir.path, label: `/${dir.path}` });
    }
    return choices;
  }, [fileTree.tree]);

  const submitNewDrawingDialog = async (name: string, targetFolder?: string) => {
    const parent = targetFolder ?? "";
    const newPath = await fileTree.createFile(parent, name);
    setNewDrawingDialogOpen(false);
    await handleSelectFile(newPath);
  };

  const submitNewFolderDialog = async (name: string, targetFolder?: string) => {
    const parent = targetFolder ?? "";
    await fileTree.createFolder(parent, name);
    setNewFolderDialogOpen(false);
  };

  // ---------- Import flow ----------
  // After an import writes a new file (or overwrites an existing one), open
  // it. Mirrors `handleSelectFile` but force-reloads even when the imported
  // file is the currently-active one — otherwise an overwrite-of-current
  // would leave the canvas showing stale (in-memory) content while autosave
  // happily clobbers our just-written import.
  const handleImportOpen = useCallback(
    async (rel: string) => {
      try {
        await autoSave.flushPending();
        autoSave.setActivePath(null);
        await activeFile.open(rel);
        autoSave.setActivePath(rel);
        updatePersistedState({ lastOpenedPath: rel });
      } catch (e) {
        window.alert(`Couldn't open imported file: ${(e as Error).message}`);
      }
    },
    [activeFile, autoSave, updatePersistedState],
  );

  const existsRel = useCallback(
    async (rel: string) => exists(toAppDataPath(rel)),
    [],
  );

  const importFlow = useImportFlow({
    importFile: fileTree.importFile,
    existsRel,
    openImportedFile: handleImportOpen,
    folderChoices,
  });

  // Drag-and-drop entry point for OS file drops (Finder → app). Disabled
  // while any modal is open so dropped files don't stack a second flow on
  // top of an in-progress one.
  //
  // Note: this is OS-level only. In-app drag-drop (sidebar file → folder)
  // is handled directly by FileTreeNode/Sidebar via standard HTML5 events
  // — see `dragDropEnabled: false` in tauri.conf.json which lets those work.
  const handleDragDrop = useCallback(
    (file: { name: string; contents: string }) => {
      void importFlow.start(file);
    },
    [importFlow.start],
  );
  useDragDrop({
    onDrop: handleDragDrop,
    disabled: newDrawingDialogOpen || newFolderDialogOpen || importFlow.isOpen,
  });

  // ---------- Theme ----------
  const handleToggleTheme = useCallback(() => {
    const current = persistedStateRef.current?.theme ?? "light";
    updatePersistedState({ theme: current === "light" ? "dark" : "light" });
  }, [updatePersistedState]);

  // ---------- Sidebar resize ----------
  const handleSidebarWidthChange = useCallback((w: number) => {
    setLiveSidebarWidth(w);
  }, []);

  const handleSidebarWidthCommit = useCallback(
    (w: number) => {
      setLiveSidebarWidth(null);
      updatePersistedState({ sidebarWidth: w });
    },
    [updatePersistedState],
  );

  // ---------- Sidebar collapse ----------
  const handleToggleSidebar = useCallback(() => {
    const collapsed = persistedStateRef.current?.sidebarCollapsed ?? false;
    updatePersistedState({ sidebarCollapsed: !collapsed });
  }, [updatePersistedState]);

  // ---------- Delete active ----------
  const handleDeleteActive = useCallback(async () => {
    const active = activeFileRef.current;
    if (!active) return;
    const confirmed = window.confirm(
      `Delete drawing "${active.path}"? This can't be undone.`,
    );
    if (!confirmed) return;
    try {
      await autoSave.flushPending().catch(() => {});
      autoSave.setActivePath(null);
      const path = active.path;
      activeFile.close();
      updatePersistedState({ lastOpenedPath: null });
      await fileTree.remove(path, false);
    } catch (e) {
      window.alert(`Couldn't delete: ${(e as Error).message}`);
    }
  }, [activeFile, autoSave, fileTree, updatePersistedState]);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    if (bootStatus !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      // Use metaKey on macOS; on Linux/Win we'd swap to ctrlKey but this is a macOS-targeted build.
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd) return;

      // Cmd+N — new drawing
      if (e.key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setNewDrawingDialogOpen(true);
        return;
      }
      // Cmd+Shift+N — new folder. `e.key` is "N" (uppercase) when shift
      // is held, so match case-insensitively.
      if ((e.key === "n" || e.key === "N") && e.shiftKey && !e.altKey) {
        e.preventDefault();
        setNewFolderDialogOpen(true);
        return;
      }
      // Cmd+I — import existing .excalidraw file (skips if anything is open
      // already so we don't stack flows / re-trigger picker on the dialog).
      if (e.key === "i" && !e.shiftKey && !e.altKey) {
        if (newDrawingDialogOpen || newFolderDialogOpen || importFlow.isOpen) return;
        e.preventDefault();
        void importFlow.start();
        return;
      }
      // Cmd+S — force-flush save
      if (e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void autoSave.flushPending();
        return;
      }
      // Cmd+Backspace — delete active drawing
      if (e.key === "Backspace" && !e.shiftKey && !e.altKey) {
        if (activeFileRef.current) {
          e.preventDefault();
          void handleDeleteActive();
        }
        return;
      }
      // Cmd+\  (key === "\\") — toggle sidebar
      if (e.key === "\\" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleToggleSidebar();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [
    bootStatus,
    autoSave,
    handleDeleteActive,
    handleToggleSidebar,
    importFlow.isOpen,
    importFlow.start,
    newDrawingDialogOpen,
    newFolderDialogOpen,
  ]);

  // ---------- Render ----------
  if (bootStatus === "loading") {
    return (
      <div className="app app--theme-light flex flex-col h-screen w-screen bg-bg text-text">
        <div data-tauri-drag-region className="topbar" />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-[120px] pulse-line" aria-hidden />
        </div>
      </div>
    );
  }
  if (bootStatus === "error") {
    return (
      <div className="app app--theme-light flex flex-col h-screen w-screen bg-bg text-text">
        <div data-tauri-drag-region className="topbar" />
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.32em] font-mono text-danger mb-4">
            STUDIO FAULT
          </p>
          <h2 className="text-[22px] font-bold m-0 mb-4 tracking-tight uppercase font-mono">
            COULDN'T START
          </h2>
          <p className="m-0 mb-2 text-[14px] text-text max-w-[440px] leading-relaxed font-mono">
            {bootError}
          </p>
          <p className="m-0 text-[12px] text-text-muted max-w-[440px] leading-relaxed font-mono">
            Check that the app has permission to write to its data directory.
          </p>
        </div>
      </div>
    );
  }

  const theme: Theme = persistedState?.theme ?? "light";
  const persistedWidth = persistedState?.sidebarWidth ?? 260;
  const sidebarWidth = liveSidebarWidth ?? persistedWidth;
  const sidebarCollapsed = persistedState?.sidebarCollapsed ?? false;

  const hasFiles = fileTree.tree.length > 0;

  // Topbar button base — squared, mono-labelled hit target. Opts out of drag.
  const topbarBtn =
    "w-7 h-7 inline-flex items-center justify-center bg-transparent border-0 text-text-muted leading-none hover:bg-bg-hover hover:text-text active:bg-text active:text-bg cursor-pointer";

  return (
    <div className={`app app--theme-${theme} flex flex-col h-screen w-screen bg-bg text-text`}>
      {/* Unified topbar.
       *
       *   - The <header> itself is the drag region (data-tauri-drag-region +
       *     -webkit-app-region: drag from .topbar CSS).
       *   - The two inner flex groups also carry data-tauri-drag-region so a
       *     mousedown on the empty left group (when the sidebar is open) or
       *     the gap between buttons still moves the window. Without this, an
       *     empty inner div absorbs the mousedown before Tauri sees it.
       *   - Buttons opt out via the `.topbar button` rule + data-no-drag.
       */}
      <header data-tauri-drag-region className="topbar">
        <div data-tauri-drag-region className="flex items-center gap-0 h-full">
          {sidebarCollapsed && (
            <button
              type="button"
              data-no-drag
              className={topbarBtn}
              onClick={handleToggleSidebar}
              title="Show sidebar (⌘\)"
              aria-label="Show sidebar"
            >
              <SidebarShowIcon size={15} />
            </button>
          )}
        </div>
        {/* Mid-region: drag handle that also surfaces the active file's title.
         *  Centred mono-caps so it sits flush with the brutalist label system
         *  in the sidebar header / footer. Truncates with ellipsis on long
         *  names. Falls back to faint em-dashes when no file is open so the
         *  region still reads as intentional, not empty. */}
        <div
          data-tauri-drag-region
          className="flex-1 h-full min-w-0 flex items-center justify-center px-3"
        >
          <span
            className={`truncate text-[11px] font-mono uppercase tracking-[0.2em] font-bold select-none ${
              activeFile.active ? "text-text" : "text-text-faint"
            }`}
            title={activeFile.active?.path ?? undefined}
          >
            {activeFile.active
              ? stripExt(basename(activeFile.active.path))
              : "— NO FILE —"}
          </span>
        </div>
        <div data-tauri-drag-region className="flex items-center gap-0 h-full">
          {/* Updater slot. Renders nothing until an update is available, in
              progress, ready to apply, or failed. Sits leftmost in the right
              cluster so it's the first thing the user sees if it appears. */}
          <UpdateButton
            state={updater.state}
            dismissed={updater.dismissed}
            onInstall={updater.install}
            onRestart={updater.restart}
          />
          <button
            type="button"
            data-no-drag
            className={topbarBtn}
            onClick={handleToggleTheme}
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            aria-label="Toggle theme"
          >
            {theme === "light" ? <MoonIcon size={15} /> : <SunIcon size={15} />}
          </button>
          <button
            type="button"
            data-no-drag
            className={topbarBtn}
            onClick={() => {
              if (newDrawingDialogOpen || importFlow.isOpen) return;
              void importFlow.start();
            }}
            title="Import drawing (⌘I)"
            aria-label="Import drawing"
          >
            <ImportIcon size={15} />
          </button>
          <button
            type="button"
            data-no-drag
            className={topbarBtn}
            onClick={() => setNewFolderDialogOpen(true)}
            title="New folder (⌘⇧N)"
            aria-label="New folder"
          >
            <FolderPlusIcon size={15} />
          </button>
          <button
            type="button"
            data-no-drag
            className={topbarBtn}
            onClick={() => setNewDrawingDialogOpen(true)}
            title="New drawing (⌘N)"
            aria-label="New drawing"
          >
            <PlusIcon size={15} />
          </button>
          {!sidebarCollapsed && (
            <button
              type="button"
              data-no-drag
              className={topbarBtn}
              onClick={handleToggleSidebar}
              title="Hide sidebar (⌘\)"
              aria-label="Hide sidebar"
            >
              <SidebarHideIcon size={15} />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!sidebarCollapsed && (
          <>
            <div
              className="flex-none flex flex-col min-w-[180px] max-w-[600px] overflow-hidden bg-bg border-r-2 border-border"
              style={{ width: `${sidebarWidth}px` }}
            >
              <Sidebar
                fileTree={fileTree}
                activePath={activeFile.active?.path ?? null}
                onSelectFile={handleSelectFile}
                onActiveFileRemoved={handleActiveFileRemoved}
                onActiveFileMoved={handleActiveFileMoved}
                initialExpanded={persistedState?.expandedFolders ?? {}}
                onExpandedChange={(expandedFolders) =>
                  updatePersistedState({ expandedFolders })
                }
              />
            </div>
            <SidebarResizer
              width={sidebarWidth}
              onWidthChange={handleSidebarWidthChange}
              onCommit={handleSidebarWidthCommit}
            />
          </>
        )}

        <main className="flex-1 relative overflow-hidden bg-bg">
          {activeFile.active ? (
            <Canvas
              filePath={activeFile.active.path}
              loadVersion={activeFile.active.loadVersion}
              initialScene={activeFile.active.initialScene}
              theme={theme}
              onAPI={autoSave.onAPI}
              onChange={autoSave.onChange}
            />
          ) : (
            <EmptyState
              hasFiles={hasFiles}
              onCreateFirst={() => setNewDrawingDialogOpen(true)}
            />
          )}
        </main>
      </div>

      {newDrawingDialogOpen && (
        <NewItemDialog
          mode="newFile"
          context="New drawing"
          folderChoices={folderChoices}
          onSubmit={submitNewDrawingDialog}
          onCancel={() => setNewDrawingDialogOpen(false)}
        />
      )}

      {newFolderDialogOpen && (
        <NewItemDialog
          mode="newFolder"
          context="New folder"
          folderChoices={folderChoices}
          onSubmit={submitNewFolderDialog}
          onCancel={() => setNewFolderDialogOpen(false)}
        />
      )}

      {importFlow.dialogs}
    </div>
  );
}

export default App;
