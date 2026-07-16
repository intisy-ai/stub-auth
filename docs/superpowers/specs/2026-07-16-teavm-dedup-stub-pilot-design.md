# TeaVM De-duplication — stub-auth Pilot (Design)

**Date:** 2026-07-16
**Status:** Approved for planning
**Sub-project of:** Part B — "There should NEVER be Java and TypeScript code doing the same thing."

## Goal

Establish a single source of truth for stub-auth's provider logic: the **Java**
code, transpiled via TeaVM to JavaScript for the plugin and compiled to a jar for
the JVM server. The same logic must be **completely usable from both Java and
TypeScript with no performance loss**, and the duplicated TypeScript logic must be
**deleted** once the Java path is verified live.

stub-auth is the **pilot**: the smallest, lowest-risk provider (already half-ported,
with an existing JVM↔JS↔TS parity smoke test). Executing it end to end produces a
proven, repeatable **migration recipe** that then applies to `claude-code-auth` and
`antigravity-auth`.

## Background & current state (audit)

- **Live path is TypeScript.** `src/driver.ts` `handle()` owns the real canned-response
  logic (`jsonBody`/`streamBody`/`sse`/`stubText`) and the model catalog (`buildModels`).
- **Java is a partial, additive port.** `java/stub-provider` `StubProvider.buildCannedBody`
  covers only the non-streaming JSON body and **hardcodes** `RESPONSE_TEXT = "stub response"`.
  It has **no streaming branch**, does not honor `response_text`/`latency_ms`/`fail_rate`/
  `streaming` config, and has no `buildModels`. `src/javaProvider.ts` bridges the TeaVM export
  (`StubProviderJs.handle`) but is wired **only** into `src/__tests__/javaProvider.smoke.test.ts`,
  never into the live `handle()`. Unlike claude/antigravity, stub has **no `use_java_orchestrator`
  flag**.
- **Consequence:** wiring the current Java in and deleting the TS would **regress** stub
  (lose config-driven text, streaming, and the model catalog). The Java must first reach full
  behavioral parity.
- **Submodules** (identical across all three providers): `core` `ecbecf3`, `core-auth` `fd30a7d`
  (on the old `master` line, **contains no Java**), `core-proxy` `3b0ae4e`. ai-java pins
  `core-auth` at `098ecef` on `main` (the java-bearing line). `fd30a7d` is a **direct ancestor**
  of `098ecef` — advancing is strictly additive (adds the Java accounts/oauth module + LiveStore/
  lock fixes, loses nothing).
- **Branch:** stub-auth is on `master`; claude/antigravity are on `experimental` (+`main`).
- **Provider Java gets shared classes** (`AccountManager`/`AccountStore`) from the published
  `intisy-ai:ai-java:…:standalone` jar (`githubCompileOnly`), **not** from the nested `core-auth`
  submodule. The submodule only feeds the **TS** bundle.

## Target architecture

"**Java owns everything (incl. timing/random) via injected host seams; TypeScript owns only
un-portable I/O.**" This mirrors the claude/antigravity async-orchestrator + seam pattern.

### Java (single source of truth)

`:stub-provider` (pure, dependency-free, TeaVM-eligible) — extended:

- `buildCannedBody(String model, String responseText)` — **takes** `responseText` (drop the
  hardcoded literal). Existing key order/values unchanged.
- `buildStreamBody(String model, String responseText)` — **new.** Ports TS `streamBody`/`sse`:
  the six SSE events (`message_start`, `content_block_start`, `content_block_delta`,
  `content_block_stop`, `message_delta`, `message_stop`) byte-for-byte.
- `buildModels(int count)` → JSON string — **new.** Ports TS `buildModels`: first three names
  (`stub-model`/`stub-pro`/`stub-fast`), `stub-N` beyond, clamped to `>= 1`.
- `StubHandleOrchestrator.handleStubRequestAsync(String inputsJson, String configJson, jsRandom,
  jsSleep)` → decision JSON — **new.** Owns the whole `handle` decision:
  1. resolve `model` (`ctx.model` → body `model` → `"stub-model"`);
  2. `fail_rate`: if `failRate > 0 && jsRandom() < failRate` → return a `529` overloaded-error
     decision (matching the TS error body exactly);
  3. `latency_ms`: if `> 0`, `await jsSleep(latencyMs)`;
  4. streaming choice: `streaming` config `null`/absent → honor request `stream` flag;
     `true`/`false` → force;
  5. build body via `buildStreamBody`/`buildCannedBody`;
  6. return decision JSON `{status, headers, body}`.

`:stub-teavm` — `StubProviderJs` extended to `@JSExport` `handleStubRequestAsync` and a
`buildModelsJson(int)` (or equivalent) surface. `StubProvider.handle` (JVM `Provider` SPI) is
updated to call the same shared methods so the jar and the JS stay one implementation.

### TypeScript (host shell — un-portable I/O only)

`src/driver.ts`:

