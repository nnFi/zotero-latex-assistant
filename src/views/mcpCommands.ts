import * as vscode from "vscode";
import { configureMcp, mcpConfigFile, mcpLaunch, validateMcpServerPath } from "../config/mcp";
import { getClientOptions, CONFIG_SECTION } from "../config/settings";
import { projectPath } from "../config/project";
import type { ProjectController } from "./projectCommands";
import { mcpSetupOptions } from "./mcpSetupOptions";

export function registerMcpCommands(context: vscode.ExtensionContext, projects: ProjectController): void {
  for (const { client, command, label, nextStep } of mcpSetupOptions) {
    context.subscriptions.push(vscode.commands.registerCommand(
      `zoteroLatexAssistant.${command}`, () => projects.run(async () => {
        const folder = await projects.folder();
        if (!folder) return;
        const selected = await vscode.window.showOpenDialog({ title: `Choose Zotero MCP server for ${label}`,
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
        void vscode.window.showInformationMessage(`${label} MCP configured. ${nextStep} Test with zotero_get_context.`);
      })));
  }
}
