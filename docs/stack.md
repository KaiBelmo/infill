# Stack

## Core

| Layer | Technology |
| --- | --- |
| Language | TypeScript |
| Package manager | pnpm via Corepack |
| Workspace | pnpm workspaces |
| Extension platform | Browser Extension Manifest V3 |
| Build tool | Vite |
| Extension build plugin | CRXJS Vite plugin |
| UI | React 19 |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Messaging | webext-bridge |
| HTTP client | ky |
| Tests | Vitest |
| Type checking | TypeScript project references |

## Browser Support

The local development target is Chromium-based browsers that support Manifest V3 and unpacked extension loading.

Compatibility with other extension hosts should be verified before claiming support. Pay special attention to Manifest V3 service worker behavior, extension storage behavior, and content script injection rules.

## Build Outputs

The extension build writes generated files to:

```text
apps/extension/dist
```

Do not commit generated build output unless release packaging explicitly requires it.

## Test Assets

Manual form fixtures live in:

```text
apps/extension/test-forms
```

Use these fixtures to verify scanner behavior across normal forms, disabled fields, iframes, prefilled fields, multi-step flows, honeypots, and sensitive input types.

## Local AI

Contributors can use local Ollama for AI-assisted workflows. Configure the Ollama base URL and model from the extension options UI after loading the unpacked extension.
