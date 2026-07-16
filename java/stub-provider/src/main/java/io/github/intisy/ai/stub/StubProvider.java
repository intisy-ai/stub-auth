package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.routing.Provider;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Java port of stub-auth's TS driver ({@code src/driver.ts}). Ported field-for-field from
 * {@code jsonBody}/{@code stubText}/{@code streamBody}/{@code sse}: same {@code id}, same
 * {@code stop_reason}/{@code stop_sequence}, same {@code usage} (input_tokens 1, output_tokens
 * 12), and the same {@code responseText + " (served by " + model + ")"} text shape. The JVM
 * {@link #handle} passes {@link #DEFAULT_RESPONSE_TEXT} since there is no config-loading seam on
 * this side of the boundary; callers with a real response text use {@link #buildCannedBody} /
 * {@link #buildStreamBody} directly.
 *
 * <p>Registered via {@code META-INF/services/io.github.intisy.ai.shared.routing.Provider} so a
 * JVM host discovers it purely through {@code ServiceLoader} — see
 * {@code io.github.intisy.ai.jvm.ProviderRegistry} in ai-java. This class (and this whole
 * module) is deliberately plain: no gson, no reflection — hand-rolled JSON string building only,
 * matching the brief ("transpilability is a Task-5 concern, keep it plain").
 */
public final class StubProvider implements Provider {

    public static final String DEFAULT_RESPONSE_TEXT = "stub response";
    private static final String DEFAULT_MODEL = "stub-model";

    // Minimal, dependency-free extraction of the top-level "model" string field out of the
    // request JSON body -- good enough for the canned proof this task requires (no nested
    // objects/arrays need to be parsed; a real JSON library would be overkill for a hand-rolled,
    // TeaVM-eligible provider jar).
    private static final Pattern MODEL_FIELD = Pattern.compile("\"model\"\\s*:\\s*\"([^\"]*)\"");

    @Override
    public String id() {
        return "stub";
    }

    @Override
    public HttpResponse handle(HttpRequest req, HandlerCtx ctx) throws Exception {
        String model = resolveModel(req, ctx);

        HttpResponse resp = new HttpResponse();
        resp.status = 200;
        resp.headers = new HashMap<>();
        resp.headers.put("content-type", "application/json");
        resp.body = buildCannedBody(model, DEFAULT_RESPONSE_TEXT);
        return resp;
    }

    /**
     * The transpilable "core" this provider's JVM {@link #handle} calls, ALSO reused verbatim by
     * {@code StubProviderJs} (the {@code :stub-teavm} TeaVM export, Task 5's js half of the
     * shared-Java model) once {@code model} has already been resolved — pure {@code String}/
     * {@code StringBuilder} construction, no gson/java.net/nio/reflection/threads/{@code
     * System.getenv}, so TeaVM compiles it unchanged. {@code model} resolution itself stays
     * split per caller: the JVM path resolves it via {@link #resolveModel} (ctx then a regex read
     * of the request body); the JS path resolves it via {@code SimpleJsonCodec} (core-proxy's
     * {@code :teavm} js-base) instead of duplicating a second JSON reader here — this method is
     * the shared seam between the two, taking an already-resolved {@code model} so neither side's
     * JSON-reading choice leaks into the other.
     */
    public static String buildCannedBody(String model, String responseText) {
        return jsonBody(model, stubText(model, responseText));
    }

    public static String buildStreamBody(String model, String responseText) {
        String text = stubText(model, responseText);
        String startMsg = "{\"id\":\"msg_stub_0001\",\"type\":\"message\",\"role\":\"assistant\",\"model\":"
                + quote(model) + ",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,"
                + "\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}";
        StringBuilder sb = new StringBuilder();
        sb.append(sse("message_start", "{\"type\":\"message_start\",\"message\":" + startMsg + "}"));
        sb.append(sse("content_block_start",
                "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}"));
        sb.append(sse("content_block_delta",
                "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":" + quote(text) + "}}"));
        sb.append(sse("content_block_stop", "{\"type\":\"content_block_stop\",\"index\":0}"));
        sb.append(sse("message_delta",
                "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":12}}"));
        sb.append(sse("message_stop", "{\"type\":\"message_stop\"}"));
        return sb.toString();
    }

    private static String sse(String event, String dataJson) {
        return "event: " + event + "\ndata: " + dataJson + "\n\n";
    }

    // ctx.model (the tier-resolved assignment) wins when present; otherwise fall back to the
    // request body's own "model" field, then the fixed default -- mirrors the TS handler's
    // `(ctx && ctx.model) || body.model || "stub-model"` precedence.
    private static String resolveModel(HttpRequest req, HandlerCtx ctx) {
        if (ctx != null && ctx.model != null && !ctx.model.isEmpty()) {
            return ctx.model;
        }
        String fromBody = extractModel(req);
        return fromBody != null ? fromBody : DEFAULT_MODEL;
    }

    private static String extractModel(HttpRequest req) {
        if (req == null || req.body == null) {
            return null;
        }
        Matcher m = MODEL_FIELD.matcher(req.body);
        return m.find() ? m.group(1) : null;
    }

    private static String stubText(String model, String responseText) {
        return responseText + " (served by " + model + ")";
    }

    // Hand-built JSON, matching src/driver.ts's jsonBody() exactly (same key order/values):
    // { id, type, role, model, content: [{ type, text }], stop_reason, stop_sequence,
    //   usage: { input_tokens, output_tokens } }.
    private static String jsonBody(String model, String text) {
        return "{"
                + "\"id\":\"msg_stub_0001\","
                + "\"type\":\"message\","
                + "\"role\":\"assistant\","
                + "\"model\":" + quote(model) + ","
                + "\"content\":[{\"type\":\"text\",\"text\":" + quote(text) + "}],"
                + "\"stop_reason\":\"end_turn\","
                + "\"stop_sequence\":null,"
                + "\"usage\":{\"input_tokens\":1,\"output_tokens\":12}"
                + "}";
    }

    // Escapes just enough (backslash, quote, control chars) for this provider's own canned
    // strings -- model ids and the fixed response text never contain anything exotic, but this
    // keeps the JSON well-formed if a caller ever passes an unusual model string.
    private static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        appendUnicodeEscape(sb, c);
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }

    // Hand-rolled (no String.format -- TeaVM's Formatter support is unreliable, exactly why
    // core-proxy's own SimpleJsonCodec avoids it too): unicode-escape prefix + 4-digit lowercase
    // hex, zero-padded. Byte-identical output to the String.format("\\u%04x", ...) this replaces.
    private static void appendUnicodeEscape(StringBuilder sb, char c) {
        sb.append("\\u");
        String hex = Integer.toHexString(c);
        for (int pad = hex.length(); pad < 4; pad++) sb.append('0');
        sb.append(hex);
    }
}
