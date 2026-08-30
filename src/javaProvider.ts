import type { ProviderModel } from "@intisy-ai/basekit/auth";
import * as stub from "./generated/stub-provider.teavm.js";

/**
 * The seam onto this provider's transpiled Java, which owns every decision it makes.
 *
 * @remarks
 * Statically imported rather than loaded on demand, because the bundle is inlined into each
 * deployed entry anyway, so deferring it saves no bytes; and because the advertised model list has
 * to be built while the driver object is, which a promise cannot do.
 */

/** What the orchestrator decided: a transport outcome plus a canonical-IR body. */
export interface HandleDecision {
  /** The HTTP status, 200 unless the failure roll came up. */
  status: number;
  /** The headers to carry through. */
  headers: Record<string, string>;
  /** The response body, which is canonical IR as JSON when the status is 200. */
  body: string;
}

const randomSource = (): number => Math.random();
const sleeper = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Runs one request through the orchestrator.
 *
 * @param inputsJson - the request's model and the handler context's, as a JSON object
 * @param configJson - the response text, latency, failure rate and streaming override, as JSON
 * @returns what the orchestrator decided
 */
export async function handleViaOrchestrator(inputsJson: string, configJson: string): Promise<HandleDecision> {
  return JSON.parse(
    await stub.handleStubRequestAsync(inputsJson, configJson, randomSource, sleeper),
  ) as HandleDecision;
}

/**
 * The models this provider advertises.
 *
 * @param count - how many stub models to build
 * @returns the models, keyed by model id
 */
export function buildModels(count: number): Record<string, ProviderModel> {
  return JSON.parse(stub.buildModelsJson(count)) as Record<string, ProviderModel>;
}
