// JVM<->JS<->TS parity smoke test (Phase 4 Task 5 — the js half of the shared-Java model; T4
// proved the JVM/ServiceLoader half). Imports the BUILT dist/javaProvider.js (esbuild-bundled,
// which itself bundles src/generated/stub-provider.teavm.js -- TeaVM's compile of
// io.github.intisy.ai.js.StubProviderJs, which calls the SAME
// io.github.intisy.ai.stub.StubProvider.buildCannedBody the JVM :stub-provider jar's
// Provider.handle calls) -- proving the compiled-from-Java provider is callable from plain node
// and returns the canned body, matching both:
//   - the JVM path (StubProviderIntegrationTest.java: msg_stub_0001 / "(served by m-stub)" /
//     usage.input_tokens:1,output_tokens:12)
//   - the TS path (src/driver.ts's jsonBody()/stubText(): same id/shape/usage).
import { describe, it, expect } from "vitest";
// @ts-ignore -- dist/ is a build artifact (produced by `npm run build`, which this test suite
// runs via `npm test` = "npm run build && vitest run"), not a source file with type declarations.
import { handleViaJavaProvider } from "../../dist/javaProvider.js";

describe("java provider (TeaVM-compiled StubProvider) smoke test", () => {
  it("returns the canned body for a /v1/messages-style request, model read from the request JSON", () => {
    const requestJson = JSON.stringify({ model: "claude-opus-4-ignored" });
    const bodyJson = handleViaJavaProvider(requestJson);
    const body = JSON.parse(bodyJson);

    expect(body.id).toBe("msg_stub_0001");
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.model).toBe("claude-opus-4-ignored");
    expect(body.content).toEqual([{ type: "text", text: "stub response (served by claude-opus-4-ignored)" }]);
    expect(body.stop_reason).toBe("end_turn");
    expect(body.stop_sequence).toBeNull();
    expect(body.usage).toEqual({ input_tokens: 1, output_tokens: 12 });
  });

  it("falls back to stub-model when the request JSON omits \"model\" — matching StubProvider's DEFAULT_MODEL", () => {
    const body = JSON.parse(handleViaJavaProvider(JSON.stringify({})));
    expect(body.model).toBe("stub-model");
    expect(body.content[0].text).toBe("stub response (served by stub-model)");
  });
});
