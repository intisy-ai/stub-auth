package io.github.intisy.ai.stub;

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
}