- `handle(request, ctx)`: assemble `inputsJson` (request body text, `ctx.model`, request `stream`
  flag) and `configJson` (from `defineConfig("stub-auth", {})`: `response_text`, `latency_ms`,
  `fail_rate`, `streaming`); pass seams `jsRandom = () => Math.random()` and
  `jsSleep = (ms) => new Promise(r => setTimeout(r, ms))`; `await handleStubRequestAsync(...)`;
  wrap the returned decision in a `Response`.
- `driver.models`: resolved from Java `buildModels(count)` via a **memoized lazy** TeaVM load on
  first access (see Performance), not at registration.
- **Unchanged:** `AccountManager`, `stubAddAccount`, `login`/`loginFlow`, `settings`, config
  plumbing, `src/index.ts` (opencode entry), `src/handler.ts` (claude entry), `src/commands.ts`.
- **Deleted (now in Java):** `jsonBody`, `streamBody`, `sse`, `stubText`, `buildModels`.

### Performance (no startup loss)

The TeaVM bundle (~500 KB) is **loaded lazily and memoized on first real use** (first `handle`
call or first `driver.models` access) — never at plugin registration. Quick launches (`config`,
`accounts`, `readme`, CLI) never evaluate TeaVM, so there is **no startup regression**; a serving
process pays a one-time init once. This is the same deferral discipline `javaHandle.ts` already
uses for claude/antigravity, extended to the model catalog.

> Implementation note for the plan: confirm exactly when core-auth's `defineProvider`/catalog
> first reads `driver.models`, and place the lazy trigger at that seam (e.g. a getter or an
> explicit warm call on first `handle`/menu) so registration itself never forces the load.

## The migration recipe (generalizes to claude & antigravity)

1. **Parity audit** — enumerate every behavior the live TS produces vs. what the Java port covers;
   list the gaps.
2. **Close the gaps in Java (TDD)** until Java ≡ TS behaviorally; JVM unit tests per method.
3. **Export via TeaVM** — extend the `:*-teavm` `@JSExport` surface; `npm run build` regenerates
   `src/generated/*.teavm.js`.
4. **Wire Java into the live path** — TS host shell reads config + does I/O and passes inputs
   into Java (seams for random/sleep/fetch/etc.); Java returns the body/decision.
5. **Verify live** (both `cc` + `oc`) **before deleting anything.**
6. **Delete the now-duplicated TS logic** — keep only the un-portable host shell.
7. **Reconcile** `core-auth` submodule (advance to `main`), **migrate branch** (`master`→`main`),
   **republish** on the unified `v*` lineage. Re-verify live after deletion.

For claude/antigravity, step 4 additionally **flips `use_java_orchestrator` on by default**, and
step 6 **removes the flag entirely** (nothing left to toggle to once the TS logic is gone).

## Testing

- **Parity smoke test** (extend `src/__tests__/javaProvider.smoke.test.ts`): assert Java
  `handleStubRequestAsync` output equals the pre-migration TS output across the matrix
  {json, stream} × {default text, custom `response_text`} × {`fail_rate` 0 and 1, with a stubbed
  `jsRandom`} × {`latency_ms` 0, with a stubbed `jsSleep`}. Assert `buildModels(n)` matches the TS
  `buildModels(n)` for n ∈ {1, 3, 5}.
- **Contract test** (`src/__tests__/contract.test.ts`) stays green (config round-trip, command
  deploy, `accounts` action).
- **JVM tests** (`java/stub-provider` test module) cover each new/extended Java method directly.
- **Live verification:** build → deploy → real `oc` and `cc` chat through stub; confirm JSON +
  streaming replies and that `response_text`/`latency_ms`/`fail_rate` config all take effect.
  Only after this passes do we delete the TS logic (step 6), then re-verify live.

## Submodule, branch, and republish

- **core-auth submodule:** advance the gitlink from `fd30a7d` to the tip of `main` (`098ecef`,
  verified strictly additive); commit the bump.
- **Branch:** migrate stub-auth `master` → `main` (non-destructive GitHub rename, per the
  ecosystem branch convention); repoint `publish.yml` / `sync-experimental-to-main` as needed.
- **Republish:** one `v*` tag (stub `v1.4.0`) → the unified workflow publishes the npm plugin
  **and** the provider jar. Timing (per-provider vs. batched after all three) decided at
  republish time.

## Non-goals

- Migrating claude-code-auth or antigravity-auth (separate sub-projects that reuse this recipe).
- Changing the provider's observable behavior, config schema, account model, or public API.
- The provider-management dashboard UI features (separate sub-project).

## Constraints (carried from the ecosystem rules)

- All plugin source is TypeScript; compiled output to `dist/` (never committed).
- Never override git identity; Conventional Commits; default-branch pushes need user OK.
- Commit **and** push `experimental`/working branch together (local == remote).
- No hardcoded secrets. Prefer few comments (non-obvious only).
- Never delete existing code without confirmation — here, the TS deletion (step 6) is the
  explicitly approved goal, gated behind live verification (step 5).
