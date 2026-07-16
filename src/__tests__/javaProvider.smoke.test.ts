import { describe, it, expect } from "vitest";
// @ts-ignore build artifact (produced by `npm run build`)
import { handleViaOrchestrator, buildModelsViaJava } from "../../dist/javaProvider.js";

const jsRandom = () => 0.9;
const jsSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("stub TeaVM orchestrator — callable from node", () => {
  it("returns a canned JSON decision using the given response text", async () => {
    const inputs = JSON.stringify({ bodyText: JSON.stringify({ model: "stub-pro" }), ctxModel: "" });
    const config = JSON.stringify({ responseText: "custom", latencyMs: 0, failRate: 0, streaming: null });
    const d = await handleViaOrchestrator(inputs, config, jsRandom, jsSleep);
    expect(d.status).toBe(200);
    expect(d.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(d.body);
    expect(body.id).toBe("msg_stub_0001");
    expect(body.model).toBe("stub-pro");
    expect(body.content[0].text).toBe("custom (served by stub-pro)");
    expect(body.usage).toEqual({ input_tokens: 1, output_tokens: 12 });
  });

  it("honors the streaming override", async () => {
    const inputs = JSON.stringify({ bodyText: "{}", ctxModel: "stub-model" });
    const config = JSON.stringify({ responseText: "x", latencyMs: 0, failRate: 0, streaming: true });
    const d = await handleViaOrchestrator(inputs, config, jsRandom, jsSleep);
    expect(d.headers["content-type"]).toBe("text/event-stream");
    expect(d.body).toContain("event: message_stop\n");
  });

  it("buildModelsViaJava(3) returns the three-model catalog", async () => {
    expect(await buildModelsViaJava(3)).toEqual({
      "stub-model": { name: "Stub Default" },
      "stub-pro": { name: "Stub Pro" },
      "stub-fast": { name: "Stub Fast" },
    });
  });
});
