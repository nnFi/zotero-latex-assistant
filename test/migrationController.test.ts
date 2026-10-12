import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { CONFIG_FILE, readProjectConfig, saveProjectConfig } from "../src/config/project";
import { bibEntries, mergeBibliography } from "../src/biblatex/importer";
import type { ProjectConfig } from "../src/shared/types";
import type { ProjectController } from "../src/views/projectCommands";

const config: ProjectConfig = { version: 1, library: { type: "user", id: 0 }, collectionKey: "", bibFile: "refs.bib",
  citationStyle: "authoryear", citationCommand: "autocite", importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Old2024" } };
const manuscript = "% \\cite{Old2024} is only an example\n\\autocite[Old2024][12]{Old2024}\n";

async function inProject(action: (root: string, original: string) => Promise<void>, initialManuscript = manuscript): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "migration-controller-"));
  try {
    await saveProjectConfig(root, config);
    const original = mergeBibliography("", ["@book{Old2024,title={Manual field contents},year=2024}"]);
    await writeFile(path.join(root, config.bibFile), original);
    await writeFile(path.join(root, "main.tex"), initialManuscript);
    await action(root, original);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function controller(root: string, options: { confirm?: boolean; dirty?: string; mode?: "manual" | "bbt"; target?: string; duringReview?: () => Promise<void>; manuscript?: string } = {}) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Project" };
  const commands = new Map<string, () => Promise<void>>();
  const errors: string[] = [];
  const previews: string[] = [];
  const requests: string[] = [];
  const documents = options.dirty ? [{ uri: { fsPath: path.join(root, options.dirty) }, isDirty: true }] : [];
  const subscription = () => ({ dispose() {} });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(options.mode, "bbt", "Manual migrations must work without Zotero or BBT");
    if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
    assert.equal(url.pathname, "/better-bibtex/json-rpc");
    const request = JSON.parse(String(init?.body));
    requests.push(request.method);
    assert.ok(["api.ready", "item.citationkey"].includes(request.method), "Migration must not regenerate keys or export/write Zotero records");
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id,
      result: request.method === "api.ready" ? { betterbibtex: "8", zotero: "10" } : { ITEM0001: "New2025" } }));
  };
  const fakeVscode = {
    workspace: { workspaceFolders: [folder], textDocuments: documents,
      createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription }),
      onDidChangeWorkspaceFolders: subscription, findFiles: async () => (await readdir(root)).filter((file) => /\.(?:bib|tex|ltx|sty|cls)$/.test(file)).map((file) => ({ fsPath: path.join(root, file) })) },
    window: { createStatusBarItem: () => ({ show() {} }), onDidChangeActiveTextEditor: subscription,
      showQuickPick: async (entries: { value?: string }[], settings: { canPickMany?: boolean }) => settings.canPickMany ? entries
        : entries.find((entry) => entry.value === (options.mode ?? "manual")) ?? entries[0],
      showInputBox: async () => options.target ?? "New2025",
      showTextDocument: async (uri: { fsPath: string }) => { previews.push(uri.fsPath); },
      showWarningMessage: async () => {
        assert.equal((await readProjectConfig(root))?.citationKeys?.ITEM0001, "Old2024", "Confirmation must precede all source edits");
        assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), options.manuscript ?? manuscript);
        assert.ok(previews.length, "The reviewable preview must be open before confirmation");
        await options.duringReview?.();
        return options.confirm ? "Migrate keys" : undefined;
      },
      showInformationMessage() {}, showErrorMessage: (message: string) => { errors.push(message); } },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return subscription(); } },
    Uri: { file: (fsPath: string) => ({ fsPath }) }, StatusBarAlignment: { Left: 1 }, RelativePattern: class {},
  };
  const filename = path.join(__dirname, "../src/views/projectCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { ProjectController: typeof ProjectController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module, Error,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings"
      ? { CONFIG_SECTION: "zoteroLatexAssistant", getClientOptions: () => ({ fetch }) } : nativeRequire(name),
  });
  new module.exports.ProjectController({ subscriptions: [], secrets: {} } as never, { appendLine() {} } as never);
  return { run: () => commands.get("zoteroLatexAssistant.migrateCitationKeys")!(), errors, previews, requests,
    markDirty: (relative: string) => { documents.push({ uri: { fsPath: path.join(root, relative) }, isDirty: true }); } };
}

