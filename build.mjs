import { build } from "esbuild";

// Every first-party library stays external and is resolved from the home's shared library store, so
// a deployed clone links one copy rather than embedding its own.
const EXTERNAL = ["@intisy-ai/core", "@intisy-ai/core-auth", "@intisy-ai/core-ir"];

const ENTRY_POINTS = ["index", "handler", "javaProvider", "driver", "plugin"];

const common = { bundle: true, platform: "node", format: "esm", logLevel: "info", external: EXTERNAL };

for (const entryPoint of ENTRY_POINTS) {
  await build({ ...common, entryPoints: [`src/${entryPoint}.ts`], outfile: `dist/${entryPoint}.js` });
}

console.log(`Bundled stub-auth -> ${ENTRY_POINTS.map((name) => `dist/${name}.js`).join(", ")}`);
