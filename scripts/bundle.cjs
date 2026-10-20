const { build } = require("esbuild");
const { copyFile } = require("node:fs/promises");
// jsonc-parser's UMD entry contains dynamic requires; bundle its ESM entry instead.
const options = { bundle: true, platform: "node", target: "node20", format: "cjs", sourcemap: true,
  alias: { "jsonc-parser": require.resolve("jsonc-parser/lib/esm/main.js") } };
const entries = [
  { ...options, entryPoints: ["mcp/server.ts"], outfile: "dist/mcp/server.cjs", metafile: true },
  { ...options, entryPoints: ["src/extension.ts"], outfile: "dist/extension.cjs", external: ["vscode"] },
];
async function run() {
  if (process.argv.includes("--watch")) {
    const { context } = require("esbuild");
    for (const entry of entries) await (await context(entry)).watch();
  } else {
    const results = await Promise.all(entries.map((entry) => build(entry)));
    const imports = Object.values(results[0].metafile.outputs).flatMap((output) => output.imports);
    if (imports.some((entry) => !entry.path.startsWith("node:"))) throw new Error("MCP bundle contains an external runtime dependency.");
    await copyFile("dist/mcp/server.cjs", "mcp-latest.cjs");
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
