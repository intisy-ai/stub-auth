// @ts-nocheck
// Cross-app slash-commands for stub-auth: the reference example for how a
// provider exposes its config + a namespaced action through core's command framework.
import { configCommand, runConfigCli } from "@intisy-ai/core";
import { printAccounts } from "@intisy-ai/core-auth";
import { driver } from "./driver.js";

export const STUB_COMMANDS = [
  configCommand("stub-auth"),
  {
    name: "stub-accounts",
    description: "List stub-auth demo accounts",
    shell: 'node "{{BUNDLE}}" accounts',
    body: "Above are the stub-auth demo accounts. Report them; if none, the user can add one from the account menu.",
  },
];

export async function maybeRunCli(configName) {
  const argv = process.argv.slice(2);
  if (argv[0] === "config") {
    runConfigCli(configName, argv.slice(1));
    return true;
  }
  if (argv[0] === "accounts") {
    printAccounts(driver.id, driver.accounts);
    return true;
  }
  return false;
}
