package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.stub.StubHandleOrchestrator;
import io.github.intisy.ai.stub.StubProvider;

import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.LinkedHashMap;
import java.util.Map;

public final class StubProviderJs {
    private StubProviderJs() {}

    @JSExport
    public static String buildModelsJson(int count) {
        return StubProvider.buildModels(count);
    }

    @JSExport
    public static JSPromise<JSString> handleStubRequestAsync(
            String inputsJson, String configJson,
            StubSeamBridges.JsRandomFn jsRandom, StubSeamBridges.JsSleepFn jsSleep) {
        return new JSPromise<>((resolve, reject) -> new Thread(() -> {
            try {
                JsonCodec json = new SimpleJsonCodec();
                StubHandleOrchestrator orch = new StubHandleOrchestrator(json);
                StubHandleOrchestrator.RequestInputs in = parseInputs(json, inputsJson);
                StubHandleOrchestrator.OrchestratorConfig cfg = parseConfig(json, configJson);
                StubHandleOrchestrator.HandleDecision d = orch.handle(
                        in, cfg, StubSeamBridges.randomSource(jsRandom), StubSeamBridges.sleeper(jsSleep));
                resolve.accept(JSString.valueOf(decisionToJson(json, d)));
            } catch (Throwable e) {
                reject.accept(JSString.valueOf("handleStubRequestAsync failed: " + e));
            }
        }).start());
    }

    private static StubHandleOrchestrator.RequestInputs parseInputs(JsonCodec json, String inputsJson) {
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        Object parsed = inputsJson != null ? json.parse(inputsJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            in.bodyText = asString(m.get("bodyText"));
            in.ctxModel = asString(m.get("ctxModel"));
        }
        return in;
    }

    private static StubHandleOrchestrator.OrchestratorConfig parseConfig(JsonCodec json, String configJson) {
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "Hello from stub-auth — the core-auth pipeline works end to end.";
        Object parsed = configJson != null ? json.parse(configJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            Object rt = m.get("responseText");
            if (rt instanceof String) cfg.responseText = (String) rt;
            Object lat = m.get("latencyMs");
            if (lat instanceof Number) cfg.latencyMs = ((Number) lat).intValue();
            Object fr = m.get("failRate");
            if (fr instanceof Number) cfg.failRate = ((Number) fr).doubleValue();
            Object st = m.get("streaming");
            if (st instanceof Boolean) cfg.streaming = (Boolean) st;
        }
        return cfg;
    }

    private static String decisionToJson(JsonCodec json, StubHandleOrchestrator.HandleDecision d) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", d.status);
        out.put("headers", d.headers);
        out.put("body", d.body);
        return json.stringify(out);
    }

    private static String asString(Object o) { return o instanceof String ? (String) o : null; }
}
