package io.github.intisy.ai.stub;

import io.github.intisy.ai.api.seam.JsonCodec;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Every decision this provider makes about one request: which model answers, whether the failure
 * roll trips, how long to wait, and whether to answer as a stream.
 *
 * @implNote Randomness and waiting are the host's to supply, because transpiled Java has neither.
 */
public final class StubHandleOrchestrator {

    /** The host's random source, so a caller can make the failure roll deterministic. */
    public interface RandomSource {
        /** @return the next value in {@code [0,1)} */
        double nextRandom();
    }

    /** The host's timer, because transpiled Java has no way to wait. */
    public interface Sleeper {
        /** @param ms how long to wait for */
        void sleep(long ms);
    }

    /** What arrived with the request. */
    public static final class RequestInputs {
        /** The request body as text, which may or may not parse as an object. */
        public String bodyText;
        /** The model the handler context named, which wins over the body's. */
        public String ctxModel;
    }

    /** What this home has configured the stub to do. */
    public static final class OrchestratorConfig {
        /** The text every reply carries. */
        public String responseText;
        /** How long to wait before replying, simulating a slow upstream. */
        public int latencyMs;
        /** How often to fail, from 0 for never to 1 for always. */
        public double failRate;
        /** Null to honour the request's own stream flag; true or false to force one. */
        public Boolean streaming;
    }

    /** The transport outcome, ready for a host to answer with. */
    public static final class HandleDecision {
        /** The HTTP status, 200 unless the failure roll tripped. */
        public int status;
        /** The headers to answer with. */
        public Map<String, String> headers;
        /** The response body. */
        public String body;
    }

    private static final String DEFAULT_MODEL = "stub-model";

    private final JsonCodec json;

    /** @param json the codec this orchestrator parses and builds with */
    public StubHandleOrchestrator(JsonCodec json) { this.json = json; }

    /**
     * Decides one request's whole outcome.
     *
     * @param in what arrived with the request
     * @param cfg what this home has configured the stub to do
     * @param random the host's random source, which the failure roll draws from
     * @param sleeper the host's timer, which the simulated latency waits on
     * @return the transport outcome, whose body is canonical IR unless the roll tripped
     */
    public HandleDecision handle(RequestInputs in, OrchestratorConfig cfg, RandomSource random, Sleeper sleeper) {
        Map<?, ?> body = parseObject(in != null ? in.bodyText : null);
        String model = resolveModel(in, body);

        if (cfg.failRate > 0 && random.nextRandom() < cfg.failRate) {
            return decision(529, "application/json",
                    "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Stub overloaded (fail_rate)\"}}");
        }

        if (cfg.latencyMs > 0) sleeper.sleep(cfg.latencyMs);

        boolean useStream = cfg.streaming != null ? cfg.streaming : truthy(body != null ? body.get("stream") : null);
        if (useStream) {
            return decision(200, "text/event-stream", StubProvider.buildStreamBody(model, cfg.responseText));
        }
        // Canonical IR JSON, returned by driver.ts as-is (no app-wire round-trip).
        return decision(200, "application/json", StubProvider.buildIrResponseJson(json, model, cfg.responseText));
    }

    private String resolveModel(RequestInputs in, Map<?, ?> body) {
        if (in != null && in.ctxModel != null && !in.ctxModel.isEmpty()) return in.ctxModel;
        Object m = body != null ? body.get("model") : null;
        if (m instanceof String && !((String) m).isEmpty()) return (String) m;
        return DEFAULT_MODEL;
    }

    private Map<?, ?> parseObject(String text) {
        if (text == null) return null;
        try {
            Object parsed = json.parse(text);
            return parsed instanceof Map ? (Map<?, ?>) parsed : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean truthy(Object v) {
        return v instanceof Boolean ? (Boolean) v : false;
    }

    private static HandleDecision decision(int status, String contentType, String body) {
        HandleDecision d = new HandleDecision();
        d.status = status;
        d.headers = new LinkedHashMap<>();
        d.headers.put("content-type", contentType);
        d.body = body;
        return d;
    }
}
