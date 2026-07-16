# stub-auth TeaVM De-duplication Pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Java code stub-auth's single source of truth for provider logic (transpiled via TeaVM to JS for the plugin, compiled to a jar for the JVM server), wire it into the live TS driver behind un-portable host seams, verify it live, then delete the duplicated TypeScript logic — with no startup performance loss.

**Architecture:** Java (`:stub-provider`) owns all pure logic (body builders, model catalog, and a `StubHandleOrchestrator` that owns the whole `handle` decision) with two injected seams — a synchronous `RandomSource` and a blocking-shaped `Sleeper`. `:stub-teavm` re-exports the orchestrator as an async `JSPromise` (mirroring claude's `handleClaudeRequestAsync`), with the seams supplied from TS as `Math.random` and `setTimeout`. `driver.ts` becomes a thin host shell (assemble inputs/config JSON, provide seams, wrap the returned decision in a `Response`). The ~500 KB TeaVM bundle is loaded lazily and memoized on first real use, never at registration.

**Tech Stack:** TypeScript (esbuild bundle), Java 8 (`:stub-provider`) / Java 17 (`:stub-teavm`), TeaVM 0.15.0 (`generateJavaScript`, ES2015), Gradle, vitest, JUnit.

## Global Constraints

- All plugin source is TypeScript; compiled output to `dist/` (never committed). — spec "Constraints"
- Java is the single source of truth; there must be **no** logic duplicated between Java and TypeScript. — spec "Goal"
- No startup performance loss: the TeaVM bundle loads **lazily + memoized on first real use**, never at plugin registration. — spec "Performance"
- Preserve observable behavior, config schema, account model, and public API (non-goal to change them). — spec "Non-goals"
- Never override git identity; Conventional Commits; **default-branch pushes and the republish need explicit user OK**. — spec "Constraints"
- No hardcoded secrets; prefer few comments (non-obvious only). — spec "Constraints"
- The TS deletion (Task 8) is the approved goal but is **gated behind live verification** (Task 7). — spec "Constraints"
- Parity is byte-for-byte with the pre-migration TS output (same JSON key order/values, same six SSE events). — spec "Target architecture"

---

## Parity reference (audit result — the behaviors Java must reproduce)

From `src/driver.ts` `handle()` and helpers, the live TS produces:

| Behavior | TS source | Java owner (this plan) |
|---|---|---|
| model resolution `ctx.model \|\| body.model \|\| "stub-model"` | `handle()` | `StubHandleOrchestrator` |
| `fail_rate`: `Math.random() < failRate` → 529 `overloaded_error` | `handle()` | orchestrator + `RandomSource` seam |
| `latency_ms`: delay before reply | `handle()` (`setTimeout`) | orchestrator + `Sleeper` seam |
| stream choice: `streaming==null ? body.stream : streaming` | `handle()` | orchestrator |
| JSON body `{id:msg_stub_0001,…,usage:{1,12}}` | `jsonBody`/`stubText` | `StubProvider.buildCannedBody(model, responseText)` |
| SSE body (6 events) | `streamBody`/`sse` | `StubProvider.buildStreamBody(model, responseText)` |
| model catalog by count (names `stub-model`/`stub-pro`/`stub-fast`/`stub-N`) | `buildModels` | `StubProvider.buildModels(count)` |

Error body (exact): `{"type":"error","error":{"type":"overloaded_error","message":"Stub overloaded (fail_rate)"}}`, status 529, `content-type: application/json`.

---

## File structure

- `java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubProvider.java` — **modify**: `buildCannedBody(model, responseText)`, add `buildStreamBody`, add `buildModels`; JVM `handle` calls `buildCannedBody(model, DEFAULT_RESPONSE_TEXT)`.
- `java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubHandleOrchestrator.java` — **create**: pure decision loop + `RequestInputs`/`OrchestratorConfig`/`HandleDecision`/`RandomSource`/`Sleeper`.
- `java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java` — **create**: JVM unit tests for the body builders, `buildModels`, and the orchestrator (fake seams).
- `java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubProviderJs.java` — **modify**: add `handleStubRequestAsync` (async) + `buildModelsJson`; drop the old `handle`.
- `java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubSeamBridges.java` — **create**: `JsRandomFn`/`JsSleepFn` `@JSFunctor`s + `RandomSource`/`Sleeper` adapters + `@Async` `awaitSleep`.
- `src/javaProvider.ts` — **modify**: lazy-memoized TeaVM loader; export `handleViaOrchestrator` + `buildModelsViaJava`.
- `src/driver.ts` — **modify**: `handle()` → host shell calling the orchestrator; `driver.models`/`fetchModels` via Java; delete `jsonBody`/`streamBody`/`sse`/`stubText`/`buildModels` (Task 8).
- `src/__tests__/javaProvider.smoke.test.ts` — **modify**: parity matrix (orchestrator output == pre-migration TS output).
- `package.json` — **modify**: build script emits `src/generated/stub-models.json` seed.
- `.gitmodules`/`core-auth` gitlink, branch, `publish.yml` — **modify** (Task 9).

---

### Task 1: Java body builders — `buildCannedBody(model, responseText)` + `buildStreamBody`

**Files:**
- Modify: `java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubProvider.java`
- Create: `java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java`

**Interfaces:**
- Produces: `static String StubProvider.buildCannedBody(String model, String responseText)`; `static String StubProvider.buildStreamBody(String model, String responseText)`; `static final String StubProvider.DEFAULT_RESPONSE_TEXT`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `StubProviderUnitTest.java`:

```java
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd java && ./gradlew :stub-provider:test --tests 'io.github.intisy.ai.stub.StubProviderUnitTest'`
Expected: FAIL — `buildCannedBody(String,String)` / `buildStreamBody` not found (compile error).

- [ ] **Step 3: Modify `StubProvider.java`**

Change the `RESPONSE_TEXT` constant to a JVM-path default and make `buildCannedBody` take `responseText`; add `buildStreamBody`. Replace the existing `buildCannedBody` and add the new method (keep `jsonBody`/`quote`/`appendUnicodeEscape` as-is):

```java
// JVM Provider.handle has no JS-config seam, so the server path uses this default text.
public static final String DEFAULT_RESPONSE_TEXT = "stub response";

public static String buildCannedBody(String model, String responseText) {
    return jsonBody(model, stubText(model, responseText));
}

// SSE body — ports src/driver.ts streamBody()/sse() byte-for-byte (six events).
public static String buildStreamBody(String model, String responseText) {
    String text = stubText(model, responseText);
    String startMsg = "{\"id\":\"msg_stub_0001\",\"type\":\"message\",\"role\":\"assistant\",\"model\":"
            + quote(model) + ",\"content\":[],\"stop_reason\":null,\"stop_sequence\":null,"
            + "\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}";
    StringBuilder sb = new StringBuilder();
    sb.append(sse("message_start", "{\"type\":\"message_start\",\"message\":" + startMsg + "}"));
    sb.append(sse("content_block_start",
            "{\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}"));
    sb.append(sse("content_block_delta",
            "{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":" + quote(text) + "}}"));
    sb.append(sse("content_block_stop", "{\"type\":\"content_block_stop\",\"index\":0}"));
    sb.append(sse("message_delta",
            "{\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":12}}"));
    sb.append(sse("message_stop", "{\"type\":\"message_stop\"}"));
    return sb.toString();
}

// event: <event>\ndata: <json>\n\n  (mirrors src/driver.ts sse()).
private static String sse(String event, String dataJson) {
    return "event: " + event + "\ndata: " + dataJson + "\n\n";
}
```

Update the JVM `handle` body line to pass the default text:

```java
resp.body = buildCannedBody(model, DEFAULT_RESPONSE_TEXT);
```

Remove the now-unused `private static final String RESPONSE_TEXT` (replaced by `DEFAULT_RESPONSE_TEXT`); keep `stubText`, `jsonBody`, `quote`, `appendUnicodeEscape`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd java && ./gradlew :stub-provider:test`
Expected: PASS — `StubProviderUnitTest` green, and `StubProviderIntegrationTest` still green (it asserts `(served by m-stub)` + `usage`, which `buildCannedBody(model, "stub response")` still satisfies).

- [ ] **Step 5: Commit**

```bash
git add java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubProvider.java java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java
git commit -m "feat(stub-provider): parameterize buildCannedBody + add buildStreamBody (SSE parity)"
```

---

### Task 2: Java model catalog — `buildModels(int count)`

**Files:**
- Modify: `java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubProvider.java`
- Modify: `java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java`

**Interfaces:**
- Produces: `static String StubProvider.buildModels(int count)` → JSON object string, keys in insertion order, matching TS `buildModels`.

- [ ] **Step 1: Write the failing test**

Add to `StubProviderUnitTest.java`:

```java
@Test
void buildModels_matchesTsShapeAndClamps() {
    assertEquals("{\"stub-model\":{\"name\":\"Stub Default\"}}", StubProvider.buildModels(1));
    assertEquals(
        "{\"stub-model\":{\"name\":\"Stub Default\"},\"stub-pro\":{\"name\":\"Stub Pro\"},\"stub-fast\":{\"name\":\"Stub Fast\"}}",
        StubProvider.buildModels(3));
    assertEquals(
        "{\"stub-model\":{\"name\":\"Stub Default\"},\"stub-pro\":{\"name\":\"Stub Pro\"},\"stub-fast\":{\"name\":\"Stub Fast\"},\"stub-4\":{\"name\":\"Stub 4\"},\"stub-5\":{\"name\":\"Stub 5\"}}",
        StubProvider.buildModels(5));
    assertEquals("{\"stub-model\":{\"name\":\"Stub Default\"}}", StubProvider.buildModels(0)); // clamp to >= 1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd java && ./gradlew :stub-provider:test --tests 'io.github.intisy.ai.stub.StubProviderUnitTest'`
Expected: FAIL — `buildModels` not found.

- [ ] **Step 3: Implement `buildModels` in `StubProvider.java`**

```java
// Ports src/driver.ts buildModels(): first three fixed names, "stub-N" beyond, clamp to >= 1.
// Hand-built JSON (no gson) so it stays TeaVM-eligible; insertion order preserved.
public static String buildModels(int count) {
    int safe = Math.max(1, count);
    StringBuilder sb = new StringBuilder("{");
    for (int i = 0; i < safe; i++) {
        if (i > 0) sb.append(",");
        String id;
        String name;
        if (i == 0) { id = "stub-model"; name = "Stub Default"; }
        else if (i == 1) { id = "stub-pro"; name = "Stub Pro"; }
        else if (i == 2) { id = "stub-fast"; name = "Stub Fast"; }
        else { id = "stub-" + (i + 1); name = "Stub " + (i + 1); }
        sb.append(quote(id)).append(":{\"name\":").append(quote(name)).append("}");
    }
    return sb.append("}").toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd java && ./gradlew :stub-provider:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubProvider.java java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java
git commit -m "feat(stub-provider): add buildModels(count) (TS catalog parity)"
```

---

### Task 3: Java `StubHandleOrchestrator` — the whole `handle` decision behind seams

**Files:**
- Create: `java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubHandleOrchestrator.java`
- Modify: `java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java`

**Interfaces:**
- Consumes: `StubProvider.buildCannedBody`, `StubProvider.buildStreamBody`; `io.github.intisy.ai.shared.spi.JsonCodec` (from `:routing`, `compileOnly`).
- Produces:
  - `interface RandomSource { double nextRandom(); }`
  - `interface Sleeper { void sleep(long ms); }` (blocking-shaped; the JS bridge makes it suspend)
  - `class RequestInputs { String bodyText; String ctxModel; }`
  - `class OrchestratorConfig { String responseText; int latencyMs; double failRate; Boolean streaming; }`
  - `class HandleDecision { int status; Map<String,String> headers; String body; }`
  - `HandleDecision handle(RequestInputs in, OrchestratorConfig cfg, RandomSource random, Sleeper sleeper)`
  - constructor `StubHandleOrchestrator(JsonCodec json)`

- [ ] **Step 1: Write the failing test**

Add to `StubProviderUnitTest.java` (uses a hand JsonCodec double — reuse the existing `TestJsonCodec` if present in the test sources; otherwise this test constructs inputs whose `bodyText` model/stream are read via that codec). Confirm `TestJsonCodec` exists at `java/stub-provider/src/test/.../TestJsonCodec.java`; if not, this task also creates a minimal one. Assume it exists per the claude/antigravity pattern.

```java
@Test
void orchestrator_json_default_usesConfigResponseText() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
    in.bodyText = "{\"model\":\"stub-pro\"}";
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "custom"; cfg.latencyMs = 0; cfg.failRate = 0; cfg.streaming = null;
    StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.9, ms -> {});
    assertEquals(200, d.status);
    assertEquals("application/json", d.headers.get("content-type"));
    assertTrue(d.body.contains("\"text\":\"custom (served by stub-pro)\""));
}

@Test
void orchestrator_streamOverride_emitsSse() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
    in.bodyText = "{}"; in.ctxModel = "stub-model";
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "x"; cfg.streaming = Boolean.TRUE;
    StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.9, ms -> {});
    assertEquals("text/event-stream", d.headers.get("content-type"));
    assertTrue(d.body.contains("event: message_stop\n"));
}

@Test
void orchestrator_failRate_returns529() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
    in.bodyText = "{}";
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "x"; cfg.failRate = 0.5;
    StubHandleOrchestrator.HandleDecision d = orch.handle(in, cfg, () -> 0.1, ms -> {}); // 0.1 < 0.5 -> fail
    assertEquals(529, d.status);
    assertTrue(d.body.contains("\"type\":\"overloaded_error\""));
    assertTrue(d.body.contains("Stub overloaded (fail_rate)"));
}

@Test
void orchestrator_latency_callsSleeper() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
    in.bodyText = "{}";
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "x"; cfg.latencyMs = 42;
    long[] slept = {-1};
    orch.handle(in, cfg, () -> 0.9, ms -> slept[0] = ms);
    assertEquals(42L, slept[0]);
}

@Test
void orchestrator_modelPrecedence_ctxThenBodyThenDefault() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "x";
    StubHandleOrchestrator.RequestInputs ctx = new StubHandleOrchestrator.RequestInputs();
    ctx.bodyText = "{\"model\":\"body-m\"}"; ctx.ctxModel = "ctx-m";
    assertTrue(orch.handle(ctx, cfg, () -> 0.9, ms -> {}).body.contains("(served by ctx-m)"));
    StubHandleOrchestrator.RequestInputs bodyOnly = new StubHandleOrchestrator.RequestInputs();
    bodyOnly.bodyText = "{\"model\":\"body-m\"}";
    assertTrue(orch.handle(bodyOnly, cfg, () -> 0.9, ms -> {}).body.contains("(served by body-m)"));
    StubHandleOrchestrator.RequestInputs none = new StubHandleOrchestrator.RequestInputs();
    none.bodyText = "{}";
    assertTrue(orch.handle(none, cfg, () -> 0.9, ms -> {}).body.contains("(served by stub-model)"));
}

@Test
void orchestrator_streamNull_honorsBodyStreamFlag() {
    StubHandleOrchestrator orch = new StubHandleOrchestrator(new TestJsonCodec());
    StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
    cfg.responseText = "x"; cfg.streaming = null;
    StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
    in.bodyText = "{\"stream\":true}";
    assertEquals("text/event-stream", orch.handle(in, cfg, () -> 0.9, ms -> {}).headers.get("content-type"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd java && ./gradlew :stub-provider:test --tests 'io.github.intisy.ai.stub.StubProviderUnitTest'`
Expected: FAIL — `StubHandleOrchestrator` does not exist.

- [ ] **Step 3: Create `StubHandleOrchestrator.java`**

```java
package io.github.intisy.ai.stub;

import io.github.intisy.ai.shared.spi.JsonCodec;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The whole stub-auth handle() decision, ported from src/driver.ts. Pure + TeaVM-eligible: the two
 * host effects (randomness for fail_rate, delay for latency) are injected as seams so both the JVM
 * unit tests and the TeaVM/JS path supply their own (Math.random / setTimeout on the JS side).
 */
public final class StubHandleOrchestrator {

    public interface RandomSource { double nextRandom(); }
    public interface Sleeper { void sleep(long ms); }

    public static final class RequestInputs { public String bodyText; public String ctxModel; }
    public static final class OrchestratorConfig {
        public String responseText;
        public int latencyMs;
        public double failRate;
        public Boolean streaming; // null = honor request stream flag; TRUE/FALSE = force
    }
    public static final class HandleDecision {
        public int status;
        public Map<String, String> headers;
        public String body;
    }

    private static final String DEFAULT_MODEL = "stub-model";

    private final JsonCodec json;

    public StubHandleOrchestrator(JsonCodec json) { this.json = json; }

    public HandleDecision handle(RequestInputs in, OrchestratorConfig cfg, RandomSource random, Sleeper sleeper) {
        Map<?, ?> body = parseObject(in != null ? in.bodyText : null);
        String model = resolveModel(in, body);

        if (cfg.failRate > 0 && random.nextRandom() < cfg.failRate) {
            return decision(529, "application/json",
                    "{\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Stub overloaded (fail_rate)\"}}");
        }

        if (cfg.latencyMs > 0) sleeper.sleep(cfg.latencyMs);

        boolean useStream = cfg.streaming != null ? cfg.streaming : truthy(body != null ? body.get("stream") : null);
        if (useStream) {
            return decision(200, "text/event-stream", StubProvider.buildStreamBody(model, cfg.responseText));
        }
        return decision(200, "application/json", StubProvider.buildCannedBody(model, cfg.responseText));
    }

    private String resolveModel(RequestInputs in, Map<?, ?> body) {
        if (in != null && in.ctxModel != null && !in.ctxModel.isEmpty()) return in.ctxModel;
        Object m = body != null ? body.get("model") : null;
        if (m instanceof String && !((String) m).isEmpty()) return (String) m;
        return DEFAULT_MODEL;
    }

    private Map<?, ?> parseObject(String text) {
        Object parsed = text != null ? json.parse(text) : null;
        return parsed instanceof Map ? (Map<?, ?>) parsed : null;
    }

    private static boolean truthy(Object v) {
        return v instanceof Boolean ? (Boolean) v : false;
    }

    private static HandleDecision decision(int status, String contentType, String body) {
        HandleDecision d = new HandleDecision();
        d.status = status;
        d.headers = new LinkedHashMap<>();
        d.headers.put("content-type", contentType);
        d.body = body;
        return d;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd java && ./gradlew :stub-provider:test`
Expected: PASS (all `StubProviderUnitTest` + `StubProviderIntegrationTest`).

- [ ] **Step 5: Commit**

```bash
git add java/stub-provider/src/main/java/io/github/intisy/ai/stub/StubHandleOrchestrator.java java/stub-provider/src/test/java/io/github/intisy/ai/stub/StubProviderUnitTest.java
git commit -m "feat(stub-provider): StubHandleOrchestrator owns the handle decision behind random/sleep seams"
```

---

### Task 4: TeaVM export — `handleStubRequestAsync` + `buildModelsJson` + seam bridges

**Files:**
- Create: `java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubSeamBridges.java`
- Modify: `java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubProviderJs.java`

**Interfaces:**
- Produces (JS exports): `handleStubRequestAsync(inputsJson, configJson, jsRandom, jsSleep): Promise<string>` and `buildModelsJson(count): string`.
  - `jsRandom`: JS `() => number`; `jsSleep`: JS `(ms) => Promise<void>`.
  - decision JSON shape: `{status:number, headers:{[k]:string}, body:string}`.
- Consumes: `StubHandleOrchestrator`, `StubProvider.buildModels`, `SimpleJsonCodec` (from `:teavm`).

- [ ] **Step 1: Create `StubSeamBridges.java`**

```java
package io.github.intisy.ai.js;

import io.github.intisy.ai.stub.StubHandleOrchestrator;

import org.teavm.interop.Async;
import org.teavm.interop.AsyncCallback;
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;
import org.teavm.jso.core.JSPromise;

/**
 * The two host seams the stub orchestrator needs, bridged to JS. jsRandom is synchronous
 * (Math.random); jsSleep is async (setTimeout) and uses TeaVM's @Async native mechanism exactly
 * like claude's JsAttemptExecutorBridge, so a blocking-looking Sleeper.sleep() suspends the whole
 * CPS-transformed call graph and resumes when the JS timer resolves.
 */
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
        return ms -> awaitSleep(fn, (int) ms); // suspends here; resumes on the JS Promise
    }

    @Async
    private static native void awaitSleep(JsSleepFn fn, int ms);

    private static void awaitSleep(JsSleepFn fn, int ms, AsyncCallback<Void> callback) {
        fn.sleep(ms).then(
                value -> { callback.complete(null); return null; },
                error -> { callback.error(new RuntimeException("sleep rejected: " + error)); return null; });
    }
}
```

- [ ] **Step 2: Rewrite `StubProviderJs.java`**

```java
package io.github.intisy.ai.js;

import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.stub.StubHandleOrchestrator;
import io.github.intisy.ai.stub.StubProvider;

import org.teavm.jso.JSExport;
import org.teavm.jso.core.JSPromise;
import org.teavm.jso.core.JSString;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * TeaVM JS export surface over stub-auth's Java provider. The live TS driver calls
 * handleStubRequestAsync (host supplies Math.random + setTimeout seams) and buildModelsJson —
 * one Java implementation, compiled twice (javac for the :stub-provider jar, TeaVM for this module).
 */
public final class StubProviderJs {
    private StubProviderJs() {}

    @JSExport
    public static String buildModelsJson(int count) {
        return StubProvider.buildModels(count);
    }

    @JSExport
    public static JSPromise<JSString> handleStubRequestAsync(
            String inputsJson, String configJson,
            StubSeamBridges.JsRandomFn jsRandom, StubSeamBridges.JsSleepFn jsSleep) {
        return new JSPromise<>((resolve, reject) -> new Thread(() -> {
            try {
                JsonCodec json = new SimpleJsonCodec();
                StubHandleOrchestrator orch = new StubHandleOrchestrator(json);
                StubHandleOrchestrator.RequestInputs in = parseInputs(json, inputsJson);
                StubHandleOrchestrator.OrchestratorConfig cfg = parseConfig(json, configJson);
                StubHandleOrchestrator.HandleDecision d = orch.handle(
                        in, cfg, StubSeamBridges.randomSource(jsRandom), StubSeamBridges.sleeper(jsSleep));
                resolve.accept(JSString.valueOf(decisionToJson(json, d)));
            } catch (Throwable e) {
                reject.accept(JSString.valueOf("handleStubRequestAsync failed: " + e));
            }
        }).start());
    }

    private static StubHandleOrchestrator.RequestInputs parseInputs(JsonCodec json, String inputsJson) {
        StubHandleOrchestrator.RequestInputs in = new StubHandleOrchestrator.RequestInputs();
        Object parsed = inputsJson != null ? json.parse(inputsJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            in.bodyText = asString(m.get("bodyText"));
            in.ctxModel = asString(m.get("ctxModel"));
        }
        return in;
    }

    private static StubHandleOrchestrator.OrchestratorConfig parseConfig(JsonCodec json, String configJson) {
        StubHandleOrchestrator.OrchestratorConfig cfg = new StubHandleOrchestrator.OrchestratorConfig();
        cfg.responseText = "Hello from stub-auth — the core-auth pipeline works end to end.";
        Object parsed = configJson != null ? json.parse(configJson) : null;
        if (parsed instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) parsed;
            Object rt = m.get("responseText");
            if (rt instanceof String) cfg.responseText = (String) rt;
            Object lat = m.get("latencyMs");
            if (lat instanceof Number) cfg.latencyMs = ((Number) lat).intValue();
            Object fr = m.get("failRate");
            if (fr instanceof Number) cfg.failRate = ((Number) fr).doubleValue();
            Object st = m.get("streaming");
            if (st instanceof Boolean) cfg.streaming = (Boolean) st; // absent/null -> honor request flag
        }
        return cfg;
    }

    private static String decisionToJson(JsonCodec json, StubHandleOrchestrator.HandleDecision d) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", d.status);
        out.put("headers", d.headers);
        out.put("body", d.body);
        return json.stringify(out);
    }

    private static String asString(Object o) { return o instanceof String ? (String) o : null; }
}
```

- [ ] **Step 3: Verify TeaVM transpiles**

Run: `cd java && ./gradlew :stub-teavm:generateJavaScript`
Expected: BUILD SUCCESSFUL — emits `java/stub-teavm/build/generated/teavm/js/stub-provider.js`. (If it fails on an unsupported API, the orchestrator/bridge used something non-transpilable — fix by staying within String/Map/StringBuilder + the JsonCodec SPI.)

- [ ] **Step 4: Commit**

```bash
git add java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubSeamBridges.java java/stub-teavm/src/main/java/io/github/intisy/ai/js/StubProviderJs.java
git commit -m "feat(stub-teavm): async handleStubRequestAsync + buildModelsJson exports with random/sleep seams"
```

---

### Task 5: TS lazy loader + build-time model seed

**Files:**
- Modify: `src/javaProvider.ts`
- Modify: `package.json` (build script emits the model seed)
- Create (generated, gitignored): `src/generated/stub-models.json`

**Interfaces:**
- Produces:
  - `async function loadStubOrchestrator(): Promise<{ handleStubRequestAsync, buildModelsJson }>` (memoized).
  - `async function handleViaOrchestrator(inputsJson: string, configJson: string, jsRandom: () => number, jsSleep: (ms: number) => Promise<void>): Promise<{status:number, headers:Record<string,string>, body:string}>`.
  - `async function buildModelsViaJava(count: number): Promise<Record<string, { name: string }>>`.
- Consumes: `src/generated/stub-provider.teavm.js` (its `handleStubRequestAsync`, `buildModelsJson`).

- [ ] **Step 1: Rewrite `src/javaProvider.ts`**

```typescript
// @ts-nocheck
// Lazy, memoized bridge to the TeaVM-compiled Java provider. The ~500KB generated ESM is imported
// only on first real use (first request or first model-catalog refresh), never at plugin
// registration, so quick launches (config/accounts/readme/CLI) never evaluate it — no startup cost.

let orchestratorPromise = null;
function loadStubOrchestrator() {
  if (!orchestratorPromise) orchestratorPromise = import("./generated/stub-provider.teavm.js");
  return orchestratorPromise;
}

export async function handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep) {
  const { handleStubRequestAsync } = await loadStubOrchestrator();
  const decisionJson = await handleStubRequestAsync(inputsJson, configJson, jsRandom, jsSleep);
  return JSON.parse(decisionJson);
}

export async function buildModelsViaJava(count) {
  const { buildModelsJson } = await loadStubOrchestrator();
  return JSON.parse(buildModelsJson(count));
}
```

- [ ] **Step 2: Add the seed-generation build step to `package.json`**

Append (after the esbuild of `javaProvider.ts`, before `postbuild`) a step that runs the generated module once to write the default-count seed the synchronous `driver.models` imports. Change the `build` script's tail from `... --outfile=dist/javaProvider.js"` to also emit the seed:

```
&& node -e "import('./src/generated/stub-provider.teavm.js').then(m => require('fs').writeFileSync('src/generated/stub-models.json', m.buildModelsJson(3)))"
```

(Default count 3 matches `defineConfig`'s `model_count: 3`. Runtime overrides are handled by `fetchModels` in Task 8.)

- [ ] **Step 3: Build and verify the seed + bundle exist**

Run: `npm run build`
Expected: `src/generated/stub-provider.teavm.js` regenerated, `src/generated/stub-models.json` written (`{"stub-model":{"name":"Stub Default"},"stub-pro":{"name":"Stub Pro"},"stub-fast":{"name":"Stub Fast"}}`), `dist/index.js`/`dist/handler.js`/`dist/javaProvider.js` emitted, no errors.

- [ ] **Step 4: Confirm generated files are gitignored**

Run: `git check-ignore src/generated/stub-provider.teavm.js src/generated/stub-models.json`
Expected: both paths printed (already ignored). If `stub-models.json` is not ignored, add `src/generated/` coverage to `.gitignore` and commit that.

- [ ] **Step 5: Commit**

```bash
git add src/javaProvider.ts package.json .gitignore
git commit -m "feat(stub): lazy-memoized TeaVM loader + build-time model-catalog seed"
```

---

### Task 6: Wire the live `handle()` to the orchestrator (TS logic kept for parity proof)

**Files:**
- Modify: `src/driver.ts`
- Modify: `src/__tests__/javaProvider.smoke.test.ts`

**Interfaces:**
- Consumes: `handleViaOrchestrator` from `src/javaProvider.ts`.
- Produces: `driver.handle` now delegates to the Java orchestrator; a private `handleViaTs(request, ctx)` retains the OLD TS logic **only** for the parity test (deleted in Task 8).

- [ ] **Step 1: Write the failing parity test**

Rewrite `src/__tests__/javaProvider.smoke.test.ts` to assert the orchestrator output equals the retained TS baseline across the matrix. It imports the built `dist/driver.js`'s exported `handleViaTs` and the live `handle`:

```typescript
import { describe, it, expect } from "vitest";
// @ts-ignore build artifact
import { driver, handleViaTs } from "../../dist/driver.js";

const req = (body) => new Request("https://x/v1/messages", { method: "POST", body: JSON.stringify(body) });

async function bodyOf(res) { return { status: res.status, ct: res.headers.get("content-type"), text: await res.text() }; }

describe("stub Java orchestrator == TS baseline (parity)", () => {
  for (const stream of [false, true]) {
    it(`json/stream=${stream} default text match`, async () => {
      const a = await bodyOf(await driver.handle(req({ model: "stub-pro", stream }), {}));
      const b = await bodyOf(handleViaTs(req({ model: "stub-pro", stream }), {}) instanceof Promise
        ? await handleViaTs(req({ model: "stub-pro", stream }), {}) : handleViaTs(req({ model: "stub-pro", stream }), {}));
      expect(a.status).toBe(b.status);
      expect(a.ct).toBe(b.ct);
      expect(a.text).toBe(b.text);
    });
  }

  it("buildModels via Java matches seed for n=3", async () => {
    const { buildModelsViaJava } = await import("../../dist/javaProvider.js");
    expect(await buildModelsViaJava(3)).toEqual({
      "stub-model": { name: "Stub Default" }, "stub-pro": { name: "Stub Pro" }, "stub-fast": { name: "Stub Fast" },
    });
  });
});
```

> Note: `handle` reads `response_text` from config; the test runs in an isolated home so config = registered defaults, making the Java `responseText` default equal the TS default — the texts match. Latency/fail_rate default to 0, so timing/random seams are inert here (dedicated seam behavior is covered by the JVM tests in Task 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run src/__tests__/javaProvider.smoke.test.ts`
Expected: FAIL — `driver.handle` still uses TS; `handleViaTs` not exported yet.

- [ ] **Step 3: Rewrite `handle` in `src/driver.ts`**

Rename the current `async handle(...)` body into an exported `handleViaTs` (unchanged logic, kept only for the parity test), and make the live `handle` delegate to the orchestrator:

```typescript
import { handleViaOrchestrator } from "./javaProvider.js";

// Retained ONLY for the parity smoke test (deleted in the de-dup task once verified live).
export async function handleViaTs(request, ctx) {
  /* ...exact current handle() body... */
}

async function handle(request, ctx) {
  let bodyText;
  try { bodyText = await request.clone().text(); } catch { bodyText = ""; }
  const cfg = defineConfig("stub-auth", {});
  const inputsJson = JSON.stringify({ bodyText: bodyText ?? "", ctxModel: (ctx && ctx.model) || "" });
  const configJson = JSON.stringify({
    responseText: typeof cfg.response_text === "string" ? cfg.response_text : undefined,
    latencyMs: typeof cfg.latency_ms === "number" ? cfg.latency_ms : 0,
    failRate: typeof cfg.fail_rate === "number" ? cfg.fail_rate : 0,
    streaming: (cfg.streaming === true || cfg.streaming === false) ? cfg.streaming : null,
  });
  const jsRandom = () => Math.random();
  const jsSleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const decision = await handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep);
  return new Response(decision.body, { status: decision.status, headers: decision.headers });
}
```

Wire `handle` into the `driver` object (replace the inline `async handle` property with `handle`). Keep `jsonBody`/`streamBody`/`sse`/`stubText`/`buildModels` in the file (used by `handleViaTs`) until Task 8.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npx vitest run`
Expected: PASS — parity + contract tests green.

- [ ] **Step 5: Commit**

```bash
git add src/driver.ts src/__tests__/javaProvider.smoke.test.ts
git commit -m "feat(stub): route live handle() through the Java orchestrator (TS retained for parity proof)"
```

---

### Task 7: Live verification (GATE — no deletion before this passes)

**Files:** none (manual verification; record results in the PR/commit message).

- [ ] **Step 1: Build and deploy the plugin to a live app**

Run: `npm run build`, then deploy the built `dist/` per the deployed-clone recipe (rebuild the clone under `~/.claude/repos/stub-auth` or the agentbox equivalent: submodule update → npm install → npm run build). Confirm the running code is the new bundle (not a stale one).

- [ ] **Step 2: Exercise the live path in OpenCode**

Select the Stub provider, send a chat. Expected: a normal reply (JSON path). Set `streaming: true` in `config/stub-auth.json`, restart, send again. Expected: streamed reply. Set `latency_ms: 1500`, confirm the delay. Set `fail_rate: 1`, confirm a 529 overloaded error surfaces. Reset config.

- [ ] **Step 3: Exercise the live path in Claude Code**

Same matrix via `cc` (the `handler.ts` entry). Confirm `response_text` edits take effect.

- [ ] **Step 4: Record the verification result**

Write a one-line confirmation (app versions, what was exercised, outcome) to append to the Task 8 commit body. If ANY case fails, STOP — fix the Java/orchestrator (do not delete TS) and re-run Task 6's tests + this task.

---

### Task 8: Delete the duplicated TS logic + Java-backed model catalog

**Files:**
- Modify: `src/driver.ts`
- Modify: `src/__tests__/javaProvider.smoke.test.ts`

**Interfaces:**
- Removes: `handleViaTs`, `jsonBody`, `streamBody`, `sse`, `stubText`, `buildModels` from `src/driver.ts`.
- Produces: `driver.models` from the build-time seed JSON; `driver.fetchModels` (async) via `buildModelsViaJava(config.model_count)`.

- [ ] **Step 1: Point the parity test at a captured baseline, then flip it to a regression guard**

Before deleting `handleViaTs`, capture its outputs as fixtures so the test still guards the Java output after deletion. Rewrite `javaProvider.smoke.test.ts` to assert `driver.handle` produces the exact expected strings (copy the concrete expected JSON + SSE text from a `handleViaTs` run — the body for `{model:"stub-pro"}` default text and the SSE for `{model:"stub-pro",stream:true}`). This removes the `handleViaTs` dependency.

```typescript
import { describe, it, expect } from "vitest";
// @ts-ignore build artifact
import { driver } from "../../dist/driver.js";

const req = (body) => new Request("https://x/v1/messages", { method: "POST", body: JSON.stringify(body) });

describe("stub Java orchestrator (regression fixtures)", () => {
  it("json default", async () => {
    const res = await driver.handle(req({ model: "stub-pro" }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const b = JSON.parse(await res.text());
    expect(b.id).toBe("msg_stub_0001");
    expect(b.model).toBe("stub-pro");
    expect(b.content[0].text).toBe("Hello from stub-auth — the core-auth pipeline works end to end. (served by stub-pro)");
    expect(b.usage).toEqual({ input_tokens: 1, output_tokens: 12 });
  });
  it("stream", async () => {
    const res = await driver.handle(req({ model: "stub-pro", stream: true }), {});
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const t = await res.text();
    expect(t).toContain("event: message_start\n");
    expect(t).toContain("event: message_stop\n");
    expect(t.endsWith("\n\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Delete the TS logic + wire the Java model catalog in `src/driver.ts`**

Remove `handleViaTs`, `jsonBody`, `streamBody`, `sse`, `stubText`, and `buildModels`. Replace the models wiring:

```typescript
import stubModelsSeed from "./generated/stub-models.json";  // build-time Java seed (default count)
import { handleViaOrchestrator, buildModelsViaJava } from "./javaProvider.js";

// ...inside `driver`:
  models: stubModelsSeed,   // synchronous seed (Java-generated at build); no TeaVM load at startup
  async fetchModels() {
    const cfg = defineConfig("stub-auth", {});
    const count = typeof cfg.model_count === "number" ? cfg.model_count : 3;
    try { return { models: await buildModelsViaJava(count) }; } catch { return null; }
  },
```

Remove the now-unused `initialCfg`/`initialModelCount` lines. (esbuild bundles the JSON import; add `"resolveJsonModule": true` to `core-auth/tsconfig.json`'s compilerOptions if tsc complains — verify in Step 4.)

> Behavior note (deliberate, documented in the spec's Performance section): the synchronous `driver.models` seed reflects the default count (3); a configured `model_count` is applied via the async `fetchModels` refresh rather than at module load. This preserves the no-startup-load discipline; the model list is a demo knob.

- [ ] **Step 3: Run tests**

Run: `npm run build && npx vitest run`
Expected: PASS — regression fixtures + contract tests green; no reference to deleted symbols.

- [ ] **Step 4: Re-verify live (smoke)**

Rebuild+redeploy; send one JSON and one streamed chat in `oc` (or `cc`). Expected: identical behavior to Task 7. This confirms the deletion didn't regress the live path.

- [ ] **Step 5: Commit**

```bash
git add src/driver.ts src/__tests__/javaProvider.smoke.test.ts core-auth/tsconfig.json
git commit -m "refactor(stub): delete duplicated TS logic — Java is the single source (handle + model catalog)

Live-verified: <one-line result from Task 7>."
```

---

### Task 9: Reconcile submodule, migrate branch, republish

**Files:**
- Modify: `core-auth` gitlink (submodule pointer)
- Modify: branch (`master` → `main`), `.github/workflows/*` if they reference `master`

> **User-gated:** Steps 3–5 (default-branch rename + push + release tag) require explicit user OK per Global Constraints. Do Steps 1–2 locally; pause for confirmation before 3–5.

- [ ] **Step 1: Advance the `core-auth` submodule to the `main` java-bearing tip**

```bash
cd core-auth && git fetch origin && git checkout 098ecef51e21483863a9836e9e15f917669aea6a && cd ..
git add core-auth
git commit -m "chore(stub): advance core-auth submodule fd30a7d -> main (098ecef, strictly additive)"
```

Run: `npm run build && npx vitest run`
Expected: PASS (the bump is additive — adds the Java accounts/oauth module + LiveStore/lock fixes; TS bundle unaffected).

- [ ] **Step 2: Confirm `.gitmodules` branch tracking**

Ensure `.gitmodules` `[submodule "core-auth"]` has `branch = main` (add it if missing) so future `submodule update --remote` tracks the java-bearing line. Commit if changed:

```bash
git add .gitmodules && git commit -m "chore(stub): track core-auth main branch"
```

- [ ] **Step 3 (user-gated): Migrate the default branch `master` → `main`**

Rename on GitHub (non-destructive) via the repo settings/`gh`, update the local tracking branch, and repoint any workflow that references `master` (e.g. `sync-experimental-to-main`). Match the claude/antigravity layout (`main` + optional `experimental`). Verify `.github/workflows/publish.yml` triggers on `v*` tags (unchanged) and the sync workflow targets `main`.

- [ ] **Step 4 (user-gated): Push**

Push `main` (and `experimental` if created). Confirm CI green.

- [ ] **Step 5 (user-gated): Republish `v1.4.0` (npm + jar)**

Tag `v1.4.0` → the unified `publish.yml` publishes the npm plugin and the `stub-auth-provider.jar` asset on the same release. Verify both landed (`npm view stub-auth version`, GitHub release asset present). Timing (now vs. batched after claude/antigravity) is the user's call.

---

## Self-Review

**1. Spec coverage:**
- Goal (Java single source, delete TS, no perf loss) → Tasks 1–8. ✓
- Target architecture (buildCannedBody(model,responseText), buildStreamBody, buildModels, StubHandleOrchestrator + jsRandom/jsSleep seams) → Tasks 1–4. ✓
- Performance (lazy memoized load; seed at build; note on catalog trade) → Task 5, Task 8 Step 2 note. ✓
- Testing (parity matrix, contract, JVM unit, live verify) → Tasks 3/6/7/8. ✓
- Submodule/branch/republish → Task 9. ✓
- Recipe generalization → captured in spec; noted where stub differs (no flag; models is stub-specific). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. The one `/* ...exact current handle() body... */` in Task 6 Step 3 is an explicit "move this existing block verbatim" instruction, not a placeholder — the block is the current `src/driver.ts` `handle` already in the repo.

**3. Type consistency:** `handleStubRequestAsync(inputsJson, configJson, jsRandom, jsSleep)` and `buildModelsJson(count)` names match across Task 4 (Java export), Task 5 (`javaProvider.ts`), and Task 6/8 (driver). Config keys `responseText`/`latencyMs`/`failRate`/`streaming` match between the TS `configJson` (Task 6) and Java `parseConfig` (Task 4). Decision shape `{status,headers,body}` matches Task 4 `decisionToJson` and Task 5 `handleViaOrchestrator`. ✓
