import { describe, expect, it, vi } from "vitest";
import { providerSupport } from "@intisy-ai/core-auth";
import plugin from "./plugin.js";

// The host's own service, which is where the provider helpers come from now. A test supplies the
// real one, so what it exercises is what a loader hands over rather than a stand-in for it.
function contextSpy(services: Record<string, unknown> = { "provider-support": providerSupport() }) {
  const provided: Record<string, unknown> = {};
  return {
    provided,
    context: {
      // Keyed by id, not by the argument, because a typed key is an object and the host records the id.
      provide: vi.fn((key: string | { id: string }, implementation: unknown) => {
        provided[typeof key === "string" ? key : key.id] = implementation;
      }),
      paths: { home: "/tmp/home" },
      // The engine mints a typed key from an id alone, which is all the plugin needs from it here.
      capability: (id: string) => ({ id }),
      service: (id: string) => ({ id }),
      services: { get: (key: { id: string }) => services[key.id] },
    },
  };
}

describe("the stub-auth api plugin", () => {
  it("provides exactly the capabilities its manifest declares", async () => {
    const { context, provided } = contextSpy();
    await plugin.activate(context as never);
    expect(Object.keys(provided).sort()).toEqual(["provider", "settings"]);
  });

  it("names the driver's own provider id", async () => {
    const { context, provided } = contextSpy();
    await plugin.activate(context as never);
    expect((provided.provider as { id: string }).id).toBe("stub");
  });

  it("advertises exactly one lane", async () => {
    const { context, provided } = contextSpy();
    await plugin.activate(context as never);
    const lanes = await (provided.provider as { providers: () => Promise<unknown[]> }).providers();
    expect(lanes).toEqual([{ id: "stub", label: expect.any(String), models: expect.any(Object), hasOAuth: true, accountPool: "stub" }]);
  });

  it("serves a request through the driver", async () => {
    const { context, provided } = contextSpy();
    await plugin.activate(context as never);
    const capability = provided.provider as { handleIr: (r: unknown, c: unknown) => Promise<unknown> };
    await expect(
      capability.handleIr({ model: "stub-model", messages: [] }, { configDir: "/tmp/home", log: () => {}, model: "stub-model", provider: "stub" }),
    ).resolves.toBeDefined();
  });

  // A host that offers no provider support cannot run a provider at all, and naming the service is
  // the only way an operator learns which host is at fault.
  it("names the missing service rather than leaving the capability unprovided", async () => {
    const { context } = contextSpy({});
    await expect(async () => plugin.activate(context as never)).rejects.toThrow(/provider-support/);
  });

  it("deactivates without throwing", async () => {
    expect(plugin.deactivate()).toBeUndefined();
  });
});
