// @ts-nocheck
// Lazy, memoized bridge to the TeaVM-compiled Java provider. The generated ESM is imported only
// on first use, never at plugin registration, so quick launches never evaluate it.

import { lazyModule } from "@intisy-ai/core-auth";

const stubOrchestrator = lazyModule(() => import("./generated/stub-provider.teavm.js"));

export async function handleViaOrchestrator(inputsJson, configJson, jsRandom, jsSleep) {
  const { handleStubRequestAsync } = await stubOrchestrator.load();
  const decisionJson = await handleStubRequestAsync(inputsJson, configJson, jsRandom, jsSleep);
  return JSON.parse(decisionJson);
}

export async function buildModelsViaJava(count) {
  const { buildModelsJson } = await stubOrchestrator.load();
  return JSON.parse(buildModelsJson(count));
}
