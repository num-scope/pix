# Shared Node 24 and managed Python

Pix ships one Node 24 executable (`node.exe` on Windows, `node` on macOS/Linux). Tauri starts the Sidecar with it, Agent Hosts fork it, and managed tool environments use the same executable through `NODE_BINARY` and `PATH`.

`prepare-sidecar.mjs` requires Node 24 and stages that build executable as a Tauri external binary. `fetch-runtimes.mjs` copies the npm package from that same Node installation; it no longer downloads another Node distribution. The manifest records the actual Node and npm versions. Install the official Node 24 distribution including npm on build machines.

The installer contains:

- One external Node executable beside the application executable.
- `runtimes/archives/npm.tar.gz`: npm/npx launchers and npm package files, with no Node executable.
- `runtimes/archives/python.tar.gz` and `runtimes/manifest.json`.

On first launch, npm scripts and Python are extracted into the application user-data directory. `npm-prefix` and `python-venv` remain separate writable directories. npm/npx launchers resolve their scripts relative to themselves and use `NODE_BINARY`, so paths with spaces and relocated installations work.

Layout version 3 replaces the old extracted `runtimes/node` directory, removing Node 22 while preserving `npm-prefix` packages. Stamp checks include Node, npm, Python, Python release, platform key and layout version. Disabling managed Node in Settings removes its PATH entries and npm isolation environment; the application backend continues using its own Node.

`versions.json` specifies the required Node major and pins Python. Node's exact patch version and npm come from the build installation.

Validation after staging:

```sh
node apps/desktop/scripts/shared-node-smoke.test.mjs
```

This uses the staged executable and production modules to check npm/npx, a local offline npm install and lifecycle script, a real node-pty terminal, the clipboard N-API addon, and Photon WASM. `sidecar-smoke.test.mjs` also checks TypeScript extension loading/reloading in the Agent Host. Release CI runs the runtime compatibility check on every target; the Windows installed-app smoke workflow checks the relocated installed executable.
