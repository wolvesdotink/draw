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
import { CommandPalette, type Command, type PaletteFile } from "./components/CommandPalette";
import {
  FolderPlusIcon,
  ImportIcon,
  MoonIcon,
  PlusIcon,
  SidebarShowIcon,
  SunIcon,
  TrashIcon,
} from "./components/icons";
import {
  useFileTree,
  ensureDrawingsRoot,
  findNode,
  flattenDirs,
  flattenFiles,
} from "./hooks/useFileTree";
import { useActiveFile } from "./hooks/useActiveFile";
import { useAutoSave } from "./hooks/useAutoSave";
import { useDragDrop } from "./hooks/useDragDrop";
import { useDrawingIndex } from "./hooks/useDrawingIndex";
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
import { DRAWINGS_DIR, basename, parentRel, stripExt, toAppDataPath } from "./lib/paths";
import { useViewport } from "./lib/platform";
import { useDialog } from "./hooks/useDialog";
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
  /**
   * Compact-viewport drawer open state. NOT persisted.
   *
   * On compact (iPhone / iPad Slide Over / half-screen Split View) the sidebar
   * is an overlay drawer over the canvas, defaulting to closed. We keep this
   * state separate from `persistedState.sidebarCollapsed` so toggling the
   * drawer on a phone doesn't clobber the user's desktop column-width
   * preference. On wide viewports this state is unused.
   */
  const [compactDrawerOpen, setCompactDrawerOpen] = useState(false);
  /** ⌘K command palette open state. NOT persisted. */
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Live viewport zone (compact / regular / wide). Drives sidebar drawer
  // mode on compact (iPhone, iPad Slide Over, half-screen Split View).
  const viewport = useViewport();
  // Imperative confirm/alert API — replaces window.confirm / window.alert.
  // Mounts brutalist-styled dialogs via DialogProvider in main.tsx.
  const dialog = useDialog();

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
  // Latest palette-open flag, read from the capture-phase key listener and the
  // global-shortcut handler without re-binding them on every toggle.
  const paletteOpenRef = useRef(false);
  paletteOpenRef.current = paletteOpen;

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

  // Flush pending writes on unload. `beforeunload` is synchronous-ish — we
  // can't await, but kicking off the writes here gives the fs plugin a chance
  // to ship them into Rust before the webview tears down. Covers Cmd+Q within
  // the 1s autosave debounce window, which would otherwise drop the last edit.
  useEffect(() => {
    const handler = () => {
      void autoSave.flushPending();
      void flushStateDebounced();
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [autoSave.flushPending]);

  // Menu-driven update check. The macOS app menu's "Check for Updates…" item
  // emits this event from Rust (see src-tauri/src/lib.rs); we just relay it
  // into the existing useUpdater state machine. Lazy import + try/catch so
  // the browser-only Vite build (no Tauri runtime) doesn't blow up on the
  // event API import — same pattern used inside useUpdater.ts.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen("menu://check-for-updates", () => {
          void updater.checkNow();
        });
        if (cancelled) {
          off();
          return;
        }
        unlisten = off;
      } catch {
        // Non-Tauri environment — nothing to wire up.
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [updater.checkNow]);

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
        // On compact viewports, auto-close the drawer after picking a file
        // so the canvas is fully visible. Wide viewports keep the column open.
        if (viewport.isCompact) setCompactDrawerOpen(false);
      } catch (e) {
        void dialog.alert({
          title: "Couldn't open file",
          body: (e as Error).message,
        });
      }
    },
    [activeFile, autoSave, updatePersistedState, viewport.isCompact, dialog],
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
        void dialog.alert({
          title: "Couldn't reopen after rename",
          body: (e as Error).message,
        });
      }
    },
    [activeFile, autoSave, updatePersistedState, dialog],
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
    const newPath = await fileTree.createFile(parent, name, theme);
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
        void dialog.alert({
          title: "Couldn't open imported file",
          body: (e as Error).message,
        });
      }
    },
    [activeFile, autoSave, updatePersistedState, dialog],
  );

  const existsRel = useCallback(async (rel: string) => exists(toAppDataPath(rel)), []);

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
  // Compact viewports drive the local drawer state; wide viewports persist
  // the column collapse across launches.
  const handleToggleSidebar = useCallback(() => {
    if (viewport.isCompact) {
      setCompactDrawerOpen((prev) => !prev);
      return;
    }
    const collapsed = persistedStateRef.current?.sidebarCollapsed ?? false;
    updatePersistedState({ sidebarCollapsed: !collapsed });
  }, [viewport.isCompact, updatePersistedState]);

  // ---------- Delete active ----------
  const handleDeleteActive = useCallback(async () => {
    const active = activeFileRef.current;
    if (!active) return;
    const confirmed = await dialog.confirm({
      title: "Delete drawing",
      subtitle: active.path,
      body: "This can't be undone.",
      okLabel: "DELETE",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await autoSave.flushPending().catch(() => {});
      autoSave.setActivePath(null);
      const path = active.path;
      activeFile.close();
      updatePersistedState({ lastOpenedPath: null });
      await fileTree.remove(path, false);
    } catch (e) {
      void dialog.alert({
        title: "Couldn't delete",
        body: (e as Error).message,
      });
    }
  }, [activeFile, autoSave, fileTree, updatePersistedState, dialog]);

  // ---------- Command palette (⌘K) ----------
  // Resolved here (not in the render block) so the command list below can read
  // the live theme without a temporal-dead-zone hazard.
  const theme: Theme = persistedState?.theme ?? "light";

  // True while another modal owns the foreground — keeps ⌘K from opening the
  // palette behind a dialog. Read from the capture-phase listener via ref.
  const blockPaletteRef = useRef(false);
  blockPaletteRef.current = newDrawingDialogOpen || newFolderDialogOpen || importFlow.isOpen;

  // Flat list of every drawing — feeds the palette's file switcher and the
  // content index keyed by the same rel paths.
  const paletteFiles = useMemo<PaletteFile[]>(
    () =>
      flattenFiles(fileTree.tree).map((node) => ({
        path: node.path,
        name: stripExt(node.name),
        dir: parentRel(node.path),
      })),
    [fileTree.tree],
  );

  // Lazy, mtime-cached full-text index over drawing contents. Built on palette
  // open (see CommandPalette); idle otherwise.
  const drawingIndex = useDrawingIndex(paletteFiles);

  const paletteCommands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "new-drawing",
        title: "New drawing",
        hint: "⌘N",
        keywords: "create file sketch canvas",
        icon: <PlusIcon size={15} />,
        run: () => setNewDrawingDialogOpen(true),
      },
      {
        id: "new-folder",
        title: "New folder",
        hint: "⌘⇧N",
        keywords: "create directory group",
        icon: <FolderPlusIcon size={15} />,
        run: () => setNewFolderDialogOpen(true),
      },
      {
        id: "import",
        title: "Import drawing",
        hint: "⌘I",
        keywords: "open excalidraw file load from disk",
        icon: <ImportIcon size={15} />,
        run: () => {
          void importFlow.start();
        },
      },
      {
        id: "toggle-theme",
        title: theme === "light" ? "Switch to dark mode" : "Switch to light mode",
        keywords: "theme appearance dark light color mode",
        icon: theme === "light" ? <MoonIcon size={15} /> : <SunIcon size={15} />,
        run: handleToggleTheme,
      },
      {
        id: "toggle-sidebar",
        title: "Toggle sidebar",
        hint: "⌘\\",
        keywords: "files tree panel drawer show hide",
        icon: <SidebarShowIcon size={15} />,
        run: handleToggleSidebar,
      },
    ];
    if (activeFile.active) {
      cmds.push({
        id: "delete-current",
        title: "Delete current drawing",
        hint: "⌘⌫",
        keywords: "remove trash erase",
        icon: <TrashIcon size={15} />,
        run: () => {
          void handleDeleteActive();
        },
      });
    }
    return cmds;
  }, [
    theme,
    activeFile.active,
    handleToggleTheme,
    handleToggleSidebar,
    handleDeleteActive,
    importFlow.start,
  ]);

  // ⌘K / ⌘P — toggle the palette. Registered in the capture phase so it
  // preempts Excalidraw's own ⌘K (add-link) before the event reaches the
  // canvas. While the palette is open it always toggles closed; while closed it
  // defers to any other open modal.
  useEffect(() => {
    if (bootStatus !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd || e.shiftKey || e.altKey) return;
      if (e.key === "k" || e.key === "K" || e.key === "p" || e.key === "P") {
        if (!paletteOpenRef.current && blockPaletteRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [bootStatus]);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    if (bootStatus !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      // The palette owns the keyboard while it's open (it handles its own keys).
      if (paletteOpenRef.current) return;
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
      <div className="app app--theme-light app-shell">
        <div data-tauri-drag-region className="topbar" />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-[120px] pulse-line" aria-hidden />
        </div>
      </div>
    );
  }
  if (bootStatus === "error") {
    return (
      <div className="app app--theme-light app-shell">
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

  const persistedWidth = persistedState?.sidebarWidth ?? 260;
  const sidebarWidth = liveSidebarWidth ?? persistedWidth;
  // On compact viewports the sidebar is an overlay drawer (Phase 6) driven
  // by a non-persisted local flag. On wide viewports it's a column whose
  // collapse state is persisted across launches.
  const persistedCollapsed = persistedState?.sidebarCollapsed ?? false;
  const sidebarCollapsed = viewport.isCompact ? !compactDrawerOpen : persistedCollapsed;

  const hasFiles = fileTree.tree.length > 0;

  // Topbar button base — squared, mono-labelled hit target. Opts out of drag.
  const topbarBtn =
    "w-7 h-7 inline-flex items-center justify-center bg-transparent border-0 text-text-muted leading-none hover:bg-bg-hover hover:text-text active:bg-text active:text-bg cursor-pointer";

  return (
    <div className={`app app--theme-${theme} app-shell`}>
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
            {activeFile.active ? stripExt(basename(activeFile.active.path)) : "— NO FILE —"}
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
        {/* Wide/regular viewport: sidebar lives as a column with a draggable
         * resizer between it and the canvas. The drawer overlay below
         * handles the compact case. */}
        {!viewport.isCompact && !sidebarCollapsed && (
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
                onExpandedChange={(expandedFolders) => updatePersistedState({ expandedFolders })}
                theme={theme}
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
            <EmptyState hasFiles={hasFiles} onCreateFirst={() => setNewDrawingDialogOpen(true)} />
          )}
        </main>
      </div>

      {/* Compact viewport: sidebar overlays the canvas as a slide-in drawer.
       * Always rendered so the close animation can play. The CSS controls
       * visibility/pointer-events via the `data-open` attribute. Tap on the
       * scrim (the drawer container itself, not the panel) closes it. */}
      {viewport.isCompact && (
        <div
          className="sidebar-drawer"
          data-open={!sidebarCollapsed ? "true" : "false"}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleToggleSidebar();
          }}
          aria-hidden={sidebarCollapsed}
        >
          <div className="sidebar-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <Sidebar
              fileTree={fileTree}
              activePath={activeFile.active?.path ?? null}
              onSelectFile={handleSelectFile}
              onActiveFileRemoved={handleActiveFileRemoved}
              onActiveFileMoved={handleActiveFileMoved}
              initialExpanded={persistedState?.expandedFolders ?? {}}
              onExpandedChange={(expandedFolders) => updatePersistedState({ expandedFolders })}
              theme={theme}
            />
          </div>
        </div>
      )}

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

      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          files={paletteFiles}
          searchContent={drawingIndex.search}
          prepareIndex={drawingIndex.refresh}
          onOpenFile={(rel) => {
            void handleSelectFile(rel);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
