import * as vscode from "vscode";
import { configureMcp, mcpConfigFile, mcpLaunch, validateMcpServerPath } from "../config/mcp";
import { getClientOptions, CONFIG_SECTION } from "../config/settings";
import { projectPath } from "../config/project";
import type { ProjectController } from "./projectCommands";

export function registerMcpCommands(context: vscode.ExtensionContext, projects: ProjectController): void {
  for (const client of ["codex", "claude", "cursor"] as const) {
    const name = client === "codex" ? "Codex" : client === "cursor" ? "Cursor" : "Claude";
    context.subscriptions.push(vscode.commands.registerCommand(
      `zoteroLatexAssistant.setup${name}`, () => projects.run(async () => {
        const folder = await projects.folder();
        if (!folder) return;
        const selected = await vscode.window.showOpenDialog({ title: `Choose Zotero MCP server for ${name}`,
          openLabel: "Use this MCP server", canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          filters: { "MCP server (.cjs)": ["cjs"] } });
        if (!selected?.length) return;
        const selectedFile = selected[0]!;
        if (selectedFile.scheme !== "file") throw new Error("Choose a local .cjs MCP server file.");
        const server = selectedFile.fsPath;
        await validateMcpServerPath(server);
        const configFile = mcpConfigFile(client);
        const configPath = await projectPath(folder.uri.fsPath, configFile);
        const workspaceConfigPath = vscode.Uri.joinPath(folder.uri, configFile).fsPath;
        if (vscode.workspace.textDocuments.some((document) => (document.uri.fsPath === configPath || document.uri.fsPath === workspaceConfigPath) && document.isDirty)) {
          throw new Error("Save the open MCP configuration before setting up the connection.");
        }
        const options = getClientOptions();
        const node = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("nodePath", "node");
        const launch = mcpLaunch(folder.uri.fsPath, server, node, options.apiUrl!, options.timeoutMs!);
        const file = await configureMcp(folder.uri.fsPath, client, launch);
        await vscode.window.showTextDocument(vscode.Uri.file(await projectPath(folder.uri.fsPath, file)));
        void vscode.window.showInformationMessage(client === "codex"
          ? "Codex MCP configured with your selected server file. Trust this project in Codex and restart its IDE session. Ask it to run zotero_get_context first. Node.js 20+ is required."
          : client === "cursor"
            ? "Cursor MCP configured in this project's .cursor/mcp.json with your selected server file. Enable or restart the server in Cursor's MCP settings, then ask it to run zotero_get_context. Node.js 20+ is required."
            : "Claude Code MCP configured with your selected server file. Approve the project server in Claude Code, then use /mcp to verify it. Restart the IDE session if needed. Claude Desktop uses a separate configuration; see README.");
      })));
  }
}
