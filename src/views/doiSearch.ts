import * as vscode from "vscode";
import { isRecord } from "../zotero/validation";
import { CrossrefClient } from "../research/crossref";
import { doiResultHtml } from "./webviewHtml";
import type { ProjectController } from "./projectCommands";

export function registerDoiSearch(context: vscode.ExtensionContext, projects: ProjectController): void {
  async function searchDoi(initial?: string): Promise<void> {
    const input = await vscode.window.showInputBox({ title: "Search Crossref by DOI / title", value: initial ?? "",
      prompt: "This query will be sent to Crossref. Enter a DOI, doi.org URL or title." });
    if (!input) return;
    const results = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Searching Crossref …" }, () => new CrossrefClient().search(input));
    const result = results.length === 1 ? results[0] : (await vscode.window.showQuickPick(results.map((entry) => ({ label: entry.title,
      description: entry.authors, detail: entry.doi, result: entry })), { title: "Crossref results" }))?.result;
    if (!result) return;
    const panel = vscode.window.createWebviewPanel("zoteroDoi", "DOI: " + result.title, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    panel.webview.html = doiResultHtml(result);
    const listener = panel.webview.onDidReceiveMessage((message: unknown) => projects.run(async () => {
      if (!isRecord(message)) return;
      if (message.type === "open") await vscode.env.openExternal(vscode.Uri.parse(`https://doi.org/${encodeURIComponent(result.doi).replace(/%2F/gi, "/")}`));
      if (message.type === "copy") await vscode.env.clipboard.writeText(result.doi);
    }));
    panel.onDidDispose(() => listener.dispose());
    context.subscriptions.push(panel);
  }

  context.subscriptions.push(vscode.commands.registerCommand("zoteroLatexAssistant.searchDoi", () => projects.run(() => searchDoi())));
}
