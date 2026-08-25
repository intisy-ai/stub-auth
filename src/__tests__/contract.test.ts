// Universal plugin contract via core's shared test-kit.
import { runPluginContract } from "@intisy-ai/core/testing";

runPluginContract({
  name: "stub-auth",
  entry: "dist/index.js",
  configName: "stub-auth",
  app: "both",
  commands: ["stub-accounts"],
  deploy: "load",
  actions: [["accounts"]],
  readme: true,
});
