// @ts-nocheck
// The whole provider: a canned Anthropic-format response (JSON or SSE). core-auth
// turns this into the OpenCode and Claude integrations.

const MOCK_TEXT = "Hello from mock-auth — the core-auth pipeline works end to end.";

function mockText(model) {
  return MOCK_TEXT + " (served by " + model + ")";
}

function jsonBody(model) {
  return {
    id: "msg_mock_0001", type: "message", role: "assistant", model,
    content: [{ type: "text", text: mockText(model) }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 12 },
  };
}

function sse(event, data) {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

function streamBody(model) {
  const msg = { id: "msg_mock_0001", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
  return (
    sse("message_start", { type: "message_start", message: msg }) +
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: mockText(model) } }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }) +
    sse("message_stop", { type: "message_stop" })
  );
}

export const driver = {
  id: "mock",
  label: "Mock",
  opencodeProvider: "anthropic",
  // a few models so the Claude model-mapping is demonstrable
  models: {
    "mock-model": { name: "Mock Default" },
    "mock-pro": { name: "Mock Pro" },
    "mock-fast": { name: "Mock Fast" },
  },
  async handle(request, ctx) {
    let body = {};
    try { body = await request.clone().json(); } catch {}
    // the Claude proxy resolves the mapped provider model into ctx.model
    const model = (ctx && ctx.model) || body.model || "mock-model";
    if (body.stream) {
      return new Response(streamBody(model), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(jsonBody(model)), { status: 200, headers: { "content-type": "application/json" } });
  },
};
