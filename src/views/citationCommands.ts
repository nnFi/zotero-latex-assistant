import * as vscode from "vscode";
import { getClientOptions } from "../config/settings";
import { readProjectConfig } from "../config/project";
import { insertPreparedCitation, type CitationNotes, type CitationTarget } from "../biblatex/citations";
import { isImportableItem } from "../biblatex/selection";
import type { ZoteroDatabaseBinding, ZoteroItem } from "../shared/types";
import { ZoteroClient } from "../zotero/client";
import { itemDescription } from "../zotero/items";
import { projectCitationKey } from "../biblatex/keys";
import { languageDescription } from "../biblatex/language";
import type { ProjectController } from "./projectCommands";

/** Die Liste erhält den Fokus; das zuletzt benutzte LaTeX-Dokument bleibt das Ziel. */
export class CitationController {
  private readonly editors = new Map<string, vscode.TextEditor>();
  private readonly busy = new Set<string>();

  constructor(context: vscode.ExtensionContext, private readonly projects: ProjectController) {
    const remember = (editor: vscode.TextEditor | undefined): void => {
      if (!editor || !this.isLatex(editor.document)) return;
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      if (folder?.uri.scheme === "file") this.editors.set(folder.uri.toString(), editor);
    };
    remember(vscode.window.activeTextEditor);
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(remember),
      vscode.workspace.onDidCloseTextDocument((document) => {
        for (const [key, editor] of this.editors) if (editor.document === document) this.editors.delete(key);
      }),
      vscode.commands.registerCommand("zoteroLatexAssistant.insertCitation", () => projects.run(() => this.choose())));
  }

  private isLatex(document: vscode.TextDocument): boolean {
    return document.uri.scheme === "file" && (document.languageId === "latex" || /\.tex$/i.test(document.uri.fsPath));
  }

  private target(folder: vscode.WorkspaceFolder): CitationTarget {
    const active = vscode.window.activeTextEditor;
    const editor = active && this.isLatex(active.document)
      && vscode.workspace.getWorkspaceFolder(active.document.uri)?.uri.toString() === folder.uri.toString()
      ? active : this.editors.get(folder.uri.toString());
    if (!editor || editor.document.isClosed) {
      throw new Error(`Open a LaTeX document in “${folder.name}” and set the cursor position.`);
    }
    const document = editor.document;
    const version = document.version;
    const selections = [...editor.selections];
    if (!selections.length) throw new Error("Set a cursor position in the LaTeX document first.");
    const viewColumn = editor.viewColumn;
    const isCurrent = (): boolean => !document.isClosed && document.version === version
      && vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === folder.uri.toString();
    return {
      isCurrent,
      insert: async (text) => {
        if (!isCurrent()) return false;
        const shown = await vscode.window.showTextDocument(document, { viewColumn: viewColumn ?? vscode.ViewColumn.Active,
          preserveFocus: false, selection: selections[0]! });
        if (!isCurrent()) return false;
        shown.selections = selections;
        const originalOffsets = selections.map((selection) => document.offsetAt(selection.active));
        const offsets = [...new Set(originalOffsets)].sort((a, b) => a - b);
        // Nur einfügen: auch markierter Text wird nicht ersetzt oder gelöscht.
        const inserted = await shown.edit((edit) => {
          for (const offset of offsets) edit.insert(document.positionAt(offset), text);
        }, { undoStopBefore: true, undoStopAfter: true });
        if (!inserted) return false;
        shown.selections = originalOffsets.map((original) => {
          const shifted = original + offsets.filter((entry) => entry <= original).length * text.length;
          const position = document.positionAt(shifted);
          return new vscode.Selection(position, position);
        });
        return true;
      },
    };
  }

  async cite(items: readonly ZoteroItem[], folder: vscode.WorkspaceFolder, notes: CitationNotes = {}, capturedTarget?: CitationTarget,
    databaseBinding?: ZoteroDatabaseBinding): Promise<void> {
    const key = folder.uri.toString();
    if (this.busy.has(key)) throw new Error("A citation is already being inserted for this project.");
    const target = capturedTarget ?? this.target(folder);
    this.busy.add(key);
    try {
      await insertPreparedCitation(items, target, () => this.projects.prepareCitation(items, folder, databaseBinding), notes);
      this.projects.log(`Citation inserted: ${items.length} source(s) in ${folder.name}.`);
    } finally { this.busy.delete(key); }
  }

  async citeWithDetails(items: readonly ZoteroItem[], folder: vscode.WorkspaceFolder, capturedTarget?: CitationTarget,
    databaseBinding?: ZoteroDatabaseBinding): Promise<void> {
    if (this.busy.has(folder.uri.toString())) throw new Error("A citation is already being inserted for this project.");
    const target = capturedTarget ?? this.target(folder);
    const biblatex = (await readProjectConfig(folder.uri.fsPath))?.citationStyleType === "biblatex";
    const { language, styleId } = await this.projects.citationLanguage(folder);
    const pages = await vscode.window.showInputBox({ title: "Cite – page number or location", ignoreFocusOut: true,
      placeHolder: biblatex ? "e.g. 14 or 14–16; leave empty for the whole work"
        : `e.g. 14, 14–16 or ${language.chapter} 3; leave empty for the whole work`,
      prompt: biblatex ? "Optional. BibLaTeX formats page numbers in the document language. Explicit labels are kept."
        : `Optional. Citation language: ${languageDescription(language)}. Page numbers receive “${language.page}” / “${language.pages}”. Explicit labels are kept.` });
    if (pages === undefined) return;
    const example = language.locale.startsWith("de") ? "vgl. or siehe" : language.locale.startsWith("en") ? "cf. or see" : "an introductory note";
    const prefix = await vscode.window.showInputBox({ title: "Cite – prefix", ignoreFocusOut: true,
      placeHolder: `e.g. ${example}; leave empty for no prefix`, prompt: biblatex ? "Optional text before the citation. Enter it in the document language."
        : `Optional text before the citation. Enter it in ${languageDescription(language)}.` });
    if (prefix === undefined) return;
    await this.cite(items, folder, { postnote: pages, prenote: prefix, language, styleId }, target, databaseBinding);
  }

  private async choose(): Promise<void> {
    const active = vscode.window.activeTextEditor;
    const folder = active && this.isLatex(active.document) ? vscode.workspace.getWorkspaceFolder(active.document.uri) : await this.projects.folder();
    if (!folder) {
      if (active && this.isLatex(active.document)) throw new Error("Open the project folder of the LaTeX document in VS Code.");
      return;
    }
    // Vor dem Quellenabruf sicherstellen, dass überhaupt ein LaTeX-Ziel vorhanden ist.
    const target = this.target(folder);
    const config = await readProjectConfig(folder.uri.fsPath);
    if (!config?.library) throw new Error("Run “Zotero: Set library” first.");
    if (!config.bibFile) throw new Error("Run “Zotero: Set .bib file” first.");
    const items = await new ZoteroClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) })
      .listItems(config.library, config.collectionKey || undefined);
    const selected = await vscode.window.showQuickPick(items.filter(isImportableItem).map((item) => ({ label: item.title,
      description: itemDescription(item), detail: [item.doi ? `DOI: ${item.doi}` : "",
        config.importedItemKeys.includes(item.key) ? `Citation key: ${projectCitationKey(config, item.key)}` : ""].filter(Boolean).join(" · "), item })), {
      title: "Cite – find a source", placeHolder: "Search by title, author, year, DOI or imported citation key …",
      matchOnDescription: true, matchOnDetail: true, ignoreFocusOut: true });
    if (selected) await this.citeWithDetails([selected.item], folder, target, { serverId: config.serverId });
  }
}
