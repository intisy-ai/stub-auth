// @ts-nocheck
// The whole provider: a canned Anthropic-format response (JSON or SSE). core-auth
// turns this into the OpenCode and Claude integrations. Includes a fake login so it
// demonstrates the shared account menu with only the core default options.

import { AccountManager, accountControllerFromManager, addAccount } from "../core-auth/dist/index.js";
import { defineConfig, getConfigValue, setConfigValue } from "../core/src/index.js";
import { handleViaOrchestrator, buildModelsViaJava } from "./javaProvider.js";
import stubModelsSeed from "./generated/stub-models.json";

// Account rotation lives in core-auth (selection.ts); the strategy is just config.
const accountManager = new AccountManager("stub", { selection: getConfigValue("stub-auth", "account_selection_strategy") || "hybrid" });

function stubAddAccount() {
  const n = accountManager.list().length + 1;
  const account = { id: "stub-" + n + "@example.com", email: "stub-" + n + "@example.com", refresh: "stub-refresh-" + n, addedAt: Date.now(), lastUsed: 0, enabled: true };
  addAccount("stub", account);
  return account;
}

function readResponseConfig() {
  const cfg = defineConfig("stub-auth", {});
  return {
    responseText: typeof cfg.response_text === "string" ? cfg.response_text : undefined,
    latencyMs: typeof cfg.latency_ms === "number" ? cfg.latency_ms : 0,
    failRate: typeof cfg.fail_rate === "number" ? cfg.fail_rate : 0,
    streaming: (cfg.streaming === true || cfg.streaming === false) ? cfg.streaming : null,
  };
}

const jsRandom = () => Math.random();
const jsSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SP-3 T2: the IR-native entry point. The actual decision (model resolution, response text,
// fail-rate roll, latency) still lives entirely in the Java orchestrator handle() already calls --
// this only adapts its JSON decision into the canonical IrResponse/IrEventStream shape, so the
// decision logic is never duplicated between TS and Java. streaming is always forced off in the
// orchestrator call (we only need the resolved model/text/usage out of it); whether THIS call
// returns an IrResponse or an IrEventStream is decided here, from ir.stream / the streaming config
// override, exactly like the orchestrator's own useStream precedence.
async function handleIr(ir, ctx) {
  const responseConfig = readResponseConfig();
  const inputsJson = JSON.stringify({ bodyText: JSON.stringify({ model: ir && ir.model }), ctxModel: (ctx && ctx.model) || "" });
  const configJson = JSON.stringify({ ...responseConfig, streaming: false });
  const decision = await handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep);

  if (decision.status !== 200) {
    const errorBody = JSON.parse(decision.body);
    throw new Error((errorBody && errorBody.error && errorBody.error.message) || "stub handleIr failed");
  }

  const body = JSON.parse(decision.body);
  const irResponse = {
    id: body.id,
    model: body.model,
    content: [{ kind: "text", text: body.content[0].text }],
    stopReason: "end_turn",
    usage: { inputTokens: body.usage.input_tokens, outputTokens: body.usage.output_tokens },
  };

  const useStream = responseConfig.streaming !== null ? responseConfig.streaming : !!(ir && ir.stream);
  if (!useStream) return irResponse;

  return new ReadableStream({
    start(controller) {
      controller.enqueue({ event: "message_start", id: irResponse.id, model: irResponse.model, role: "assistant", usage: { inputTokens: irResponse.usage.inputTokens, outputTokens: 0 } });
      controller.enqueue({ event: "content_block_start", index: 0, blockKind: "text" });
      controller.enqueue({ event: "text_delta", index: 0, text: irResponse.content[0].text });
      controller.enqueue({ event: "content_block_stop", index: 0 });
      controller.enqueue({ event: "message_delta", stopReason: irResponse.stopReason, usage: irResponse.usage });
      controller.enqueue({ event: "message_stop" });
      controller.close();
    },
  });
}

function irRequestFromWire(bodyText) {
  // Stub never inspects anything beyond model/stream, so the "decode" step only extracts those --
  // a full generic Anthropic-wire decoder would just duplicate AnthropicRequestCodec for fields
  // this provider never reads.
  let parsed = {};
  try { parsed = JSON.parse(bodyText || "{}"); } catch { parsed = {}; }
  return { model: parsed.model, stream: parsed.stream === true };
}

