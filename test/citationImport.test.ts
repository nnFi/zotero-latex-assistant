import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import type { ProjectController } from "../src/views/projectCommands";
import type * as vscode from "vscode";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";
import { readProjectConfig, saveProjectConfig } from "../src/config/project";
import { bibEntries, mergeBibliography } from "../src/biblatex/importer";
import type { SecretStore } from "../src/zotero/writer";
import { insertPreparedCitation } from "../src/biblatex/citations";
import { ZoteroError } from "../src/shared/errors";

const item: ZoteroItem = { library: { type: "user", id: 0 }, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };
const config: ProjectConfig = { version: 1, library: item.library, collectionKey: "ROOT0001", bibFile: "references.bib",
  citationStyle: "apa", citationCommand: "parencite", importedItemKeys: [] };

function controller(root: string, fetch: typeof globalThis.fetch, showMessage: (...args: unknown[]) => Promise<unknown> = async () => {}, secrets?: SecretStore,
  exporter: "native" | "better-biblatex" = "native", transactionConflict = false) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Projekt" };
  const settingsUpdates: { key: string; value: unknown; target: unknown }[] = [];
  const documents: { uri: { fsPath: string }; isDirty: boolean }[] = [];
  const subscription = () => ({ dispose() {} });
  const fakeVscode = { workspace: { workspaceFolders: [folder], textDocuments: documents,
    createFileSystemWatcher: () => ({ onDidChange: subscription, onDidCreate: subscription, onDidDelete: subscription }),
    onDidChangeWorkspaceFolders: subscription,
    findFiles: async (pattern: { pattern: string }) => (await readdir(root, { recursive: true })).filter((file) => (pattern.pattern.includes("bib") ? /\.(bib|tex|ltx|sty|cls)$/ : /\.(tex|ltx|sty|cls)$/).test(file)
      && !/(^|[\\/])(node_modules|\.git|\.zotero|dist|build|out)([\\/]|$)/.test(file)).map((file) => ({ fsPath: path.join(root, file) })),
    getConfiguration: (_section: string, resource: unknown) => ({ update: async (key: string, value: unknown, target: unknown) => {
      assert.equal(resource, folder.uri);
      settingsUpdates.push({ key, value, target });
      assert.equal(key, "bibliographyExporter");
      assert.equal(target, 3);
      assert.equal(value, "native");
      exporter = "native";
    } }) },
    window: { createStatusBarItem: () => ({ show() {} }), onDidChangeActiveTextEditor: subscription,
      withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(), showInformationMessage: showMessage,
      showErrorMessage: showMessage, showWarningMessage: showMessage, showQuickPick: async () => undefined },
    commands: { registerCommand: subscription }, StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { WorkspaceFolder: 3 }, RelativePattern: class { constructor(readonly base: unknown, readonly pattern: string) {} } };
  const filename = path.join(__dirname, "../src/views/projectCommands.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { ProjectController: typeof ProjectController } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings"
      ? { getClientOptions: () => ({ fetch }), getBibliographyExporter: () => exporter, CONFIG_SECTION: "zoteroLatexAssistant" }
      : name === "../config/project" && transactionConflict ? { ...nativeRequire(name), writeProjectChanges: async (directory: string, changes: { path: string; text: string; previous: string | undefined }[], kind: string) => {
        const bibliography = changes.find((change) => change.path === config.bibFile)!;
        return nativeRequire(name).writeProjectChanges(directory, [...changes, { path: "rollback-alias.bib", text: "conflict", previous: bibliography.previous }], kind);
      } } : nativeRequire(name),
  });
  return { projects: new module.exports.ProjectController({ subscriptions: [], secrets } as unknown as vscode.ExtensionContext,
    { appendLine() {} } as unknown as vscode.OutputChannel), folder: folder as unknown as vscode.WorkspaceFolder, settingsUpdates,
    markDirty: (relative: string) => documents.push({ uri: { fsPath: path.join(root, relative) }, isDirty: true }) };
}

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-citation-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("Sources selected in another database cannot be cited or synchronized even if their keys also exist here", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, serverId: "database-B" });
    const originalConfig = await readFile(path.join(root, ".zotero/config.json"), "utf8");
    const bibliography = "@book{existing,title={Keep database B}}\n";
    await writeFile(path.join(root, config.bibFile), bibliography);
    let calls = 0;
    const { projects, folder } = controller(root, async () => { calls++; throw new Error("Unexpected Zotero request"); });
    for (const databaseBinding of [{ serverId: "database-A" }, { serverId: undefined }]) {
      await assert.rejects(projects.prepareCitation([item], folder, databaseBinding), /database binding changed/);
      await assert.rejects(projects.synchronizeItems([item], [item], folder, {}, databaseBinding), /database binding changed/);
    }
    assert.equal(calls, 0);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bibliography);
    assert.equal(await readFile(path.join(root, ".zotero/config.json"), "utf8"), originalConfig);
  });
});

test("Eine fehlende Quelle wird vor der Zitation tatsächlich exportiert und in der Projekt-.bib samt Importbestand gespeichert", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const calls: string[] = [];
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      calls.push(url.pathname);
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{original, title={Quelle}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Quelle" } }]));
    });
    const prepared = await projects.prepareCitation([item], folder);
    const bib = await readFile(path.join(root, "references.bib"), "utf8");
    assert.equal(bibEntries(bib)[0]?.key, "original");
    assert.equal(prepared.citationKeys?.ITEM0001, "original");
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, [item.key]);
    assert.equal(prepared.citationCommand, "parencite");
    assert.deepEqual(calls, ["/api/users/0/collections/ROOT0001/items/top", "/api/users/0/items/ITEM0001"]);
  });
});

test("Eine vorhandene importierte Quelle wird ohne zusätzlichen Zotero-Abruf zitiert", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, importedItemKeys: [item.key] });
    const bib = "@book{zotero-user-0-ITEM0001,title={Manuell ergänzte Daten}}\n";
    await writeFile(path.join(root, config.bibFile), bib);
    let calls = 0;
    const { projects, folder } = controller(root, async () => { calls++; throw new Error("offline"); });
    await projects.prepareCitation([item], folder);
    assert.equal(calls, 0);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bib);
  });
});

