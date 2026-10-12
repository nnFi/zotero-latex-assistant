import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, saveProjectConfig } from "../src/config/project";
import { bibEntries, mergeBibliography } from "../src/biblatex/importer";
import type { ProjectController } from "../src/views/projectCommands";

const config = { ...newProjectConfig(), library: { type: "user" as const, id: 0 }, collectionKey: "ROOT0001", serverId: "old-database",
  bibFile: "refs.bib", citationStyle: "numeric", importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Old2024" } };
const manuscript = '% \\autocite{Old2024} is a comment\n\\documentclass{article}\n\\usepackage[style=numeric]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}A claim \\autocite[12]{Old2024}.\\printbibliography\\end{document}\n';
const bibliography = mergeBibliography('@book{manual,title={Keep this independent source}}\n', ['@book{Old2024,title={Imported source}}']);

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "delete-citations-controller-"));
  try {
    await saveProjectConfig(root, config);
    await writeFile(path.join(root, "main.tex"), manuscript);
    await writeFile(path.join(root, config.bibFile), bibliography);
    await action(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function controller(root: string, options: { confirm?: boolean; dirty?: string; duringReview?: () => Promise<void>; conflict?: boolean; chooseLibrary?: boolean } = {}) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Project" };
  const commands = new Map<string, () => Promise<void>>();
  const errors: string[] = [];
  const previews: string[] = [];
  const requests: string[] = [];
  const invoked: string[] = [];
  const subscription = () => ({ dispose() {} });
  const documents = options.dirty ? [{ uri: { fsPath: path.join(root, options.dirty) }, isDirty: true }] : [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.equal(url.pathname, "/api/", "Deletion never needs Zotero; only a subsequent library change can check the connection");
    return new Response("", { headers: { "Zotero-API-Version": "3", "Zotero-Server-ID": "new-database" } });
  };
  const fakeVscode = {
    workspace: { workspaceFolders: [folder], textDocuments: documents,
      createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription }),
      onDidChangeWorkspaceFolders: subscription,
      findFiles: async () => (await readdir(root)).filter((file) => /\.(bib|tex|ltx|sty|cls)$/.test(file) && file !== "rollback-alias.tex").map((file) => ({ fsPath: path.join(root, file) })) },
    window: { createStatusBarItem: () => ({ show() {} }), onDidChangeActiveTextEditor: subscription,
      showTextDocument: async (uri: { fsPath: string }) => { previews.push(uri.fsPath); },
      showWarningMessage: async (message: string, settings: { modal: boolean }, action: string) => {
        assert.match(message, /Delete all citations/);
        assert.equal(settings.modal, true);
        assert.equal(action, "Delete all citations");
        assert.ok(previews.length, "The complete preview must open before deletion is confirmed");
        assert.deepEqual(await readProjectConfig(root), config);
        assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
        await options.duringReview?.();
        return options.confirm ? action : undefined;
      },
      showInformationMessage: async () => options.chooseLibrary ? "Set library" : undefined,
      showErrorMessage: (message: string) => { errors.push(message); } },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return subscription(); },
      executeCommand: async (name: string) => { invoked.push(name); } },
    Uri: { file: (fsPath: string) => ({ fsPath }) }, StatusBarAlignment: { Left: 1 }, RelativePattern: class {},
  };
  const filename = path.join(__dirname, "../src/views/projectCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { ProjectController: typeof ProjectController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module, Error,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings"
      ? { CONFIG_SECTION: "zoteroLatexAssistant", getClientOptions: () => ({ fetch }), getProjectSettings: () => ({ citationCommand: "autocite" }) }
      : name === "../config/project" && options.conflict ? { ...nativeRequire(name), writeProjectChanges: async (directory: string, changes: { path: string; text: string; previous: string | undefined }[], kind: string) => {
        const main = changes.find((change) => change.path === "main.tex")!;
        return nativeRequire(name).writeProjectChanges(directory, [...changes, { path: "rollback-alias.tex", previous: main.previous, text: "conflict" }], kind);
      } } : nativeRequire(name),
  });
  const projects = new module.exports.ProjectController({ subscriptions: [], secrets: {} } as never, { appendLine() {} } as never);
  return { run: () => commands.get("zoteroLatexAssistant.deleteAllCitations")!(), projects, errors, previews, requests, invoked,
    markDirty: (relative: string) => { documents.push({ uri: { fsPath: path.join(root, relative) }, isDirty: true }); } };
}

