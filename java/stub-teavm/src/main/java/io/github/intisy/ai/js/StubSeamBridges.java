package io.github.intisy.ai.js;

import io.github.intisy.ai.stub.StubHandleOrchestrator;

import org.teavm.interop.Async;
import org.teavm.interop.AsyncCallback;
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSPromise;

public final class StubSeamBridges {
    private StubSeamBridges() {}

    @JSFunctor
    public interface JsRandomFn extends JSObject { double next(); }

    @JSFunctor
    public interface JsSleepFn extends JSObject { JSPromise<JSObject> sleep(int ms); }

    public static StubHandleOrchestrator.RandomSource randomSource(JsRandomFn fn) {
        return fn::next;
    }

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
