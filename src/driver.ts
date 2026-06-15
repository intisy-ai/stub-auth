// @ts-nocheck
// The whole provider: a canned Anthropic-format response (JSON or SSE). core-auth
// turns this into the OpenCode and Claude integrations. Includes a fake login so it
// demonstrates the shared account menu with only the core default options.

import { AccountManager, accountControllerFromManager, addAccount } from "../core-auth/dist/index.js";

const accountManager = new AccountManager("stub", {});

function stubAddAccount() {
  const n = accountManager.list().length + 1;
  const account = { id: "stub-" + n + "@example.com", email: "stub-" + n + "@example.com", refresh: "stub-refresh-" + n, addedAt: Date.now(), lastUsed: 0, enabled: true };
  addAccount("stub", account);
  return account;
}

const STUB_TEXT = "Hello from stub-auth — the core-auth pipeline works end to end.";

function stubText(model) {
  return STUB_TEXT + " (served by " + model + ")";
}

function jsonBody(model) {
  return {
    id: "msg_stub_0001", type: "message", role: "assistant", model,
    content: [{ type: "text", text: stubText(model) }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 12 },
  };
}

function sse(event, data) {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

function streamBody(model) {
  const msg = { id: "msg_stub_0001", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
  return (
    sse("message_start", { type: "message_start", message: msg }) +
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: stubText(model) } }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }) +
    sse("message_stop", { type: "message_stop" })
  );
}

export const driver = {
  id: "stub",
  label: "Stub",
  opencodeProvider: "stub",
  opencodeNpm: "@ai-sdk/anthropic",
  // a few models so the Claude model-mapping is demonstrable
  models: {
    "stub-model": { name: "Stub Default" },
    "stub-pro": { name: "Stub Pro" },
    "stub-fast": { name: "Stub Fast" },
  },
  async handle(request, ctx) {
    let body = {};
    try { body = await request.clone().json(); } catch {}
    const model = (ctx && ctx.model) || body.model || "stub-model";
    if (body.stream) {
      return new Response(streamBody(model), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(jsonBody(model)), { status: 200, headers: { "content-type": "application/json" } });
  },
  loginFlow: async () => ({ url: "https://example.com/stub-login", instructions: "Stub login (no real OAuth) — completes immediately.", complete: async () => stubAddAccount() }),
  accounts: accountControllerFromManager(accountManager, { login: async () => { const a = stubAddAccount(); return { id: a.id, email: a.email, status: "active", enabled: true }; } }),
};
