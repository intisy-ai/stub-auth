package io.github.intisy.ai.stub;

import io.github.intisy.ai.ir.Block;
import io.github.intisy.ai.ir.IrMessage;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.spi.StreamDecoder;
import io.github.intisy.ai.ir.spi.StreamEncoder;
import io.github.intisy.ai.ir.spi.Translator;
import io.github.intisy.ai.jvm.AiJava;
import io.github.intisy.ai.jvm.Storage;
import io.github.intisy.ai.jvm.backend.json.GsonJsonCodec;
import io.github.intisy.ai.shared.routing.RoutingProfile;
import io.github.intisy.ai.shared.spi.Store;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves stub-auth's OWN {@code ./gradlew :stub-provider:jar} artifact, not an
 * in-test-classpath fixture but the real built jar from this module, dropped into a directory and
 * discovered purely via {@code ServiceLoader} by ai-java's {@code ProviderRegistry}, then routed
 * a real request through {@code AiJava.router(...)}. ai-java is pulled in as a test-only Gradle
 * composite build ({@code includeBuild}, see {@code ../settings.gradle}); it is never modified
 * to know stub-auth exists; discovery is 100% jar-on-disk + {@code META-INF/services}.
 *
 * <p>The jar path comes from the {@code stubProviderJar} system property the {@code stub-provider}
 * build wires up (see {@code build.gradle}'s {@code test} block: {@code
 * systemProperty "stubProviderJar", tasks.jar.archiveFile...}), so this test always exercises
 * whatever the {@code jar} task most recently produced, never a hand-duplicated path/version
 * string.
 */
class StubProviderIntegrationTest {

    private static final String CONFIG_FILE = "stub-provider-integration-test.json";

    @Test
    void builtJar_isDiscoveredByAiJavaProviderRegistry_andRoutesARealRequest(@TempDir Path tmp) throws IOException {
        Path builtJar = builtStubProviderJar();
        assertTrue(Files.isRegularFile(builtJar), "expected the stub-provider jar to already exist at " + builtJar
                + " -- run `./gradlew :stub-provider:jar` (or let `test` depend on it) before this test");

        Path providersDir = tmp.resolve("providers");
        Files.createDirectory(providersDir);
        copy(builtJar, providersDir.resolve(builtJar.getFileName()));

        Store store = Storage.memory();
        seedModelMap(store);

        // Zero ai-java host code changes: AiJava.builder().providersDir(...) is pure
        // ServiceLoader discovery over *.jar files in the directory -- ai-java has no idea
        // "stub-auth" or "StubProvider" exist.
        try (AiJava app = AiJava.builder().storage(store).providersDir(providersDir).build()) {
            assertEquals(Collections.singletonList("stub"), app.providerRegistry().listProviderIds(),
                    "AiJava should have discovered stub-auth's built jar's Provider purely via ServiceLoader");

            AiJava.WiredRouter router = app.router(profile());
            HttpResponse resp = router.route(post("/v1/messages", "{\"model\":\"claude-opus-4-ignored\"}"));

            assertEquals(200, resp.status);
            assertTrue(resp.body.contains("\"id\":\"msg_stub_0001\""), "canned response id mismatch: " + resp.body);
            assertTrue(resp.body.contains("(served by m-stub)"),
                    "expected the stubText() suffix naming the routed model: " + resp.body);
            assertTrue(resp.body.contains("\"usage\":{\"input_tokens\":1,\"output_tokens\":12}"),
                    "usage block should be the wire encoding the front door produces: " + resp.body);
        }
    }

    // -- fixtures -------------------------------------------------------------------------

    /**
     * The jar path is injected by {@code build.gradle}'s {@code test} block as a system property
     * so it always points at whatever {@code :stub-provider:jar} most recently produced (no
     * hand-duplicated filename/version). Falls back to the conventional Gradle output path when
     * run outside Gradle (e.g. directly from an IDE) so the test still tells you what to build.
     */
    private static Path builtStubProviderJar() {
        String injected = System.getProperty("stubProviderJar");
        if (injected != null && !injected.isEmpty()) {
            return Paths.get(injected);
        }
        return Paths.get("build", "libs", "stub-provider-0.1.0.jar");
    }