test("Ein Exportfehler verändert die vorhandene Bib-Datei nicht und liefert keine vorbereitete Zitation", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const bib = "@book{manual,title={Eigene Quelle}}\n";
    await writeFile(path.join(root, config.bibFile), bib);
    const { projects, folder } = controller(root, async (input) => new URL(String(input)).searchParams.get("format") === "biblatex"
      ? new Response("", { status: 500 }) : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Quelle" } }])));
    await assert.rejects(projects.prepareCitation([item], folder), /failed/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bib);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
  });
});

test("Eine weiterhin sichtbare Erfolgsmeldung hält weder die Aktion noch die Projektsperre fest", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const closeMessages: (() => void)[] = [];
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{original,title={Quelle}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Quelle" } }]));
    },
    () => new Promise<void>((resolve) => { closeMessages.push(resolve); }));
    const withinDeadline = async (action: Promise<void>) => {
      const timeout = new AbortController();
      try { await Promise.race([action, delay(1000, undefined, { signal: timeout.signal }).then(() => { throw new Error("Die Aktion wartet noch auf ihre Statusmeldung."); })]); }
      finally { timeout.abort(); }
    };
    try {
      await withinDeadline(projects.importItems([item], folder));
      assert.equal(closeMessages.length, 1);
      // Erste Meldung bleibt offen; dieselbe Projektaktion muss erneut möglich sein.
      await withinDeadline(projects.importItems([item], folder));
      assert.equal(closeMessages.length, 2);
      assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, [item.key]);
    } finally { closeMessages.forEach((close) => close()); }
  });
});

test("Eine Fehlerbenachrichtigung lässt den Befehlsablauf ohne Warten auf ihr Schließen enden", async () => {
  await inProject(async (root) => {
    let closeMessage: () => void = () => {};
    let messages = 0;
    const { projects } = controller(root, async () => new Response("[]"), () => {
      messages++; return new Promise<void>((resolve) => { closeMessage = resolve; });
    });
    const timeout = new AbortController();
    try {
      await Promise.race([projects.run(async () => { throw new Error("Fehler beim Import"); }),
        delay(1000, undefined, { signal: timeout.signal }).then(() => { throw new Error("Fehlerablauf wartet auf Benachrichtigung."); })]);
      assert.equal(messages, 1);
    } finally { timeout.abort(); closeMessage(); }
  });
});

test("Neue BBT-Schlüssel werden übernommen und bleiben bei späteren Exporten mit geändertem Zotero-Schlüssel stabil", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    let pluginCalls = 0;
    const { projects, folder } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") {
        pluginCalls++;
        const request = JSON.parse(String(init?.body));
        const result = request.method === "api.ready" ? { betterbibtex: "8.0", zotero: "7.0" } : { ITEM0001: "Mueller2024Methoden" };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      }
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{changed_native,title={Quelle}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Quelle" } }]));
    });
    await projects.importItems([item], folder);
    assert.equal((await readProjectConfig(root))?.citationKeys?.ITEM0001, "Mueller2024Methoden");
    await projects.importItems([item], folder);
    assert.equal(pluginCalls, 2); // ready und einmalige gebündelte Zuordnung
    assert.equal(bibEntries(await readFile(path.join(root, config.bibFile), "utf8"))[0]?.key, "Mueller2024Methoden");
  });
});

test("Vor dem Upgrade importierte technische Keys werden beim Aktualisieren nicht umbenannt", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, importedItemKeys: [item.key] });
    await writeFile(path.join(root, config.bibFile), mergeBibliography("", ["@book{zotero-user-0-ITEM0001,title={Alt}}"]));
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      assert.notEqual(url.pathname, "/better-bibtex/json-rpc");
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{Mueller2024Neu,title={Neu}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Neu" } }]));
    });
    await projects.importItems([item], folder);
    const bib = await readFile(path.join(root, config.bibFile), "utf8");
    assert.equal(bibEntries(bib)[0]?.key, "zotero-user-0-ITEM0001");
    assert.match(bib, /title=\{Neu\}/);
  });
});

test("Neu übernommene Schlüssel werden über eine autorisierte versionsgeprüfte Extra-Änderung in Zotero festgehalten", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, serverId: "database-A" });
    const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "database-A" };
    let patches = 0;
    const values = new Map<string, string>();
    const secrets: SecretStore = { get: async (key) => values.get(key), store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
    const { projects, folder } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.pathname === "/api/local/authorize") return new Response(JSON.stringify({ key: "A".repeat(32), remember: true }), { headers });
      if (init?.method === "PATCH") {
        patches++;
        assert.deepEqual(JSON.parse(String(init.body)), { extra: "DOI: 10.1234/example\nCitation Key: Mueller2024Methoden" });
        assert.equal(new Headers(init.headers).get("If-Unmodified-Since-Version"), "7");
        assert.equal(new Headers(init.headers).get("Zotero-Server-ID"), "database-A");
        return new Response(null, { status: 204, headers });
      }
      if (url.searchParams.get("format") === "biblatex") return new Response("@book{Mueller2024Methoden,title={Quelle}}", { headers });
      const source = { key: item.key, version: 7, data: { itemType: "book", title: "Quelle", extra: "DOI: 10.1234/example" } };
      return new Response(JSON.stringify(url.pathname.endsWith("/top") ? [source] : source), { headers });
    }, undefined, secrets);
    await projects.importItems([item], folder);
    assert.equal(patches, 1);
    assert.equal((await readProjectConfig(root))?.citationKeys?.ITEM0001, "Mueller2024Methoden");
    assert.ok(!(await readFile(path.join(root, ".zotero/config.json"), "utf8")).includes("A".repeat(32)));
  });
});

test("Kollidierende Zotero-Schlüssel verändern weder die bestehende Bib-Datei noch die Importzuordnung", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const old = "@book{Mueller2024Methoden,title={Eigene Quelle}}\n";
    await writeFile(path.join(root, config.bibFile), old);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{Mueller2024Methoden,title={Andere Quelle}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: "Quelle" } }]));
    });
    await assert.rejects(projects.importItems([item], folder), /already in use/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), old);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
  });
});

