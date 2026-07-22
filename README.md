# Pix

Pix is a desktop shell for the [pi](https://pi.dev) coding agent: a Codex-style UI that keeps configuration, packages, sessions, and tools on the native pi side (`~/.pi/agent`).

## Requirements

- Node.js 22.19 or newer
- pnpm 11.15.1

## Setup

```bash
pnpm install
pnpm electron:install
```

`electron:install` downloads the Electron 43 runtime for your platform.

## Develop

```bash
pnpm dev
```

Builds renderer / preload / main / agent-host, then launches Electron. Restart after source changes.

Product launch uses your real `HOME` and the same agent dir as the CLI (`~/.pi/agent` / `PI_CODING_AGENT_DIR`). Models, API keys, settings, packages, and tools match interactive `pi`. The last workspace is restored from desktop prefs; no temp workspace is created on every start.

## Validate

```bash
pnpm check        # lint + types + format (same as Linux CI)
pnpm check:types  # lint + types only (same as Windows/macOS CI)
pnpm fmt          # auto-fix formatting
pnpm test
pnpm build
pnpm smoke
pnpm ready        # check + test + build
```

Isolated smoke (temp home + fixture workspace + fake model):

```bash
pnpm smoke
# or
PIX_ISOLATED=1 pnpm start
```

Packaged smoke (unsigned app directory):

```bash
pnpm package
pnpm smoke:packaged
```

## Package

```bash
pnpm package
```

Produces an unsigned platform app directory under `apps/desktop/release/app/` via `electron-builder --dir`.

## CI & Release

| Workflow    | File                            | When                      | What                                                                      |
| ----------- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| **CI**      | `.github/workflows/ci.yml`      | PR + push to `main`       | install → lint/types → unit tests → `pnpm build` on Linux, Windows, macOS |
| **Release** | `.github/workflows/release.yml` | push `v*` tag (or manual) | multi-platform `pnpm package` → zip → **GitHub Release** with assets      |

### Cut a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

That triggers packaging on Linux / Windows / macOS and publishes a GitHub Release named `v0.1.0` with one zip per platform. Manual **workflow_dispatch** only builds and uploads Actions artifacts (no Release). Format check runs only on Linux CI; lint and typecheck run on all three OSes. mac packaging sets `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned).

## Architecture

```text
React Renderer → Preload → Electron Main → utilityProcess Agent Host → pi SDK
```

- Renderer has no Node.js access.
- Main supervises the Agent Host but does not execute pi tools or extensions.
- Agent Host uses the public `@earendil-works/pi-coding-agent` SDK.
- Electron `userData` is only for desktop chrome prefs — never a second agent config layer.
- A fresh pi home receives no Pix packages, resources, or custom settings.
- `utilityProcess` provides crash isolation, not a security sandbox.

## License

See [LICENSE](./LICENSE).
