import * as vscode from "vscode";
import { registerCommands } from "./views/commands";
import { registerZoteroTree } from "./views/zoteroTree";
import { ProjectController } from "./views/projectCommands";
import { registerDoiSearch } from "./views/doiSearch";
import { registerSourceList } from "./views/sourceList";
import { CitationController } from "./views/citationCommands";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Zotero LaTeX Assistant");
  context.subscriptions.push(output);
  registerCommands(context, output);
  registerZoteroTree(context, output);
  const projects = new ProjectController(context, output);
  registerDoiSearch(context, projects);
  const citations = new CitationController(context, projects);
  registerSourceList(context, projects, citations);
  void projects.startup();
  output.appendLine("Zotero LaTeX Assistant activated.");
}

// VS Code gibt alle über context.subscriptions registrierten Ressourcen frei.
