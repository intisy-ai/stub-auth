package io.github.intisy.ai.stub;

import io.github.intisy.ai.jvm.AiJava;
import io.github.intisy.ai.jvm.Storage;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Task 4's proof: stub-auth's OWN {@code ./gradlew :stub-provider:jar} artifact — not an
 * in-test-classpath fixture, the real built jar from this module — dropped into a directory and
 * discovered purely via {@code ServiceLoader} by ai-java's {@code ProviderRegistry}, then routed
 * a real request through {@code AiJava.router(...)}. ai-java is pulled in as a test-only Gradle
 * composite build ({@code includeBuild}, see {@code ../settings.gradle}) — it is never modified
 * to know stub-auth exists; discovery is 100% jar-on-disk + {@code META-INF/services}.
 *
 * <p>The jar path comes from the {@code stubProviderJar} system property the {@code stub-provider}
 * build wires up (see {@code build.gradle}'s {@code test} block: {@code
 * systemProperty "stubProviderJar", tasks.jar.archiveFile...}), so this test always exercises
 * whatever the {@code jar} task most recently produced — never a hand-duplicated path/version
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
                    "usage block should match src/driver.ts's jsonBody() exactly: " + resp.body);
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
            return Path.of(injected);
        }
        return Path.of("build", "libs", "stub-provider-0.1.0.jar");
    }

    private static void copy(Path from, Path to) throws IOException {
        try (InputStream in = Files.newInputStream(from); OutputStream out = Files.newOutputStream(to)) {
            in.transferTo(out);
        }
    }

    private static RoutingProfile profile() {
        RoutingProfile p = new RoutingProfile();
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
}
