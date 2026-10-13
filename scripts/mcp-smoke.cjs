// Opt-in live test. Read-only by default; writes require a named test collection
// and a stable request ID supplied by the human running this command.
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");
const { resolve, isAbsolute } = require("node:path");
const { writeFile } = require("node:fs/promises");
async function main() {
  const flags = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--write") flags.set(flag, true);
    else if (["--project", "--test-collection", "--request-id", "--report", "--server"].includes(flag) && args[i + 1]) flags.set(flag, args[++i]);
    else throw new Error("Usage: npm run test:mcp:live -- --project /absolute/project [--write --test-collection NAME --request-id STABLE-ID] [--report FILE]");
  }
  const root = flags.get("--project");
  if (!root || !isAbsolute(root)) throw new Error("An explicit absolute --project path is required.");
  const write = flags.has("--write");
  const requestId = flags.get("--request-id");
  if (write && (!flags.get("--test-collection") || typeof requestId !== "string" || requestId.length < 8)) {
    throw new Error("Live writes require an explicitly approved --test-collection NAME and stable --request-id (at least 8 characters).");
  }
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [flags.get("--server") ?? resolve(__dirname, "../dist/mcp/server.cjs"), "--project", root, "--timeout-ms", "15000"], stderr: "inherit" });
  const client = new Client({ name: "zotero-live-smoke", version: "1.0.0" });
  const report = { timestamp: new Date().toISOString(), client: "official MCP TypeScript client", project: root, writeRequested: write, checks: [], success: false };
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
    const output = response.structuredContent;
    if (response.isError || !output?.ok) throw new Error(`${name}: ${output?.error?.message ?? "MCP operation failed"}`);
    report.checks.push(name);
    return output.result;
  };
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (tools.tools.length !== 33) throw new Error("Expected thirty-three Zotero MCP tools.");
    const scope = await call("zotero_get_selected_collection");
    report.scope = scope;
    await call("zotero_search", { query: "", limit: 1 });
    if (write) {
      if (!scope.writeReady || scope.collection?.name !== flags.get("--test-collection")) throw new Error("The selected collection does not match the explicitly approved test collection.");
      const metadata = { itemType: "report", title: `MCP-TEST synthetic acceptance ${requestId}`,
        creators: [{ creatorType: "author", name: "Zotero LaTeX Assistant Test" }],
        fields: { date: "2026", institution: "Synthetic MCP test fixture", extra: "Synthetic test source, not a published reference. Created only for an explicitly authorized MCP acceptance test." }, tags: ["MCP-TEST"] };
      await call("zotero_check_duplicates", { metadata });
      const created = await call("zotero_create_item", { metadata, requestId });
      if (!["created", "already-created"].includes(created.status)) throw new Error("Creation was blocked by duplicates; no trash operation performed.");
      report.itemKey = created.item.key;
      report.createdVersion = created.version;
      const search = await call("zotero_search", { query: metadata.title });
      if (!search.items.some((item) => item.key === created.item.key && item.title === metadata.title)) throw new Error("The created source was not found again. Inspect it before retrying.");
      const detail = await call("zotero_get_metadata", { library: scope.library, itemKey: created.item.key });
      const trashed = await call("zotero_delete_item", { library: scope.library, itemKey: created.item.key, expectedVersion: detail.version });
      report.trashVersion = trashed.version;
      report.verifiedTrash = trashed.verified;
    }
    report.success = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    await client.close();
    const text = JSON.stringify(report, null, 2) + "\n";
    if (flags.has("--report")) await writeFile(flags.get("--report"), text);
    process.stdout.write(text);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
