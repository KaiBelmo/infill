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

### Recommended Ollama Models

Local AI should use an instruction-tuned model that can return strict JSON within the extension timeout. On a lower-VRAM Windows laptop, use these models in order:

| Priority | Model | Use when | Notes |
| --- | --- | --- | --- |
| 1 | `qwen2.5:3b-instruct-q4_K_M` | Recommended default | Best balance tested for local JSON/instruction following while staying small enough for this machine class. |
| 2 | `qwen2.5:1.5b` | Faster fallback | Use if the 3B model is too slow. Expect weaker reasoning and more schema mistakes. |
| 3 | `llama3.2:3b` | Alternative 3B instruct model | Try if Qwen 3B is unavailable or gives poor output. |

Avoid using very small or oversized models for the local assist path:

- `qwen2.5:0.5b` can run locally, but it may copy examples or return invalid JSON for matcher prompts.
- 9B-class models such as `qwen3.5:9b-q4_K_M` may be too slow on this setup and can miss the extension timeout.

Install the recommended model with:

```powershell
ollama pull qwen2.5:3b-instruct-q4_K_M
```

Then configure the extension options UI with:

```text
Ollama base URL: http://localhost:11434/v1
Ollama model: qwen2.5:3b-instruct-q4_K_M
```
