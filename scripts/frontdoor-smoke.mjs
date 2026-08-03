#!/usr/bin/env node
// Raw-Node smoke test proving standalone in-process serving: a temp home carrying ONLY the
// generic deployed front-door (<home>/frontdoor/app-frontdoor.mjs, produced by opencode-proxy's
// own deployFrontDoor) is enough for core-auth's resolveAppFrontDoor to find it via HUB_CONFIG_DIR
// alone. No HUB_APP_FRONTDOOR env, no opencode-loader, no daemon. Vitest's module loader is more
// lenient than plain Node about bare-path dynamic import() specifiers (Windows reads a drive
// letter as a URL scheme), so running this via raw `node` proves the real runtime behavior.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const stubAuthDir = join(scriptDir, "..");
const repoRoot = join(stubAuthDir, "..", "..");
const opencodeProxyIndexPath = join(repoRoot, "proxies", "opencode-proxy", "dist", "index.js");
const coreAuthIndexPath = join(stubAuthDir, "core-auth", "dist", "index.js");
const driverPath = join(stubAuthDir, "dist", "driver.js");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!existsSync(opencodeProxyIndexPath)) fail(`opencode-proxy dist not built at ${opencodeProxyIndexPath} (run "npm run build" in proxies/opencode-proxy)`);
if (!existsSync(coreAuthIndexPath)) fail(`core-auth dist not built at ${coreAuthIndexPath} (run "npm run build" in providers/stub-auth)`);
if (!existsSync(driverPath)) fail(`stub-auth driver dist not built at ${driverPath} (run "npm run build" in providers/stub-auth)`);

const smokeHome = mkdtempSync(join(tmpdir(), "fd-smoke-"));

const { deployFrontDoor, frontDoorDeployPath } = await import(pathToFileURL(opencodeProxyIndexPath).href);
deployFrontDoor(smokeHome);
const deployedPath = frontDoorDeployPath(smokeHome);
if (!existsSync(deployedPath)) fail(`deployFrontDoor did not produce ${deployedPath}`);

// Standalone proof: HUB_CONFIG_DIR only, no HUB_APP_FRONTDOOR override, no loader, no daemon.
delete process.env.HUB_APP_FRONTDOOR;
process.env.HUB_CONFIG_DIR = smokeHome;

const { createProviderPlugin } = await import(pathToFileURL(coreAuthIndexPath).href);
const { driver } = await import(pathToFileURL(driverPath).href);

const plugin = createProviderPlugin(driver);
const hooks = await plugin({ client: null });
if (!hooks || !hooks.auth || typeof hooks.auth.loader !== "function") {
  fail("createProviderPlugin did not build OpenCode auth hooks; the generic front-door was not resolved");
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

rmSync(smokeHome, { recursive: true, force: true });

if (response.status !== 200 || !bodyMatch) fail(`unexpected response (status=${response.status} bodyMatch=${bodyMatch})`);

console.log("PASS: raw-node front-door smoke check succeeded (standalone, no loader, no daemon, no HUB_APP_FRONTDOOR)");
