// @ts-nocheck
// Claude entry: the provider surface the claude-code-loader proxy imports for the active
// provider. Exposes the IR-native handleIr; the front-door owns app<->IR translation.

import { providerHandlerExports } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";

export const { handleIr, accounts, loginFlow, menu, menuModel, def } = providerHandlerExports(driver);
