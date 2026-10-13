import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, saveProjectConfig } from "../src/config/project";
import { withProjectWriteLock } from "../src/config/projectLock";

test("packaged extension renders its source list and applies styles only to active TeX commands", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-extension-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const extensionRoot = path.join(root, "installed extension with spaces");
  const projectRoot = path.join(root, "project");
  const dist = path.join(extensionRoot, "dist");
  await mkdir(path.join(dist, "webview"), { recursive: true });
  await mkdir(projectRoot);
  const texRoot = path.join(root, "local TeX installation");
  await mkdir(texRoot);
  for (const name of ["biblatex.sty", "numeric.bbx", "numeric.cbx"]) await writeFile(path.join(texRoot, name), "Local style fixture");
  const filename = path.join(dist, "extension.cjs");
  await copyFile(process.env.ZOTERO_EXTENSION_TEST_BUNDLE ?? path.resolve(__dirname, "../extension.cjs"), filename);
  const script = await readFile(process.env.ZOTERO_EXTENSION_TEST_WEBVIEW ?? path.resolve(__dirname, "../webview/sourceList.js"), "utf8");
  await copyFile(process.env.ZOTERO_EXTENSION_TEST_WEBVIEW ?? path.resolve(__dirname, "../webview/sourceList.js"), path.join(dist, "webview/sourceList.js"));
  await saveProjectConfig(projectRoot, { ...newProjectConfig(), library: { type: "user", id: 0 } });

  const uri = (file: string) => ({ scheme: "file", fsPath: file, toString: () => pathToFileURL(file).href });
  const folder = { name: "Project", uri: uri(projectRoot) };
  const subscription = () => ({ dispose() {} });
  const event = () => subscription();
  const commands = new Map<string, () => Promise<void>>();
  const errors: string[] = [];
  const panels: { disposed: boolean; webview: { html: string }; dispose(): void }[] = [];
  const selectedServer = path.join(root, "manual server \"chosen\".cjs");
  await writeFile(selectedServer, "// Explicitly chosen file; setup must not execute it.\n");
  const mcpUi = { selection: selectedServer as string | undefined, scheme: "file", chooseCursorMenu: false,
    dialogs: [] as { title: string; defaultUri?: unknown; canSelectFiles: boolean; canSelectFolders: boolean; canSelectMany: boolean }[],
    opened: [] as string[], menus: [] as { label: string; command: string }[][] };
  const textDocuments: { uri: ReturnType<typeof uri>; isDirty: boolean }[] = [];
  const fakeVscode = {
    Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)) },
    TreeItem: class {}, EventEmitter: class { event = event; fire() {} dispose() {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }, ThemeIcon: class {}, RelativePattern: class {},
    StatusBarAlignment: { Left: 1 }, ViewColumn: { Active: 1 },
    workspace: {
      workspaceFolders: [folder], textDocuments, getWorkspaceFolder: () => folder,
      getConfiguration: () => ({ get: (_key: string, defaultValue: unknown) => defaultValue }),
      findFiles: async () => [uri(path.join(projectRoot, "main.tex"))],
      onDidChangeWorkspaceFolders: event, onDidCloseTextDocument: event, onDidChangeConfiguration: event,
      createFileSystemWatcher: () => ({ onDidChange: event, onDidCreate: event, onDidDelete: event, dispose() {} }),
    },
    window: {
      activeTextEditor: undefined, onDidChangeActiveTextEditor: event,
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      createStatusBarItem: () => ({ show() {}, dispose() {} }), createTreeView: subscription,
      showErrorMessage: (message: string) => { errors.push(message); },
      showQuickPick: async (entries: { label: string; command?: string }[]) => {
        if (entries.some((entry) => entry.command === "setupCursor")) {
          mcpUi.menus.push(entries as { label: string; command: string }[]);
          if (mcpUi.chooseCursorMenu) return entries.find((entry) => entry.command === "setupCursor");
        }
        return entries[0];
      }, showInformationMessage() {},
      showOpenDialog: async (options: typeof mcpUi.dialogs[number]) => {
        mcpUi.dialogs.push(options);
        return mcpUi.selection ? [{ ...uri(mcpUi.selection), scheme: mcpUi.scheme }] : undefined;
      },
      showTextDocument: async (file: ReturnType<typeof uri>) => { mcpUi.opened.push(file.fsPath); },
      createWebviewPanel: () => {
        const panel = { disposed: false, webview: { html: "", onDidReceiveMessage: event, postMessage: async () => true },
          onDidDispose: event, reveal() {}, dispose() { panel.disposed = true; } };
        panels.push(panel); return panel;
      },
    },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { commands.set(name, callback); return subscription(); },
      executeCommand: async (name: string) => commands.get(name)!() },
  };
  const localFetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://localhost:23119");
    assert(["/api/users/0/items/top", "/api/users/0/items"].includes(url.pathname), "Opening the list only reads local source and attachment metadata");
    const data = url.searchParams.get("itemType") ? [] : [{ key: "ITEM0001", data: { itemType: "book", title: "Bundled source list" } }];
    return new Response(JSON.stringify(data));
  };
  const module = { exports: {} as { activate(context: unknown): void } };
  const nativeRequire = createRequire(filename);
  let lookups = 0;
  // Run the bundled style discovery against real fixture files without requiring a TeX installation.
  const execFile = Object.assign(() => { throw new Error("Unexpected direct child process call."); }, {
    [promisify.custom]: async (executable: string, args: string[], options: { cwd: string }) => {
      lookups++;
      assert.equal(executable, "kpsewhich"); assert.equal(options.cwd, projectRoot); assert.equal(args[0], "--progname=latex");
      const query = args.slice(1);
      assert(query.length === 1 && ["biblatex.sty", "--expand-path=$TEXINPUTS"].includes(query[0]!)
        || query.join(",") === "numeric.bbx,numeric.cbx", "Only local style discovery is permitted");
      return { stdout: query[0] === "--expand-path=$TEXINPUTS" ? texRoot : query.map((file) => path.join(texRoot, file)).join("\n") + "\n", stderr: "" };
    },
  });
  runInNewContext(await readFile(filename, "utf8"), {
    module, exports: module.exports, __dirname: dist, __filename: filename, Buffer, Error, URL, URLSearchParams, Headers, Response, AbortSignal, fetch: localFetch,
    require: (name: string) => {
      if (name === "vscode") return fakeVscode;
      assert(name.startsWith("node:"), `Packaged extension must not depend on source files or node_modules: ${name}`);
      if (name === "node:child_process") return { ...nativeRequire(name), execFile };
      return nativeRequire(name);
    },
  }, { filename });
  module.exports.activate({ extensionUri: uri(extensionRoot), subscriptions: [], secrets: {} });
  assert(commands.has("zoteroLatexAssistant.openSourceList"));
  await commands.get("zoteroLatexAssistant.openSourceList")!();
  assert.deepEqual(errors, []);
  assert.equal(panels.length, 1);
  const panel = panels[0]!;
  assert.equal(panel.disposed, false);
  assert.match(panel.webview.html, /Bundled source list/);
  assert.match(panel.webview.html, /<table aria-label="Zotero sources"/);
  assert.equal(panel.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1], script,
    "The rendered list must include the actual packaged browser script, not only create a webview tab");

  const original = String.raw`\\documentclass{example}
\\bibliographystyle{plain}
\\usepackage[style=example]{biblatex}
\\begin{document}
\\end{document}
\documentclass{article}
\begin{document}
Text
\end{document}
`;
  await writeFile(path.join(projectRoot, "main.tex"), original);
  const bibliography = "@book{StableKey,title={Untouched bibliography}}\n";
  await writeFile(path.join(projectRoot, "refs.bib"), bibliography);
  await saveProjectConfig(projectRoot, { ...(await readProjectConfig(projectRoot))!, bibFile: "refs.bib", citationStyle: "authoryear" },
    await readFile(path.join(projectRoot, CONFIG_FILE), "utf8"));
  await commands.get("zoteroLatexAssistant.selectCitationStyle")!();
  assert.deepEqual(errors, []); assert.equal(lookups, 3);
  assert.equal((await readProjectConfig(projectRoot))?.citationStyle, "numeric");
  const expected = original.replace(String.raw`\documentclass{article}` + "\n", String.raw`\documentclass{article}` + "\n" + String.raw`\usepackage[style=numeric]{biblatex}` + "\n")
    .replace("\n" + String.raw`\begin{document}`, "\n" + String.raw`\addbibresource{refs.bib}` + "\n" + String.raw`\begin{document}`)
    .replace("\n" + String.raw`\end{document}`, "\n" + String.raw`\printbibliography` + "\n" + String.raw`\end{document}`);
  assert.equal(await readFile(path.join(projectRoot, "main.tex"), "utf8"), expected);
  assert.equal(await readFile(path.join(projectRoot, "refs.bib"), "utf8"), bibliography);
  await withProjectWriteLock(projectRoot, async () => {
    await commands.get("zoteroLatexAssistant.connectProject")!();
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Another MCP write or Zotero project action/);
  });
  assert.equal((await readProjectConfig(projectRoot))!.collectionKey, "");
  errors.length = 0;

  const manifest = JSON.parse(await readFile(path.resolve(__dirname, "../../package.json"), "utf8"));
  assert.equal(manifest.version, "0.5.0");
  assert(manifest.contributes.commands.some((entry: { command: string }) => entry.command === "zoteroLatexAssistant.setupCursor"));
  const targets = { Codex: ".codex/config.toml", Claude: ".mcp.json", Cursor: ".cursor/mcp.json" };
  for (const [client, file] of Object.entries(targets)) {
    assert(commands.has(`zoteroLatexAssistant.setup${client}`));
    await commands.get(`zoteroLatexAssistant.setup${client}`)!();
    assert.deepEqual(errors, []);
    const text = await readFile(path.join(projectRoot, file), "utf8");
    const config = client === "Codex" ? parseToml(text).mcp_servers as Record<string, { args: string[] }> : JSON.parse(text).mcpServers;
    assert.equal(config.zotero_latex_assistant.args[0], selectedServer);
    assert.equal(config.zotero_latex_assistant.args[2], projectRoot);
    const options = mcpUi.dialogs.at(-1)!;
    assert.equal(options.defaultUri, undefined, "No bundled server path may be selected by default");
    assert.equal(options.canSelectFiles, true); assert.equal(options.canSelectFolders, false); assert.equal(options.canSelectMany, false);
    assert(options.title.includes(client)); assert(mcpUi.opened.includes(path.join(projectRoot, file)));
  }
  mcpUi.chooseCursorMenu = true;
  await commands.get("zoteroLatexAssistant.configureProject")!();
  assert(mcpUi.menus.at(-1)!.some((entry) => entry.command === "setupCursor"));
  assert.deepEqual(errors, []);
  mcpUi.chooseCursorMenu = false;
  mcpUi.selection = undefined;
  const opened = mcpUi.opened.length;
  for (const [client, file] of Object.entries(targets)) {
    const before = await readFile(path.join(projectRoot, file), "utf8");
    await commands.get(`zoteroLatexAssistant.setup${client}`)!();
    assert.equal(await readFile(path.join(projectRoot, file), "utf8"), before);
  }
  assert.equal(mcpUi.opened.length, opened); assert.deepEqual(errors, []);

  const cursorBefore = await readFile(path.join(projectRoot, targets.Cursor), "utf8");
  const invalid = path.join(root, "wrong.txt"); await writeFile(invalid, "");
  const directory = path.join(root, "folder.cjs"); await mkdir(directory);
  for (const choice of [invalid, directory, path.join(root, "missing.cjs")]) {
    mcpUi.selection = choice;
    await commands.get("zoteroLatexAssistant.setupCursor")!();
    assert.equal(await readFile(path.join(projectRoot, targets.Cursor), "utf8"), cursorBefore);
  }
  assert.equal(errors.length, 3);
  mcpUi.selection = selectedServer; mcpUi.scheme = "vscode-remote";
  await commands.get("zoteroLatexAssistant.setupCursor")!();
  assert.equal(errors.length, 4); mcpUi.scheme = "file";
  textDocuments.push({ uri: uri(path.join(projectRoot, targets.Cursor)), isDirty: true });
  await commands.get("zoteroLatexAssistant.setupCursor")!();
  assert.equal(errors.length, 5); assert.match(errors.at(-1)!, /Save the open MCP configuration/);
  assert.equal(await readFile(path.join(projectRoot, targets.Cursor), "utf8"), cursorBefore);
});
