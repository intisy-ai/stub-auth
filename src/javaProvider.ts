// @ts-nocheck
// Lazy, memoized bridge to the TeaVM-compiled Java provider. The generated ESM is imported only
// on first use, never at plugin registration, so quick launches never evaluate it.

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
