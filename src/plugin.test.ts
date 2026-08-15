import { describe, expect, it, vi } from "vitest";
import plugin from "./plugin.js";

function contextSpy() {
  const provided: Record<string, unknown> = {};
  return {
    provided,
    context: {
      provide: vi.fn((id: string, implementation: unknown) => {
        provided[id] = implementation;
      }),
      paths: { home: "/tmp/home" },
    },
  };
}

describe("the stub-auth api plugin", () => {
  it("provides exactly the provider capability its manifest declares", async () => {
    const { context, provided } = contextSpy();
    await plugin.activate(context as never);
    expect(Object.keys(provided)).toEqual(["provider"]);
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

  it("deactivates without throwing", async () => {
    expect(plugin.deactivate()).toBeUndefined();
  });
});