test("Abgelehnte Zotero-Schreibfreigabe verliert weder den erfolgreichen Bib-Import noch den gespeicherten Schlüssel", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, serverId: "database-A" });
    const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "database-A" };
    let patches = 0;
    const secrets: SecretStore = { get: async () => undefined, store: async () => {}, delete: async () => {} };
    const { projects, folder } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.pathname === "/api/local/authorize") return new Response("", { status: 403, headers });
      if (init?.method === "PATCH") patches++;
      if (url.searchParams.get("format") === "biblatex") return new Response("@book{Mueller2024Methoden,title={Quelle}}", { headers });
      const source = { key: item.key, version: 7, data: { itemType: "book", title: "Quelle", extra: "" } };
      return new Response(JSON.stringify(url.pathname.endsWith("/top") ? [source] : source), { headers });
    }, undefined, secrets);
    await projects.importItems([item], folder);
    assert.equal(patches, 0);
    assert.equal((await readProjectConfig(root))?.citationKeys?.ITEM0001, "Mueller2024Methoden");
    assert.equal(bibEntries(await readFile(path.join(root, config.bibFile), "utf8"))[0]?.key, "Mueller2024Methoden");
  });
});

test("List synchronization removes unchecked sources, preserves checked fields and supports clearing the selection", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    const tracked = { ...config, importedItemKeys: [item.key, second.key], citationKeys: { ITEM0001: "First2024", ITEM0002: "Second2024" } };
    await saveProjectConfig(root, tracked);
    const old = mergeBibliography("% Keep unrelated sources\n@book{unrelated,title={Personal}}\n",
      ["@book{First2024,title={Remove}}", "@book{Second2024,title={Manually maintained fields}}"]);
    await writeFile(path.join(root, config.bibFile), old);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      assert.equal(url.searchParams.get("format"), "json", "Existing checked entries must not be re-exported");
      return new Response(JSON.stringify([item, second].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    });
    await projects.synchronizeItems([second], [item, second], folder);
    const text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["unrelated", "Second2024"]);
    assert.match(text, /Manually maintained fields/);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, [second.key]);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0002: "Second2024" });
    assert.ok((await readdir(path.join(root, ".zotero/backups"))).some((file) => file.startsWith("bibliography-")));
    await projects.synchronizeItems([], [item], folder);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), text, "Sources outside the shown list remain unchanged");
    await projects.synchronizeItems([], [item, second], folder);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["unrelated"]);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, {});
  });
});

test("Manual deletion from the managed .bib can be synchronized and the source can later be checked again", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "First2024" } });
    const deleted = mergeBibliography("", ["@book{First2024,title={Remove}}"])
      .replace("@book{First2024,title={Remove}}", "");
    await writeFile(path.join(root, config.bibFile), deleted);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return url.searchParams.get("format") === "biblatex" ? new Response("@book{First2024,title={Re-added}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    });
    await projects.synchronizeItems([], [item], folder);
    assert.equal(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).length, 0);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
    await projects.synchronizeItems([item], [item], folder);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["First2024"]);
  });
});

test("Failed addition during synchronization cannot remove unchecked entries or alter project mappings", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "First2024" } };
    await saveProjectConfig(root, tracked);
    const old = mergeBibliography("", ["@book{First2024,title={Original}}"]);
    await writeFile(path.join(root, config.bibFile), old);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      return url.searchParams.get("format") === "biblatex" ? new Response("", { status: 500 })
        : new Response(JSON.stringify([item, second].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    });
    await assert.rejects(projects.synchronizeItems([second], [item, second], folder));
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), old);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("An empty selection from a foreign-library list cannot delete a matching project key", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "First2024" } };
    await saveProjectConfig(root, tracked);
    const old = mergeBibliography("", ["@book{First2024,title={Original}}"]);
    await writeFile(path.join(root, config.bibFile), old);
    const { projects, folder } = controller(root, async () => { throw new Error("Should not request Zotero"); });
    await assert.rejects(projects.synchronizeItems([], [{ ...item, library: { type: "group", id: 42 } }], folder), /source list does not belong/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), old);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("After a collection change, sources outside the selected collection are removed and cannot be reintroduced through an old list", async () => {
  await inProject(async (root) => {
    const added = { ...item, key: "ITEM0002" };
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Old2024" } };
    await saveProjectConfig(root, tracked);
    const original = mergeBibliography("", ["@book{Old2024,title={Preserved custom fields}}"]);
    await writeFile(path.join(root, config.bibFile), original);
    const exports: string[] = [];
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.searchParams.get("format") === "biblatex") {
        exports.push(url.pathname);
        assert.ok(url.pathname.startsWith("/api/users/0/items/"));
        return new Response(url.pathname.endsWith(item.key) ? "@book{native_old,title={Latest old metadata}}" : "@book{New2025,title={New source}}");
      }
      assert.equal(url.pathname, "/api/users/0/collections/NEWCOL01/items/top");
      return new Response(JSON.stringify([{ key: added.key, data: { itemType: "book", title: "New source" } }]));
    });
    await projects.connect({ data: { kind: "collection", collection: { library: item.library, key: "NEWCOL01", name: "New collection", parentKey: null } } });
    assert.deepEqual(await readProjectConfig(root), { ...tracked, collectionKey: "NEWCOL01", importedItemKeys: [], citationKeys: {} });
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")), []);
    await projects.synchronizeItems([added], [added], folder);
    let text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["New2025"]);
    assert.doesNotMatch(text, /Preserved custom fields/);
    assert.deepEqual(exports, ["/api/users/0/items/ITEM0002"]);
    await assert.rejects(projects.prepareCitation([item], folder), /selected source/);
    assert.deepEqual(exports, ["/api/users/0/items/ITEM0002"]);
    await projects.updateBib();
    text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.doesNotMatch(text, /Latest old metadata/);
    assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["New2025"]);
    await projects.synchronizeItems([], [added], folder);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")), []);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, {});
  });
});

