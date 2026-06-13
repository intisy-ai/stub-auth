// @ts-nocheck
// OpenCode entry (the deployed plugin file). core-auth registers the native
// provider + auth method and routes requests to driver.handle.

import { defineProvider } from "../core-auth/dist/index.js";
import { driver } from "./driver.js";

export const MockProvider = defineProvider(driver).opencode;
