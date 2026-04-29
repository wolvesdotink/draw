# draw

**A quiet, local-first sketchpad for the desktop.**

Open the app, draw a thing, close the app. That's the whole loop. No
account, no cloud, no sync spinner — every drawing is just a plain
`.excalidraw` file on your own disk. Autosaved every keystroke. Works
on a plane.

Built on the Excalidraw canvas you already know, wrapped in a native
macOS shell that gets out of the way.

---

## Features

- **Local files, real files.** Drawings live in
  `~/Library/Application Support/ink.wolves.draw/drawings/` as plain
  `.excalidraw` JSON. Open them in any Excalidraw client, commit them
  to git, grep them, back them up — they're yours.
- **Continuous autosave with crash recovery.** Every change is flushed
  to disk via atomic `.tmp` → rename. Stale temp files are swept on
  launch. Pull the plug mid-stroke; the file is fine.
- **Offline-first.** No network calls, no telemetry, no login. The
  app does the same thing on a train as it does on a desk.
- **Sidebar file tree.** Folders, nested folders, drag-and-drop to
  reorganize, in-place rename, delete. Resizable, collapsible, and it
  remembers what you had open.
- **Drop to import.** Drag a `.excalidraw` file from Finder onto the
  window — the import flow asks where to put it and detects overwrites.
- **Light & dark.** A single toggle in the topbar. Pure white or pure
  graphite — the canvas matches.
- **Keyboard-first.** `⌘N` new drawing · `⌘⇧N` new folder · `⌘I` import
  · `⌘S` force-save · `⌘⌫` delete · `⌘\` toggle sidebar.
- **Silent auto-update.** Checks for new releases a few seconds after
  launch, signed with the Tauri minisign key. The user always confirms
  the restart — your in-flight canvas is never yanked out from under you.
- **Universal macOS binary.** One signed, notarized `.dmg` runs natively
  on Apple Silicon and Intel.

---

## Design

Brutalist, on purpose.

- Pure black on pure white (or pure white on graphite, in dark mode).
  No gradients. No frosted glass. No animated mascots.
- Hard 4px offset shadows — the kind printed posters cast — instead of
  soft drop shadows. Everything reads as a placed object.
- Hairline borders at full contrast: black-on-white, white-on-black.
  Borders are structural, not decorative.
- Typography is two faces, doing different jobs. **JetBrains Mono** in
  small caps with wide tracking carries every label, button, kbd hint
  and the active-file title in the topbar — load-bearing monospace.
  **Instrument Sans** keeps the file tree and body content readable.
- Native macOS chrome: traffic lights overlay a single unified topbar
  that doubles as the window drag region. The title in the middle is
  the file you're currently editing.
- An empty canvas shows a faint drafting-dot grid and nothing else.

The whole thing is meant to feel like a clean drafting table, not a SaaS
dashboard.

---

## Local development

```bash
pnpm install
pnpm tauri dev
```

Frontend-only (in a browser) for layout work:

```bash
pnpm dev    # runs vite at http://localhost:1420
```

Note that filesystem features (autosave, file tree, import) only work in
the Tauri shell — the browser-only path will throw on those calls.

---

## Distribution — how to ship a release

Releases are produced by GitHub Actions. The maintainer never builds a
`.dmg` locally for distribution.

### One-time setup (do this once, before the first release)

1. **Add the Apple Developer ID + Tauri updater secrets to GitHub:**
   Settings → Secrets and variables → Actions → *New repository secret*

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | base64 of your Developer ID `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
   | `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_PASSWORD` | app-specific password (created at appleid.apple.com → Sign-In and Security → App-Specific Passwords) |
   | `APPLE_TEAM_ID` | 10-character team id |
   | `TAURI_SIGNING_PRIVATE_KEY` | contents of `.secrets/updater.key` (this file is gitignored — keep your local copy safe) |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | blank if generated without password |

   Encoding the `.p12` for `APPLE_CERTIFICATE`:

   ```bash
   base64 -i path/to/DeveloperID.p12 | pbcopy
   ```

2. **Commit `.secrets/updater.key.pub` is NOT needed** — the public key
   is already baked into [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json)
   under `plugins.updater.pubkey`. The signing key in `.secrets/` stays
   local, never in git (see `.gitignore`).

### Cutting a release

Bump the version in **two** places (they must match):

- [`package.json`](./package.json) → `version`
- [`src-tauri/tauri.conf.json`](./src-tauri/tauri.conf.json) → `version`

Then tag and push:

```bash
git commit -am "v0.2.0"
git tag v0.2.0
git push --follow-tags
```

The [`release.yml`](./.github/workflows/release.yml) workflow will:

1. Build a universal `.dmg` (Apple Silicon + Intel in one file)
2. Sign it with your Developer ID + notarize it with Apple
3. Sign the updater payload with the Tauri minisign key
4. Publish a GitHub Release with all artifacts
5. Re-upload the `.dmg` under the stable filename `draw.dmg` so the
   marketing site can link to one URL forever

Total runtime is about 12–18 minutes, mostly Apple notarization.

---

## Distribution URLs (link these from the marketing site)

These URLs are stable forever — they always point at the current latest
release:

| What | URL |
|---|---|
| **Direct DMG download** (use this on your "Download" button) | `https://github.com/wolvesdotink/draw/releases/latest/download/draw.dmg` |
| Updater manifest (the in-app updater hits this) | `https://github.com/wolvesdotink/draw/releases/latest/download/latest.json` |
| Release page (changelog, all assets) | `https://github.com/wolvesdotink/draw/releases/latest` |

GitHub auto-redirects `releases/latest/download/<filename>` to the asset
of that name in the most recent non-prerelease.

Example download button HTML for the website:

```html
<a href="https://github.com/wolvesdotink/draw/releases/latest/download/draw.dmg" download>
  Download for macOS
</a>
```

---

## In-app auto-update

The app checks for updates 4 seconds after launch (silent — no UI flash
on cold-start). When the updater finds a newer version on the manifest
endpoint, the topbar grows a small `↑` button with an accent dot.

| Topbar state | Means |
|---|---|
| (hidden) | Up to date or check still pending |
| `↑` + dot | Update available — click to download + install |
| `[ ## % ]` | Currently downloading / installing |
| `⟲ RESTART` (inverted) | Install complete — click to relaunch |
| `!` (red) | Check or install failed — click to retry |

The updater never auto-restarts the app. The user always confirms by
clicking `RESTART`, so any in-flight canvas state is safe.

Implementation:

- Hook: [`src/hooks/useUpdater.ts`](./src/hooks/useUpdater.ts)
- Button: [`src/components/UpdateButton.tsx`](./src/components/UpdateButton.tsx)
- Plugin config: `plugins.updater` in `tauri.conf.json`

---

## App icon

Designed in SVG — see [`src-tauri/icons/icon.svg`](./src-tauri/icons/icon.svg).

To regenerate all platform icon sizes from the SVG (after editing it):

```bash
rsvg-convert -w 1024 -h 1024 src-tauri/icons/icon.svg -o src-tauri/icons/icon-source.png
pnpm tauri icon src-tauri/icons/icon-source.png
```

This produces `.icns` (macOS), `.ico` (Windows), and all the PNG sizes
declared in `bundle.icon` in `tauri.conf.json`. Commit them all.

If you don't have `rsvg-convert`:

```bash
brew install librsvg
```

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