test("An imported source outside the new collection can be restored from its library when the .bib is missing", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, collectionKey: "NEWCOL01", importedItemKeys: [item.key], citationKeys: { ITEM0001: "Old2024" } };
    await saveProjectConfig(root, tracked);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("format") === "biblatex") {
        assert.equal(url.pathname, "/api/users/0/items/ITEM0001");
        return new Response("@book{native_old,title={Restored source}}");
      }
      assert.equal(url.pathname, "/api/users/0/collections/NEWCOL01/items/top");
      return new Response("[]");
    });
    await projects.prepareCitation([item], folder);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["Old2024"]);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("A source removed from the actual library cannot cause a partial update after a collection change", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, collectionKey: "NEWCOL01", importedItemKeys: [item.key], citationKeys: { ITEM0001: "Old2024" } };
    await saveProjectConfig(root, tracked);
    const original = mergeBibliography("", ["@book{Old2024,title={Keep this source}}"]);
    await writeFile(path.join(root, config.bibFile), original);
    const { projects } = controller(root, async (input) => new URL(String(input)).searchParams.get("format") === "biblatex"
      ? new Response("", { status: 404 }) : new Response("[]"));
    await assert.rejects(projects.updateBib(), /HTTP 404/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("Better BibLaTeX imports full translator metadata and stores the exported citation key", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const raw = "@string{pub={Example Press}}\n@article{BBT2024,title={A {LaTeX} study},journaltitle={Journal},date={2024-03-12},langid={german},eprinttype={arxiv},eprint={2403.12345},urldate={2026-10-11},publisher=pub}";
    let pluginAvailable = true;
    const { projects, folder } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      assert.notEqual(url.searchParams.get("format"), "biblatex", "The full translator must not use native metadata export");
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") {
        assert.ok(pluginAvailable, "Preserving/removing existing selections must not need the translator");
        const request = JSON.parse(String(init?.body));
        assert.ok(["api.ready", "item.citationkey", "item.export"].includes(request.method));
        const result = request.method === "api.ready" ? { betterbibtex: "8.0", zotero: "10.0" }
          : request.method === "item.citationkey" ? { ITEM0001: "BBT2024" } : raw;
        if (request.method === "item.export") assert.deepEqual(request.params, [["BBT2024"], "Better BibLaTeX"]);
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      }
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "journalArticle", title: item.title } }]));
    }, undefined, undefined, "better-biblatex");
    await projects.importItems([item], folder);
    const text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.ok(text.includes(raw));
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0001: "BBT2024" });
    pluginAvailable = false;
    await projects.synchronizeItems([item], [item], folder);
    const synchronized = await readFile(path.join(root, config.bibFile), "utf8");
    assert.ok(synchronized.includes(raw.slice(raw.indexOf("@article"))));
    assert.match(synchronized, /@string\{pub=\{Example Press\}\}/);
    await projects.synchronizeItems([], [item], folder);
    assert.equal(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).length, 0);
  });
});

test("Better BibLaTeX metadata updates preserve previously saved project citation keys", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Persisted2024" } };
    await saveProjectConfig(root, tracked);
    await writeFile(path.join(root, config.bibFile), mergeBibliography("", ["@book{Persisted2024,title={Old}}"]));
    const { projects } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      assert.notEqual(url.searchParams.get("format"), "biblatex");
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") {
        const request = JSON.parse(String(init?.body));
        const result = request.method === "api.ready" ? { betterbibtex: "8.0", zotero: "10.0" }
          : request.method === "item.citationkey" ? { ITEM0001: "Changed2025" }
            : "@book{Changed2025,title={Full translator metadata},langid={english},origdate={1997}}";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      }
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, undefined, undefined, "better-biblatex");
    await projects.updateBib();
    const text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["Persisted2024"]);
    assert.match(text, /origdate=\{1997\}/);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, tracked.citationKeys);
  });
});

test("Missing Better BibTeX preserves all project files without a native fallback", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = "@book{manual,title={Keep}}\n";
    await writeFile(path.join(root, config.bibFile), original);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      assert.notEqual(url.searchParams.get("format"), "biblatex");
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, undefined, undefined, "better-biblatex");
    await assert.rejects(projects.importItems([item], folder), (error: unknown) => error instanceof ZoteroError && error.code === "CANCELLED");
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Failure in the second Better BibLaTeX export cannot partially synchronize the bibliography", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    await saveProjectConfig(root, config);
    const original = "@book{manual,title={Keep}}\n";
    await writeFile(path.join(root, config.bibFile), original);
    const { projects, folder } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      assert.notEqual(url.searchParams.get("format"), "biblatex");
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") {
        const request = JSON.parse(String(init?.body));
        if (request.method === "item.export" && request.params[0][0] === "Second2024") {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "Translator failed" } }));
        }
        const result = request.method === "api.ready" ? { betterbibtex: "8.0", zotero: "10.0" }
          : request.method === "item.citationkey" ? { ITEM0001: "First2024", ITEM0002: "Second2024" }
            : "@book{First2024,title={First export}}";
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      }
      return new Response(JSON.stringify([item, second].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    }, undefined, undefined, "better-biblatex");
    await assert.rejects(projects.synchronizeItems([item, second], [item, second], folder), /Translator failed/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Duplicate DOI across distinct bibliography keys aborts an import without changing any files", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = "@article{manual,title={Original source},doi={10.1234/paper}}\n";
    await writeFile(path.join(root, config.bibFile), original);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return url.searchParams.get("format") === "biblatex" ? new Response("@article{new_key,title={Another title},doi={https://doi.org/10.1234/PAPER}}")
        : new Response(JSON.stringify([{ key: item.key, data: { itemType: "journalArticle", title: item.title } }]));
    });
    await assert.rejects(projects.importItems([item], folder), /Duplicate DOI/);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("A title-author-year duplicate requires an explicit override before an import can change files", async () => {
  for (const allow of [false, true]) {
    await inProject(async (root) => {
      await saveProjectConfig(root, config);
      const original = '@article{manual,title={A Detailed Scientific Study},author={Smith, John},year=2024}\n';
      await writeFile(path.join(root, config.bibFile), original);
      let warnings = 0;
      const { projects, folder } = controller(root, async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
        if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
        return url.searchParams.get("format") === "biblatex" ? new Response('@article{new_key,title={A detailed scientific study},author={John Smith},date={2024-03-12}}')
          : new Response(JSON.stringify([{ key: item.key, data: { itemType: "journalArticle", title: item.title } }]));
      }, async (message) => {
        if (String(message).startsWith("Possible duplicate")) { warnings++; return allow ? "Import anyway" : undefined; }
        return undefined;
      });
      await projects.importItems([item], folder);
      assert.equal(warnings, 1);
      if (allow) assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["manual", "new_key"]);
      else {
        assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
        assert.deepEqual(await readProjectConfig(root), config);
      }
    });
  }
});

