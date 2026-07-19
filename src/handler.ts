// @ts-nocheck
// Claude entry: the provider surface the claude-code-loader proxy imports for the active
// provider. Post-T4 it exposes the IR-native handleIr (the front-door owns app<->IR
// translation); there is no legacy app-wire handle().

import { runProviderMenu, buildAccountMenu } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";

export const handleIr = driver.handleIr;
export const accounts = driver.accounts;
export const menu = () => runProviderMenu(driver);
export const menuModel = () => buildAccountMenu(driver);   // opencode loader renders this natively in-tab
