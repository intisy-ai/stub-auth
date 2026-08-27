// What each of this provider's settings is called and how a surface renders it, beside the values
// the manifest declares. Data the settings capability answers with.
import { COMMON_PROVIDER_CAPABILITIES, toCapabilitiesFields } from "@intisy-ai/core-auth";
import type { CapabilitySchema } from "@intisy-ai/core";
import { STUB_SETTINGS_SCHEMA } from "./driver.js";

export const STUB_SETTINGS: CapabilitySchema = {
  fields: [...COMMON_PROVIDER_CAPABILITIES, ...toCapabilitiesFields(STUB_SETTINGS_SCHEMA)],
  actions: [
    { id: "accounts", label: "List accounts", description: "Print the stub-auth demo accounts." },
  ],
};
