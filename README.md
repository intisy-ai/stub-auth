# stub-auth

[![npm version](https://img.shields.io/npm/v/stub-auth)](https://www.npmjs.com/package/stub-auth)
[![npm downloads](https://img.shields.io/npm/dm/stub-auth)](https://www.npmjs.com/package/stub-auth)
[![CI](https://img.shields.io/github/actions/workflow/status/intisy-ai/stub-auth/publish.yml)](https://github.com/intisy-ai/stub-auth/actions)

A stub AI-provider driver for [`core-auth`](https://github.com/intisy-ai/core-auth). It returns canned,
valid responses as canonical IR (the front-door encodes them to the app's Anthropic wire format, JSON or
SSE) so the auth pipeline (discovery, routing, and the per-app adapters in Claude Code and OpenCode) can
be validated end to end without contacting any real provider. It is also the reference **example** for
building new provider plugins: define `{ id, label, models, handleIr }`, let core-auth do the rest.

## Under-the-Hood Architecture

```mermaid
flowchart LR
  A[cc / oc chat] --> B[core-auth / loader proxy]
  B --> C{active provider}
  C -->|stub| D[driver.handleIr]
  D -->|stream?| E[canned IR event stream]
  D -->|else| F[canned IrResponse]
  E --> A
  F --> A
```

## Structure

- `src/`
  - `src/driver.ts`, the provider: `id`/`label`/`models` + `handleIr()` returning the canned IR response.
  - `src/index.ts`, OpenCode entry (`defineProviderPlugin({...})`, core-auth's shared provider prologue).
  - `src/handler.ts`, Claude entry (exposes the IR-native `handleIr` the loader proxy calls).
  - `src/commands.ts`, cross-app slash-commands (the reference example of the command framework).
- `dist/`
  - `dist/index.js` + `dist/handler.js`; not committed. `@intisy-ai/core`, `core-auth` and `core-ir` stay external and resolve from the home's shared library store.

## Installation

### Via plugin-updater (recommended)

```bash
npx plugin-updater@latest init https://github.com/intisy-ai/stub-auth
```

### Via npm

```bash
npm install stub-auth
```

## Selecting the Stub Provider

After installing, pick **Stub** in the loader's Providers tab (`cc auth`) or run `oc auth login` and select a `stub/...` model. The active provider is stored by the loader.

## Configuration

Config file: `<configDir>/config/stub-auth.json` (edit it directly, or through whatever settings surface the app offers).

```json
{
  "account_selection_strategy": "hybrid",
  "logging": true,
  "response_text": "Hello from stub-auth: the core-auth pipeline works end to end.",
  "model_count": 3,
  "latency_ms": 0,
  "fail_rate": 0,
  "streaming": null
}
```

| Key | Default |
| --- | --- |
| `account_selection_strategy` | `"hybrid"` |
| `logging` | `true` |
| `response_text` | `"Hello from stub-auth: the core-auth pipeline works end to end."` |
| `model_count` | `3` |
| `latency_ms` | `0` |
| `fail_rate` | `0` |
| `streaming` | `null` |

## Commands

| Command | Description | Arguments |
| --- | --- | --- |
| `/stub-accounts` | List stub-auth demo accounts |  |

## Dependencies

- `core`
- `core-auth`

## Logging

Logs are written to `<configDir>/logs/YYYY-MM-DD/stub-auth-HH-MM-SS.log` and are toggled by
this plugin's `logging` config (default on). Console mirroring is global, off by default,
and controlled by the shared `config/settings.json` `logConsole` flag.

## License

MIT.
