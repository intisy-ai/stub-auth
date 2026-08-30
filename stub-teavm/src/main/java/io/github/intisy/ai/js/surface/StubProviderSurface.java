package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsModule;

import java.util.concurrent.CompletionStage;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * stub-auth's JavaScript module surface, typed for a TypeScript consumer.
 *
 * @implNote Declares the shape {@code StubProviderJs} actually exports; it is never implemented,
 * only emitted, and {@link TsModule} renders its members as free functions. The export class speaks
 * {@code JSPromise}, {@code JSString} and two JSO functional interfaces, none of which mean anything
 * to a TypeScript caller, which is exactly why this parallel declaration exists.
 */
@TsModule
public interface StubProviderSurface {

    /**
     * The models this provider advertises.
     *
     * @param count how many stub models to build
     * @return the models as a JSON object, keyed by model id
     */
    String buildModelsJson(int count);

    /**
     * Runs one request through the orchestrator, which owns every decision it makes.
     *
     * @param inputsJson the request's model and the handler context's, as a JSON object
     * @param configJson the response text, latency, failure rate and streaming override, as a JSON
     *                   object
     * @param jsRandom the host's random source, so the failure roll is the host's to seed
     * @param jsSleep the host's timer, because transpiled Java has no way to wait
     * @return the status, headers and body as a JSON object, the body being canonical IR
     */
    CompletionStage<String> handleStubRequestAsync(String inputsJson, String configJson,
                                                   Supplier<Double> jsRandom,
                                                   Function<Integer, CompletionStage<Void>> jsSleep);
}
