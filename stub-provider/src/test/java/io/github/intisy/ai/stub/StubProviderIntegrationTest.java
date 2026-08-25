package io.github.intisy.ai.stub;

import io.github.intisy.ai.auth.contracts.Provider;
import io.github.intisy.ai.ir.Block;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.api.seam.Store;
import io.github.intisy.ai.seam.InMemoryStore;
import io.github.intisy.ai.seam.NoopLogger;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import java.util.ServiceLoader;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Proves the artifact this module actually ships: the jar {@code :stub-provider:jar} just produced,
 * loaded off disk through {@code ServiceLoader} exactly as a JVM host loads it, serving a real
 * request; and that the jar is THIN, carrying its own classes and nothing else.
 *
 * <p>The jar path is injected by {@code build.gradle}'s {@code test} block as a system property, so
 * this always exercises whatever {@code jar} most recently produced, never a hand-duplicated path
 * or version string.
 *
 * @implNote No host takes part. {@code ServiceLoader.load(Provider.class, loader)} over a
 * {@code URLClassLoader} IS the discovery a host performs, so running it here keeps the assertion
 * about this repo's own artifact instead of about someone else's registry. That a host wires that
 * discovery into routing is proven where the host lives, by ai-java's
 * {@code ProviderRegistryIntegrationTest} against its own separately built provider jar.
 */
class StubProviderIntegrationTest {

    private static final String CONFIGURED_TEXT = "served from the built jar";
    private static final String SERVICES_ENTRY = "META-INF/services/io.github.intisy.ai.auth.contracts.Provider";

    @Test
    void builtJarIsDiscoveredByServiceLoaderAndServesARequest() throws Exception {
        Path jar = builtStubProviderJar();

        // Parent-first delegation, as a host's provider classloader does it: Provider, HandlerCtx
        // and the IR types resolve from the parent, only the provider itself from the jar.
        try (URLClassLoader loader = new URLClassLoader(new URL[]{jar.toUri().toURL()}, hostSideOfTheClasspath())) {
            List<Provider> discovered = new ArrayList<>();
            for (Provider provider : ServiceLoader.load(Provider.class, loader)) {
                discovered.add(provider);
            }

            assertEquals(1, discovered.size(), "the jar should register exactly one Provider");
            Provider stub = discovered.get(0);
            assertEquals("stub", stub.id());
            assertSame(loader, stub.getClass().getClassLoader(),
                    "the discovered provider must come from the jar, not from the test classpath");

            IrResponse response = stub.handleIr(new IrRequest(), ctxFor("m-stub"));

            assertEquals("msg_stub_0001", response.id);
            assertEquals("m-stub", response.model);
            assertEquals(1, response.content.size());
            // The configured text proves the jar-loaded code read the ctx.store the host injected,
            // rather than falling back to a default or assembling a store of its own.
            assertEquals(CONFIGURED_TEXT + " (served by m-stub)", textOf(response.content.get(0)));
            assertEquals(Integer.valueOf(1), response.usage.inputTokens);
            assertEquals(Integer.valueOf(12), response.usage.outputTokens);
        }
    }

    @Test
    void builtJarCarriesItsServiceRegistrationAndNoBorrowedClasses() throws IOException {
        try (JarFile jarFile = new JarFile(builtStubProviderJar().toFile())) {
            assertNotNull(jarFile.getEntry(SERVICES_ENTRY), "missing " + SERVICES_ENTRY);
            assertNotNull(jarFile.getEntry("io/github/intisy/ai/stub/StubProvider.class"));

            List<String> borrowed = new ArrayList<>();
            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                String name = entries.nextElement().getName();
                if (name.endsWith(".class")
                        && name.startsWith("io/github/intisy/")
                        && !name.startsWith("io/github/intisy/ai/stub/")) {
                    borrowed.add(name);
                }
            }
            assertTrue(borrowed.isEmpty(),
                    "a provider jar must bundle no first-party class it does not own, found: " + borrowed);
        }
    }

    private static Path builtStubProviderJar() {
        String injected = System.getProperty("stubProviderJar");
        Path jar = injected != null && !injected.isEmpty()
                ? Paths.get(injected)
                : Paths.get("build", "libs", "stub-provider.jar");
        assertTrue(jar.toFile().isFile(), "expected the built jar at " + jar
                + " -- run `./gradlew :stub-provider:test`, which builds it first");
        return jar;
    }

    /**
     * The test classpath carries this module's compiled classes AND its {@code META-INF/services}
     * registration, so a plain parent would win the parent-first lookup and the jar would never be
     * read. Hiding just this module's own package and its services entry leaves a parent shaped like
     * a real host's: all the shared vocabulary, none of the provider.
     */
    private static ClassLoader hostSideOfTheClasspath() {
        return new ClassLoader(StubProviderIntegrationTest.class.getClassLoader()) {
            @Override
            protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
                if (name.startsWith("io.github.intisy.ai.stub.")) {
                    throw new ClassNotFoundException(name);
                }
                return super.loadClass(name, resolve);
            }

            @Override
            public URL getResource(String name) {
                return SERVICES_ENTRY.equals(name) ? null : super.getResource(name);
            }

            @Override
            public Enumeration<URL> getResources(String name) throws IOException {
                return SERVICES_ENTRY.equals(name) ? Collections.<URL>emptyEnumeration() : super.getResources(name);
            }
        };
    }

    private static HandlerCtx ctxFor(String model) {
        Store store = new InMemoryStore();
        store.put("stub-auth.json", "{\"response_text\":\"" + CONFIGURED_TEXT + "\"}");
        return new HandlerCtx("", store, NoopLogger.INSTANCE, model);
    }

    private static String textOf(Block block) {
        assertTrue(block instanceof TextBlock, "expected a text block, got " + block);
        return ((TextBlock) block).text;
    }
}
