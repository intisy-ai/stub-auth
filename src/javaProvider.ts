// @ts-nocheck
// Additive bridge to the TeaVM-compiled Java provider (Phase 4 Task 5 — the js half of the
// shared-Java model; T4 already proved the JVM/ServiceLoader half). `src/generated/*` is staged
// by `tools/teavm-build` from `java/stub-teavm`'s `generateJavaScript` output as part of
// `npm run build` (see package.json) — never hand-written, never committed (.gitignore).
//
// Purely additive: driver.ts's own TS logic is untouched. This module exists so a node smoke
// test can call the SAME Java method (`StubProvider.buildCannedBody`, via the TeaVM-exported
// `StubProviderJs.handle`) that both the JVM provider jar (T4) and this TS driver's canned
// response mirror, proving JVM<->JS<->TS parity end to end.
import { handle as handleViaJavaProvider } from "./generated/stub-provider.teavm.js";

export { handleViaJavaProvider };
