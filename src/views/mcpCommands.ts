import * as vscode from "vscode";
import { access } from "node:fs/promises";
import { configureMcp, mcpLaunch } from "../config/mcp";
import { getClientOptions, CONFIG_SECTION } from "../config/settings";
import { projectPath } from "../config/project";
import type { ProjectController } from "./projectCommands";

export function registerMcpCommands(context: vscode.ExtensionContext, projects: ProjectController): void {
  for (const client of ["codex", "claude"] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(
      `zoteroLatexAssistant.setup${client === "codex" ? "Codex" : "Claude"}`, () => projects.run(async () => {
        const folder = await projects.folder();
        if (!folder) return;
        const server = vscode.Uri.joinPath(context.extensionUri, "dist", "mcp", "server.cjs").fsPath;
        await access(server);
        const options = getClientOptions();
        const node = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("nodePath", "node");
        const launch = mcpLaunch(folder.uri.fsPath, server, node, options.apiUrl!, options.timeoutMs!);
        const file = await configureMcp(folder.uri.fsPath, client, launch);
        await vscode.window.showTextDocument(vscode.Uri.file(await projectPath(folder.uri.fsPath, file)));
        void vscode.window.showInformationMessage(client === "codex"
          ? "Codex MCP configured for this project. Trust this project in Codex and restart its IDE session. Ask it to run zotero_get_selected_collection first. Node.js 20+ and Zotero must be available on this machine."
          : "Claude Code MCP configured for this project. Approve the project server in Claude Code, then use /mcp to verify it. Restart the IDE session if needed. Claude Desktop uses a separate configuration; see README.");
      })));
  }
}
