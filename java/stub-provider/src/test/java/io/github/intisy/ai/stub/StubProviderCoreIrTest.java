package io.github.intisy.ai.stub;

import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.IrStopReason;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.translators.anthropic.AnthropicTranslator;
import io.github.intisy.ai.jvm.backend.json.GsonJsonCodec;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves {@link StubProvider#buildCannedBodyViaIr} emits Anthropic-wire JSON built
 * through core-ir (an {@link IrResponse} encoded by {@link AnthropicTranslator}), and that wire
 * parses BACK into the expected IR via {@code AnthropicTranslator.decodeResponse} -- proving the
 * provider drives core-ir end to end, not just producing JSON that happens to look right.
 */
class StubProviderCoreIrTest {

    @Test
    void buildCannedBodyViaIr_matchesHandWrittenShape() {
        String viaIr = StubProvider.buildCannedBodyViaIr(new GsonJsonCodec(), "stub-pro", "hi there");
        assertTrue(viaIr.contains("\"id\":\"msg_stub_0001\""));
        assertTrue(viaIr.contains("\"model\":\"stub-pro\""));
        assertTrue(viaIr.contains("\"text\":\"hi there (served by stub-pro)\""));
        assertTrue(viaIr.contains("\"usage\":{\"input_tokens\":1,\"output_tokens\":12}"));
        assertTrue(viaIr.contains("\"stop_reason\":\"end_turn\""));
    }

    @Test
    void buildCannedBodyViaIr_roundTripsThroughAnthropicTranslator() {
        String wire = StubProvider.buildCannedBodyViaIr(new GsonJsonCodec(), "stub-model", "custom");

        AnthropicTranslator translator = new AnthropicTranslator(
                new StubProvider.RoutingJsonCodecAdapter(new GsonJsonCodec()));
        IrResponse ir = translator.decodeResponse(wire);

        assertEquals("msg_stub_0001", ir.id);
        assertEquals("stub-model", ir.model);
        assertEquals(1, ir.content.size());
        assertTrue(ir.content.get(0) instanceof TextBlock);
        assertEquals("custom (served by stub-model)", ((TextBlock) ir.content.get(0)).text);
        assertEquals(IrStopReason.END_TURN, ir.stopReason);
        assertEquals(1, ir.usage.inputTokens);
        assertEquals(12, ir.usage.outputTokens);
    }
}
