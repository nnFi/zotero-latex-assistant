import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { CONFIG_FILE, readProjectText, saveProjectConfig } from "../src/config/project";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";
import type { registerSourceList } from "../src/views/sourceList";
import { ZoteroError } from "../src/shared/errors";

const library = { type: "user" as const, id: 0 };
const config: ProjectConfig = { version: 1, library, collectionKey: "", bibFile: "refs.bib", citationStyle: "numeric",
  citationCommand: "autocite", importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "Existing2024", ITEM0002: "Missing2024" } };

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "source-list-presence-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function list(root: string, bbtKey?: string | (() => string), options: { serverId?: () => string; beforeItems?: () => Promise<void> } = {}) {
  const folder = { uri: { scheme: "file", fsPath: root, toString: () => root }, name: "Project" };
  const subscription = () => ({ dispose() {} });
  const commands = new Map<string, (selection?: unknown) => Promise<void>>();
  const changeListeners: ((uri: { fsPath: string }) => Promise<void>)[] = [];
  const errors: unknown[] = [];
  const messages: unknown[] = [];
  let receive: (message: unknown) => Promise<void> = async () => {};
  function createPanel() {
    const listeners: (() => void)[] = [];
    const panel = { disposed: false,
      webview: { html: "", onDidReceiveMessage: (callback: typeof receive) => { receive = callback; return subscription(); }, postMessage: async (message: unknown) => { messages.push(message); return true; } },
      onDidDispose: (callback: () => void) => { listeners.push(callback); return subscription(); }, reveal() {},
      dispose() { if (!panel.disposed) { panel.disposed = true; listeners.forEach((callback) => callback()); } } };
    return panel;
  }
  const panels: ReturnType<typeof createPanel>[] = [];
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    const serverId = options.serverId?.();
    const headers = serverId ? { "Zotero-Server-ID": serverId } : {};
    assert.equal(url.hostname, "localhost");
    if (url.pathname === "/api/") return new Response("", { headers: { ...headers, "Zotero-API-Version": "3" } });
    if (url.pathname === "/better-bibtex/json-rpc") {
      if (!bbtKey) return new Response("", { status: 404 });
      const request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id,
        result: request.method === "api.ready" ? { betterbibtex: "8", zotero: "10" } : { ITEM0003: typeof bbtKey === "function" ? bbtKey() : bbtKey } }));
    }
    assert.equal(url.searchParams.get("format"), "json", "Presence detection must not export or write Zotero sources");
    if (!url.searchParams.get("itemType")) await options.beforeItems?.();
    return new Response(JSON.stringify(url.searchParams.get("itemType") ? [] : [
      { key: "ITEM0001", data: { itemType: "book", title: serverId ? `Alpha ${serverId}` : "Alpha" } },
      { key: "ITEM0002", data: { itemType: "book", title: "Beta" } },
      { key: "ITEM0003", data: { itemType: "book", title: "Gamma" } },
    ]), { headers });
  };
  const fakeVscode = { workspace: { createFileSystemWatcher: () => ({ onDidChange: (callback: typeof changeListeners[number]) => { changeListeners.push(callback); return subscription(); },
    onDidCreate: subscription, onDidDelete: subscription, dispose() {} }) },
    window: { createWebviewPanel: () => { const panel = createPanel(); panels.push(panel); return panel; }, showInformationMessage() {}, showErrorMessage(message: string) { errors.push(message); } },
    commands: { registerCommand: (name: string, callback: (selection?: unknown) => Promise<void>) => { commands.set(name, callback); return subscription(); } },
    ViewColumn: { Active: 1 }, RelativePattern: class {} };
  const filename = path.join(__dirname, "../src/views/sourceList.js");
  const nativeRequire = createRequire(filename);
  const module = { exports: {} as { registerSourceList: typeof registerSourceList } };
  runInNewContext(`(function(exports,require,module){${readFileSync(filename, "utf8")}\n})(exports,require,module)`, {
    exports: module.exports, module,
    require: (name: string) => name === "vscode" ? fakeVscode : name === "../config/settings" ? { getClientOptions: () => ({ fetch }) } : nativeRequire(name),
  });
  const imports: string[][] = [];
  const projects = { folder: async () => folder, run: async (action: () => Promise<void>) => action(), log() {},
    synchronizeItems: async (items: readonly ZoteroItem[]) => { imports.push(Array.from(items, (item) => item.key)); } };
  module.exports.registerSourceList({ subscriptions: [] } as never, projects as never,
    { citeWithDetails: async () => { throw new ZoteroError("CANCELLED", "Export cancelled"); } } as never);
  return { open: () => commands.get("zoteroLatexAssistant.openSourceList")!(), get panel() { return panels.at(-1)!; }, panels, calls, imports, errors, messages,
    change: async (file = "refs.bib") => { for (const listener of changeListeners) await listener({ fsPath: path.join(root, file) }); },
    message: (value: unknown) => receive(value) };
}

