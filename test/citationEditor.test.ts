import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import type { CitationController } from "../src/views/citationCommands";
import type { ProjectController } from "../src/views/projectCommands";
import type { ProjectConfig, ZoteroDatabaseBinding, ZoteroItem } from "../src/shared/types";
import type * as vscode from "vscode";
import { citationLanguage } from "../src/biblatex/language";

const item: ZoteroItem = { library: { type: "user", id: 0 }, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };
const config: ProjectConfig = { version: 1, library: item.library, collectionKey: "", bibFile: "references.bib",
  citationStyle: "apa", citationCommand: "textcite", importedItemKeys: [item.key] };

class Position { constructor(readonly line: number, readonly character: number) {} }
class Selection {
  constructor(readonly anchor: Position, readonly active: Position) {}
}

function editorHarness(text: string, selections: Selection[], prepare?: () => Promise<ProjectConfig>, inputs: (string | undefined)[] = []) {
  const folder = { uri: { scheme: "file", fsPath: "/project", toString: () => "/project" }, name: "Projekt" };
  const document = { uri: { scheme: "file", fsPath: "/project/main.tex" }, languageId: "latex", isClosed: false, version: 1,
    text, offsetAt: (position: Position): number => {
      const lines = document.text.split("\n");
      return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
    }, positionAt: (offset: number): Position => {
      const lines = document.text.slice(0, offset).split("\n");
      return new Position(lines.length - 1, lines.at(-1)!.length);
    } };
  const editor = { document, selections, viewColumn: 1, edit: async (callback: (edit: { insert(position: Position, text: string): void }) => void) => {
    const edits: { offset: number; text: string }[] = [];
    callback({ insert: (position, text) => { edits.push({ offset: document.offsetAt(position), text }); } });
    for (const edit of edits.sort((a, b) => b.offset - a.offset)) document.text = document.text.slice(0, edit.offset) + edit.text + document.text.slice(edit.offset);
    document.version++;
    return true;
  } };
  let shown = 0; let prepared = 0;
  let preparedBinding: ZoteroDatabaseBinding | undefined;
  const questions: unknown[] = [];
  const commands = new Map<string, () => Promise<void>>();
  let pickerOptions: unknown;
  const window = { activeTextEditor: editor as typeof editor | undefined,
    onDidChangeActiveTextEditor: () => ({ dispose() {} }), showTextDocument: async () => { shown++; window.activeTextEditor = editor; return editor; },
    showInputBox: async (options: unknown) => { questions.push(options); return inputs.shift(); },
    showQuickPick: async (entries: { item: ZoteroItem }[], options: unknown) => { pickerOptions = options; return entries[0]; } };
  const fakeVscode = { window, workspace: { getWorkspaceFolder: () => folder, onDidCloseTextDocument: () => ({ dispose() {} }) },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return { dispose() {} }; } }, ViewColumn: { Active: -1 }, Selection };
  const filename = path.join(__dirname, "../src/views/citationCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { CitationController: typeof CitationController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings" ? { getClientOptions: () => ({}) }
      : name === "../config/project" ? { readProjectConfig: async () => config }
        : name === "../zotero/client" ? { ZoteroClient: class { async listItems() { return [item]; } } } : nativeRequire(name),
  });
  const projects = { prepareCitation: async (_items: readonly ZoteroItem[], _folder: vscode.WorkspaceFolder, binding?: ZoteroDatabaseBinding) => {
    prepared++; preparedBinding = binding; return prepare ? prepare() : config;
  }, log: () => {},
    citationLanguage: async () => ({ styleId: config.citationStyle, language: citationLanguage("de-DE") }),
    folder: async () => folder, run: async (action: () => Promise<void>) => action() } as unknown as ProjectController;
  const controller = new module.exports.CitationController({ subscriptions: [] } as unknown as vscode.ExtensionContext, projects);
  window.activeTextEditor = undefined; // Quellenliste hat inzwischen den Fokus.
  return { controller, document, editor, folder: folder as unknown as vscode.WorkspaceFolder, shown: () => shown, prepared: () => prepared,
    questions, preparedBinding: () => preparedBinding, pickerOptions: () => pickerOptions, invokeCommand: () => commands.get("zoteroLatexAssistant.insertCitation")!() };
}