function encodeIrResponseToWire(irResponse) {
  return JSON.stringify({
    id: irResponse.id,
    type: "message",
    role: "assistant",
    model: irResponse.model,
    content: irResponse.content.map((b) => ({ type: "text", text: b.text })),
    stop_reason: irResponse.stopReason,
    stop_sequence: null,
    usage: { input_tokens: irResponse.usage.inputTokens, output_tokens: irResponse.usage.outputTokens },
  });
}

function sseLine(event, dataObj) {
  return "event: " + event + "\ndata: " + JSON.stringify(dataObj) + "\n\n";
}

function encodeIrEventToSse(event) {
  switch (event.event) {
    case "message_start":
      return sseLine("message_start", { type: "message_start", message: {
        id: event.id, type: "message", role: event.role || "assistant", model: event.model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: (event.usage && event.usage.inputTokens) || 0, output_tokens: 0 },
      } });
    case "content_block_start":
      return sseLine("content_block_start", { type: "content_block_start", index: event.index, content_block: { type: "text", text: "" } });
    case "text_delta":
      return sseLine("content_block_delta", { type: "content_block_delta", index: event.index, delta: { type: "text_delta", text: event.text || "" } });
    case "content_block_stop":
      return sseLine("content_block_stop", { type: "content_block_stop", index: event.index });
    case "message_delta":
      return sseLine("message_delta", { type: "message_delta", delta: { stop_reason: event.stopReason || null, stop_sequence: null }, usage: { output_tokens: (event.usage && event.usage.outputTokens) || 0 } });
    case "message_stop":
      return sseLine("message_stop", { type: "message_stop" });
    default:
      return "";
  }
}

async function drainIrEventStreamToSse(stream) {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += encodeIrEventToSse(value);
  }
  return text;
}

// SP-3 T2: a thin wrapper over handleIr -- decode the inbound Anthropic wire into an IrRequest,
// call handleIr, and encode its IrResponse/IrEventStream back to wire JSON/SSE.
async function handle(request, ctx) {
  let bodyText;
  try { bodyText = await request.clone().text(); } catch { bodyText = ""; }
  const ir = irRequestFromWire(bodyText);

  try {
    const result = await handleIr(ir, ctx);
    if (result && typeof result.getReader === "function") {
      const sseText = await drainIrEventStreamToSse(result);
      return new Response(sseText, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(encodeIrResponseToWire(result), { status: 200, headers: { "content-type": "application/json" } });
  } catch (err) {
    const message = (err && err.message) || "Stub overloaded (fail_rate)";
    return new Response(
      JSON.stringify({ type: "error", error: { type: "overloaded_error", message } }),
      { status: 529, headers: { "content-type": "application/json" } },
    );
  }
}

export const driver = {
  id: "stub",
  label: "Stub",
  opencodeProvider: "stub",
  opencodeNpm: "@ai-sdk/anthropic",
  models: stubModelsSeed,
  async fetchModels() {
    const cfg = defineConfig("stub-auth", {});
    const count = typeof cfg.model_count === "number" ? cfg.model_count : 3;
    try { return { models: await buildModelsViaJava(count) }; } catch { return null; }
  },
  handle,
  handleIr,
  loginFlow: async () => ({ url: "https://example.com/stub-login", instructions: "Stub login (no real OAuth) — completes immediately.", complete: async () => stubAddAccount() }),
  accounts: accountControllerFromManager(accountManager, { login: async () => { const a = stubAddAccount(); return { id: a.id, email: a.email, status: "active", enabled: true }; } }),
  // Even the stub exposes a Settings entry in its auth menu — the Response group is
  // wired to what handle() actually reads; Account rotation drives the core selection.
  settings: {
    groups: [
      { title: "Response", fields: [
        { key: "response_text", label: "Response text", type: "string", hint: "What the stub replies with." },
        { key: "latency_ms", label: "Latency (ms)", type: "number", min: 0, hint: "Artificial delay before replying." },
        { key: "fail_rate", label: "Failure rate", type: "number", min: 0, max: 1, hint: "0–1 chance of a simulated overload error." },
      ] },
      { title: "Account rotation", fields: [
        { key: "account_selection_strategy", label: "Account selection", type: "enum", options: ["sticky", "round-robin", "hybrid"], hint: "How accounts are picked (rotation lives in core-auth). Applies next launch." },
      ] },
    ],
    get: (key) => getConfigValue("stub-auth", key),
    set: (key, value) => setConfigValue("stub-auth", key, value),
  },
  proxies: true,
};
