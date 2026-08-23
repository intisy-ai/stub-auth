import { providerCapability } from "@intisy-ai/core-auth";
import type { Plugin, PluginContext } from "@intisy-ai/api";
import type { ProviderCapability } from "@intisy-ai/core-auth";
import type { SettingsCapability } from "@intisy-ai/core";
import { driver } from "./driver.js";
import { STUB_SETTINGS } from "./settings.js";
import { printAccounts } from "@intisy-ai/core-auth";

/** What an in-process host loads: the api plugin this bundle's default export carries. */
const plugin: Plugin = {
  activate(context: PluginContext) {
    context.provide(context.capability<ProviderCapability>("provider"), providerCapability(driver));
    context.provide(context.capability<SettingsCapability>("settings"), {
      schema: () => STUB_SETTINGS,
      run: async (actionId: string) => {
        if (actionId !== "accounts") return { ok: false, message: `unknown action: ${actionId}` };
        printAccounts(driver.id, driver.accounts);
        return { ok: true };
      },
    });
  },
  deactivate() {},
};

export default plugin;
