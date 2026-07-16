package io.github.intisy.ai.stub;

import io.github.intisy.ai.jvm.backend.json.GsonJsonCodec;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StubProviderUnitTest {
    @Test
    void buildCannedBody_usesGivenResponseText() {
        String body = StubProvider.buildCannedBody("stub-pro", "hi there");
        assertTrue(body.contains("\"id\":\"msg_stub_0001\""));
        assertTrue(body.contains("\"model\":\"stub-pro\""));
        assertTrue(body.contains("\"text\":\"hi there (served by stub-pro)\""));
        assertTrue(body.contains("\"usage\":{\"input_tokens\":1,\"output_tokens\":12}"));
    }

    @Test
    void buildStreamBody_emitsSixSseEvents() {
        String sse = StubProvider.buildStreamBody("stub-model", "yo");
        assertTrue(sse.contains("event: message_start\n"));
        assertTrue(sse.contains("event: content_block_start\n"));
        assertTrue(sse.contains("event: content_block_delta\n"));
        assertTrue(sse.contains("event: content_block_stop\n"));
        assertTrue(sse.contains("event: message_delta\n"));
        assertTrue(sse.contains("event: message_stop\n"));
        assertTrue(sse.contains("\"text_delta\",\"text\":\"yo (served by stub-model)\""));
        assertTrue(sse.endsWith("\n\n"));
    }

    @Test
    void buildModels_matchesTsShapeAndClamps() {
        assertEquals("{\"stub-model\":{\"name\":\"Stub Default\"}}", StubProvider.buildModels(1));
        assertEquals(
            "{\"stub-model\":{\"name\":\"Stub Default\"},\"stub-pro\":{\"name\":\"Stub Pro\"},\"stub-fast\":{\"name\":\"Stub Fast\"}}",
            StubProvider.buildModels(3));
        assertEquals(
            "{\"stub-model\":{\"name\":\"Stub Default\"},\"stub-pro\":{\"name\":\"Stub Pro\"},\"stub-fast\":{\"name\":\"Stub Fast\"},\"stub-4\":{\"name\":\"Stub 4\"},\"stub-5\":{\"name\":\"Stub 5\"}}",
            StubProvider.buildModels(5));
        assertEquals("{\"stub-model\":{\"name\":\"Stub Default\"}}", StubProvider.buildModels(0));
    }

    @Test
    void orchestrator_json_default_usesConfigResponseText() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{\"model\":\"stub-pro\"}";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "custom"; cfg.latencyMs = 0; cfg.failRate = 0; cfg.streaming = null;
        StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.9, ms -> {});
        assertEquals(200, d.status);
        assertEquals("application/json", d.headers.get("content-type"));
        assertTrue(d.body.contains("\"text\":\"custom (served by stub-pro)\""));
    }

    @Test
    void orchestrator_streamOverride_emitsSse() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{}"; in.ctxModel = "stub-model";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.streaming = Boolean.TRUE;
        StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.9, ms -> {});
        assertEquals("text/event-stream", d.headers.get("content-type"));
        assertTrue(d.body.contains("event: message_stop\n"));
    }

    @Test
    void orchestrator_failRate_returns529() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{}";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.failRate = 0.5;
        StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.1, ms -> {});
        assertEquals(529, d.status);
        assertTrue(d.body.contains("\"type\":\"overloaded_error\""));
        assertTrue(d.body.contains("Stub overloaded (fail_rate)"));
    }

    @Test
    void orchestrator_latency_callsSleeper() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{}";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.latencyMs = 42;
        long[] slept = {-1};
        orch.handle(in, cfg, () -> 0.9, ms -> slept[0] = ms);
        assertEquals(42L, slept[0]);
    }

    @Test
    void orchestrator_modelPrecedence_ctxThenBodyThenDefault() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x";
        StubHandleOrchestrator.RequestInputs ctx = new StubHandleOrchestrator.RequestInputs();
        ctx.bodyText = "{\"model\":\"body-m\"}"; ctx.ctxModel = "ctx-m";
        assertTrue(orch.handle(ctx, cfg, () -> 0.9, ms -> {}).body.contains("(served by ctx-m)"));
        StubHandleOrchestrator.RequestInputs bodyOnly = new StubHandleOrchestrator.RequestInputs();
        bodyOnly.bodyText = "{\"model\":\"body-m\"}";
        assertTrue(orch.handle(bodyOnly, cfg, () -> 0.9, ms -> {}).body.contains("(served by body-m)"));
        StubHandleOrchestrator.RequestInputs none = new StubHandleOrchestrator.RequestInputs();
        none.bodyText = "{}";
        assertTrue(orch.handle(none, cfg, () -> 0.9, ms -> {}).body.contains("(served by stub-model)"));
    }

    @Test
    void orchestrator_streamNull_honorsBodyStreamFlag() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.streaming = null;
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{\"stream\":true}";
        assertEquals("text/event-stream", orch.handle(in, cfg, () -> 0.9, ms -> {}).headers.get("content-type"));
    }

    @Test
    void orchestrator_failRate_shortCircuitsBeforeLatency() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{}";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.failRate = 1.0; cfg.latencyMs = 500;
        boolean[] slept = {false};
        StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.0, ms -> slept[0] = true);
        assertEquals(529, d.status);
        assertFalse(slept[0], "fail_rate must short-circuit before the latency sleep");
    }

    @Test
    void orchestrator_streamFalseOverride_forcesJsonDespiteBodyStream() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "{\"stream\":true}";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x"; cfg.streaming = Boolean.FALSE;
        assertEquals("application/json", orch.handle(in, cfg, () -> 0.9, ms -> {}).headers.get("content-type"));
    }

    @Test
    void orchestrator_malformedBody_doesNotThrow_fallsBackToDefaultModel() {
        StubHandleOrchestrator orch = new StubHandleOrchestrator(new GsonJsonCodec());
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        in.bodyText = "not json {";
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "x";
        StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.9, ms -> {});
        assertEquals(200, d.status);
        assertTrue(d.body.contains("(served by stub-model)"));
    }
}
