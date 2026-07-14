package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.stub.StubProvider;

import org.teavm.jso.JSExport;

import java.util.Map;

/**
 * TeaVM JS export surface over stub-auth's Java provider ({@code StubProvider}) — the js half of
 * Task 5's shared-Java model proof (T4 proved the JVM/ServiceLoader half). Lives in the SAME
 * package ({@code io.github.intisy.ai.js}) as core-proxy's {@code :teavm} module (a Gradle
 * project dependency, see {@code stub-teavm/build.gradle}), so {@link SimpleJsonCodec} is
 * referenced unqualified exactly like {@code CoreAuthJs}/{@code CoreProxyJs} do — NOT duplicated
 * here.
 *
 * <p>{@link #handle} resolves {@code model} out of the request JSON via {@code SimpleJsonCodec}
 * (never regex — that's {@code StubProvider}'s own JVM-side {@code resolveModel} concern, kept on
 * that side of the boundary) and then calls {@link StubProvider#buildCannedBody}, the SAME method
 * {@code StubProvider.handle} calls on the JVM path — one Java method, compiled twice (javac for
 * the {@code :stub-provider} jar, TeaVM for this module), producing byte-identical canned bodies.
 */
public final class StubProviderJs {
    private StubProviderJs() {
    }

    // Mirrors StubProvider's own private DEFAULT_MODEL constant -- duplicated here as a literal
    // (not exposed as public API on StubProvider) since it's this export's own fallback for a
    // request body that omits "model" entirely, matching resolveModel's fallback precedence
    // ((ctx-less here, since this export has no HandlerCtx concept) body.model || "stub-model").
    private static final String DEFAULT_MODEL = "stub-model";

    /**
     * Non-streaming canned-response export: {@code requestJson} is a {@code /v1/messages}-style
     * request body (only the top-level {@code "model"} field is read). Returns the same JSON body
     * shape {@code StubProvider.handle} returns on the JVM side and {@code src/driver.ts}'s
     * {@code jsonBody()} returns on the TS side: {@code msg_stub_0001} id, {@code "(served by
     * <model>)"} text, {@code usage.output_tokens:12}.
     */
    @JSExport
    public static String handle(String requestJson) {
        JsonCodec json = new SimpleJsonCodec();
        String model = extractModel(json, requestJson);
        return StubProvider.buildCannedBody(model);
    }

    private static String extractModel(JsonCodec json, String requestJson) {
        Object parsed = requestJson != null ? json.parse(requestJson) : null;
        if (parsed instanceof Map) {
            Object model = ((Map<?, ?>) parsed).get("model");
            if (model instanceof String && !((String) model).isEmpty()) {
                return (String) model;
            }
        }
        return DEFAULT_MODEL;
    }
}
