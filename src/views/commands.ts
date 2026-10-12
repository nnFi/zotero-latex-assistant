import * as vscode from "vscode";
import { getClientOptions } from "../config/settings";
import { ZoteroClient } from "../zotero/client";

export function registerCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unknown Zotero error occurred.";
      output.appendLine(`[Error] ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("zoteroLatexAssistant.checkConnection", () => run(async () => {
      const connection = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Checking the Zotero connection …" },
        () => { const client = new ZoteroClient(getClientOptions()); client.clearCache(); return client.checkConnection(); },
      );
      output.appendLine(`Connected to ${connection.apiUrl} (API ${connection.apiVersion}).`);
      void vscode.window.showInformationMessage(`Zotero is available (local API ${connection.apiVersion}).`);
    })),
    vscode.commands.registerCommand("zoteroLatexAssistant.listLibraries", () => run(async () => {
      const libraries = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Loading Zotero libraries …" },
        () => new ZoteroClient(getClientOptions()).listLibraries(),
      );
      await vscode.window.showQuickPick(libraries.map((library) => ({
        label: library.name,
        description: library.type === "user" ? "Personal library" : `Group ${library.id}`,
        ...(library.itemCount === undefined ? {} : {
          detail: `${library.itemCount} items including attachments and notes`,
        }),
      })), {
        title: "Zotero libraries",
        placeHolder: "Library overview – link the project using “Set library”.",
      });
    })),
  );
}
