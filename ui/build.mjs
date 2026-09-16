import { copyFile, mkdir, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uiDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = path.resolve(uiDirectory, "..");
const taName = "Splunk_TA_NetApp_ontap";
const command = process.platform === "win32" ? "ucc-gen-ui.cmd" : "ucc-gen-ui";
const forwardedArgs = process.argv.slice(2);
const outputArgument = forwardedArgs.find((argument) => argument.startsWith("output="));
const outputRoot = outputArgument
  ? path.resolve(outputArgument.slice("output=".length))
  : path.join(repositoryDirectory, "output");

const uccArguments = [
  `ta_name=${taName}`,
  "init_file_dir=src/ucc-ui.js",
];
if (outputArgument) uccArguments.push(`output=${outputRoot}`);

execFileSync(command, uccArguments, {
  cwd: uiDirectory,
  stdio: "inherit",
});

// UCC's Vite cleanup intentionally removes JavaScript from the generated
// directory. Legacy extensions referenced by globalConfig must be copied back
// after the context entry page has been built.
const legacyDirectory = path.join(
  repositoryDirectory,
  "package",
  "appserver",
  "static",
  "js",
  "build",
  "custom",
);
const generatedDirectory = path.join(
  outputRoot,
  taName,
  "appserver",
  "static",
  "js",
  "build",
  "custom",
);
await mkdir(generatedDirectory, { recursive: true });
const legacyFiles = (await readdir(legacyDirectory)).filter((fileName) => fileName.endsWith(".js"));
for (const fileName of legacyFiles) {
  await copyFile(path.join(legacyDirectory, fileName), path.join(generatedDirectory, fileName));
}
