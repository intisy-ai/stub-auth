package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.routing.AccountQuota;
import io.github.intisy.ai.shared.routing.ConfigGroup;
import io.github.intisy.ai.shared.routing.ConfigSchema;
import io.github.intisy.ai.shared.routing.HandlerCtx;
import io.github.intisy.ai.shared.routing.ModelInfo;
import io.github.intisy.ai.shared.spi.Store;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.UnaryOperator;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Task E-E: StubProvider's typed capability SPI (ConfigurableProvider/ModelCatalogProvider/
 * QuotaProvider) -- canned example data, config persisted via the injected {@link Store} (never a
 * self-assembled FileStore), models reused from {@link StubProvider#buildModels}, no OAuthProvider
 * (stub has no real OAuth notion).
 */
class StubProviderCapabilityTest {

    @Test
    void configSchema_hasResponseAndAccountRotationGroups() {
        ConfigSchema schema = new StubProvider().configSchema(ctxWith(null));
        assertEquals(2, schema.groups.size());
        ConfigGroup response = schema.groups.get(0);
        assertEquals("Response", response.title);
        assertEquals(3, response.fields.size());
        assertEquals("response_text", response.fields.get(0).key);
        assertEquals("text", response.fields.get(0).type);
        assertEquals("latency_ms", response.fields.get(1).key);
        assertEquals("number", response.fields.get(1).type);
        assertEquals("fail_rate", response.fields.get(2).key);

        ConfigGroup rotation = schema.groups.get(1);
        assertEquals("Account rotation", rotation.title);
        assertEquals("account_selection_strategy", rotation.fields.get(0).key);
        assertEquals("select", rotation.fields.get(0).type);
        assertEquals(java.util.Arrays.asList("sticky", "round-robin", "hybrid"), rotation.fields.get(0).options);
    }

    @Test
    void getConfigValues_returnsDefaultsWhenStoreEmpty() {
        Map<String, Object> values = new StubProvider().getConfigValues(ctxWith(new FakeStore()));
        assertEquals("Hello from stub-auth — the core-auth pipeline works end to end.", values.get("response_text"));
        assertEquals(0L, values.get("latency_ms"));
        assertEquals(0.0, (double) values.get("fail_rate"));
        assertEquals("hybrid", values.get("account_selection_strategy"));
    }

    @Test
    void putConfigValues_persistsViaInjectedStore_andRoundTrips() {
        FakeStore store = new FakeStore();
        StubProvider provider = new StubProvider();
        HandlerCtx ctx = ctxWith(store);

        Map<String, Object> incoming = new LinkedHashMap<>();
        incoming.put("response_text", "custom text");
        incoming.put("latency_ms", 250L);
        incoming.put("fail_rate", 0.5);
        incoming.put("account_selection_strategy", "sticky");
        Map<String, Object> putResult = provider.putConfigValues(ctx, incoming);

        assertEquals("custom text", putResult.get("response_text"));
        assertEquals(250L, putResult.get("latency_ms"));
        assertEquals(0.5, (double) putResult.get("fail_rate"));
        assertEquals("sticky", putResult.get("account_selection_strategy"));

        // Persisted in the injected store (not a self-assembled FileStore) -- a fresh provider
        // instance reading the SAME store sees the override.
        assertTrue(store.data.containsKey("stub-auth.json"));
        Map<String, Object> reread = new StubProvider().getConfigValues(ctxWith(store));
        assertEquals("custom text", reread.get("response_text"));
        assertEquals("sticky", reread.get("account_selection_strategy"));
    }

    @Test
    void putConfigValues_ignoresInvalidEnum_keepsPriorValue() {
        FakeStore store = new FakeStore();
        StubProvider provider = new StubProvider();
        HandlerCtx ctx = ctxWith(store);

        Map<String, Object> first = new LinkedHashMap<>();
        first.put("account_selection_strategy", "round-robin");
        provider.putConfigValues(ctx, first);

        Map<String, Object> invalid = new LinkedHashMap<>();
        invalid.put("account_selection_strategy", "not-a-real-strategy");
        Map<String, Object> result = provider.putConfigValues(ctx, invalid);

        assertEquals("round-robin", result.get("account_selection_strategy"));
    }

    @Test
    void models_reusesBuildModels_sameIdsNamesAndOrder() {
        List<ModelInfo> models = new StubProvider().models(ctxWith(null));
        String buildModelsJson = StubProvider.buildModels(3);

        assertEquals(3, models.size());
        assertEquals("stub-model", models.get(0).id);
        assertEquals("Stub Default", models.get(0).name);
        assertEquals("stub-pro", models.get(1).id);
        assertEquals("Stub Pro", models.get(1).name);
        assertEquals("stub-fast", models.get(2).id);
        assertEquals("Stub Fast", models.get(2).name);

        // Parity check: every id/name models() returns also appears in buildModels(3)'s JSON --
        // proof both derive from the same source, not two separately hardcoded lists.
        for (ModelInfo m : models) {
            assertTrue(buildModelsJson.contains("\"" + m.id + "\":{\"name\":\"" + m.name + "\"}"),
                    "buildModels(3) missing " + m.id + "/" + m.name + ": " + buildModelsJson);
        }
    }

    @Test
    void quota_returnsCannedAccountQuotasWithBars() {
        List<AccountQuota> quota = new StubProvider().quota(ctxWith(null));
        assertEquals(2, quota.size());
        for (AccountQuota aq : quota) {
            assertNotNull(aq.accountId);
            assertNotNull(aq.accountEmail);
            assertEquals("active", aq.accountStatus);
            assertFalse(aq.bars.isEmpty());
            assertEquals("Stub demo pool", aq.bars.get(0).label);
        }
    }

    @Test
    void handle_ignoresRequestUrl_noRetiredSidePathsExist() throws Exception {
        // stub's handle() never branched on request.url in the first place (no /v1/config,
        // /v1/models, /v1/quota, /v1/oauth/* side paths to retire) -- it always serves the canned
        // messages response regardless of the inbound path.
        StubProvider provider = new StubProvider();
        HttpRequest req = new HttpRequest();
        req.method = "GET";
        req.url = "/v1/config";
        req.body = "{}";
        HttpResponse resp = provider.handle(req, ctxWith(null));
        assertEquals(200, resp.status);
        assertTrue(resp.body.contains("\"id\":\"msg_stub_0001\""));
    }

    private static HandlerCtx ctxWith(Store store) {
        HandlerCtx ctx = new HandlerCtx();
        ctx.store = store;
        return ctx;
    }

    /** Minimal in-memory {@link Store} fake, local to this test (no cross-module test dependency). */
    private static final class FakeStore implements Store {
        final Map<String, String> data = new LinkedHashMap<>();

        @Override public String get(String key) { return data.get(key); }
        @Override public void put(String key, String value) { data.put(key, value); }
        @Override public boolean exists(String key) { return data.containsKey(key); }
        @Override public void delete(String key) { data.remove(key); }
        @Override public void update(String key, UnaryOperator<String> mutator) {
            data.put(key, mutator.apply(data.get(key)));
        }
        @Override public List<String> listKeys(String prefix) {
            List<String> keys = new java.util.ArrayList<>();
            for (String k : data.keySet()) if (k.startsWith(prefix)) keys.add(k);
            return keys;
        }
    }
}
