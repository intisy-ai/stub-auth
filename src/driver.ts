// @ts-nocheck
// The whole provider: an IR-native handleIr that returns a canned IrResponse (or a canonical IR
// event stream). The front-door owns app<->IR translation, so this provider carries no app-wire
// (Anthropic) format code. core-auth turns this into the OpenCode and Claude integrations.
// Includes a fake login so it demonstrates the shared account menu with only the core defaults.

import { AccountManager, accountControllerFromManager, addAccount } from "../core-auth/dist/index.js";
import { defineConfig, getConfigValue, setConfigValue } from "../core/src/index.js";
import { handleViaOrchestrator, buildModelsViaJava } from "./javaProvider.js";
// Local, dependency-free copy of core-proxy's HandleIrError wire-error shape. The front-door
// recognizes it by its stable `name` marker (duck-typed isHandleIrError), NOT by class identity --
// esbuild bundles each side separately, so a shared class is never instanceof-compatible across the
// boundary anyway. Defining it here removes a build-time dependency on core-proxy's dist (which this
// provider never builds), so a clean checkout (CI / fresh deploy) bundles without it.
class HandleIrError extends Error {
  constructor(init) {
    super("handleIr transport error: " + init.status);
    this.name = "HandleIrError";
    this.status = init.status;
    this.headers = init.headers;
    this.body = init.body;
    this.retryAfterMs = init.retryAfterMs;
  }
}
import stubModelsSeed from "./generated/stub-models.json";

// Re-exported so callers (tests included) that need `instanceof HandleIrError` to work against
// this bundled driver import it from here, not straight from core-proxy/dist -- esbuild inlines
// a separate copy of the class per bundle, so importing from two different bundles gives two
// different (non-instanceof-compatible) classes.
export { HandleIrError };

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
// fail-rate roll, latency) still lives entirely in the Java orchestrator this calls via
// handleViaOrchestrator -- this only adapts its JSON decision into the canonical
// IrResponse/IrEventStream shape, so the
// decision logic is never duplicated between TS and Java. streaming is always forced off in the
// orchestrator call (we only need the resolved model/text/usage out of it); whether THIS call
// returns an IrResponse or an IrEventStream is decided here, from ir.stream / the streaming config
// override, exactly like the orchestrator's own useStream precedence.
async function handleIr(ir, ctx) {
  const responseConfig = readResponseConfig();
  const inputsJson = JSON.stringify({ bodyText: JSON.stringify({ model: ir && ir.model }), ctxModel: (ctx && ctx.model) || "" });
  const configJson = JSON.stringify({ ...responseConfig, streaming: false });
  const decision = await handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep);

  // T3c-2: carry the orchestrator's real transport outcome through the typed error contract
  // (core-proxy's HandleIrError) instead of a plain Error, so the front door (server.ts) can
  // reconstruct the real status/headers/body and route it through the same rate-limit/fallback
  // logic a normal response would get. The only non-200 status this orchestrator ever returns is
  // 529 (the fail_rate roll) -- no retryAfterMs is included since fail_rate is a synthetic dice
  // roll with no reset-time semantics to derive one from.
  if (decision.status !== 200) {
    throw new HandleIrError({ status: decision.status, headers: decision.headers, body: decision.body });
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
  handleIr,
  loginFlow: async () => ({ url: "https://example.com/stub-login", instructions: "Stub login (no real OAuth) — completes immediately.", complete: async () => stubAddAccount() }),
  accounts: accountControllerFromManager(accountManager, { login: async () => { const a = stubAddAccount(); return { id: a.id, email: a.email, status: "active", enabled: true }; } }),
  // Even the stub exposes a Settings entry in its auth menu — the Response group is
  // wired to what handleIr actually reads; Account rotation drives the core selection.
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