test("Replacing a deselected source with the same DOI does not create a false duplicate", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    await saveProjectConfig(root, { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "OldKey" } });
    await writeFile(path.join(root, config.bibFile), mergeBibliography("", ['@article{OldKey,doi={10.1234/paper}}']));
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      return url.searchParams.get("format") === "biblatex" ? new Response('@article{NewKey,doi={10.1234/paper}}')
        : new Response(JSON.stringify([item, second].map((source) => ({ key: source.key, data: { itemType: "journalArticle", title: source.title } }))));
    });
    await projects.synchronizeItems([second], [item, second], folder);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["NewKey"]);
  });
});

test("New crossrefs and subsequent metadata refreshes remain consistent after parent key migration", async () => {
  for (const exporter of ["native", "better-biblatex"] as const) {
    await inProject(async (root) => {
      const child = { ...item, key: "ITEM0002", itemType: "bookSection" };
      const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "MigratedParent" } };
      await saveProjectConfig(root, tracked);
      await writeFile(path.join(root, config.bibFile), mergeBibliography("", ["@book{MigratedParent,title={Preserved manual parent fields}}"]));
      const { projects, folder } = controller(root, async (input, init) => {
        const url = new URL(String(input));
        const parent = "@book{ProviderParent,title={Updated parent fields}}";
        const descendant = "@inbook{ProviderChild,title={A chapter},crossref={ProviderParent}}";
        if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
        if (url.pathname === "/better-bibtex/json-rpc") {
          if (exporter === "native") return new Response("", { status: 404 });
          const request = JSON.parse(String(init?.body));
          const result = request.method === "api.ready" ? { betterbibtex: "8", zotero: "10" }
            : request.method === "item.citationkey" ? Object.fromEntries(request.params[0].map((key: string) => [key, key === item.key ? "ProviderParent" : "ProviderChild"]))
              : request.params[0][0] === "ProviderParent" ? parent : descendant;
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        }
        if (url.searchParams.get("format") === "biblatex") {
          assert.equal(exporter, "native");
          return new Response(url.pathname.endsWith(item.key) ? parent : descendant);
        }
        return new Response(JSON.stringify([item, child].map((source) => ({ key: source.key, data: { itemType: source.itemType, title: source.title } }))));
      }, undefined, undefined, exporter);
      await projects.synchronizeItems([child], [child], folder);
      let text = await readFile(path.join(root, config.bibFile), "utf8");
      assert.match(text, /crossref=\{MigratedParent\}/);
      assert.match(text, /Preserved manual parent fields/);
      await projects.updateBib();
      text = await readFile(path.join(root, config.bibFile), "utf8");
      assert.match(text, /crossref=\{MigratedParent\}/);
      assert.match(text, /Updated parent fields/);
      assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["MigratedParent", "ProviderChild"]);
    });
  }
});

test("Pinned external entries are cited offline with their actual key and adopted without rewriting bibliography text", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = '@book{Pinned2024,title={Manual fields}}\n';
    await writeFile(path.join(root, config.bibFile), original);
    let calls = 0;
    const { projects, folder } = controller(root, async () => { calls++; throw new Error("offline"); });
    const prepared = await projects.prepareCitation([{ ...item, citationKey: "Pinned2024" }], folder);
    assert.equal(prepared.citationKeys?.[item.key], "Pinned2024");
    assert.deepEqual(prepared.importedItemKeys, [item.key]);
    assert.equal(calls, 0);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
  });
});

test("External Better BibTeX entries are recognized consistently by citing and manual metadata refresh", async () => {
  for (const action of ["cite", "refresh"] as const) {
    await inProject(async (root) => {
      await saveProjectConfig(root, config);
      const original = '@book{External2024,title={Manual fields}}\n';
      await writeFile(path.join(root, config.bibFile), original);
      let exports = 0;
      const { projects, folder } = controller(root, async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
        if (url.pathname === "/better-bibtex/json-rpc") {
          const request = JSON.parse(String(init?.body));
          const result = request.method === "api.ready" ? { betterbibtex: "8", zotero: "10" }
            : request.method === "item.citationkey" ? { ITEM0001: "External2024" }
              : (exports++, '@book{External2024,title={Full updated metadata}}');
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
        }
        assert.equal(url.searchParams.get("format"), "json");
        return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
      }, undefined, undefined, "better-biblatex");
      if (action === "cite") {
        const prepared = await projects.prepareCitation([item], folder);
        assert.equal(prepared.citationKeys?.[item.key], "External2024");
        assert.equal(exports, 0);
        assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
      } else {
        await projects.updateBib();
        assert.equal(exports, 1);
        assert.match(await readFile(path.join(root, config.bibFile), "utf8"), /Full updated metadata/);
        assert.equal((await readProjectConfig(root))?.citationKeys?.[item.key], "External2024");
      }
    });
  }
});

test("Manual metadata refresh honors saved deletions while a subsequent citation restores only its selected source", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    const tracked = { ...config, importedItemKeys: [item.key, second.key], citationKeys: { ITEM0001: "Deleted2024", ITEM0002: "Present2024" } };
    await saveProjectConfig(root, tracked);
    const original = mergeBibliography("", ['@book{Deleted2024,title={Delete me}}', '@book{Present2024,title={Old fields}}']);
    await writeFile(path.join(root, config.bibFile), original.replace('@book{Deleted2024,title={Delete me}}', ''));
    const exported: string[] = [];
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get("format") === "biblatex") {
        const key = url.pathname.split("/").at(-1)!;
        exported.push(key);
        return new Response(`@book{Provider${key},title={Updated ${key}}}`);
      }
      return new Response(JSON.stringify([item, second].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    });
    await projects.updateBib();
    assert.deepEqual(exported, [second.key]);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["Present2024"]);
    assert.equal((await readProjectConfig(root))?.citationKeys?.[item.key], "Deleted2024", "Saved names survive manual deletions for later citations");
    await projects.prepareCitation([item], folder);
    assert.deepEqual(exported, [second.key, item.key]);
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["Present2024", "Deleted2024"]);
  });
});

