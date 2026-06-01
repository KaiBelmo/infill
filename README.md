# Infill

Infill is an open-source browser extension that helps you fill forms faster while keeping you in control of what gets written into the page.

## What It Does

- Scans the active tab for fillable form fields.
- Matches fields against saved profile facts.
- Shows suggested mappings before filling.
- Avoids auto-filling sensitive fields unless the user approves the action.
- Stores profile state in browser extension storage.
- Supports optional encrypted profile sync through our backend after setting a passphrase.

## Project Layout

```text
.
+-- apps/extension/            # Browser extension source, UI, manifest, fixtures
+-- packages/form-brain/       # Field matching, assist, and risk logic
+-- packages/profile-vault/    # Profile facts, import, and vault state helpers
+-- packages/shared/           # Shared schemas and cross-package types
+-- docs/                      # Contributor and architecture documentation
+-- package.json               # Workspace scripts
`-- pnpm-workspace.yaml        # pnpm workspace package map
```

## Prerequisites

- Node.js 22 or newer.
- Corepack enabled.
- pnpm 10.30.0, managed through Corepack.
- Chromium-based browser for local extension loading.

```powershell
corepack enable
corepack pnpm install
```

## Development

Run the extension build in watch mode:

```powershell
corepack pnpm dev
```

Create a production build:

```powershell
corepack pnpm build
```

Run tests:

```powershell
corepack pnpm test
```

Run TypeScript checks:

```powershell
corepack pnpm typecheck
```

The extension build output is generated under `apps/extension/dist`.

## Load The Extension

1. Run `corepack pnpm build` or keep `corepack pnpm dev` running.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select `apps/extension/dist`.
6. Pin Infill from the browser toolbar.

After source changes in watch mode, reload the extension from `chrome://extensions` before retesting browser behavior.

## Documentation

- [Architecture](docs/architecture.md)
- [Stack](docs/stack.md)
- [Development Guide](docs/development.md)
- [Contributing](docs/contributing.md)

## Security

Please report security issues privately before opening a public issue. Include the affected version or commit, reproduction steps, expected impact, and whether the issue affects local Ollama, profile sync, or sign-in.
