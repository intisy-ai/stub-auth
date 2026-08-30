package io.github.intisy.ai.js;

import io.github.intisy.ai.stub.StubHandleOrchestrator;

import org.teavm.interop.Async;
import org.teavm.interop.AsyncCallback;
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSPromise;

/**
 * The two things the orchestrator needs and transpiled Java cannot have, adapted from the functions
 * the host passes in.
 */
public final class StubSeamBridges {
    private StubSeamBridges() {}

    /** The host's random source, as JavaScript hands it over. */
    @JSFunctor
    public interface JsRandomFn extends JSObject {
        /** @return the next value in {@code [0,1)} */
        double next();
    }

    /** The host's timer, as JavaScript hands it over. */
    @JSFunctor
    public interface JsSleepFn extends JSObject {
        /**
         * @param ms how long to wait for
         * @return a promise that settles once the wait is over
         */
        JSPromise<JSObject> sleep(int ms);
    }

    /**
     * @param fn the host's random source
     * @return it, as the orchestrator expects one
     */
    public static StubHandleOrchestrator.RandomSource randomSource(JsRandomFn fn) {
        return fn::next;
    }

    /**
     * @param fn the host's timer
     * @return it, as the orchestrator expects one, blocking the transpiled call until it settles
     */
    public static StubHandleOrchestrator.Sleeper sleeper(JsSleepFn fn) {
        return ms -> awaitSleep(fn, (int) ms);
    }

    @Async
    private static native void awaitSleep(JsSleepFn fn, int ms);

    private static void awaitSleep(JsSleepFn fn, int ms, AsyncCallback<Void> callback) {
        fn.sleep(ms).then(
                value -> { callback.complete(null); return null; },
                error -> { callback.error(new RuntimeException("sleep rejected: " + error)); return null; });
    }
}