function checked(html: string, key: string): boolean {
  const row = html.split(`data-key="${key}"`)[1]?.split("</tr>")[0] ?? "";
  return /class="pick"[^>]*\bchecked\b/.test(row);
}

test("Source list reads actual .bib content and updates checkboxes on file saves without reloading Zotero", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    await writeFile(path.join(root, "refs.bib"), "@book{Existing2024,title={Existing}}\n");
    const view = list(root);
    await view.open();
    assert.equal(checked(view.panel.webview.html, "ITEM0001"), true);
    assert.equal(checked(view.panel.webview.html, "ITEM0002"), false);
    const count = view.calls.length;
    await writeFile(path.join(root, "refs.bib"), "@book{Missing2024,title={New}}\n");
    await view.change();
    assert.equal(checked(view.panel.webview.html, "ITEM0001"), false);
    assert.equal(checked(view.panel.webview.html, "ITEM0002"), true);
    assert.equal(view.calls.length, count);
    await rm(path.join(root, "refs.bib"));
    await view.change();
    assert.equal(checked(view.panel.webview.html, "ITEM0002"), false);
  });
});

test("A database binding change disposes old lists and reopening loads fresh sources with a new selection state", async () => {
  await inProject(async (root) => {
    let serverId = "database-A";
    await saveProjectConfig(root, { ...config, serverId });
    await writeFile(path.join(root, config.bibFile), "@book{ExternalA,title={Database A}}\n");
    const view = list(root, () => serverId === "database-A" ? "ExternalA" : "ExternalB", { serverId: () => serverId });
    await view.open();
    const previous = view.panel;
    const previousState = previous.webview.html.match(/data-state-id="([^"]*)"/)![1];
    assert.match(previous.webview.html, /Alpha database-A/);
    assert.equal(checked(previous.webview.html, "ITEM0003"), true);
    assert.match(previous.webview.html, /Citation key: ExternalA/);
    serverId = "database-B";
    await saveProjectConfig(root, { ...config, serverId }, await readProjectText(root, CONFIG_FILE));
    await writeFile(path.join(root, config.bibFile), "@book{ExternalB,title={Database B}}\n");
    await view.change(CONFIG_FILE);
    assert.equal(previous.disposed, true);
    await view.open();
    assert.notEqual(view.panel, previous);
    assert.match(view.panel.webview.html, /Alpha database-B/);
    assert.doesNotMatch(view.panel.webview.html, /Alpha database-A/);
    assert.equal(checked(view.panel.webview.html, "ITEM0003"), true);
    assert.match(view.panel.webview.html, /Citation key: ExternalB/);
    assert.doesNotMatch(view.panel.webview.html, /Citation key: ExternalA/);
    assert.notEqual(view.panel.webview.html.match(/data-state-id="([^"]*)"/)![1], previousState);
  });
});

