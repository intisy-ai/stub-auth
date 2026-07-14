package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.routing.Provider;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

import java.util.HashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Java port of stub-auth's TS driver ({@code src/driver.ts}, non-streaming branch only —
 * streaming SSE is deferred, per this task's brief). Ported field-for-field from
 * {@code jsonBody}/{@code stubText} (src/driver.ts:44-55): same {@code id}, same
 * {@code stop_reason}/{@code stop_sequence}, same {@code usage} (input_tokens 1, output_tokens
 * 12), and the same {@code responseText + " (served by " + model + ")"} text shape. The TS side
 * reads {@code responseText} from stub-auth's own config (default a longer sentence); this Java
 * port hardcodes the brief's fixed literal ({@code "stub response"}) since there is no
 * config-loading seam on this side of the boundary.
 *
 * <p>Registered via {@code META-INF/services/io.github.intisy.ai.shared.routing.Provider} so a
 * JVM host discovers it purely through {@code ServiceLoader} — see
 * {@code io.github.intisy.ai.jvm.ProviderRegistry} in ai-java. This class (and this whole
 * module) is deliberately plain: no gson, no reflection — hand-rolled JSON string building only,
 * matching the brief ("transpilability is a Task-5 concern, keep it plain").
 */
public final class StubProvider implements Provider {

    private static final String RESPONSE_TEXT = "stub response";
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
        String text = stubText(model, RESPONSE_TEXT);

        HttpResponse resp = new HttpResponse();
        resp.status = 200;
        resp.headers = new HashMap<>();
        resp.headers.put("content-type", "application/json");
        resp.body = jsonBody(model, text);
        return resp;
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
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
        return sb.toString();
    }
}
