// End-to-end proof of the generic deployed front-door: opencode-proxy's own deployFrontDoor
// copies its built adapter to <home>/frontdoor/app-frontdoor.mjs, and stub-auth's generic
// createProviderPlugin (core-auth) resolves it via HUB_CONFIG_DIR alone (no HUB_APP_FRONTDOOR,
// no opencode-loader), serving a real Anthropic-wire response in-process with no daemon. Requires
// opencode-proxy's dist/index.js + dist/frontdoor.mjs to be built; skips (with a log) otherwise,
// since the per-repo unit tests already cover each half of this wiring independently.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore build artifact (produced by `npm run build`)
import { createProviderPlugin } from "../../core-auth/dist/index.js";
// @ts-ignore build artifact (produced by `npm run build`)
import { driver } from "../../dist/driver.js";

const opencodeProxyIndexPath = join(process.cwd(), "..", "..", "proxies", "opencode-proxy", "dist", "index.js");
const hasOpencodeProxy = existsSync(opencodeProxyIndexPath);

if (!hasOpencodeProxy) {
  console.warn(`[frontdoor-e2e] skipping: opencode-proxy dist not built at ${opencodeProxyIndexPath} (run "npm run build" in proxies/opencode-proxy)`);
}

describe.skipIf(!hasOpencodeProxy)("OpenCode in-process front-door (generic deployed path, no loader)", () => {
  let home: string;
  let prevHubConfigDir: string | undefined;
  let prevHubAppFrontDoor: string | undefined;

  beforeAll(async () => {
    const { deployFrontDoor } = await import(opencodeProxyIndexPath);
    home = mkdtempSync(join(tmpdir(), "fd-e2e-"));
    deployFrontDoor(home);

    prevHubConfigDir = process.env.HUB_CONFIG_DIR;
    prevHubAppFrontDoor = process.env.HUB_APP_FRONTDOOR;
    delete process.env.HUB_APP_FRONTDOOR;
    process.env.HUB_CONFIG_DIR = home;
  });

  afterAll(() => {
    if (prevHubConfigDir === undefined) delete process.env.HUB_CONFIG_DIR;
    else process.env.HUB_CONFIG_DIR = prevHubConfigDir;
    if (prevHubAppFrontDoor !== undefined) process.env.HUB_APP_FRONTDOOR = prevHubAppFrontDoor;
    rmSync(home, { recursive: true, force: true });
  });

  it("serves a stub chat request as Anthropic wire via the generic deployed front-door", async () => {
    const plugin = createProviderPlugin(driver);
    const hooks = await plugin({ client: null });
    const loaded = await hooks.auth.loader();
    const req = new Request("http://x/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "stub/stub-model", max_tokens: 16, messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await loaded.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("Hello from stub-auth");
  });
});