test("Imports preserve existing manual fields and never restore unrelated deleted project sources", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    const third = { ...item, key: "ITEM0003" };
    await saveProjectConfig(root, { ...config, importedItemKeys: [item.key, second.key], citationKeys: { ITEM0001: "Missing2024", ITEM0002: "Keep2024" } });
    await writeFile(path.join(root, config.bibFile), '@book{Keep2024,title={Manual field contents}}\n');
    const exported: string[] = [];
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.searchParams.get("format") === "biblatex") { exported.push(url.pathname); return new Response('@book{New2025,title={New source}}'); }
      return new Response(JSON.stringify([item, second, third].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    });
    await projects.importItems([third], folder);
    const text = await readFile(path.join(root, config.bibFile), "utf8");
    assert.match(text, /Manual field contents/);
    assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["Keep2024", "New2025"]);
    assert.deepEqual(exported, ["/api/users/0/items/ITEM0003"]);
  });
});

test("All import paths roll back bibliography and configuration together after a late write conflict", async () => {
  for (const action of ["import", "refresh", "cite"] as const) {
    await inProject(async (root) => {
      const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Stable2024" } };
      await saveProjectConfig(root, tracked);
      const original = action === "cite" ? "@book{manual,title={Unrelated}}\n" : '@book{Stable2024,title={Old metadata}}\n';
      await writeFile(path.join(root, config.bibFile), original);
      await symlink(config.bibFile, path.join(root, "rollback-alias.bib"));
      const { projects, folder } = controller(root, async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
        if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
        return url.searchParams.get("format") === "biblatex" ? new Response('@book{Provider2025,title={New metadata}}')
          : new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
      }, undefined, undefined, "native", true);
      await assert.rejects(action === "import" ? projects.importItems([item], folder) : action === "refresh" ? projects.updateBib()
        : projects.prepareCitation([item], folder), /in the meantime/);
      assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
      assert.deepEqual(await readProjectConfig(root), tracked);
      const backups = await readdir(path.join(root, ".zotero/backups"));
      assert.ok(backups.some((name) => name.startsWith("bibliography-")));
    });
  }
});

test("An empty or missing bibliography prompts for selection instead of restoring a stale import list", async () => {
  for (const missing of [false, true]) {
    await inProject(async (root) => {
      const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Deleted2024" } };
      await saveProjectConfig(root, tracked);
      if (!missing) await writeFile(path.join(root, config.bibFile), "");
      let exports = 0;
      const { projects } = controller(root, async (input) => {
        const url = new URL(String(input));
        if (url.searchParams.get("format") === "biblatex") { exports++; throw new Error("No source was selected"); }
        return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
      });
      await projects.updateBib(); // Cancel the offered source selection.
      assert.equal(exports, 0);
      assert.deepEqual(await readProjectConfig(root), tracked);
      if (missing) await assert.rejects(readFile(path.join(root, config.bibFile)), { code: "ENOENT" });
      else assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), "");
    });
  }
});

test("Citing with missing Better BibTeX offers local export, saves the project choice and imports before inserting", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, citationStyle: "numeric", citationStyleType: "biblatex" });
    const original = '@book{manual,title={Keep existing literature}}\n';
    await writeFile(path.join(root, config.bibFile), original);
    let offers = 0;
    let exports = 0;
    const { projects, folder, settingsUpdates } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.searchParams.get("format") === "biblatex") {
        exports++;
        return new Response('@book{Native2024,title={Imported source},author={Smith, Jane},year={2024}}');
      }
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, async (message, options, action) => {
      assert.match(String(message), /Better BibLaTeX is unavailable/);
      assert.equal((options as { modal: boolean }).modal, true);
      assert.equal(action, "Use Zotero export");
      offers++;
      return action;
    }, undefined, "better-biblatex");
    let text = "A claim.";
    const target = { isCurrent: () => true, insert: async (citation: string) => {
      const entries = bibEntries(await readFile(path.join(root, config.bibFile), "utf8"));
      assert.ok(entries.some((entry) => entry.key === "Native2024"), "Bibliography must be written before insertion");
      text += citation;
      return true;
    } };
    await insertPreparedCitation([item], target, () => projects.prepareCitation([item], folder), { postnote: "12" });
    assert.equal(text, "A claim.\\parencite[12]{Native2024}");
    assert.equal(offers, 1);
    assert.equal(exports, 1);
    assert.deepEqual(settingsUpdates, [{ key: "bibliographyExporter", value: "native", target: 3 }]);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0001: "Native2024" });
    assert.match(await readFile(path.join(root, config.bibFile), "utf8"), /Keep existing literature/);
    await insertPreparedCitation([item], target, () => projects.prepareCitation([item], folder));
    assert.equal(offers, 1, "Existing sources can be cited without another exporter prompt");
    assert.equal(exports, 1);
  });
});

test("Cancelling the exporter offer leaves bibliography, configuration, settings and LaTeX untouched", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = '@book{manual,title={Keep}}\n';
    await writeFile(path.join(root, config.bibFile), original);
    let offers = 0;
    const { projects, folder, settingsUpdates } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      assert.notEqual(url.searchParams.get("format"), "biblatex", "Cancellation must not use the native exporter");
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, async () => { offers++; return undefined; }, undefined, "better-biblatex");
    let inserted = false;
    await assert.rejects(insertPreparedCitation([item], { isCurrent: () => true, insert: async () => { inserted = true; return true; } },
      () => projects.prepareCitation([item], folder)), (error: unknown) => error instanceof ZoteroError && error.code === "CANCELLED");
    assert.equal(offers, 1);
    assert.equal(inserted, false);
    assert.deepEqual(settingsUpdates, []);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Translator failures never offer a different exporter or insert a citation", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = '@book{manual,title={Keep}}\n';
    await writeFile(path.join(root, config.bibFile), original);
    let offers = 0;
    const { projects, folder, settingsUpdates } = controller(root, async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") {
        const request = JSON.parse(String(init?.body));
        const response = request.method === "item.export" ? { error: { code: -32000, message: "Translator failed" } }
          : { result: request.method === "api.ready" ? { betterbibtex: "8", zotero: "10" } : { ITEM0001: "BBT2024" } };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response }));
      }
      assert.notEqual(url.searchParams.get("format"), "biblatex");
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, async () => { offers++; return "Use Zotero export"; }, undefined, "better-biblatex");
    let inserted = false;
    await assert.rejects(insertPreparedCitation([item], { isCurrent: () => true, insert: async () => { inserted = true; return true; } },
      () => projects.prepareCitation([item], folder)), /Translator failed/);
    assert.equal(offers, 0);
    assert.equal(inserted, false);
    assert.deepEqual(settingsUpdates, []);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Native export failure after choosing recovery does not write an incomplete bibliography or citation", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const original = '@book{manual,title={Keep}}\n';
    await writeFile(path.join(root, config.bibFile), original);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.searchParams.get("format") === "biblatex") return new Response("", { status: 500 });
      return new Response(JSON.stringify([{ key: item.key, data: { itemType: "book", title: item.title } }]));
    }, async () => "Use Zotero export", undefined, "better-biblatex");
    let inserted = false;
    await assert.rejects(insertPreparedCitation([item], { isCurrent: () => true, insert: async () => { inserted = true; return true; } },
      () => projects.prepareCitation([item], folder)), /HTTP 500/);
    assert.equal(inserted, false);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
    assert.deepEqual(await readProjectConfig(root), config);
  });
});

