// Universal plugin contract via core's shared test-kit.
import { runPluginContract } from "../../core/src/testing.js";

runPluginContract({
  name: "stub-auth",
  entry: "dist/index.js",
  configName: "stub-auth",
  app: "both",
  commands: ["stub-auth-config", "stub-accounts"],
  deploy: "load",
  actions: [["accounts"]],
});
