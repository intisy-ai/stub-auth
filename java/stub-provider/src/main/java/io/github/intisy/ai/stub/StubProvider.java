package io.github.intisy.ai.stub;

import io.github.intisy.ai.ir.Block;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.IrStopReason;
import io.github.intisy.ai.ir.IrUsage;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.shared.routing.AccountQuota;
import io.github.intisy.ai.shared.routing.ConfigSchema;
import io.github.intisy.ai.shared.routing.ConfigurableProvider;
import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.routing.ModelCatalogProvider;
import io.github.intisy.ai.shared.routing.ModelInfo;
import io.github.intisy.ai.shared.routing.Provider;
import io.github.intisy.ai.shared.routing.QuotaBar;
import io.github.intisy.ai.shared.routing.QuotaProvider;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Canned-response builder for the stub provider: fixed {@code id}, {@code stop_reason}/
 * {@code stop_sequence}, {@code usage} (input_tokens 1, output_tokens 12), and the
 * {@code responseText + " (served by " + model + ")"} text shape.
 * {@link #handleIr} is the sole serving path: it reads the configured
 * {@code response_text} via {@link StubConfig#values(HandlerCtx)} (which threads the injected
 * {@code ctx.store}, never a self-assembled FileStore), falling back to
 * {@link #DEFAULT_RESPONSE_TEXT} only when unset/blank. The JS/TeaVM path serves the same reply
 * as IR via {@link #buildIrResponseJson}. There is no app-wire
 * {@code handle()} override: the front-door owns app&lt;-&gt;IR translation, so this provider
 * inherits {@code Provider}'s throwing {@code handle} default and carries zero wire-format code.
 *
 * <p>Registered via {@code META-INF/services/io.github.intisy.ai.shared.routing.Provider} so a
 * JVM host discovers it purely through {@code ServiceLoader}, see
 * {@code io.github.intisy.ai.jvm.ProviderRegistry} in ai-java. This class (and this whole
 * module) is deliberately plain: no gson, no reflection, hand-rolled JSON string building only,
 * to keep it transpilable by TeaVM.
 *
 * <p>Also implements core-proxy's typed capability SPI ({@link ConfigurableProvider}/
 * {@link ModelCatalogProvider}/{@link QuotaProvider}), replacing what would otherwise be
 * {@code /v1/config}/{@code /v1/models}/{@code /v1/quota} URL branches on the app-wire path. stub
 * is the ONE provider allowed to hardcode canned example data (models, config schema, quota
 * bars): everything below is illustrative, not derived from a real upstream. {@code OAuthProvider}
 * is deliberately NOT implemented: stub's {@code loginFlow} (src/driver.ts) completes instantly
 * with no real authorize/exchange round-trip, so there is no OAuth capability to expose.
 */
public final class StubProvider implements Provider, ConfigurableProvider, ModelCatalogProvider, QuotaProvider {

    public static final String DEFAULT_RESPONSE_TEXT = "stub response";
    private static final String DEFAULT_MODEL = "stub-model";

    @Override
    public String id() {
        return "stub";
    }

    /**
     * IR-native entry point: model resolution is {@code ctx.model} then
     * {@code request.model} then {@link #DEFAULT_MODEL}, read off the already-decoded
     * {@link IrRequest}. The front-door (Router/proxy server) owns app&lt;-&gt;IR translation, so
     * this provider has no app-wire {@code handle()} and no wire-format code at all (it inherits
     * {@code Provider}'s throwing {@code handle} default). Stub never streams from this entry
     * point: it is a canned example with no per-token generation, so a single {@link IrResponse}
     * covers every test case.
     */
    @Override
    public IrResponse handleIr(IrRequest request, HandlerCtx ctx) {
        String model = resolveModelForIr(request, ctx);
        String responseText = resolveResponseText(ctx);
        return buildIrResponse(model, responseText);
    }

    private static String resolveModelForIr(IrRequest request, HandlerCtx ctx) {
        if (ctx != null && ctx.model != null && !ctx.model.isEmpty()) {
            return ctx.model;
        }
        if (request != null && request.model != null && !request.model.isEmpty()) {
            return request.model;
        }
        return DEFAULT_MODEL;
    }

    // Reads the configured response_text through the same seam ConfigurableProvider uses
    // (StubConfig.values -> ctx.store), falling back to DEFAULT_RESPONSE_TEXT when unset/blank.
    private static String resolveResponseText(HandlerCtx ctx) {
        Object configured = StubConfig.values(ctx).get("response_text");
        if (configured instanceof String && !((String) configured).trim().isEmpty()) {
            return (String) configured;
        }
        return DEFAULT_RESPONSE_TEXT;
    }

    // ---- ConfigurableProvider -- delegates to StubConfig, which threads ctx.store (the server's
    // injected Store) rather than self-assembling a FileStore. ------------------------------------

    @Override
    public ConfigSchema configSchema(HandlerCtx ctx) {
        return StubConfig.schema();
    }

    @Override
    public Map<String, Object> getConfigValues(HandlerCtx ctx) {
        return StubConfig.values(ctx);
    }

    @Override
    public Map<String, Object> putConfigValues(HandlerCtx ctx, Map<String, Object> values) {
        return StubConfig.put(ctx, values);
    }

    // ---- ModelCatalogProvider -- reuses buildModels's own id/name source (modelEntries), never a
    // second hardcoded model list; context/output windows are canned (stub has no real backend to
    // query them from). -----------------------------------------------------------------------------

    private static final int MODEL_CATALOG_COUNT = 3; // mirrors src/index.ts's model_count default
    private static final int DEFAULT_CONTEXT = 200000;
    private static final int DEFAULT_OUTPUT = 64000;

    @Override
    public List<ModelInfo> models(HandlerCtx ctx) {
        String[][] entries = modelEntries(MODEL_CATALOG_COUNT);
        List<ModelInfo> out = new ArrayList<>(entries.length);
        for (String[] entry : entries) {
            out.add(new ModelInfo(entry[0], entry[1], DEFAULT_CONTEXT, DEFAULT_OUTPUT));
        }
        return out;
    }

    // ---- QuotaProvider -- canned demo bars: stub never enforces real rate limits (every request
    // is served unconditionally, modulo the config's artificial fail_rate), so these illustrate the
    // dashboard's quota UI rather than reflect real per-account usage. ------------------------------

    @Override
    public List<AccountQuota> quota(HandlerCtx ctx) {
        return Arrays.asList(
                new AccountQuota("stub-demo-1", "demo-1@example.com", "active",
                        Arrays.asList(new QuotaBar("Stub demo pool", 0.92, "n/a"))),
                new AccountQuota("stub-demo-2", "demo-2@example.com", "active",
                        Arrays.asList(new QuotaBar("Stub demo pool", 0.47, "n/a")))
        );
    }

    /**
     * The canned reply as an {@link IrResponse}, the single place that assembles it. {@link #handleIr}
     * (the JVM path) returns it directly; the JS/TeaVM path serializes it via {@link #buildIrResponseJson}.
     */
    public static IrResponse buildIrResponse(String model, String responseText) {
        IrResponse ir = new IrResponse();
        ir.id = "msg_stub_0001";
        ir.model = model;
        ir.content = Collections.<Block>singletonList(new TextBlock(stubText(model, responseText)));
        ir.stopReason = IrStopReason.END_TURN;
        ir.usage = new IrUsage(1, 12, null, null);
        return ir;
    }

    /**
     * {@link #buildIrResponse} serialized to canonical IR JSON (the shape core-auth/core-proxy's JS
     * front-door consumes), for the TeaVM JS export {@code driver.ts} calls. No app-wire format is
     * involved: the front-door owns IR&lt;-&gt;app translation. {@code json} is the routing SPI codec
     * every caller here already threads in (GsonJsonCodec on the JVM, SimpleJsonCodec from the export).
     */
    public static String buildIrResponseJson(io.github.intisy.ai.shared.spi.JsonCodec json, String model, String responseText) {
        IrResponse ir = buildIrResponse(model, responseText);
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("kind", "text");
        block.put("text", ((TextBlock) ir.content.get(0)).text);
        Map<String, Object> usage = new LinkedHashMap<>();
        usage.put("inputTokens", ir.usage.inputTokens);
        usage.put("outputTokens", ir.usage.outputTokens);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", ir.id);
        out.put("model", ir.model);
        out.put("content", Collections.singletonList(block));
        out.put("stopReason", "end_turn");
        out.put("usage", usage);
        return json.stringify(out);
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

    /**
     * Port of {@code src/driver.ts}'s {@code buildModels}: first three fixed ids/names, then
     * {@code stub-N} (1-based) beyond, clamped to at least one model. Built from
     * {@link #modelEntries}, the single ordered id/name source this method AND
     * {@link #models(HandlerCtx)} (the typed {@code ModelCatalogProvider} capability) both
     * derive from -- never two separately hardcoded model lists.
     */
    public static String buildModels(int count) {
        String[][] entries = modelEntries(count);
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < entries.length; i++) {
            if (i > 0) sb.append(",");
            sb.append(quote(entries[i][0])).append(":{\"name\":").append(quote(entries[i][1])).append("}");
        }
        return sb.append("}").toString();
    }

    /** Ordered {@code {id, name}} pairs, clamped to at least one entry. See {@link #buildModels}. */
    private static String[][] modelEntries(int count) {
        int safe = Math.max(1, count);
        String[][] entries = new String[safe][2];
        for (int i = 0; i < safe; i++) {
            if (i == 0) { entries[i][0] = "stub-model"; entries[i][1] = "Stub Default"; }
            else if (i == 1) { entries[i][0] = "stub-pro"; entries[i][1] = "Stub Pro"; }
            else if (i == 2) { entries[i][0] = "stub-fast"; entries[i][1] = "Stub Fast"; }
            else { entries[i][0] = "stub-" + (i + 1); entries[i][1] = "Stub " + (i + 1); }
        }
        return entries;
    }

    private static String sse(String event, String dataJson) {
        return "event: " + event + "\ndata: " + dataJson + "\n\n";
    }

    private static String stubText(String model, String responseText) {
        return responseText + " (served by " + model + ")";
    }

    // Escapes just enough (backslash, quote, control chars) for this provider's own canned
    // strings -- model ids and the fixed response text never contain anything exotic, but this
    // keeps the JSON well-formed if a caller ever passes an unusual model string. Package-private
    // (not private) so StubConfig reuses this same escaper for config-value persistence instead
    // of hand-rolling a second one.
    static String quote(String s) {
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
