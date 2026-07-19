// @ts-nocheck
// Claude entry: the named handle() the claude-code-loader proxy imports and calls
// for the active provider.

import { runProviderMenu, buildAccountMenu } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";

export const handle = driver.handle;
export const handleIr = driver.handleIr;
export const accounts = driver.accounts;
export const menu = () => runProviderMenu(driver);
export const menuModel = () => buildAccountMenu(driver);   // opencode loader renders this natively in-tab
