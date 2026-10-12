import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, saveProjectConfig } from "../src/config/project";
import type { ProjectController } from "../src/views/projectCommands";

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "style-controller-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function controller(root: string, options: { dirty?: string; cancel?: boolean } = {}) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Project" };
  const commands = new Map<string, () => Promise<void>>();
  const errors: string[] = [];
  const subscription = () => ({ dispose() {} });
  const fakeVscode = {
    workspace: { workspaceFolders: [folder], textDocuments: options.dirty ? [{ uri: { fsPath: path.join(root, options.dirty) }, isDirty: true }] : [],
      createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription }),
      onDidChangeWorkspaceFolders: subscription, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      findFiles: async () => [{ fsPath: path.join(root, "main.tex") }] },
    window: { createStatusBarItem: () => ({ show() {} }), onDidChangeActiveTextEditor: subscription,
      showQuickPick: async (entries: unknown[]) => options.cancel ? undefined : entries[0],
      showInformationMessage() {}, showErrorMessage: (error: string) => { errors.push(error); } },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return subscription(); } },
    StatusBarAlignment: { Left: 1 }, RelativePattern: class {},
  };
  const filename = path.join(__dirname, "../src/views/projectCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { ProjectController: typeof ProjectController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module, Error,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings"
      ? { CONFIG_SECTION: "zoteroLatexAssistant", getProjectSettings: () => ({ citationCommand: "autocite" }) }
      : name === "../biblatex/styles" ? { localTexLookup: () => undefined,
        listInstalledBiblatexStyles: async () => [{ id: "numeric", bibliographyFile: "local/numeric.bbx", citationFile: "local/numeric.cbx" }] }
      : nativeRequire(name),
  });
  new module.exports.ProjectController({ subscriptions: [], secrets: {} } as never, { appendLine() {} } as never);
  return { chooseStyle: () => commands.get("zoteroLatexAssistant.selectCitationStyle")!(), errors };
}

test("Style command creates missing project config and updates the actual main document", async () => {
  await inProject(async (root) => {
    await writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n\\begin{document}Text\\end{document}\n");
    const command = controller(root);
    await command.chooseStyle();
    assert.deepEqual(command.errors, []);
    assert.equal((await readProjectConfig(root))?.citationStyle, "numeric");
    assert.equal((await readProjectConfig(root))?.citationStyleType, "biblatex");
    assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /\\usepackage\[style=numeric\]\{biblatex\}/);
  });
});

test("Style command migrates legacy CSL and adds missing bibliography setup", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { version: 1, library: null, collectionKey: "", bibFile: "refs.bib",
      citationStyle: "http://www.zotero.org/styles/apa", citationLocale: "de-DE", citationCommand: "textcite", importedItemKeys: [] });
    await writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n\\begin{document}Text\\end{document}\n");
    const command = controller(root);
    await command.chooseStyle();
    assert.deepEqual(command.errors, []);
    const config = await readProjectConfig(root);
    assert.equal(config?.citationStyle, "numeric");
    assert.equal(config?.citationLocale, undefined);
    assert.equal(config?.citationCommand, "textcite");
    const text = await readFile(path.join(root, "main.tex"), "utf8");
    assert.match(text, /\\addbibresource\{refs.bib\}/);
    assert.match(text, /\\printbibliography/);
  });
});

test("Style command preserves escaped examples and bibliography keys while backing up the actual files", async () => {
  await inProject(async (root) => {
    const config = { ...newProjectConfig(), library: { type: "user" as const, id: 0 }, bibFile: "refs.bib", citationStyle: "authoryear",
      importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "StableKey" } };
    await saveProjectConfig(root, config);
    const originalConfig = await readFile(path.join(root, CONFIG_FILE), "utf8");
    const original = String.raw`\\documentclass{example}
\\bibliographystyle{plain}
\\usepackage[style=example]{biblatex}
\\RequirePackage[style=example]{biblatex}
\\PassOptionsToPackage{style=example}{biblatex}
\\ExecuteBibliographyOptions{style=example}
\documentclass{article}
\usepackage[style=authoryear,backend=biber]{biblatex}
\addbibresource{refs.bib}
\\begin{document}
\\end{document}
\begin{document}
\autocite{StableKey}
\printbibliography
\end{document}
`.replace(/\n/g, "\r\n");
    const bibliography = "@book{StableKey,title={Preserved source}}\n";
    await writeFile(path.join(root, "main.tex"), original); await writeFile(path.join(root, "refs.bib"), bibliography);
    const command = controller(root); await command.chooseStyle();
    assert.deepEqual(command.errors, []);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), original.replace("style=authoryear,backend=biber", "backend=biber,style=numeric"));
    assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), bibliography);
    const saved = await readProjectConfig(root);
    assert.equal(saved?.citationStyle, "numeric"); assert.deepEqual(saved?.citationKeys, config.citationKeys);
    const backups = await readdir(path.join(root, ".zotero/backups")); assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backups[0]!, "main.tex"), "utf8"), original);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backups[0]!, CONFIG_FILE), "utf8"), originalConfig);
  });
});

test("Style command aborts before any write when a real classic-BibTeX command follows an escaped example", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...newProjectConfig(), citationStyle: "authoryear" });
    const config = await readFile(path.join(root, CONFIG_FILE), "utf8");
    const text = String.raw`\\bibliographystyle{example}` + "\n" + String.raw`\bibliographystyle{plain}`;
    await writeFile(path.join(root, "main.tex"), text);
    const command = controller(root); await command.chooseStyle();
    assert.match(command.errors[0]!, /classic BibTeX/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), text);
    assert.equal(await readFile(path.join(root, CONFIG_FILE), "utf8"), config);
  });
});

test("Cancelling the picker or encountering unsaved edits preserves all project files", async () => {
  for (const options of [{ cancel: true }, { dirty: "main.tex" }]) {
    await inProject(async (root) => {
      const original = "\\usepackage[style=authoryear]{biblatex}\n";
      await writeFile(path.join(root, "main.tex"), original);
      const command = controller(root, options);
      await command.chooseStyle();
      assert.equal(await readProjectConfig(root), undefined);
      assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), original);
      if ("dirty" in options) assert.match(command.errors[0]!, /Save the open changes/);
      else assert.deepEqual(command.errors, []);
    });
  }
});
