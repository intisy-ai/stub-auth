// @ts-nocheck
// OpenCode entry (the deployed plugin file). core-auth registers the native
// provider + auth method and routes requests to driver.handleIr.

import { defineProviderPlugin, setActivityEmitter } from "@intisy-ai/core-auth";
import { driver } from "./driver.js";
import { emitEvent } from "@intisy-ai/core";
import { maybeRunCli } from "./commands.js";

// Best-effort: let core-auth's account activity (added/removed/login/rate_limited/models_refreshed) flow onto the bus.
setActivityEmitter((spec: unknown, source: string) => emitEvent(spec, source));

export const StubProvider = await defineProviderPlugin({
  name: "stub-auth",
  driver,
  cliGuard: () => maybeRunCli(),
  readme: {
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
        "`src/index.ts`, OpenCode entry (`defineProviderPlugin({...})`, core-auth's shared provider prologue).",
        "`src/handler.ts`, Claude entry (exposes the IR-native `handleIr` the loader proxy calls).",
        "`src/commands.ts`, cross-app slash-commands (the reference example of the command framework).",
      ],
      dist: [
        "`dist/index.js` + `dist/handler.js`; not committed. `@intisy-ai/core`, `core-auth` and `core-ir` stay external and resolve from the home's shared library store.",
      ],
    },
    dependencies: ["core", "core-auth"],
    extraSections: [
      {
        id: "provider-selection",
        title: "Selecting the Stub Provider",
        after: "installation",
        body: "After installing, pick **Stub** in the loader's Providers tab (`cc auth`) or run `oc auth login` and select a `stub/...` model. The active provider is stored by the loader.",
      },
    ],
  },
});

// StubProvider stays exported too: OpenCode invokes every exported function, while an api host reads the default.
export { default } from "./plugin.js";
