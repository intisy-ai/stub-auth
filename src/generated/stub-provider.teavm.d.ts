// Generated from Java sources. Do not edit.

/**
 * The models this provider advertises.
 *
 * @param count - how many stub models to build
 * @returns the models as a JSON object, keyed by model id
 */
export declare function buildModelsJson(count: number): string;
/**
 * Runs one request through the orchestrator, which owns every decision it makes.
 *
 * @param inputsJson - the request's model and the handler context's, as a JSON object
 * @param configJson - the response text, latency, failure rate and streaming override, as a JSON
 * object
 * @param jsRandom - the host's random source, so the failure roll is the host's to seed
 * @param jsSleep - the host's timer, because transpiled Java has no way to wait
 * @returns the status, headers and body as a JSON object, the body being canonical IR
 */
export declare function handleStubRequestAsync(inputsJson: string, configJson: string, jsRandom: (() => number), jsSleep: ((value: number) => Promise<void>)): Promise<string>;

