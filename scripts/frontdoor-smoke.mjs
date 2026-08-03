#!/usr/bin/env node
// Raw-Node smoke test for the in-process app<->IR front-door chain. Vitest's module loader is
// more lenient than plain Node about bare-path dynamic import() specifiers (Windows reads a drive
// letter as a URL scheme), so this proves the real runtime behavior: HUB_APP_FRONTDOOR pointing at
// opencode-loader's built adapter, resolved by core-auth's resolveAppFrontDoor via pathToFileURL,
// wired through createProviderPlugin, and served end to end with no daemon.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const stubAuthDir = join(scriptDir, "..");
const repoRoot = join(stubAuthDir, "..", "..");
const frontDoorPath = join(repoRoot, "loaders", "opencode-loader", "dist", "frontdoor.js");
const coreAuthIndexPath = join(stubAuthDir, "core-auth", "dist", "index.js");
const driverPath = join(stubAuthDir, "dist", "driver.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(frontDoorPath)) fail(`opencode-loader dist not built at ${frontDoorPath} (run "npm run build" in loaders/opencode-loader)`);
if (!existsSync(coreAuthIndexPath)) fail(`core-auth dist not built at ${coreAuthIndexPath} (run "npm run build" in providers/stub-auth)`);
if (!existsSync(driverPath)) fail(`stub-auth driver dist not built at ${driverPath} (run "npm run build" in providers/stub-auth)`);

process.env.HUB_APP_FRONTDOOR = frontDoorPath;

const { createProviderPlugin } = await import(pathToFileURL(coreAuthIndexPath).href);
const { driver } = await import(pathToFileURL(driverPath).href);

const plugin = createProviderPlugin(driver);
const hooks = await plugin({ client: null });
if (!hooks || !hooks.auth || typeof hooks.auth.loader !== "function") {
  fail("createProviderPlugin did not build OpenCode auth hooks; the front-door was not resolved");
}

const loaded = await hooks.auth.loader();
const request = new Request("http://x/v1/messages", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "stub/stub-model", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
});

const response = await loaded.fetch(request);
const bodyText = await response.text();
const bodyMatch = bodyText.includes("Hello from stub-auth");

console.log(`status=${response.status} bodyMatch=${bodyMatch}`);
console.log(bodyText);

if (response.status !== 200 || !bodyMatch) fail(`unexpected response (status=${response.status} bodyMatch=${bodyMatch})`);

console.log("PASS: raw-node front-door smoke check succeeded");
