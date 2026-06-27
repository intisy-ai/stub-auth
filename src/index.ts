// @ts-nocheck
// OpenCode entry (the deployed plugin file). core-auth registers the native
// provider + auth method and routes requests to driver.handle.

import { defineProvider } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";
import { deployCommands, ensureConfig } from "../core/src/index.js";
import { STUB_COMMANDS, maybeRunCli } from "./commands.js";

// Slash-command / config invocations shell back in as `node <bundle> <action>`;
// handle those first and exit so they never register the provider.
if (await maybeRunCli("stub-auth")) {
  process.exit(0);
}
try {
  deployCommands("stub-auth", STUB_COMMANDS);
  ensureConfig("stub-auth", { logging: true });
} catch {
  /* best-effort */
}

export const StubProvider = defineProvider(driver).opencode;
