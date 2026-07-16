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
  models: stubModelsSeed,
  async fetchModels() {
    const cfg = defineConfig("stub-auth", {});
    const count = typeof cfg.model_count === "number" ? cfg.model_count : 3;
    try { return { models: await buildModelsViaJava(count) }; } catch { return null; }
  },
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