test("Confirmed deletion clears actual citations, imported bibliography and binding with backups; a different library can then be selected", async () => {
  await inProject(async (root) => {
    const command = controller(root, { confirm: true, chooseLibrary: true });
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.deepEqual(command.requests, [], "Deletion must work offline and never write or export Zotero records");
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript.replace('A claim \\autocite[12]{Old2024}.', 'A claim .'));
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["manual"]);
    const reset = (await readProjectConfig(root))!;
    assert.equal(reset.library, null);
    assert.equal(reset.serverId, undefined);
    assert.deepEqual(reset.importedItemKeys, []);
    assert.deepEqual(reset.citationKeys, {});
    assert.equal(reset.bibFile, config.bibFile);
    assert.equal(reset.citationStyle, config.citationStyle);
    const backup = (await readdir(path.join(root, ".zotero/backups"))).find((name) => name.startsWith("reset-"))!;
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, config.bibFile), "utf8"), bibliography);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, ".zotero/backups", backup, CONFIG_FILE), "utf8")), config);
    assert.match(await readFile(command.previews[0]!, "utf8"), /\.zotero\/config.json/);
    assert.deepEqual(command.invoked, ["zoteroLatexAssistant.connectProject"]);
    await command.projects.connect({ data: { kind: "library", library: { type: "group", id: 42 } } });
    const next = (await readProjectConfig(root))!;
    assert.deepEqual(next.library, { type: "group", id: 42 });
    assert.equal(next.serverId, "new-database");
    assert.deepEqual(next.importedItemKeys, []);
  });
});

test("Cancelling deletion preserves every source file and mapping", async () => {
  await inProject(async (root) => {
    const command = controller(root);
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.equal(command.previews.length, 1);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bibliography);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.deepEqual(command.invoked, []);
  });
});

test("Unsaved manuscript, bibliography or configuration changes block deletion", async () => {
  for (const dirty of ["main.tex", config.bibFile, CONFIG_FILE]) await inProject(async (root) => {
    const command = controller(root, { confirm: true, dirty });
    await command.run();
    assert.match(command.errors[0]!, /Save the open changes/);
    assert.equal(command.previews.length, 0);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
  });
});

test("Missing .bib still permits a complete reset without creating a replacement file", async () => {
  await inProject(async (root) => {
    await rm(path.join(root, config.bibFile));
    const command = controller(root, { confirm: true });
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.equal((await readProjectConfig(root))?.library, null);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
    await assert.rejects(readFile(path.join(root, config.bibFile)), { code: "ENOENT" });
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript.replace('A claim \\autocite[12]{Old2024}.', 'A claim .'));
  });
});

test("Changed or newly created source files during review prevent reset without losing the user's edits", async () => {
  for (const added of [false, true]) await inProject(async (root) => {
    const file = added ? "new.ltx" : "main.tex";
    const changed = added ? '\\autocite{Old2024}' : manuscript + 'New edits';
    const command = controller(root, { confirm: true, duringReview: () => writeFile(path.join(root, file), changed) });
    await command.run();
    assert.match(command.errors[0]!, /changed during the deletion preview/);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bibliography);
    assert.equal(await readFile(path.join(root, file), "utf8"), changed);
  });
});

test("New unsaved editor changes during review prevent deletion", async () => {
  await inProject(async (root) => {
    const command = controller(root, { confirm: true, duringReview: async () => command.markDirty("main.tex") });
    await command.run();
    assert.match(command.errors[0]!, /Save the open changes/);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
  });
});

test("Late write conflict restores citations, bibliography and library binding together", async () => {
  await inProject(async (root) => {
    await symlink("main.tex", path.join(root, "rollback-alias.tex"));
    const command = controller(root, { confirm: true, conflict: true });
    await command.run();
    assert.match(command.errors[0]!, /in the meantime/);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bibliography);
    assert.deepEqual(command.invoked, []);
  });
});

test("A configuration change during review prevents every deletion and preserves the newer configuration", async () => {
  await inProject(async (root) => {
    const changed = { ...config, citationCommand: "parencite" as const };
    const command = controller(root, { confirm: true, duringReview: async () => saveProjectConfig(root, changed,
      await readFile(path.join(root, CONFIG_FILE), "utf8")) });
    await command.run();
    assert.match(command.errors[0]!, /changed in the meantime/);
    assert.deepEqual(await readProjectConfig(root), changed);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bibliography);
  });
});