test("Project command handles a cancelled export quietly", async () => {
  await inProject(async (root) => {
    let messages = 0;
    const { projects } = controller(root, async () => new Response("[]"), async () => { messages++; });
    await projects.run(async () => { throw new ZoteroError("CANCELLED", "Export cancelled"); });
    assert.equal(messages, 0);
  });
});

function sourcesOnly(items: readonly ZoteroItem[]): typeof globalThis.fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
    if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
    assert.notEqual(url.searchParams.get("format"), "biblatex", "Existing checked sources must not be exported again");
    return new Response(JSON.stringify(items.map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
  };
}

test("Unchecking a source synchronizes bibliography and every project citation while preserving mixed and outside-list references", async () => {
  await inProject(async (root) => {
    const second = { ...item, key: "ITEM0002" };
    const outside = { ...item, key: "ITEM0003" };
    const tracked = { ...config, importedItemKeys: [item.key, second.key, outside.key], citationKeys: { ITEM0001: "Remove2024", ITEM0002: "Keep2024", ITEM0003: "Outside2024" } };
    await saveProjectConfig(root, tracked);
    const old = mergeBibliography('@book{manual,title={Personal source}}\n', ['@book{Remove2024,title={Remove}}',
      '@book{Keep2024,title={Manual fields},related={Remove2024}}', '@book{Outside2024,title={Keep outside collection}}']);
    await writeFile(path.join(root, config.bibFile), old);
    const manuscript = '% \\cite{Remove2024} is an example\nText \\autocite[12]{Remove2024}. Mixed \\parencite[see][14]{Remove2024,Keep2024}. Outside \\textcite{Outside2024}.\n';
    const preamble = '\\footcite{Remove2024}\n';
    const chapter = '\\textcquote{Remove2024}{Quoted prose remains}.\n';
    await writeFile(path.join(root, "main.tex"), manuscript);
    await writeFile(path.join(root, "preamble.sty"), preamble);
    await mkdir(path.join(root, "chapters"));
    await writeFile(path.join(root, "chapters/chapter.ltx"), chapter);
    const { projects, folder } = controller(root, sourcesOnly([item, second, outside]));
    await projects.synchronizeItems([second], [item, second], folder);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript.replace('\\autocite[12]{Remove2024}', '').replace('{Remove2024,Keep2024}', '{Keep2024}'));
    assert.equal(await readFile(path.join(root, "preamble.sty"), "utf8"), '\n');
    assert.equal(await readFile(path.join(root, "chapters/chapter.ltx"), "utf8"), '\\textquote[]{Quoted prose remains}.\n');
    const bib = await readFile(path.join(root, config.bibFile), "utf8");
    assert.deepEqual(bibEntries(bib).map((entry) => entry.key), ["manual", "Outside2024", "Keep2024"]);
    assert.match(bib, /title=\{Manual fields\},related=\{\}/);
    const next = (await readProjectConfig(root))!;
    assert.deepEqual(next.library, tracked.library, "Checkbox updates preserve the library binding");
    assert.deepEqual(next.importedItemKeys, [outside.key, second.key]);
    assert.deepEqual(next.citationKeys, { ITEM0002: "Keep2024", ITEM0003: "Outside2024" });
    const backup = (await readdir(path.join(root, ".zotero/backups"))).find((name) => name.startsWith("bibliography-"))!;
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "preamble.sty"), "utf8"), preamble);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, "chapters/chapter.ltx"), "utf8"), chapter);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backup, config.bibFile), "utf8"), old);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, ".zotero/backups", backup, ".zotero/config.json"), "utf8")), tracked);
  });
});

test("Clearing the selection removes only the shown sources' citations and preserves independent manual citations", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Remove2024" } };
    await saveProjectConfig(root, tracked);
    await writeFile(path.join(root, config.bibFile), mergeBibliography('@book{Manual2024,title={Keep}}\n', ['@book{Remove2024,title={Remove}}']));
    const manuscript = 'Text \\autocite{Remove2024}. Mixed \\cite{Remove2024,Manual2024}. Explicit \\cite{Manual2024}.\\nocite{*}\n';
    await writeFile(path.join(root, "main.tex"), manuscript);
    const { projects, folder } = controller(root, sourcesOnly([item]));
    await projects.synchronizeItems([], [item], folder);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), 'Text . Mixed \\cite{Manual2024}. Explicit \\cite{Manual2024}.\\nocite{*}\n');
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["Manual2024"]);
    assert.deepEqual((await readProjectConfig(root))?.importedItemKeys, []);
    assert.deepEqual((await readProjectConfig(root))?.library, tracked.library);
  });
});

test("Deselection cleans up stale citations even when the source was already removed manually from the bibliography", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Missing2024" } };
    await saveProjectConfig(root, tracked);
    await writeFile(path.join(root, config.bibFile), "");
    await writeFile(path.join(root, "main.tex"), 'Text \\parencite{Missing2024}.');
    const { projects, folder } = controller(root, sourcesOnly([item]));
    await projects.synchronizeItems([], [item], folder);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), 'Text .');
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, {});
  });
});

