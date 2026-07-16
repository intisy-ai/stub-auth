package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.spi.JsonCodec;

import java.util.LinkedHashMap;
import java.util.Map;

public final class StubHandleOrchestrator {

    public interface RandomSource { double nextRandom(); }
    public interface Sleeper { void sleep(long ms); }

    public static final class RequestInputs { public String bodyText; public String ctxModel; }
    public static final class OrchestratorConfig {
        public String responseText;
        public int latencyMs;
        public double failRate;
        public Boolean streaming; // null = honor request stream flag; TRUE/FALSE = force
    }
    public static final class HandleDecision {
        public int status;
        public Map<String, String> headers;
        public String body;
    }

    private static final String DEFAULT_MODEL = "stub-model";

    private final JsonCodec json;

    public StubHandleOrchestrator(JsonCodec json) { this.json = json; }

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
        return decision(200, "application/json", StubProvider.buildCannedBody(model, cfg.responseText));
    }

    private String resolveModel(RequestInputs in, Map<?, ?> body) {
        if (in != null && in.ctxModel != null && !in.ctxModel.isEmpty()) return in.ctxModel;
        Object m = body != null ? body.get("model") : null;
        if (m instanceof String && !((String) m).isEmpty()) return (String) m;
        return DEFAULT_MODEL;
    }

    private Map<?, ?> parseObject(String text) {
        Object parsed = text != null ? json.parse(text) : null;
        return parsed instanceof Map ? (Map<?, ?>) parsed : null;
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
