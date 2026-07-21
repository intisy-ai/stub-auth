// @ts-nocheck
// Cross-app slash-commands for stub-auth: the reference example for how a
// provider exposes its config + a namespaced action through core's command framework.
import { configCommand, runConfigCli } from "../core/src/index.js";
import { listAccounts } from "../core-auth/dist/index.js";

const PROVIDER_ID = "stub";

export const STUB_COMMANDS = [
  configCommand("stub-auth"),
  {
    name: "stub-accounts",
    description: "List stub-auth demo accounts",
    shell: 'node "{{BUNDLE}}" accounts',
    body: "Above are the stub-auth demo accounts. Report them; if none, the user can add one from the account menu.",
  },
];

function runAccounts() {
  let accounts = [];
  try {
    accounts = listAccounts(PROVIDER_ID) || [];
  } catch (e) {
    console.log(`Could not read accounts: ${e?.message || e}`);
    return;
  }
  if (!accounts.length) {
    console.log("No stub-auth accounts. Add one from the account menu.");
    return;
  }
  for (const a of accounts) {
    const state = a.enabled === false ? " (disabled)" : "";
    console.log(`- ${a.email || a.id}${state}`);
  }
}

export async function maybeRunCli(configName) {
  const argv = process.argv.slice(2);
  if (argv[0] === "config") {
    runConfigCli(configName, argv.slice(1));
    return true;
  }
  if (argv[0] === "accounts") {
    runAccounts();
    return true;
  }
  return false;
}