test("Unsaved LaTeX edits prevent both source removal and bibliography/configuration changes", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Remove2024" } };
    await saveProjectConfig(root, tracked);
    const bib = mergeBibliography("", ['@book{Remove2024,title={Keep until saved}}']);
    const manuscript = 'Text \\cite{Remove2024}.';
    await writeFile(path.join(root, config.bibFile), bib);
    await writeFile(path.join(root, "main.tex"), manuscript);
    const { projects, folder, markDirty } = controller(root, sourcesOnly([item]));
    markDirty("main.tex");
    await assert.rejects(projects.synchronizeItems([], [item], folder), /Save the open changes/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bib);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("An edit during export aborts checkbox synchronization without overwriting the newer LaTeX text", async () => {
  await inProject(async (root) => {
    const added = { ...item, key: "ITEM0002" };
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Remove2024" } };
    await saveProjectConfig(root, tracked);
    const bib = mergeBibliography("", ['@book{Remove2024,title={Keep}}']);
    const original = 'Text \\cite{Remove2024}.';
    const changed = original + ' New user text.';
    await writeFile(path.join(root, config.bibFile), bib);
    await writeFile(path.join(root, "main.tex"), original);
    const { projects, folder } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (url.pathname === "/better-bibtex/json-rpc") return new Response("", { status: 404 });
      if (url.searchParams.get("format") === "biblatex") {
        await writeFile(path.join(root, "main.tex"), changed);
        return new Response('@book{New2025,title={New source}}');
      }
      return new Response(JSON.stringify([item, added].map((source) => ({ key: source.key, data: { itemType: "book", title: source.title } }))));
    });
    await assert.rejects(projects.synchronizeItems([added], [item, added], folder), /LaTeX project files changed/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), changed);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bib);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});

test("A late synchronization conflict rolls back LaTeX citations together with bibliography and key mapping", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Remove2024" } };
    await saveProjectConfig(root, tracked);
    const bib = mergeBibliography("", ['@book{Remove2024,title={Keep}}']);
    const manuscript = 'Text \\cite{Remove2024}.';
    await writeFile(path.join(root, config.bibFile), bib);
    await writeFile(path.join(root, "main.tex"), manuscript);
    await symlink(config.bibFile, path.join(root, "rollback-alias.bib"));
    const { projects, folder } = controller(root, sourcesOnly([item]), undefined, undefined, "native", true);
    await assert.rejects(projects.synchronizeItems([], [item], folder), /in the meantime/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), manuscript);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), bib);
    assert.deepEqual(await readProjectConfig(root), tracked);
  });
});


test("Switching collections saves bibliography, selective citations and key tracking together, preserving shared sources", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key, "ITEM0002"], citationKeys: { ITEM0001: "Removed", ITEM0002: "Shared" } };
    await saveProjectConfig(root, tracked);
    const original = mergeBibliography("", ["@book{Removed,title={Old}}", "@book{Shared,title={Custom metadata}}"]);
    await writeFile(path.join(root, config.bibFile), original);
    const manuscript = String.raw`Text \parencite[see][14]{Removed,Shared}.`;
    await writeFile(path.join(root, "main.tex"), manuscript);
    const { projects } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      assert.equal(url.pathname, "/api/users/0/collections/NEWCOL01/items/top");
      return new Response(JSON.stringify([{ key: "ITEM0002", data: { itemType: "book", title: "Current source" } }]));
    });
    await projects.connect({ data: { kind: "collection", collection: { library: item.library, key: "NEWCOL01", name: "New", parentKey: null } } });
    assert.deepEqual(bibEntries(await readFile(path.join(root, config.bibFile), "utf8")).map((entry) => entry.key), ["Shared"]);
    assert.match(await readFile(path.join(root, config.bibFile), "utf8"), /Custom metadata/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), String.raw`Text \parencite[see][14]{Shared}.`);
    assert.deepEqual((await readProjectConfig(root))?.citationKeys, { ITEM0002: "Shared" });
    const backups = await readdir(path.join(root, ".zotero/backups"));
    assert.equal(await readFile(path.join(root, ".zotero/backups", backups[0]!, config.bibFile), "utf8"), original);
    assert.equal(await readFile(path.join(root, ".zotero/backups", backups[0]!, "main.tex"), "utf8"), manuscript);
  });
});

test("Collection switches reject dirty files, concurrent edits and failed list requests without changing the binding", async () => {
  for (const mode of ["dirty", "changed", "unavailable"] as const) await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Old" } };
    await saveProjectConfig(root, tracked);
    const original = "@book{Old,title={Preserve on failure}}";
    await writeFile(path.join(root, config.bibFile), original);
    const { projects, markDirty } = controller(root, async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3" } });
      if (mode === "unavailable") return new Response("", { status: 404 });
      if (mode === "changed") await writeFile(path.join(root, config.bibFile), original + "\n% Changed by user");
      return new Response("[]");
    });
    if (mode === "dirty") markDirty(config.bibFile);
    await assert.rejects(projects.connect({ data: { kind: "collection", collection: { library: item.library, key: "NEWCOL01", name: "New", parentKey: null } } }));
    assert.deepEqual(await readProjectConfig(root), tracked);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original + (mode === "changed" ? "\n% Changed by user" : ""));
  });
});

test("A late collection-switch write conflict restores bibliography and project binding together", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, importedItemKeys: [item.key], citationKeys: { ITEM0001: "Old" } };
    await saveProjectConfig(root, tracked);
    const original = "@book{Old,title={Preserve on rollback}}";
    await writeFile(path.join(root, config.bibFile), original);
    await symlink(config.bibFile, path.join(root, "rollback-alias.bib"));
    const { projects } = controller(root, async (input) => new URL(String(input)).pathname === "/api/"
      ? new Response("", { headers: { "Zotero-API-Version": "3" } }) : new Response("[]"), undefined, undefined, "native", true);
    await assert.rejects(projects.connect({ data: { kind: "collection", collection: { library: item.library, key: "NEWCOL01", name: "New", parentKey: null } } }), /in the meantime/);
    assert.deepEqual(await readProjectConfig(root), tracked);
    assert.equal(await readFile(path.join(root, config.bibFile), "utf8"), original);
  });
});
