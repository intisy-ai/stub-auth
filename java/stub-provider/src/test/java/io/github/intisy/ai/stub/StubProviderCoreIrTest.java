package io.github.intisy.ai.stub;

import io.github.intisy.ai.jvm.backend.json.GsonJsonCodec;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Proves {@link StubProvider#buildIrResponseJson} serializes the canned reply as canonical IR JSON
 * (the shape the JS front-door consumes) with no app-wire format involved.
 */
class StubProviderCoreIrTest {

    @Test
    @SuppressWarnings("unchecked")
    void buildIrResponseJson_emitsCanonicalIrShape() {
        GsonJsonCodec json = new GsonJsonCodec();
        Map<String, Object> ir = (Map<String, Object>) json.parse(
                StubProvider.buildIrResponseJson(json, "stub-pro", "hi there"));

        assertEquals("msg_stub_0001", ir.get("id"));
        assertEquals("stub-pro", ir.get("model"));
        assertEquals("end_turn", ir.get("stopReason"));

        List<Map<String, Object>> content = (List<Map<String, Object>>) ir.get("content");
        assertEquals(1, content.size());
        assertEquals("text", content.get(0).get("kind"));
        assertEquals("hi there (served by stub-pro)", content.get(0).get("text"));

        Map<String, Object> usage = (Map<String, Object>) ir.get("usage");
        assertEquals(1, ((Number) usage.get("inputTokens")).intValue());
        assertEquals(12, ((Number) usage.get("outputTokens")).intValue());
    }
}
