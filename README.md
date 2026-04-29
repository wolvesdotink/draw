# draw

Local-first Excalidraw desktop app. Drawings live as plain `.excalidraw`
files in `~/Library/Application Support/ink.wolves.draw/drawings/`,
autosaved continuously, with full offline support.

Built with Tauri 2 + React 18 + Vite.

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
| **Direct DMG download** (use this on your "Download" button) | `https://github.com/wolvessoftware/draw/releases/latest/download/draw.dmg` |
| Updater manifest (the in-app updater hits this) | `https://github.com/wolvessoftware/draw/releases/latest/download/latest.json` |
| Release page (changelog, all assets) | `https://github.com/wolvessoftware/draw/releases/latest` |

GitHub auto-redirects `releases/latest/download/<filename>` to the asset
of that name in the most recent non-prerelease.

Example download button HTML for the website:

```html
<a href="https://github.com/wolvessoftware/draw/releases/latest/download/draw.dmg" download>
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
