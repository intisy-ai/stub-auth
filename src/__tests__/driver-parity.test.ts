import { describe, it, expect } from "vitest";
// @ts-ignore build artifact (produced by `npm run build`)
import { driver } from "../../dist/driver.js";

const req = (body: Record<string, unknown>) =>
  new Request("https://x/v1/messages", { method: "POST", body: JSON.stringify(body) });

describe("stub driver.handle (Java) regression", () => {
  it("json default", async () => {
    const res = await driver.handle(req({ model: "stub-pro" }), {} as any);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const b = JSON.parse(await res.text());
    expect(b.id).toBe("msg_stub_0001");
    expect(b.model).toBe("stub-pro");
    expect(b.content[0].text).toBe("Hello from stub-auth — the core-auth pipeline works end to end. (served by stub-pro)");
    expect(b.usage).toEqual({ input_tokens: 1, output_tokens: 12 });
  });

  it("stream", async () => {
    const res = await driver.handle(req({ model: "stub-pro", stream: true }), {} as any);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const t = await res.text();
    expect(t).toContain("event: message_start\n");
    expect(t).toContain("event: message_stop\n");
    expect(t.endsWith("\n\n")).toBe(true);
  });

  it("models catalog comes from the Java seed", async () => {
    expect(driver.models).toEqual({
      "stub-model": { name: "Stub Default" },
      "stub-pro": { name: "Stub Pro" },
      "stub-fast": { name: "Stub Fast" },
    });
  });
});
