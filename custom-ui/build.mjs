import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const directory = path.dirname(fileURLToPath(import.meta.url));

const lodashCompatPlugin = {
  name: "lodash-compat",
  setup(build) {
    // Alias only the package root. Imports such as lodash/isString must keep
    // resolving to their individual lodash modules.
    build.onResolve({ filter: /^lodash$/ }, () => ({
      path: path.join(directory, "src", "lodash_compat.js"),
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(directory, "src", "data_collection_tab.jsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2018",
  plugins: [lodashCompatPlugin],
  outfile: path.join(directory, "..", "package", "appserver", "static", "js", "build", "custom", "data_collection_tab.js"),
});
