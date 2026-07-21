// @ts-nocheck
// Claude entry: the provider surface the claude-code-loader proxy imports for the active
// provider. Exposes the IR-native handleIr; the front-door owns app<->IR translation.

import { runProviderMenu, buildAccountMenu } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";

export const handleIr = driver.handleIr;
export const accounts = driver.accounts;
export const menu = () => runProviderMenu(driver);
export const menuModel = () => buildAccountMenu(driver);   // opencode loader renders this natively in-tab
