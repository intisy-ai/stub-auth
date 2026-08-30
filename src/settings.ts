// What each of this provider's settings is called and how a surface renders it, beside the values
// the manifest declares. Data the settings capability answers with.
import { COMMON_PROVIDER_CAPABILITIES, toCapabilitiesFields } from "@intisy-ai/basekit/auth";
import type { CapabilitySchema } from "@intisy-ai/basekit";
import { STUB_SETTINGS_SCHEMA } from "./driver.js";

/** This provider's settings and actions, as a capability surface renders them. */
export const STUB_SETTINGS: CapabilitySchema = {
  fields: [...COMMON_PROVIDER_CAPABILITIES, ...toCapabilitiesFields(STUB_SETTINGS_SCHEMA)],
  actions: [
    { id: "accounts", label: "List accounts", description: "Print the stub-auth demo accounts." },
  ],
};