    private static void copy(Path from, Path to) throws IOException {
        try (InputStream in = Files.newInputStream(from); OutputStream out = Files.newOutputStream(to)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private static RoutingProfile profile() {
        RoutingProfile p = new RoutingProfile();
        // The provider is IR-native (no app-wire handle()), so the front-door must supply an
        // app<->IR translator, exactly as a real profile does. With it set, the Router decodes the
        // inbound wire to IR, calls the provider's handleIr, and encodes the IrResponse back.
        // Without it the Router would hit Provider's throwing handle() default. Which vendor speaks
        // the wire is irrelevant here (each real translator is tested in its own repo), so this
        // supplies a minimal one and asserts on the fields it writes.
        p.translator = new WireTranslator(new GsonJsonCodec());
        p.configFile = CONFIG_FILE;
        p.routingKey = "providerRouting";
        p.tierSourceProvider = "stub";
        p.tierOrder = Collections.singletonList("opus");
        p.tierFallback = Collections.singletonList("opus");
        p.tierRegex = Pattern.compile("^claude-([a-z]+)-\\d");
        p.envPrefix = "ANTHROPIC";
        p.defaultContext = 200000;
        p.defaultOutput = 64000;
        p.nativeRateLimit = info -> {
            RoutingProfile.Synth s = new RoutingProfile.Synth();
            s.status = 429;
            s.headers = new HashMap<>();
            s.body = "{}";
            return s;
        };
        return p;
    }

    // Hand-written JSON (no codec dependency needed) -- assigns the "opus" tier to
    // provider "stub" / model "m-stub", the shape Router.route's model-map resolution expects.
    private static void seedModelMap(Store store) {
        String doc = "{\"modelMap\":{\"opus\":[{\"provider\":\"stub\",\"model\":\"m-stub\"}]}}";
        store.put(CONFIG_FILE, doc);
    }

    private static HttpRequest post(String url, String body) {
        HttpRequest req = new HttpRequest();
        req.method = "POST";
        req.url = url;
        req.headers = new HashMap<>();
        req.body = body;
        return req;
    }

    /**
     * Minimal app<->IR translator for the front door: decodes the inbound request's model, and
     * encodes the provider's response as {@code id/model/content/stop_reason/usage} (the fields
     * this test asserts on). Streaming is out of scope here, so those decoders refuse rather than
     * pretend.
     */
    private static final class WireTranslator implements Translator {
        private final io.github.intisy.ai.shared.spi.JsonCodec codec;

        WireTranslator(io.github.intisy.ai.shared.spi.JsonCodec codec) {
            this.codec = codec;
        }

        @Override
        public IrRequest decodeRequest(String wireJson) {
            Object parsed = codec.parse(wireJson);
            IrRequest request = new IrRequest();
            request.messages = new ArrayList<>();
            if (parsed instanceof Map) {
                Map<?, ?> root = (Map<?, ?>) parsed;
                Object model = root.get("model");
                request.model = model == null ? null : String.valueOf(model);
                request.stream = Boolean.TRUE.equals(root.get("stream"));
                Object messages = root.get("messages");
                if (messages instanceof List) {
                    for (Object entry : (List<?>) messages) {
                        if (!(entry instanceof Map)) continue;
                        Map<?, ?> message = (Map<?, ?>) entry;
                        List<Block> content = new ArrayList<>();
                        content.add(new TextBlock(String.valueOf(message.get("content"))));
                        request.messages.add(new IrMessage(String.valueOf(message.get("role")), content));
                    }
                }
            }
            return request;
        }

        @Override
        public String encodeRequest(IrRequest request) {
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("model", request.model);
            return codec.stringify(root);
        }

        @Override
        public IrResponse decodeResponse(String wireJson) {
            throw new UnsupportedOperationException("the front door never decodes a response in this test");
        }

        @Override
        public String encodeResponse(IrResponse response) {
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("id", response.id);
            root.put("model", response.model);
            List<Object> content = new ArrayList<>();
            if (response.content != null) {
                for (Block block : response.content) {
                    if (!(block instanceof TextBlock)) continue;
                    Map<String, Object> encoded = new LinkedHashMap<>();
                    encoded.put("type", "text");
                    encoded.put("text", ((TextBlock) block).text);
                    content.add(encoded);
                }
            }
            root.put("content", content);
            root.put("stop_reason", response.stopReason);
            if (response.usage != null) {
                Map<String, Object> usage = new LinkedHashMap<>();
                usage.put("input_tokens", response.usage.inputTokens);
                usage.put("output_tokens", response.usage.outputTokens);
                root.put("usage", usage);
            }
            return codec.stringify(root);
        }

        @Override
        public StreamDecoder newStreamDecoder() {
            throw new UnsupportedOperationException("streaming is covered by the vendor translators' own tests");
        }

        @Override
        public StreamEncoder newStreamEncoder() {
            throw new UnsupportedOperationException("streaming is covered by the vendor translators' own tests");
        }
    }
}
