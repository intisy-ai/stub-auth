// @ts-nocheck
// OpenCode entry (the deployed plugin file). core-auth registers the native
// provider + auth method and routes requests to driver.handle.

import { defineProvider } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";
import { deployCommands, defineConfig, defineReadme, maybeRunReadmeCli } from "../core/src/index.js";
import { STUB_COMMANDS, maybeRunCli } from "./commands.js";

// Register config defaults BEFORE the CLI guard so `config schema` sees them (no write).
defineConfig("stub-auth", {
  logging: true,
  response_text: "Hello from stub-auth: the core-auth pipeline works end to end.",
  model_count: 3,
  latency_ms: 0,
  fail_rate: 0,
  streaming: null,   // null = honor the request's stream flag; true/false = force
});

defineReadme({
  description:
    "A stub AI-provider driver for [`core-auth`](https://github.com/intisy-ai/core-auth). It returns canned,\nvalid Anthropic Messages API responses (JSON or SSE) so the auth pipeline — discovery, routing, and\nthe per-app adapters in Claude Code and OpenCode — can be validated end to end without contacting any\nreal provider. It is also the reference **example** for building new provider plugins: define\n`{ id, label, models, handle }`, let core-auth do the rest.",
  architecture: `flowchart LR
  A[cc / oc chat] --> B[core-auth / loader proxy]
  B --> C{active provider}
  C -->|stub| D[driver.handle]
  D -->|stream?| E[canned SSE]
  D -->|else| F[canned JSON]
  E --> A
  F --> A`,
  structure: {
    src: [
      "`src/driver.ts` — the provider: `id`/`label`/`models` + `handle()` returning the canned response.",
      "`src/index.ts` — OpenCode entry (`defineProvider(driver).opencode`).",
      "`src/handler.ts` — Claude entry (the named `handle` the loader proxy calls).",
      "`src/commands.ts` — cross-app slash-commands (the reference example of the command framework).",
      "`core-auth/`, `core/` — git submodules (auth engine; shared config/logging/commands), bundled in.",
    ],
    dist: [
      "`dist/index.js` + `dist/handler.js` — esbuild bundles the submodules in, producing self-contained entries; not committed.",
    ],
  },
  commands: STUB_COMMANDS,
  dependencies: ["core", "core-auth"],
  extraSections: [
    {
      id: "provider-selection",
      title: "Selecting the Stub Provider",
      after: "installation",
      body: "After installing, pick **Stub** in the loader's Providers tab (`cc auth`) or run `oc auth login` and select a `stub/...` model. The active provider is stored by the loader.",
    },
  ],
});

// Slash-command / config invocations shell back in as `node <bundle> <action>`;
// handle those first and exit so they never register the provider.
if (maybeRunReadmeCli("stub-auth")) process.exit(0);
if (await maybeRunCli("stub-auth")) {
  process.exit(0);
}
try {
  deployCommands("stub-auth", STUB_COMMANDS);
} catch {
  /* best-effort */
}

export const StubProvider = defineProvider(driver).opencode;