test("Citation dialogs retain the source list database binding until preparation", async () => {
  const harness = editorHarness("Text", [new Selection(new Position(0, 4), new Position(0, 4))], async () => {
    assert.deepEqual(harness.preparedBinding(), { serverId: "database-A" });
    throw new Error("The Zotero database binding changed. Reopen the source list.");
  }, ["14", "see"]);
  await assert.rejects(harness.controller.citeWithDetails([item], harness.folder, undefined, { serverId: "database-A" }), /database binding changed/);
  assert.equal(harness.questions.length, 2);
  assert.equal(harness.document.text, "Text");
  assert.equal(harness.shown(), 0);
});

test("Quellenlistenaktion stellt den LaTeX-Editor wieder her, erhält markierten Text und setzt den Cursor hinter die Zitation", async () => {
  const harness = editorHarness("Eine Aussage.", [new Selection(new Position(0, 0), new Position(0, 12))]);
  await harness.controller.cite([item], harness.folder);
  const citation = "\\textcite{zotero-user-0-ITEM0001}";
  assert.equal(harness.document.text, "Eine Aussage" + citation + ".");
  assert.equal(harness.shown(), 1);
  assert.equal(harness.editor.selections[0]?.active.character, 12 + citation.length);
  assert.equal(harness.prepared(), 1);
});

test("Mehrere Cursor werden anhand der ursprünglichen Positionen bearbeitet; doppelte Positionen fügen nur einmal ein", async () => {
  const harness = editorHarness("AB\nCD", [new Selection(new Position(1, 1), new Position(1, 1)),
    new Selection(new Position(0, 1), new Position(0, 1)), new Selection(new Position(0, 1), new Position(0, 1))]);
  await harness.controller.cite([item], harness.folder);
  const citation = "\\textcite{zotero-user-0-ITEM0001}";
  assert.equal(harness.document.text, `A${citation}B\nC${citation}D`);
  assert.deepEqual(Array.from(harness.editor.selections, (selection) => [selection.active.line, selection.active.character]),
    [[1, 1 + citation.length], [0, 1 + citation.length], [0, 1 + citation.length]]);
});

test("Wenn sich das Dokument während der Vorbereitung ändert, bleibt der neue Text unberührt", async () => {
  const harness = editorHarness("Original", [new Selection(new Position(0, 0), new Position(0, 0))], async () => {
    harness.document.text = "Zwischenzeitlich geändert"; harness.document.version++; return config;
  });
  await assert.rejects(harness.controller.cite([item], harness.folder), /has changed/);
  assert.equal(harness.document.text, "Zwischenzeitlich geändert");
  assert.equal(harness.shown(), 0);
});

test("Ein geschlossenes Zieldokument löst keinen Bib-Import aus", async () => {
  const harness = editorHarness("Original", [new Selection(new Position(0, 0), new Position(0, 0))]);
  harness.document.isClosed = true;
  await assert.rejects(harness.controller.cite([item], harness.folder), /LaTeX document/);
  assert.equal(harness.prepared(), 0);
});

test("Rechtsklick-Befehl bietet Quellensuche nach Titel, Autoren und DOI und fügt anschließend Seiten / Zusatz ein", async () => {
  const harness = editorHarness("Text", [new Selection(new Position(0, 4), new Position(0, 4))], undefined, ["14–16", "vgl."]);
  await harness.invokeCommand();
  assert.equal(harness.document.text, "Text\\textcite[vgl.][S. 14–16]{zotero-user-0-ITEM0001}");
  const options = harness.pickerOptions() as { matchOnDescription: boolean; matchOnDetail: boolean; placeHolder: string };
  assert.equal(options.matchOnDescription, true);
  assert.equal(options.matchOnDetail, true);
  assert.match(options.placeHolder, /title, author, year, DOI/);
  assert.equal(harness.questions.length, 2);
});

test("Abbrechen bei Seitenzahl oder Zusatz führt weder zu Import noch Texteinfügung", async () => {
  for (const inputs of [[undefined], ["14", undefined]]) {
    const harness = editorHarness("Text", [new Selection(new Position(0, 4), new Position(0, 4))], undefined, inputs);
    await harness.invokeCommand();
    assert.equal(harness.document.text, "Text");
    assert.equal(harness.prepared(), 0);
    assert.equal(harness.shown(), 0);
  }
});
