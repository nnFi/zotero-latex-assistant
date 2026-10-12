import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, saveProjectConfig } from "../src/config/project";
import type { ProjectController } from "../src/views/projectCommands";

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "bib-file-controller-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function controller(root: string, options: { files?: string[]; target?: string; cancel?: boolean; dirty?: string; rollback?: boolean } = {}) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Project" };
  const commands = new Map<string, () => Promise<void>>();
  const errors: string[] = [];
  const pickerEntries: { value?: string; description?: string }[][] = [];
  const subscription = () => ({ dispose() {} });
  const fakeVscode = {
    workspace: { workspaceFolders: [folder], textDocuments: options.dirty ? [{ uri: { fsPath: path.join(root, options.dirty) }, isDirty: true }] : [],
      createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription }),
      onDidChangeWorkspaceFolders: subscription, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      fs: { readFile: (uri: { fsPath: string }) => readFile(uri.fsPath) },
      findFiles: async (pattern: { pattern: string }) => (options.files ?? ["main.tex", "refs.bib"])
        .filter((file) => pattern.pattern.endsWith("*.bib") ? file.endsWith(".bib") : pattern.pattern.endsWith("*.tex") ? file.endsWith(".tex") : /\.(tex|ltx|sty|cls)$/.test(file))
        .map((file) => ({ fsPath: path.join(root, file) })) },
    window: { createStatusBarItem: () => ({ show() {} }), onDidChangeActiveTextEditor: subscription,
      showQuickPick: async (entries: { value?: string; description?: string }[]) => {
        pickerEntries.push(entries);
        return options.cancel ? undefined : entries.find((entry) => entry.value === options.target)
          ?? entries.find((entry) => entry.value === "") ?? entries[0];
      },
      showInputBox: async () => options.target ?? "new.bib", showInformationMessage() {}, showErrorMessage: (message: string) => { errors.push(message); } },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return subscription(); } },
    StatusBarAlignment: { Left: 1 }, RelativePattern: class { constructor(_folder: unknown, public pattern: string) {} },
  };
  const filename = path.join(__dirname, "../src/views/projectCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { ProjectController: typeof ProjectController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module, Buffer, Error,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings"
      ? { CONFIG_SECTION: "zoteroLatexAssistant", getProjectSettings: () => ({ citationCommand: "autocite" }) }
      : name === "../biblatex/styles" ? { localTexLookup: () => undefined,
        listInstalledBiblatexStyles: async () => [{ id: "numeric", bibliographyFile: "local/numeric.bbx", citationFile: "local/numeric.cbx" }] }
      : name === "../config/project" && options.rollback ? { ...nativeRequire(name), writeProjectChanges: async (directory: string, changes: { path: string; text: string; previous: string | undefined }[], kind: string) => {
        const main = changes.find((change) => change.path === "main.tex")!;
        return nativeRequire(name).writeProjectChanges(directory, [...changes, { path: "rollback-alias.tex", previous: main.previous, text: "conflict" }], kind);
      } } : nativeRequire(name),
  });
  new module.exports.ProjectController({ subscriptions: [], secrets: {} } as never, { appendLine() {} } as never);
  return { setBib: () => commands.get("zoteroLatexAssistant.selectBibFile")!(),
    setStyle: () => commands.get("zoteroLatexAssistant.selectCitationStyle")!(), errors, pickerEntries };
}
const main = '\\documentclass{article}\n\\usepackage[style=numeric]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\\autocite{Stable2024}\\printbibliography\\end{document}\n';
const bib = '@book{Stable2024,title={Manual bibliography contents}}\n';
const config = { ...newProjectConfig(), library: { type: "user" as const, id: 0 }, bibFile: "refs.bib", citationStyle: "numeric",
  importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Stable2024" } };

async function setup(root: string): Promise<void> {
  await saveProjectConfig(root, config);
  await writeFile(path.join(root, "main.tex"), main);
  await writeFile(path.join(root, "refs.bib"), bib);
}

test("The .bib picker marks real resources as detected and stays usable with incomplete code examples", async () => {
  await inProject(async (root) => {
    await writeFile(path.join(root, "refs.bib"), bib);
    await writeFile(path.join(root, "example.bib"), bib);
    const files = ["main.tex", "refs.bib", "example.bib"];
    await writeFile(path.join(root, "main.tex"), '\\verb|\\addbibresource{example.bib}|\n\\addbibresource{refs.bib}');
    const first = controller(root, { files, cancel: true });
    await first.setBib();
    assert.deepEqual(first.errors, []);
    assert.equal(first.pickerEntries[0]!.find((entry) => entry.value === "refs.bib")?.description, "Detected automatically");
    assert.equal(first.pickerEntries[0]!.find((entry) => entry.value === "example.bib")?.description, "Existing file");
    await writeFile(path.join(root, "main.tex"), '\\verb|\\addbibresource{example.bib}');
    const incomplete = controller(root, { files, cancel: true });
    await incomplete.setBib();
    assert.deepEqual(incomplete.errors, []);
    assert.equal(incomplete.pickerEntries[0]!.some((entry) => entry.description === "Detected automatically"), false);
    assert.equal(await readProjectConfig(root), undefined);
  });
});

test("Selecting a new .bib path copies existing literature and saves resource references and config with backups", async () => {
  await inProject(async (root) => {
    await setup(root);
    const command = controller(root, { target: "sources/new.bib" });
    await command.setBib();
    assert.deepEqual(command.errors, []);
    assert.equal(await readFile(path.join(root, "sources/new.bib"), "utf8"), bib);
    assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), bib);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main.replace("{refs.bib}", "{sources/new.bib}"));
    assert.deepEqual(await readProjectConfig(root), { ...config, bibFile: "sources/new.bib" });
    const backup = (await readdir(path.join(root, ".zotero/backups")))[0]!;
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "main.tex"), "utf8"), main);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, ".zotero/backups", backup, CONFIG_FILE), "utf8")), config);
  });
});

