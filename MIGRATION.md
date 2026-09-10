# Tauri + Node Agent Sidecar migration

## Preserved behavior

| Area                                                              | Implementation                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| React, Tailwind, components, rich timeline, skins                 | Existing renderer, with a transport adapter and native drag/drop integration      |
| Public frontend API                                               | Existing `PixDesktopApi` / `window.pix` surface                                   |
| Models, API keys, OAuth, usage, settings                          | Existing pi SDK and agent-runtime modules                                         |
| Session history, fork/tree, compaction, import/export/share       | Existing Agent Host command handlers                                              |
| Background generation and parked sessions                         | Existing HostSupervisor lifecycle policy, now using Node child IPC                |
| Extensions, prompts, skills, package management, trust            | Existing pi resource loader and extension UI bridge                               |
| Git, branches, worktrees, project history                         | Existing Node implementations, moved out of Electron Main                         |
| Terminal                                                          | Existing Ghostty frontend + Node `node-pty` + bundled/global pi CLI               |
| Window chrome, resize persistence, scale, theme                   | Tauri window APIs and window-state plugin                                         |
| File/folder dialogs, open/reveal, clipboard images, notifications | Rust native handlers via Tauri plugins                                            |
| Managed Node/Python tools                                         | Shared Node 24 + npm scripts, existing Python provisioner and runtime preferences |
| Installers and updates                                            | Tauri bundler and signed updater artifacts                                        |

## Source layout

- `apps/desktop/src/desktop/`: renderer adapter retaining the original API.
- `apps/desktop/src/sidecar/`: Node business entry, versioned stdio RPC, native request bridge, image codec, Agent Host fork.
- `apps/desktop/src/main/`: reusable Node business helpers retained from the old desktop main process.
- `apps/desktop/src/agent-host/`: SDK worker; standard `process.send` / `process.on('message')` IPC.
- `apps/desktop/src-tauri/`: native shell, capabilities, sidecar supervisor, native handlers.
- `packages/sidecar-node/`: minimal production dependency graph; no React/Electron packages in the sidecar bundle.

## Transport and lifecycle

Tauri launches a bundled, explicitly resolved Node 24 executable (`node.exe` / `node`). Managed tools share that executable; only npm/npx scripts and Python are provisioned into user data. Only the trusted main window can invoke the desktop bridge. Renderer requests carry a unique ID; sidecar responses and events have protocol version 1. Native requests run independently so a dialog or an active generation cannot block an abort or other concurrent RPC. stdout is reserved for JSON protocol traffic; diagnostics go to stderr.

The sidecar registers every business handler before sending readiness. Startup failures and sidecar exits reject outstanding requests. Agent Host crashes can be recovered by starting the host again. A fatal top-level sidecar failure is shown in the interface and requires restarting Pix; an in-progress prompt is never replayed automatically.

Application exit closes PTYs and requests shutdown of foreground and parked agents. The sidecar also shuts down on stdin EOF if its Rust parent disappears. Rust enforces an exit deadline; Agent Hosts exit when their Node parent IPC disconnects.

## Data and assets

The agent directory and durable session format are unchanged. Desktop state is separate from pi configuration. `PIX_DATA_DIR` can select an explicit desktop data directory; isolated launches use temporary directories. Browser-local preferences in an older Electron profile are not automatically imported into a different WebView origin. The pi configuration and session files are shared directly.

Custom skin backgrounds now use validated raster data URLs rather than Electron's `pix-theme:` protocol. Wallpaper validation and export logic are preserved. The existing Photon WASM dependency handles image decoding and previews. The Tauri CSP permits the bundled Ghostty WASM data URL while preventing remote script execution.

Native file-drop events carry actual OS paths. The legacy synchronous `pathForFile(File)` contract returns an empty string for browser File objects, since WebViews do not expose filesystem paths; the composer receives paths through Tauri's drop event. File picking and image paste continue to work.

Skin Studio stages browser-selected image bytes through the existing image attachment API. Managed Python retains its bundled pip wheels; a runtime layout revision invalidates older installations that cannot create a working virtual environment. The terminal can fall back to the Sidecar's Node executable when no tool or host Node is available.

The AI proxy preference is injected into Agent Host environments. The app proxy preference configures Node's HTTP dispatcher for app network requests. The WebView loads bundled assets; external links open in the OS browser, which follows its own proxy settings. Tauri's updater uses the app proxy supplied on update checks.

## Platform checks

`pnpm check:rust` checks the native shell. `pnpm e2e` uses Chromium by default; `PIX_TEST_BROWSER=webkit pnpm e2e` uses WebKit with the same business sidecar. These tests do not replace native OS dialog/notification verification. CI includes Linux dependencies, while release builds run on each platform to keep Node and native addons compatible.

OS notification presentation and permission prompts remain platform-controlled. macOS release notarization and Windows code signing require the owner's signing configuration. Automatic updates require a Tauri signing keypair; the Electron updater feed cannot update this app. Existing Electron installations must install the Tauri release manually once.

## Validation on this migration

- 533 unit tests across contracts, agent-runtime and desktop; runtime archive helper checks also pass.
- 26 complete Chromium interface regressions against the real Node Sidecar.
- Five focused WebKit regressions covering app scale, extension selection, terminal switching/layout and skin image import.
- Production dependency staging, Sidecar protocol/SDK smoke test and two release artifact policy tests.
- TypeScript, lint, formatting and native Rust checks; macOS arm64 release app and DMG built locally.

The native macOS app was copied outside the repository and exercised for chat, the embedded terminal, native file/folder dialogs and shutdown. The relocated bundle also passes the Sidecar integration test. Production modules use real directories and command shims; staging rejects symlinks and fixes the PTY helper's execute permission before bundling. Windows, Linux, OS signing and signed update installation still require validation on their corresponding release environments.

For a macOS packaged smoke launch with temporary data and the local fake model, run `node apps/desktop/scripts/native-smoke.mjs --release` after `pnpm package`. `PIX_NATIVE_EXECUTABLE` can point to the executable of an app copied outside the repository, which verifies that module resolution cannot fall back to development dependencies.
