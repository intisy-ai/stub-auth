// @ts-nocheck
// Mock provider driver: implements the core-auth ProviderDriver contract with
// canned, valid Anthropic Messages API responses (streaming or JSON). It exists
// to validate the harness end-to-end before real providers are wired.

const MOCK_TEXT = "Hello from mock-auth — the core-auth pipeline works end to end.";

async function readBody(request) {
  try { return await request.clone().json(); } catch { return {}; }
}

function jsonBody(model) {
  return {
    id: "msg_mock_0001",
    type: "message",
    role: "assistant",
    model: model,
    content: [{ type: "text", text: MOCK_TEXT }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 12 },
  };
}

function sse(event, data) {
  return "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
}

function streamBody(model) {
  const msg = {
    id: "msg_mock_0001", type: "message", role: "assistant", model: model,
    content: [], stop_reason: null, stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  };
  return (
    sse("message_start", { type: "message_start", message: msg }) +
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: MOCK_TEXT } }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 12 } }) +
    sse("message_stop", { type: "message_stop" })
  );
}

const driver = {
  id: "mock",
  label: "Mock",

  // no real auth — produce a dummy account so the harness has one to select
  async authenticate(_ctx) {
    return { id: "mock-account", label: "Mock account", credentials: {}, meta: { mock: true } };
  },

  async handle(request, _account, _ctx) {
    const body = await readBody(request);
    const model = body.model || "mock-model";
    if (body.stream) {
      return new Response(streamBody(model), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(jsonBody(model)), { status: 200, headers: { "content-type": "application/json" } });
  },
};

export default driver;