test("Selecting an existing bibliography preserves its contents and additional LaTeX resources", async () => {
  await inProject(async (root) => {
    await setup(root);
    const manuscript = main.replace('\\addbibresource{refs.bib}', '\\addbibresource{refs.bib}\n\\addbibresource{extra.bib}');
    await writeFile(path.join(root, "main.tex"), manuscript);
    const target = '@article{Another2025,title={Existing target}}\n';
    await writeFile(path.join(root, "existing.bib"), target);
    const command = controller(root, { target: "existing.bib", files: ["main.tex", "refs.bib", "existing.bib"] });
    await command.setBib();
    assert.deepEqual(command.errors, []);
    assert.equal(await readFile(path.join(root, "existing.bib"), "utf8"), target);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript.replace("{refs.bib}", "{existing.bib}"));
    assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), bib);
  });
});

test("Setting style first or bib first produces identical complete LaTeX setup through the actual commands", async () => {
  const results: string[] = [];
  for (const order of ["style-first", "bib-first"]) {
    await inProject(async (root) => {
      await writeFile(path.join(root, "main.tex"), '\\documentclass{article}\n\\begin{document}Text\\end{document}\n');
      const command = controller(root, { target: "refs.bib", files: ["main.tex"] });
      if (order === "style-first") { await command.setStyle(); await command.setBib(); }
      else { await command.setBib(); await command.setStyle(); }
      assert.deepEqual(command.errors, []);
      results.push(await readFile(path.join(root, "main.tex"), "utf8"));
      assert.equal((await readProjectConfig(root))?.bibFile, "refs.bib");
      assert.equal((await readProjectConfig(root))?.citationStyle, "numeric");
    });
  }
  assert.equal(results[0], results[1]);
  assert.match(results[0]!, /\\addbibresource\{refs.bib\}/);
  assert.match(results[0]!, /\\printbibliography/);
});

test("A missing old .bib can still have its literal resource path updated without manufacturing contents", async () => {
  await inProject(async (root) => {
    await setup(root);
    await rm(path.join(root, "refs.bib"));
    const command = controller(root, { target: "new.bib", files: ["main.tex"] });
    await command.setBib();
    assert.deepEqual(command.errors, []);
    assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /\\addbibresource\{new.bib\}/);
    await assert.rejects(readFile(path.join(root, "new.bib")), { code: "ENOENT" });
  });
});

test("Cancelling or unsaved changes leave all resources, bibliography files and configuration untouched", async () => {
  for (const options of [{ cancel: true }, { dirty: "main.tex" }, { dirty: "refs.bib" }, { dirty: CONFIG_FILE }]) {
    await inProject(async (root) => {
      await setup(root);
      const command = controller(root, options);
      await command.setBib();
      assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
      assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), bib);
      assert.deepEqual(await readProjectConfig(root), config);
      await assert.rejects(readFile(path.join(root, "new.bib")), { code: "ENOENT" });
      if ("dirty" in options) assert.match(command.errors[0]!, /Save the open changes/);
      else assert.deepEqual(command.errors, []);
    });
  }
});

test("A late file conflict rolls back TeX and config and removes the newly copied bibliography", async () => {
  await inProject(async (root) => {
    await setup(root);
    await symlink("main.tex", path.join(root, "rollback-alias.tex"));
    const command = controller(root, { target: "new.bib", rollback: true });
    await command.setBib();
    assert.match(command.errors[0]!, /in the meantime/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
    assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), bib);
    assert.deepEqual(await readProjectConfig(root), config);
    await assert.rejects(readFile(path.join(root, "new.bib")), { code: "ENOENT" });
  });
});

test("Escaping target symlinks and malformed existing bibliographies abort before any project changes", async () => {
  await inProject(async (root) => inProject(async (outside) => {
    await setup(root);
    await symlink(outside, path.join(root, "escape"), "dir");
    const command = controller(root, { target: "escape/new.bib" });
    await command.setBib();
    assert.match(command.errors[0]!, /symlink/);
    await mkdir(path.join(root, "sources"));
    await writeFile(path.join(root, "sources/broken.bib"), '@book{Broken,title={Oops}');
    const broken = controller(root, { target: "sources/broken.bib", files: ["main.tex", "refs.bib", "sources/broken.bib"] });
    await broken.setBib();
    assert.match(broken.errors[0]!, /Incomplete/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
    assert.deepEqual(await readProjectConfig(root), config);
  }));
});