test("Confirmed migration updates actual .bib, config and LaTeX files and backs up every original", async () => {
  await inProject(async (root, original) => {
    const command = controller(root, { confirm: true });
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0001: "New2025" });
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["New2025"]);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript.replace("[12]{Old2024}", "[12]{New2025}"));
    const backup = (await readdir(path.join(root, ".zotero/backups"))).find((file) => file.startsWith("migration-"))!;
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, config.bibFile), "utf8"), original);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "main.tex"), "utf8"), manuscript);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, ".zotero/backups", backup, CONFIG_FILE), "utf8")), config);
    assert.match(await readFile(command.previews[0]!, "utf8"), /Old2024 → New2025/);
  });
});

test("Confirmed alias migration saves both alias citations and their definition together and backs up the original manuscript", async () => {
  const aliases = "\\defcitealias{Old2024}{Study I}\n\\citetalias{Old2024} and \\citepalias{Old2024}\n";
  await inProject(async (root, original) => {
    const command = controller(root, { confirm: true, manuscript: aliases });
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0001: "New2025" });
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["New2025"]);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"),
      "\\defcitealias{New2025}{Study I}\n\\citetalias{New2025} and \\citepalias{New2025}\n");
    const backup = (await readdir(path.join(root, ".zotero/backups"))).find((file) => file.startsWith("migration-"))!;
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "main.tex"), "utf8"), aliases);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, config.bibFile), "utf8"), original);
    assert.match(await readFile(command.previews[0]!, "utf8"), /3 citation\/bibliography reference\(s\)/);
  }, aliases);
});

test("Cancelled migration leaves the source files and mapping unchanged while retaining its preview", async () => {
  await inProject(async (root, original) => {
    const command = controller(root);
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.equal(command.previews.length, 1);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Unsaved manuscript edits block migration before any preview or project changes", async () => {
  await inProject(async (root, original) => {
    const command = controller(root, { confirm: true, dirty: "main.tex" });
    await command.run();
    assert.match(command.errors[0]!, /Save the open changes/);
    assert.equal(command.previews.length, 0);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("A manuscript edit during review cancels the entire migration without overwriting that edit", async () => {
  await inProject(async (root, original) => {
    const changed = manuscript + "New user edits\n";
    const command = controller(root, { confirm: true, duringReview: () => writeFile(path.join(root, "main.tex"), changed) });
    await command.run();
    assert.match(command.errors[0]!, /changed during the migration preview/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), changed);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Bulk migration reads current BBT keys without exporting or writing Zotero metadata", async () => {
  await inProject(async (root) => {
    const command = controller(root, { confirm: true, mode: "bbt" });
    await command.run();
    assert.deepEqual(command.errors, []);
    assert.deepEqual(command.requests, ["api.ready", "item.citationkey"]);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0001: "New2025" });
  });
});

test("New unsaved citations in a previously unchanged file cannot escape the migration snapshot", async () => {
  await inProject(async (root, original) => {
    await writeFile(path.join(root, "extra.tex"), "No citations yet\n");
    const command = controller(root, { confirm: true, duringReview: async () => { command.markDirty("extra.tex"); } });
    await command.run();
    assert.match(command.errors[0]!, /Save the open changes/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("A new project source file created during review invalidates the migration plan", async () => {
  await inProject(async (root, original) => {
    const command = controller(root, { confirm: true, duringReview: () => writeFile(path.join(root, "new.tex"), "\\cite{Old2024}") });
    await command.run();
    assert.match(command.errors[0]!, /file list changed during the migration preview/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});
