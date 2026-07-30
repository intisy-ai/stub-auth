// @ts-nocheck
// OpenCode entry (the deployed plugin file). core-auth registers the native
// provider + auth method and routes requests to driver.handleIr.

import { defineProvider, COMMON_PROVIDER_CAPABILITIES, COMMON_PROVIDER_DEFAULTS } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";
import { deployCommands, defineConfig, defineCapabilities, defineReadme, maybeRunReadmeCli } from "../core/src/index.js";
import { STUB_COMMANDS, maybeRunCli } from "./commands.js";

// Register config defaults BEFORE the CLI guard so `config schema` sees them (no write).
defineConfig("stub-auth", {
  ...COMMON_PROVIDER_DEFAULTS,
  logging: true,
  response_text: "Hello from stub-auth: the core-auth pipeline works end to end.",
  model_count: 3,
  latency_ms: 0,
  fail_rate: 0,
  streaming: null,   // null = honor the request's stream flag; true/false = force
});

// Describe those settings as controllable data so a dashboard can render typed
// controls for them without knowing anything about stub-auth specifically.
defineCapabilities("stub-auth", {
  fields: [
    ...COMMON_PROVIDER_CAPABILITIES,
    { key: "logging", type: "boolean", label: "Logging", description: "Write this plugin's log file.", group: "General" },
    { key: "response_text", type: "multiline", label: "Canned response", description: "The text every stub reply returns.", group: "Response" },
    { key: "model_count", type: "number", label: "Advertised models", description: "How many stub models to expose.", min: 1, group: "Response" },
    { key: "latency_ms", type: "number", label: "Simulated latency (ms)", min: 0, group: "Simulation" },
    { key: "fail_rate", type: "number", label: "Failure rate", description: "0 = never fail, 1 = always fail.", min: 0, max: 1, step: 0.05, group: "Simulation" },
    {
      key: "streaming", type: "select", label: "Streaming", group: "Simulation",
      options: [
        { value: "null", label: "Honor request" },
        { value: "true", label: "Force on" },
        { value: "false", label: "Force off" },
      ],
    },
  ],
  actions: [
    { id: "accounts", label: "List accounts", description: "Print the stub-auth demo accounts." },
  ],
});

defineReadme({
  description:
    "A stub AI-provider driver for [`core-auth`](https://github.com/intisy-ai/core-auth). It returns canned,\nvalid responses as canonical IR (the front-door encodes them to the app's Anthropic wire format, JSON or\nSSE) so the auth pipeline (discovery, routing, and the per-app adapters in Claude Code and OpenCode) can\nbe validated end to end without contacting any real provider. It is also the reference **example** for\nbuilding new provider plugins: define `{ id, label, models, handleIr }`, let core-auth do the rest.",
  architecture: `flowchart LR
  A[cc / oc chat] --> B[core-auth / loader proxy]
  B --> C{active provider}
  C -->|stub| D[driver.handleIr]
  D -->|stream?| E[canned IR event stream]
  D -->|else| F[canned IrResponse]
  E --> A
  F --> A`,
  structure: {
    src: [
      "`src/driver.ts`, the provider: `id`/`label`/`models` + `handleIr()` returning the canned IR response.",
      "`src/index.ts`, OpenCode entry (`defineProvider(driver).opencode`).",
      "`src/handler.ts`, Claude entry (exposes the IR-native `handleIr` the loader proxy calls).",
      "`src/commands.ts`, cross-app slash-commands (the reference example of the command framework).",
      "`core-auth/`, `core/`, git submodules (auth engine; shared config/logging/commands), bundled in.",
    ],
    dist: [
      "`dist/index.js` + `dist/handler.js`, esbuild bundles the submodules in, producing self-contained entries; not committed.",
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
