// @ts-nocheck
// The whole provider: a canned Anthropic-format response (JSON or SSE). core-auth
// turns this into the OpenCode and Claude integrations. Includes a fake login so it
// demonstrates the shared account menu with only the core default options.

import { AccountManager, accountControllerFromManager, addAccount } from "../core-auth/dist/index.js";
import { defineConfig, getConfigValue, setConfigValue } from "../core/src/index.js";
import { handleViaOrchestrator } from "./javaProvider.js";

// Account rotation lives in core-auth (selection.ts); the strategy is just config.
const accountManager = new AccountManager("stub", { selection: getConfigValue("stub-auth", "account_selection_strategy") || "hybrid" });

function stubAddAccount() {
  const n = accountManager.list().length + 1;
  const account = { id: "stub-" + n + "@example.com", email: "stub-" + n + "@example.com", refresh: "stub-refresh-" + n, addedAt: Date.now(), lastUsed: 0, enabled: true };
  addAccount("stub", account);
  return account;
}

function stubText(model: string, responseText: string) {
  return responseText + " (served by " + model + ")";
}

// Build the models object from config — called at module load so loaders/catalog see it.
// Keeps "stub-model", "stub-pro", "stub-fast" as the first three names; generates
// "stub-N" beyond that; clamps to >= 1.
function buildModels(count: number): Record<string, { name: string }> {
  const BASE_NAMES = [
    { id: "stub-model", name: "Stub Default" },
    { id: "stub-pro",   name: "Stub Pro" },
    { id: "stub-fast",  name: "Stub Fast" },
  ];
  const safe = Math.max(1, Math.floor(count));
  const result: Record<string, { name: string }> = {};
  for (let i = 0; i < safe; i++) {
    if (i < BASE_NAMES.length) {
      result[BASE_NAMES[i].id] = { name: BASE_NAMES[i].name };
    } else {
      result["stub-" + (i + 1)] = { name: "Stub " + (i + 1) };
    }
  }
  return result;
}

function jsonBody(model: string, responseText: string) {
  return {
    id: "msg_stub_0001", type: "message", role: "assistant", model,
    content: [{ type: "text", text: stubText(model, responseText) }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 12 },
  };
}

function sse(event: string, data: unknown) {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

function streamBody(model: string, responseText: string) {
  const msg = { id: "msg_stub_0001", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
  return (
    sse("message_start", { type: "message_start", message: msg }) +
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: stubText(model, responseText) } }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }) +
    sse("message_stop", { type: "message_stop" })
  );
}

// Build models at module load from config so loaders/catalog always see the right set.
const initialCfg = defineConfig("stub-auth", {});
const initialModelCount = typeof initialCfg.model_count === "number" ? initialCfg.model_count : 3;

export async function handleViaTs(request, ctx) {
  // Read config per-request (merges registered defaults with on-disk values).
  const cfg = defineConfig("stub-auth", {});
  const responseText = typeof cfg.response_text === "string"
    ? cfg.response_text
    : "Hello from stub-auth — the core-auth pipeline works end to end.";
  const latencyMs = typeof cfg.latency_ms === "number" ? cfg.latency_ms : 0;
  const failRate  = typeof cfg.fail_rate  === "number" ? cfg.fail_rate  : 0;
  const streamingCfg = cfg.streaming;  // null/undefined = honor request; true/false = force

  // Fail fast if configured — useful for testing retry logic.
  if (failRate > 0 && Math.random() < failRate) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Stub overloaded (fail_rate)" } }),
      { status: 529, headers: { "content-type": "application/json" } },
    );
  }

  let body: Record<string, unknown> = {};
  try { body = await request.clone().json(); } catch {}
  const model = (ctx && ctx.model) || body.model || "stub-model";

  // Simulate latency before returning.
  if (latencyMs > 0) await new Promise(r => setTimeout(r, latencyMs));

  // streaming: null/undefined honors request flag; true/false overrides it.
  const useStream = (streamingCfg === null || streamingCfg === undefined) ? !!body.stream : !!streamingCfg;

  if (useStream) {
    return new Response(streamBody(model, responseText), { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(JSON.stringify(jsonBody(model, responseText)), { status: 200, headers: { "content-type": "application/json" } });
}

async function handle(request, ctx) {
  let bodyText;
  try { bodyText = await request.clone().text(); } catch { bodyText = ""; }
  const cfg = defineConfig("stub-auth", {});
  const inputsJson = JSON.stringify({ bodyText: bodyText ?? "", ctxModel: (ctx && ctx.model) || "" });
  const configJson = JSON.stringify({
    responseText: typeof cfg.response_text === "string" ? cfg.response_text : undefined,
    latencyMs: typeof cfg.latency_ms === "number" ? cfg.latency_ms : 0,
    failRate: typeof cfg.fail_rate === "number" ? cfg.fail_rate : 0,
    streaming: (cfg.streaming === true || cfg.streaming === false) ? cfg.streaming : null,
  });
  const jsRandom = () => Math.random();
  const jsSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const decision = await handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep);
  return new Response(decision.body, { status: decision.status, headers: decision.headers });
}

export const driver = {
  id: "stub",
  label: "Stub",
  opencodeProvider: "stub",
  opencodeNpm: "@ai-sdk/anthropic",
  // models derived from config at startup; default 3 = identical to prior behavior
  models: buildModels(initialModelCount),
  handle,
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
