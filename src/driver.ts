// @ts-nocheck
// The whole provider: an IR-native handleIr that returns a canned IrResponse (or a canonical IR
// event stream). The front-door owns app<->IR translation, so this provider carries no app-wire
// (Anthropic) format code. core-auth turns this into the OpenCode and Claude integrations.
// Includes a fake login so it demonstrates the shared account menu with only the core defaults.

import { AccountManager, accountControllerFromManager, addAccount, commonManagerOptions, HandleIrError, toSettingsGroups, setActivityEmitter, type ProviderSettingsSchema } from "@intisy-ai/core-auth";
import { getAppConfigDir, loadConfig, getConfigValue, setConfigValue, emitEvent } from "@intisy-ai/core";
import { handleViaOrchestrator, buildModelsViaJava } from "./javaProvider.js";
import stubModelsSeed from "./generated/stub-models.json";

// This module owns the AccountManager (addAccount can emit account activity) and is bundled
// independently into dist/driver.js as well as dist/index.js and dist/handler.js, each with its
// own copy of core-auth's module-level emitter, so it needs its own one-time wiring.
setActivityEmitter((spec, source) => emitEvent(spec, source));

// Re-exported so callers (tests included) that need `instanceof HandleIrError` to work against
// this bundled driver import it from here, not straight from core-auth/dist -- esbuild inlines
// a separate copy of the class per bundle, so importing from two different bundles gives two
// different (non-instanceof-compatible) classes.
export { HandleIrError };

// Account rotation lives in core-auth (selection.ts); the strategy is just config.
const accountManager = new AccountManager("stub", commonManagerOptions({ account_selection_strategy: getConfigValue("stub-auth", "account_selection_strategy") }));

function stubAddAccount() {
  const n = accountManager.list().length + 1;
  const account = { id: "stub-" + n + "@example.com", email: "stub-" + n + "@example.com", refresh: "stub-refresh-" + n, addedAt: Date.now(), lastUsed: 0, enabled: true };
  addAccount("stub", account);
  return account;
}

function readResponseConfig() {
  const cfg = loadConfig("stub-auth", getAppConfigDir());
  return {
    responseText: typeof cfg.response_text === "string" ? cfg.response_text : undefined,
    latencyMs: typeof cfg.latency_ms === "number" ? cfg.latency_ms : 0,
    failRate: typeof cfg.fail_rate === "number" ? cfg.fail_rate : 0,
    streaming: (cfg.streaming === true || cfg.streaming === false) ? cfg.streaming : null,
  };
}

const jsRandom = () => Math.random();
const jsSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The IR-native entry point. The actual decision (model resolution, response text,
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

  // Carry the orchestrator's real transport outcome through the typed error contract
  // (core-proxy's HandleIrError) instead of a plain Error, so the front door (server.ts) can
  // reconstruct the real status/headers/body and route it through the same rate-limit/fallback
  // logic a normal response would get. The only non-200 status this orchestrator ever returns is
  // 529 (the fail_rate roll) -- no retryAfterMs is included since fail_rate is a synthetic dice
  // roll with no reset-time semantics to derive one from.
  if (decision.status !== 200) {
    throw new HandleIrError({ status: decision.status, headers: decision.headers, body: decision.body });
  }

  // The orchestrator returns canonical IR JSON, so it IS the IrResponse; no app-wire remapping.
  const irResponse = JSON.parse(decision.body);

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

// One schema drives both the loader-TUI settings.groups and the Cairn capabilities
// fields (see index.ts), so the two surfaces can never drift out of key-set sync.
// account_selection_strategy is deliberately NOT in this schema: it is core-auth's
// own COMMON_PROVIDER_CAPABILITIES/COMMON_PROVIDER_DEFAULTS field, shared verbatim by
// every provider, so it stays wired into settings.groups below exactly as before.
export const STUB_SETTINGS_SCHEMA: ProviderSettingsSchema = [
  { title: "General", fields: [
    { key: "logging", label: "Logging", type: "bool", hint: "Write this plugin's log file." },
  ] },
  { title: "Response", fields: [
    { key: "response_text", label: "Canned response", type: "multiline", hint: "The text every stub reply returns." },
    { key: "model_count", label: "Advertised models", type: "number", min: 1, hint: "How many stub models to expose." },
  ] },
  { title: "Simulation", fields: [
    { key: "latency_ms", label: "Simulated latency (ms)", type: "number", min: 0, hint: "Artificial delay before replying." },
    { key: "fail_rate", label: "Failure rate", type: "number", min: 0, max: 1, step: 0.05, hint: "0 = never fail, 1 = always fail." },
    { key: "streaming", label: "Streaming", type: "enum", options: [
      { value: "null", label: "Honor request" },
      { value: "true", label: "Force on" },
      { value: "false", label: "Force off" },
    ] },
  ] },
];

export const driver = {
  id: "stub",
  label: "Stub",
  appProviderId: "stub",
  appNpm: "@ai-sdk/anthropic",
  models: stubModelsSeed,
  async fetchModels() {
    const cfg = loadConfig("stub-auth", getAppConfigDir());
    const count = typeof cfg.model_count === "number" ? cfg.model_count : 3;
    try { return { models: await buildModelsViaJava(count) }; } catch { return null; }
  },
  handleIr,
  loginFlow: async () => ({ url: "https://example.com/stub-login", instructions: "Stub login (no real OAuth), completes immediately.", complete: async () => stubAddAccount() }),
  accounts: accountControllerFromManager(accountManager, { login: async () => { const a = stubAddAccount(); return { id: a.id, email: a.email, status: "active", enabled: true }; } }),
  // Even the stub exposes a Settings entry in its auth menu: Response/Simulation are
  // wired to what handleIr actually reads; Account rotation drives the core selection.
  settings: {
    groups: [
      ...toSettingsGroups(STUB_SETTINGS_SCHEMA),
      { title: "Account rotation", fields: [
        { key: "account_selection_strategy", label: "Account selection", type: "enum", options: ["sticky", "round-robin", "hybrid"], hint: "How accounts are picked (rotation lives in core-auth). Applies next launch." },
      ] },
    ],
    get: (key) => getConfigValue("stub-auth", key),
    set: (key, value) => setConfigValue("stub-auth", key, value),
  },
  proxies: true,
};
