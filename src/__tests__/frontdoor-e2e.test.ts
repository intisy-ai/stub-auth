// End-to-end wire-parity through the loader-injected front-door: proves stub-auth's generic
// createProviderPlugin (core-auth) resolves the opencode-loader-owned AppFrontDoor at runtime and
// serves a real Anthropic-wire response, all in-process, with no daemon and no bundled front-door
// of its own. Requires opencode-loader's dist/frontdoor.js to be built; skips (with a log) otherwise,
// since the per-repo unit tests already cover each half of this wiring independently.
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore build artifact (produced by `npm run build`)
import { createProviderPlugin } from "../../core-auth/dist/index.js";
// @ts-ignore build artifact (produced by `npm run build`)
import { driver } from "../../dist/driver.js";

const frontDoorPath = join(process.cwd(), "..", "..", "loaders", "opencode-loader", "dist", "frontdoor.js");
const hasFrontDoor = existsSync(frontDoorPath);

if (!hasFrontDoor) {
  console.warn(`[frontdoor-e2e] skipping: opencode-loader dist not built at ${frontDoorPath} (run "npm run build" in loaders/opencode-loader)`);
}

describe.skipIf(!hasFrontDoor)("OpenCode in-process front-door (loader-injected)", () => {
  beforeAll(() => {
    process.env.HUB_APP_FRONTDOOR = frontDoorPath;
  });

  it("serves a stub chat request as Anthropic wire via the injected front-door", async () => {
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
