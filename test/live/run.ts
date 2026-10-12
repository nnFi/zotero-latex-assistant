import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ZoteroClient } from "../../src/zotero/client";
import { isImportableItem } from "../../src/biblatex/selection";
import { bibEntries, rekeyExport } from "../../src/biblatex/importer";
import { bibliographyRecords } from "../../src/biblatex/fields";
import { newProjectConfig, readProjectConfig, saveProjectConfig } from "../../src/config/project";
import { insertPreparedCitation } from "../../src/biblatex/citations";
import { ZoteroError } from "../../src/shared/errors";

/** Opt-in test in a real extension host. Only generated workspace files are written. */
export async function run(): Promise<void> {
  const root = process.env.ZOTERO_LIVE_SMOKE_ROOT;
  if (!root || !path.basename(root).startsWith("zotero-live-smoke-")) throw new Error("Use npm run test:live to create an isolated workspace.");
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.equal(folder?.uri.fsPath, path.join(root, "workspace"));
  const checks: string[] = [];
  const report: { success: boolean; vscodeVersion: string; checks: string[]; error?: string; limitations: string[] } = {
    success: false, vscodeVersion: vscode.version, checks,
    limitations: ["Native exporter only; no Zotero writes or authorization prompts", "No manual dialog/button or Better BibTeX integration test"],
  };
  try {
    assert.equal(vscode.workspace.isTrusted, true, "The generated live-test workspace must be trusted in VS Code.");
    const extension = vscode.extensions.getExtension("local.zotero-latex-assistant");
    assert.ok(extension, "Development extension is available in the real host");
    await extension.activate();
    assert.equal(extension.isActive, true);
    checks.push("Extension activates in the installed VS Code host");
    const commands = await vscode.commands.getCommands(true);
    for (const command of ["openSourceList", "updateBib", "insertCitation", "selectBibFile", "deleteAllCitations", "setupCodex", "setupClaude"]) {
      assert.ok(commands.includes(`zoteroLatexAssistant.${command}`));
    }
    checks.push("Expected extension commands are registered");
    await vscode.commands.executeCommand("zoteroLatexAssistant.setupCodex");
    const codexText = await readFile(path.join(folder!.uri.fsPath, ".codex", "config.toml"), "utf8");
    assert.ok(codexText.includes("[mcp_servers.zotero_latex_assistant]"));
    assert.ok(codexText.includes(folder!.uri.fsPath));
    assert.ok(codexText.includes("server.cjs"));
    await vscode.commands.executeCommand("zoteroLatexAssistant.setupClaude");
    const claudeConfig = JSON.parse(await readFile(path.join(folder!.uri.fsPath, ".mcp.json"), "utf8"));
    assert.equal(claudeConfig.mcpServers.zotero_latex_assistant.args[2], folder!.uri.fsPath);
    checks.push("Real extension commands write project-scoped Codex and Claude MCP configurations pointing at the bundled server");
    const connection = await new ZoteroClient().checkConnection();
    const client = new ZoteroClient({ ...(connection.serverId ? { serverId: connection.serverId } : {}) });
    const library = { type: "user" as const, id: 0 };
    const items = await client.listItems(library);
    const item = items.find(isImportableItem);
    assert.ok(item, "The local personal library needs an importable source for this read-only test");
    const exported = await client.exportItem(library, item.key);
    const stableKey = "LiveSmokeKey";
    const keyed = rekeyExport(exported, stableKey);
    const nativeTitle = bibliographyRecords(keyed)[0]!.fields.get("title")?.value;
    checks.push("Real Zotero connection, item list and native BibLaTeX export are readable");
    const workspace = folder!.uri.fsPath;
    await mkdir(path.join(workspace, ".vscode"), { recursive: true });
    await writeFile(path.join(workspace, ".vscode/settings.json"), JSON.stringify({ "zoteroLatexAssistant.bibliographyExporter": "native" }));
    const config = { ...newProjectConfig(), library, bibFile: "refs.bib", importedItemKeys: [item.key],
      citationKeys: { [item.key]: stableKey }, ...(connection.serverId ? { serverId: connection.serverId } : {}) };
    await saveProjectConfig(workspace, config);
    await writeFile(path.join(workspace, "refs.bib"), `@book{${stableKey},title={Temporary smoke fixture}}\n`);
    const texPath = path.join(workspace, "main.tex");
    await writeFile(texPath, "\\documentclass{article}\n\\usepackage[style=numeric]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\nLive smoke test.\n\\printbibliography\n\\end{document}\n");
    // Wait for the real workspace setting to become visible before invoking the normal command.
    await vscode.workspace.getConfiguration("zoteroLatexAssistant", folder!.uri)
      .update("bibliographyExporter", "native", vscode.ConfigurationTarget.WorkspaceFolder);
    await vscode.commands.executeCommand("zoteroLatexAssistant.updateBib");
    const updated = await readFile(path.join(workspace, "refs.bib"), "utf8");
    assert.deepEqual(bibEntries(updated).map((entry) => entry.key), [stableKey]);
    assert.equal(bibliographyRecords(updated)[0]!.fields.get("title")?.value, nativeTitle);
    assert.notEqual(updated, `@book{${stableKey},title={Temporary smoke fixture}}\n`);
    checks.push("Registered update command writes real native metadata with the existing stable project key");
    await vscode.commands.executeCommand("zoteroLatexAssistant.openSourceList");
    assert.ok(vscode.window.tabGroups.all.flatMap((group) => group.tabs)
      .some((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("zoteroSourceList")));
    checks.push("Registered source-list command creates its real VS Code webview");
    const document = await vscode.workspace.openTextDocument(texPath);
    const editor = await vscode.window.showTextDocument(document);
    const original = document.getText();
    const position = document.positionAt(original.indexOf("Live smoke test.") + "Live smoke test.".length);
    const version = document.version;
    const target = { isCurrent: () => !document.isClosed && document.version === version,
      insert: async (text: string) => editor.edit((edit) => edit.insert(position, text)) };
    await assert.rejects(insertPreparedCitation([item], target, async () => { throw new ZoteroError("CANCELLED", "Live smoke cancellation"); }), /cancellation/);
    assert.equal(document.getText(), original);
    await insertPreparedCitation([item], target, async () => (await readProjectConfig(workspace))!);
    assert.ok(document.getText().includes(`Live smoke test.\\autocite{${stableKey}}`));
    await document.save();
    assert.equal(await readFile(texPath, "utf8"), document.getText());
    checks.push("Citation preparation cancellation leaves the real document unchanged; insertion uses the real editor and saves successfully");
    report.success = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(path.join(root, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