test("Reopening after a database change replaces the panel even before the file watcher fires", async () => {
  await inProject(async (root) => {
    let serverId = "database-A";
    await saveProjectConfig(root, { ...config, serverId });
    const view = list(root, undefined, { serverId: () => serverId });
    await view.open();
    const previous = view.panel;
    serverId = "database-B";
    await saveProjectConfig(root, { ...config, serverId }, await readProjectText(root, CONFIG_FILE));
    await view.open();
    assert.equal(previous.disposed, true);
    assert.match(view.panel.webview.html, /Alpha database-B/);
    await view.open();
    assert.equal(view.panels.length, 2, "An unchanged database reuses its current panel");
  });
});

test("Actions from a stale database are rejected before citation or synchronization", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, serverId: "database-A" });
    const view = list(root, undefined, { serverId: () => "database-A" });
    await view.open();
    await saveProjectConfig(root, { ...config, serverId: "database-B" }, await readProjectText(root, CONFIG_FILE));
    await view.message({ type: "synchronize", keys: ["ITEM0001"] });
    assert.deepEqual(view.imports, []);
    assert.equal(view.panel.disposed, true);
    assert.match(String(view.errors[0]), /database binding changed/);
  });
});

test("A binding change during loading never renders sources from the old database", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, { ...config, serverId: "database-A" });
    const view = list(root, undefined, { serverId: () => "database-A", beforeItems: async () => {
      await saveProjectConfig(root, { ...config, serverId: "database-B" }, await readProjectText(root, CONFIG_FILE));
    } });
    await assert.rejects(view.open(), /database binding changed/);
    assert.equal(view.panel.disposed, true);
    assert.doesNotMatch(view.panel.webview.html, /Alpha database-A/);
  });
});

test("Cancelling exporter selection while citing from the source list produces no error notification", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const view = list(root);
    await view.open();
    await view.message({ type: "cite", key: "ITEM0001" });
    assert.deepEqual(view.errors, []);
    assert.deepEqual(JSON.parse(JSON.stringify(view.messages)), [{ type: "complete" }], "The webview must release its buttons after cancellation");
    await view.message({ type: "refresh" });
    assert.deepEqual(view.errors, [], "Cancellation must release the list's action lock");
  });
});

test("Failed list actions report the error and still signal completion", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const view = list(root);
    await view.open();
    await view.message({ type: "cite", key: "MISSING1" });
    assert.deepEqual(JSON.parse(JSON.stringify(view.messages)), [
      { type: "error", message: "The source is no longer in the list. Refresh the list." }, { type: "complete" },
    ]);
    assert.equal(view.errors.length, 1);
  });
});

test("Existing external entries are prechecked through local BBT and the full selection is synchronized", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const text = "@book{External2024,title={Manual export}}\n";
    await writeFile(path.join(root, "refs.bib"), text);
    const view = list(root, "External2024");
    await view.open();
    assert.equal(checked(view.panel.webview.html, "ITEM0003"), true);
    await view.message({ type: "synchronize", keys: ["ITEM0003", "ITEM0002"] });
    assert.deepEqual(view.imports, [["ITEM0003", "ITEM0002"]]);
    assert.equal(await readFile(path.join(root, "refs.bib"), "utf8"), text);
  });
});

test("An empty selection reaches synchronization so every shown source can be removed", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    const view = list(root);
    await view.open();
    await view.message({ type: "synchronize", keys: [] });
    assert.deepEqual(view.imports, [[]]);
  });
});

test("Damaged .bib retains the list with an error and clears stale existing-source checkboxes", async () => {
  await inProject(async (root) => {
    await saveProjectConfig(root, config);
    await writeFile(path.join(root, "refs.bib"), "@book{Existing2024,title={Broken}");
    const view = list(root);
    await view.open();
    assert.match(view.panel.webview.html, /Project \.bib could not be read/);
    assert.equal(checked(view.panel.webview.html, "ITEM0001"), false);
    assert.equal(view.calls.some((call) => call.includes("better-bibtex")), false);
  });
});
