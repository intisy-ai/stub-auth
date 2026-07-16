import { describe, it, expect } from "vitest";
// @ts-ignore build artifact (produced by `npm run build`)
import { driver, handleViaTs } from "../../dist/driver.js";

const req = (body: Record<string, unknown>) =>
  new Request("https://x/v1/messages", { method: "POST", body: JSON.stringify(body) });

async function snap(res: Response) {
  return { status: res.status, ct: res.headers.get("content-type"), text: await res.text() };
}

describe("stub driver.handle (Java) == handleViaTs (TS baseline) parity", () => {
  for (const stream of [false, true]) {
    it(`stream=${stream}`, async () => {
      const java = await snap(await driver.handle(req({ model: "stub-pro", stream }), {} as any));
      const ts = await snap(await handleViaTs(req({ model: "stub-pro", stream }), {} as any));
      expect(java).toEqual(ts);
    });
  }
});
