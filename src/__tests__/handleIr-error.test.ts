// Proves stub-auth's handleIr throws the canonical typed transport error
// (core-proxy's HandleIrError) instead of a plain Error on a non-2xx upstream outcome. The
// front-door reconstructs the Response from that typed error, so this provider carries no
// app-wire encoding of its own to test here.
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

describe("stub driver handleIr -- typed transport error", () => {
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
});
