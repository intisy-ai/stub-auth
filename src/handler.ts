// @ts-nocheck
// Claude entry: the named handle() the claude-code-loader proxy imports and
// calls for the active provider. Pure passthrough to the driver.

import { driver } from "./driver.js";

export const handle = driver.handle;
