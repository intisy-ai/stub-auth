import { describe, it, expect } from "vitest";
// @ts-ignore build artifact (produced by `npm run build`)
import { driver } from "../../dist/driver.js";

// T4: repointed from the deleted legacy driver.handle() wrapper to the IR-native handleIr --
// these assert the provider's OWN behavior (canned decision from the Java orchestrator: id,
// model, text, usage, and the IR event sequence), not the app-wire JSON/SSE encoding, which is
// now the front-door's responsibility.
describe("stub driver.handleIr (Java) regression", () => {
  it("canned IrResponse (json default)", async () => {
    const ir = await driver.handleIr({ model: "stub-pro", stream: false }, {} as any);
    expect(ir.id).toBe("msg_stub_0001");
    expect(ir.model).toBe("stub-pro");
    expect(ir.content[0].kind).toBe("text");
    expect(ir.content[0].text).toBe("Hello from stub-auth: the core-auth pipeline works end to end. (served by stub-pro)");
    expect(ir.stopReason).toBe("end_turn");
    expect(ir.usage).toEqual({ inputTokens: 1, outputTokens: 12 });
  });

  it("canned IR event stream when streaming", async () => {
    const stream = await driver.handleIr({ model: "stub-pro", stream: true }, {} as any);
    expect(typeof stream.getReader).toBe("function");
    const reader = stream.getReader();
    const events: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value.event);
    }
    expect(events[0]).toBe("message_start");
    expect(events[events.length - 1]).toBe("message_stop");
    expect(events).toContain("text_delta");
  });

  it("models catalog comes from the Java seed", async () => {
    expect(driver.models).toEqual({
      "stub-model": { name: "Stub Default" },
      "stub-pro": { name: "Stub Pro" },
      "stub-fast": { name: "Stub Fast" },
    });
  });
});
