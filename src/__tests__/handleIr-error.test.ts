// T3c-2: proves stub-auth's handleIr now throws the canonical typed transport error
// (core-proxy's HandleIrError) instead of a plain Error on a non-2xx upstream outcome, and
// that the legacy handle() wrapper still reconstructs the identical Response from it.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-ignore build artifacts (produced by `npm run build`)
// HandleIrError is re-exported from driver.js itself (not imported straight from
// core-proxy/dist) so `instanceof` checks against errors thrown inside this same bundle work --
// esbuild inlines its own copy of the class per bundle, so a separately imported core-proxy/dist
// copy would be a different, non-instanceof-compatible class.
import { driver, HandleIrError } from "../../dist/driver.js";

let dir: string;
let prevConfigDir: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stub-auth-handleir-error-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  // fail_rate: 1 forces StubHandleOrchestrator's random() < failRate check to always trip,
  // deterministically driving the 529 (overloaded_error) branch this test targets.
  writeFileSync(join(dir, "config", "stub-auth.json"), JSON.stringify({ fail_rate: 1 }));
  prevConfigDir = process.env.HUB_CONFIG_DIR;
  process.env.HUB_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = prevConfigDir;
  rmSync(dir, { recursive: true, force: true });
});

describe("stub driver handleIr / handle -- typed transport error", () => {
  it("handleIr throws a HandleIrError carrying the orchestrator's real status/headers/body", async () => {
    await expect(driver.handleIr({ model: "stub-pro", stream: false }, {})).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(HandleIrError);
      expect(err.status).toBe(529);
      expect(err.headers).toEqual({ "content-type": "application/json" });
      const body = JSON.parse(err.body);
      expect(body.error.type).toBe("overloaded_error");
      expect(err.retryAfterMs).toBeUndefined();
      return true;
    });
  });

  it("handle() reconstructs a byte-identical 529 Response from the typed error", async () => {
    const req = new Request("https://x/v1/messages", { method: "POST", body: JSON.stringify({ model: "stub-pro" }) });
    const res = await driver.handle(req, {});
    expect(res.status).toBe(529);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ type: "error", error: { type: "overloaded_error", message: "Stub overloaded (fail_rate)" } });
  });
});
