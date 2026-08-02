// Proves the injected OpenCode front-door is actually wired: with driver.serveDirect set
// (src/index.ts), core-auth's dispatchOpencodeFetch takes the in-process direct path instead
// of the no-front-door 503, so an offline OpenCode request (no proxy daemon running) is
// served for real, all the way through the Anthropic-wire codec back to a JSON response.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let dir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stub-auth-offline-frontdoor-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  saved = {
    HUB_CONFIG_DIR: process.env.HUB_CONFIG_DIR,
    CORE_APP: process.env.CORE_APP,
    OPENCODE_CONFIG: process.env.OPENCODE_CONFIG,
    HUB_OC_PROXY: process.env.HUB_OC_PROXY,
  };
  process.env.HUB_CONFIG_DIR = dir;
  process.env.CORE_APP = "opencode";
  // Isolate the opencode.json merge target so the test never touches a real home.
  process.env.OPENCODE_CONFIG = join(dir, "opencode.json");
  delete process.env.HUB_OC_PROXY;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("stub-auth offline OpenCode front-door", () => {
  it("serves an offline OpenCode request via the injected serveDirect instead of 503ing", async () => {
    // @ts-ignore build artifact (produced by `npm run build`)
    const { StubProvider } = await import("../../dist/index.js");
    const hooks = await StubProvider({});
    const loader = await hooks.auth.loader();
    const request = new Request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "stub-pro", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }),
    });
    const res = await loader.fetch(request);
    expect(res.status).not.toBe(503);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content?.[0]?.text).toContain("Hello from stub-auth");
  });
});
