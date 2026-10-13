import * as vscode from "vscode";
import * as path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { CONFIG_SECTION, getBibliographyExporter, getClientOptions, getProjectSettings } from "../config/settings";
import { withProjectWriteLock } from "../config/projectLock";
import { CONFIG_FILE, discoverBibFile, isMissing, projectPath, readProjectConfig, readProjectText, saveProjectConfig,
  newProjectConfig, parseProjectConfig, validateBibFile, withProjectLibrary, writeProjectChanges, writeProjectText } from "../config/project";
import type { LibraryRef, ProjectConfig, ZoteroCollection, ZoteroDatabaseBinding, ZoteroItem } from "../shared/types";
import { ZoteroClient } from "../zotero/client";
import { listInstalledStyles } from "../zotero/styles";
import { citationLanguage, type CitationLanguage } from "../biblatex/language";
import { listInstalledBiblatexStyles, localTexLookup, type BiblatexStyle } from "../biblatex/styles";
import { planBiblatexStyle } from "../biblatex/texStyle";
import { planProjectBibFile } from "../biblatex/bibFile";
import { bibEntries } from "../biblatex/importer";
import { resolveBibliographyPresence, type BibliographyPresence } from "../biblatex/presence";
import { assertBibliographyScope, bibliographyItemKeys, bibliographyExportsHaveReferences, planBibliographyUpdate, completeBibliographyUpdate } from "../biblatex/update";
import { bibliographyRecords } from "../biblatex/fields";
import { migrationPreview, planCitationKeyMigration, type MigrationSource } from "../biblatex/migration";
import { pinnedCitationKeyExtra, projectCitationKey, validateCitationKey } from "../biblatex/keys";
import { BetterBibtexClient } from "../zotero/betterBibtex";
import { ZoteroWriter, type SecretStore } from "../zotero/writer";
import { itemDescription } from "../zotero/items";
import { isImportableItem } from "../biblatex/selection";
import { ZoteroError } from "../shared/errors";
import { citationDeletionPreview, planCitationDeletion, planTexCitationRemoval } from "../biblatex/deletion";
import { planCollectionChange } from "../biblatex/collectionChange";

interface TreeSelection {
  readonly data?: { readonly kind: string; readonly library?: LibraryRef; readonly collection?: ZoteroCollection; readonly item?: ZoteroItem };
}

export class ProjectController {
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  private readonly busy = new Set<string>();
  private readonly secrets: SecretStore;

  constructor(context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {
    this.secrets = context.secrets;
    this.status.command = "zoteroLatexAssistant.configureProject";
    this.status.show();
    const watcher = vscode.workspace.createFileSystemWatcher("**/.zotero/config.json");
    context.subscriptions.push(this.status, watcher,
      watcher.onDidChange(() => void this.refreshStatus()), watcher.onDidCreate(() => void this.refreshStatus()),
      watcher.onDidDelete(() => void this.refreshStatus()),
      vscode.window.onDidChangeActiveTextEditor(() => void this.refreshStatus()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.startup()));
    const command = (name: string, action: (selection?: TreeSelection) => Promise<void>): void => {
      context.subscriptions.push(vscode.commands.registerCommand(`zoteroLatexAssistant.${name}`,
        (selection?: TreeSelection) => this.run(() => action(selection))));
    };
    command("configureProject", () => this.configure());
    command("connectProject", (selection) => this.connect(selection));
    command("selectCitationStyle", () => this.editStyle());
    command("selectBibFile", () => this.editBibFile());
    command("updateBib", () => this.updateBib());
    command("migrateCitationKeys", () => this.migrateCitationKeys());
    command("deleteAllCitations", () => this.deleteAllCitations());
    command("importItem", (selection) => this.updateBib(selection?.data?.item));
    command("openProjectConfig", async () => {
      const project = await this.requireProject();
      if (project) await vscode.window.showTextDocument(vscode.Uri.file(await projectPath(project.folder.uri.fsPath, CONFIG_FILE)));
    });
  }

  async run(action: () => Promise<void>): Promise<void> {
    try { await action(); }
    catch (error) {
      if (error instanceof ZoteroError && error.code === "CANCELLED") return;
      const message = error instanceof Error ? error.message : "The Zotero action failed.";
      this.output.appendLine(`[Project] ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  async folder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) throw new Error("Open a local project folder in VS Code first.");
    const active = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const folder = active ?? (folders.length === 1 ? folders[0] : (await vscode.window.showQuickPick(
      folders.map((entry) => ({ label: entry.name, description: entry.uri.fsPath, folder: entry })),
      { title: "Choose a Zotero project" }))?.folder);
    if (folder && folder.uri.scheme !== "file") throw new Error("The Zotero project configuration requires a local project folder.");
    return folder;
  }

  async requireProject(): Promise<{ folder: vscode.WorkspaceFolder; config: ProjectConfig } | undefined> {
    const folder = await this.folder();
    if (!folder) return undefined;
    const config = await readProjectConfig(folder.uri.fsPath);
    if (!config) throw new Error("This project has no configuration yet. Run “Set library” or “Set .bib file”.");
    return { folder, config };
  }

  async startup(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== "file") continue;
      try {
        const config = await readProjectConfig(folder.uri.fsPath);
        if (config) {
          const exists = config.bibFile ? await readProjectText(folder.uri.fsPath, config.bibFile) !== undefined : false;
          const library = config.library ? `${config.library.type}/${config.library.id}, collection ${config.collectionKey || "entire library"}` : "Library not set yet";
          this.output.appendLine(`${folder.name}: ${library}, ${config.bibFile ? `${config.bibFile}${exists ? " found" : " (created on first import)"}` : ".bib file not set yet"}.`);
        } else {
          const discovery = await this.discover(folder);
          this.output.appendLine(`${folder.name}: not linked to Zotero yet.${discovery.detected ? ` ${discovery.detected} detected automatically.` : ""}`);
        }
      } catch (error) {
        this.output.appendLine(`[Project] ${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.refreshStatus();
  }

  private async refreshStatus(): Promise<void> {
    const active = vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const folder = active ?? vscode.workspace.workspaceFolders?.[0];
    try {
      const config = folder?.uri.scheme === "file" ? await readProjectConfig(folder.uri.fsPath) : undefined;
      this.status.text = !config?.library ? "$(library) Zotero: Set library"
        : !config.bibFile ? "$(library) Zotero: Set .bib file" : `$(library) Zotero: ${config.bibFile}`;
      this.status.tooltip = config ? `${folder!.name}: ${config.library ? `${config.library.type}/${config.library.id}` : "Library not set"}\nCollection: ${config.library ? config.collectionKey || "entire library" : "not selected"}\nBib file: ${config.bibFile || "not set"}\nCitation style: ${config.citationStyle || "not selected"}`
        : "Configure the project library, BibLaTeX file and citation style";
    } catch (error) { this.status.text = "$(warning) Zotero: Check configuration"; this.status.tooltip = String(error); }
  }

  private async discover(folder: vscode.WorkspaceFolder): Promise<{ files: string[]; detected: string | undefined }> {
    const exclude = "**/{node_modules,.git,.zotero,dist,build,out}/**";
    const files = (await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.bib"), exclude))
      .map((uri) => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/")).sort();
    const sources = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.tex"), exclude);
    const texSources: { path: string; text: string }[] = [];
    for (const uri of sources) {
      texSources.push({ path: path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/"),
        text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8") });
    }
    return { files, detected: discoverBibFile(files, texSources) };
  }

  private async bibFile(folder: vscode.WorkspaceFolder, current?: string): Promise<string | undefined> {
    const { files, detected } = await this.discover(folder);
    const selected = await vscode.window.showQuickPick([
      ...files.map((file) => ({ label: file, description: file === current ? "Current" : file === detected ? "Detected automatically" : "Existing file", value: file })),
      { label: "Set file name or path …", description: "New or existing .bib file", value: "" },
    ], { title: `BibLaTeX file for ${folder.name}`, placeHolder: detected ? `${detected} was detected automatically.` : "The library binding is saved separately." });
    if (!selected) return undefined;
    if (selected.value) return validateBibFile(selected.value);
    return vscode.window.showInputBox({ title: "BibLaTeX file name", value: current || detected || "references.bib",
      prompt: "Relative project path, e.g. references.bib or sources/references.bib",
      validateInput: (value) => { try { validateBibFile(value); return undefined; } catch (error) { return String(error instanceof Error ? error.message : error); } } });
  }

  async installedStyles(folder: vscode.WorkspaceFolder): Promise<readonly BiblatexStyle[]> {
    const executable = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("kpsewhichPath", "kpsewhich");
    return listInstalledBiblatexStyles(folder.uri.fsPath, localTexLookup(executable));
  }

  async citationLanguage(folder: vscode.WorkspaceFolder): Promise<{ styleId: string; language: CitationLanguage }> {
    const config = await readProjectConfig(folder.uri.fsPath);
    const directory = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("stylesDirectory", "") || path.join(homedir(), "Zotero", "styles");
    if (config?.citationStyle && config.citationStyleType !== "biblatex") {
      try {
        const style = (await listInstalledStyles(directory)).find((entry) => entry.id === config.citationStyle);
        if (style?.language) return { styleId: config.citationStyle, language: style.language };
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return { styleId: config?.citationStyle ?? "", language: citationLanguage(config?.citationLocale ?? "en-US", true) };
  }

  private async style(folder: vscode.WorkspaceFolder, current?: string): Promise<BiblatexStyle | undefined> {
    const styles = await this.installedStyles(folder);
    return (await vscode.window.showQuickPick(styles.map((entry) => ({ label: entry.id,
      description: entry.id === current ? "Current" : "Local BibLaTeX style",
      detail: `${entry.bibliographyFile} · ${entry.citationFile}`, style: entry })),
    { title: "Choose an installed BibLaTeX citation style", placeHolder: "Updates the project configuration and LaTeX files. Only local styles are listed." }))?.style;
  }

  private async locked(folder: vscode.WorkspaceFolder, action: () => Promise<void>): Promise<void> {
    const key = folder.uri.toString();
    if (this.busy.has(key)) throw new Error("A Zotero action is already running for this project.");
    this.busy.add(key);
    try { await withProjectWriteLock(folder.uri.fsPath, action); }
    finally { this.busy.delete(key); await this.refreshStatus(); }
  }

  private async assertSaved(folder: vscode.WorkspaceFolder, relative: string): Promise<void> {
    const target = await projectPath(folder.uri.fsPath, relative);
    if (vscode.workspace.textDocuments.some((document) => document.uri.fsPath === target && document.isDirty)) {
      throw new Error(`Save the open changes to ${relative} first.`);
    }
  }

  private async texSources(folder: vscode.WorkspaceFolder): Promise<readonly MigrationSource[]> {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{tex,ltx,sty,cls}"),
      "**/{node_modules,.git,.zotero,dist,build,out}/**");
    const sources: MigrationSource[] = [];
    for (const uri of uris) {
      const relative = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
      await this.assertSaved(folder, relative);
      const text = await readProjectText(folder.uri.fsPath, relative);
      if (text === undefined) throw new Error(`${relative} disappeared. Please retry.`);
      sources.push({ path: relative, text });
    }
    return sources;
  }

  private async assertTexUnchanged(folder: vscode.WorkspaceFolder, sources: readonly MigrationSource[]): Promise<void> {
    const current = await this.texSources(folder);
    if (current.length !== sources.length || sources.some((source) => !current.some((file) => file.path === source.path && file.text === source.text))) {
      throw new Error("The LaTeX project files changed during preparation. Please retry.");
    }
  }

  private async projectSources(folder: vscode.WorkspaceFolder, bibFile: string): Promise<MigrationSource[]> {
    const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{bib,tex,ltx,sty,cls}"),
      "**/{node_modules,.git,.zotero,dist,build,out}/**");
    const paths = new Set(uris.map((uri) => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/")));
    if (bibFile) {
      await this.assertSaved(folder, bibFile);
      if (await readProjectText(folder.uri.fsPath, bibFile) !== undefined) paths.add(bibFile);
    }
    const sources: MigrationSource[] = [];
    for (const relative of [...paths].sort()) {
      await this.assertSaved(folder, relative);
      const text = await readProjectText(folder.uri.fsPath, relative);
      if (text === undefined) throw new Error("The project file list changed during preparation. Please retry.");
      sources.push({ path: relative, text });
    }
    return sources;
  }

  private async presence(config: ProjectConfig, items: readonly ZoteroItem[], text: string,
    resolvedKeys: Readonly<Record<string, string>> = {}): Promise<BibliographyPresence> {
    return resolveBibliographyPresence(config, items, text, { resolvedKeys,
      lookup: (keys) => new BetterBibtexClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) })
        .citationKeys(config.library!, keys, true),
      onLookupError: (error) => this.log(`Existing-source key lookup unavailable: ${error instanceof Error ? error.message : String(error)}`) });
  }

  async connect(selection?: TreeSelection): Promise<void> {
    const folder = await this.folder();
    if (!folder) return;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const snapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const old = await readProjectConfig(folder.uri.fsPath);
      const base = old ?? newProjectConfig(getProjectSettings(folder.uri).citationCommand);
      const client = new ZoteroClient(getClientOptions());
      const connection = await client.checkConnection();
      const boundCollection = selection?.data?.collection;
      let library = boundCollection?.library ?? selection?.data?.library;
      let collectionKey = boundCollection?.key ?? "";
      if (!library) {
        library = (await vscode.window.showQuickPick((await client.listLibraries()).map((entry) => ({ label: entry.name,
          description: `${entry.type}/${entry.id}`, library: entry })), { title: `Library for ${folder.name}` }))?.library;
        if (!library) return;
        let parent: string | undefined;
        for (;;) {
          const collections = await client.listCollections(library, parent);
          const choice = await vscode.window.showQuickPick([
            { label: parent ? "Use this collection" : "Use entire library", key: parent ?? "", use: true },
            ...collections.map((collection) => ({ label: collection.name, key: collection.key, use: false })),
          ], { title: "Choose a project collection", placeHolder: "Open a collection, then select “Use this collection”." });
          if (!choice) return;
          if (choice.use) { collectionKey = choice.key; break; }
          parent = choice.key;
        }
      }
      let next = withProjectLibrary(base, library, collectionKey, connection.serverId);
      const changedCollection = base.library?.type === library.type && base.library.id === library.id
        && base.serverId === connection.serverId && base.collectionKey !== collectionKey;
      if (changedCollection) {
        const sources = await this.projectSources(folder, base.bibFile);
        const scopeClient = new ZoteroClient({ ...getClientOptions(), ...(connection.serverId ? { serverId: connection.serverId } : {}) });
        scopeClient.clearCache();
        const items = (await scopeClient.listItems(library, collectionKey || undefined)).filter(isImportableItem);
        const bibliography = sources.filter((source) => source.path.endsWith(".bib"));
        const text = bibliography.find((source) => source.path === base.bibFile)?.text ?? "";
        const presence = await this.presence(base, items, text);
        const plan = planCollectionChange(base, next, items, presence, bibliography, sources.filter((source) => !source.path.endsWith(".bib")));
        const current = await this.projectSources(folder, base.bibFile);
        if (current.length !== sources.length || sources.some((source) => !current.some((file) => file.path === source.path && file.text === source.text))) {
          throw new Error("The project files changed during the collection switch. Please retry.");
        }
        await this.assertSaved(folder, CONFIG_FILE);
        const updates = [...plan.changes, { path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(plan.config, null, 2) + "\n" }];
        const backup = await writeProjectChanges(folder.uri.fsPath, updates, "bibliography");
        next = plan.config;
        this.log(`Collection changed: removed ${plan.bibliographyCount} bibliography entries outside the selected collection. Backup: ${backup}`);
      } else {
        await this.assertSaved(folder, CONFIG_FILE);
        await saveProjectConfig(folder.uri.fsPath, next, snapshot);
      }
      // Eine Statusmeldung darf die Projektsperre nicht bis zum Schließen der Meldung halten.
      void vscode.window.showInformationMessage(`Library for ${folder.name} set.${next.bibFile ? "" : " The .bib file can be set separately."}`);
    });
  }

  private async configure(): Promise<void> {
    const choice = await vscode.window.showQuickPick([
      { label: "Set library", command: "connectProject" },
      { label: "Set up Codex MCP connection", description: "Connect this project to Codex", command: "setupCodex" },
      { label: "Set up Claude MCP connection", description: "Connect this project to Claude Code", command: "setupClaude" },
      { label: "Set up Cursor MCP connection", description: "Connect this project to Cursor", command: "setupCursor" },
      { label: "Set .bib file", command: "selectBibFile" },
      { label: "Change citation style", command: "selectCitationStyle" },
      { label: "Update .bib manually", command: "updateBib" },
      { label: "Migrate existing citation keys", command: "migrateCitationKeys" },
      { label: "Delete all citations", description: "Remove project citations and release the library binding", command: "deleteAllCitations" },
      { label: "Change citation command", description: "Command used for “Cite” in the LaTeX document", command: "citationCommand" },
      { label: "Open project configuration", command: "openProjectConfig" },
    ], { title: "Configure Zotero project" });
    if (!choice) return;
    if (choice.command !== "citationCommand") { await vscode.commands.executeCommand(`zoteroLatexAssistant.${choice.command}`); return; }
    await this.edit(async (config) => {
      const command = await vscode.window.showQuickPick([
        { label: "\\autocite", description: "Formatting follows the LaTeX style / autocite setting", value: "autocite" as const },
        { label: "\\parencite", description: "Citation in parentheses, e.g. (Smith, 2024)", value: "parencite" as const },
        { label: "\\textcite", description: "Author in the sentence, e.g. Smith (2024)", value: "textcite" as const },
      ], { title: "LaTeX citation command", placeHolder: "Used by “Cite”. Examples are for author–year styles." });
      return command ? { ...config, citationCommand: command.value } : undefined;
    });
  }

  private async edit(transform: (config: ProjectConfig, folder: vscode.WorkspaceFolder) => Promise<ProjectConfig | undefined>): Promise<void> {
    const folder = await this.folder();
    if (!folder) return;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const snapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = await readProjectConfig(folder.uri.fsPath) ?? newProjectConfig(getProjectSettings(folder.uri).citationCommand);
      const next = await transform(config, folder);
      if (next) {
        await this.assertSaved(folder, CONFIG_FILE);
        await saveProjectConfig(folder.uri.fsPath, next, snapshot);
      }
    });
  }

  private async editStyle(): Promise<void> {
    const folder = await this.folder();
    if (!folder) return;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const previous = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = previous === undefined ? newProjectConfig(getProjectSettings(folder.uri).citationCommand) : parseProjectConfig(JSON.parse(previous));
      const style = await this.style(folder, config.citationStyle);
      if (!style) return;
      const sources = await this.texSources(folder);
      const changes = planBiblatexStyle(sources, style.id, config.bibFile);
      // CSL locales must not override the language chosen by LaTeX/BibLaTeX.
      const { citationLocale: _locale, ...base } = config;
      const next = parseProjectConfig({ ...base, citationStyle: style.id, citationStyleType: "biblatex" });
      const updates = [...changes, { path: CONFIG_FILE, previous, text: JSON.stringify(next, null, 2) + "\n" }];
      await this.assertTexUnchanged(folder, sources);
      for (const update of updates) await this.assertSaved(folder, update.path);
      const backup = await writeProjectChanges(folder.uri.fsPath, updates);
      this.log(`BibLaTeX style ${style.id}: updated ${changes.map((change) => change.path).join(", ") || "project configuration only"}. Backup: ${backup}`);
      void vscode.window.showInformationMessage(`BibLaTeX style: ${style.id}. ${changes.length} LaTeX file(s) updated.${sources.length ? "" : " No LaTeX files found; the style is saved for the project."}`);
    });
  }

  private async editBibFile(): Promise<void> {
    const folder = await this.folder();
    if (!folder) return;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const previous = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = previous === undefined ? newProjectConfig(getProjectSettings(folder.uri).citationCommand) : parseProjectConfig(JSON.parse(previous));
      const bibFile = await this.bibFile(folder, config.bibFile);
      if (!bibFile) return;
      await this.assertSaved(folder, bibFile);
      if (config.bibFile) await this.assertSaved(folder, config.bibFile);
      const oldBib = config.bibFile ? await readProjectText(folder.uri.fsPath, config.bibFile) : undefined;
      const selectedBib = await readProjectText(folder.uri.fsPath, bibFile);
      const sources = await this.texSources(folder);
      if (config.citationStyleType === "biblatex" && config.citationStyle) {
        const styles = await this.installedStyles(folder);
        if (!styles.some((style) => style.id === config.citationStyle)) throw new Error("The configured BibLaTeX style is not installed locally. Choose an installed style first.");
      }
      const updates = planProjectBibFile(config, previous, bibFile, oldBib, selectedBib, sources);
      const changes = updates.filter((change) => /\.(tex|ltx|sty|cls)$/.test(change.path));
      await this.assertTexUnchanged(folder, sources);
      for (const update of updates) await this.assertSaved(folder, update.path);
      if (config.bibFile && await readProjectText(folder.uri.fsPath, config.bibFile) !== oldBib) throw new Error("The previous .bib file changed. Please retry.");
      if (await readProjectText(folder.uri.fsPath, bibFile) !== selectedBib) throw new Error("The selected .bib file changed. Please retry.");
      const backup = await writeProjectChanges(folder.uri.fsPath, updates, "bibliography");
      this.log(`BibLaTeX resource ${bibFile}: ${changes.length} LaTeX file(s) updated. Backup: ${backup}`);
      void vscode.window.showInformationMessage(`Project .bib: ${bibFile}. ${changes.length} LaTeX file(s) updated.`);
    });
  }

  async migrateCitationKeys(): Promise<void> {
    const project = await this.requireProject();
    if (!project) return;
    const { folder } = project;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const snapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = (await readProjectConfig(folder.uri.fsPath))!;
      if (!config.library || !config.bibFile || !config.importedItemKeys.length) throw new Error("Import project sources before migrating citation keys.");
      await this.assertSaved(folder, config.bibFile);
      const bibliography = await readProjectText(folder.uri.fsPath, config.bibFile);
      if (bibliography === undefined) throw new Error("The project .bib file is missing. Update it before migrating citation keys.");
      const records = new Map(bibliographyRecords(bibliography).map((record) => [record.key, record]));
      const mode = await vscode.window.showQuickPick([
        { label: "Rename one citation key", value: "manual" },
        { label: "Use current Better BibTeX keys", value: "bbt" },
      ], { title: "Migrate existing project citation keys", placeHolder: "Updates the .bib, project mapping and literal LaTeX citation references together." });
      if (!mode) return;
      const targets: Record<string, string> = {};
      if (mode.value === "manual") {
        const selected = await vscode.window.showQuickPick(config.importedItemKeys.map((itemKey) => {
          const key = projectCitationKey(config, itemKey);
          return { label: key, description: records.get(key)?.fields.get("title")?.value ?? "Imported project source", itemKey };
        }), { title: "Choose the citation key to rename" });
        if (!selected) return;
        const next = await vscode.window.showInputBox({ title: "New citation key", value: projectCitationKey(config, selected.itemKey),
          validateInput: (value) => { try { validateCitationKey(value); return undefined; } catch (error) { return (error as Error).message; } } });
        if (next === undefined) return;
        targets[selected.itemKey] = validateCitationKey(next);
      } else {
        const current = await new BetterBibtexClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) })
          .citationKeys(config.library, config.importedItemKeys);
        if (!current) throw new Error("Install and enable Better BibTeX in Zotero to migrate to its current citation keys, or rename a key manually.");
        const changed = config.importedItemKeys.filter((itemKey) => current[itemKey] !== projectCitationKey(config, itemKey));
        if (!changed.length) { void vscode.window.showInformationMessage("The project already uses the current Better BibTeX citation keys."); return; }
        const selected = await vscode.window.showQuickPick(changed.map((itemKey) => ({ label: projectCitationKey(config, itemKey),
          description: `→ ${current[itemKey]}`, itemKey })), { title: "Choose citation keys to migrate", canPickMany: true });
        if (!selected?.length) return;
        for (const entry of selected) targets[entry.itemKey] = current[entry.itemKey]!;
      }
      const bibSources = [{ path: config.bibFile, text: bibliography }];
      const texSources: MigrationSource[] = [];
      const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{bib,tex,ltx,sty,cls}"),
        "**/{node_modules,.git,.zotero,dist,build,out}/**");
      for (const uri of uris) {
        const relative = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/");
        if (relative === config.bibFile) continue;
        await this.assertSaved(folder, relative);
        const text = await readProjectText(folder.uri.fsPath, relative);
        if (text === undefined) throw new Error("The project file list changed while preparing the migration. Please retry.");
        (relative.endsWith(".bib") ? bibSources : texSources).push({ path: relative, text });
      }
      const plan = planCitationKeyMigration(config, bibSources, texSources, targets);
      if (!plan.keys.length) { void vscode.window.showInformationMessage("No citation keys need to be changed."); return; }
      const preview = `.zotero/migration-preview-${randomUUID()}.md`;
      await writeProjectText(folder.uri.fsPath, preview, migrationPreview(plan), undefined);
      await vscode.window.showTextDocument(vscode.Uri.file(await projectPath(folder.uri.fsPath, preview)));
      const decision = await vscode.window.showWarningMessage(`Migrate ${plan.keys.length} citation key(s) and ${plan.referenceCount} reference(s)?`,
        { modal: true, detail: "Review the opened preview. The bibliography, LaTeX files and project mapping will be backed up and changed together." }, "Migrate keys");
      if (decision !== "Migrate keys") return;
      const updates = [...plan.changes, { path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(plan.config, null, 2) + "\n" }];
      for (const update of updates) await this.assertSaved(folder, update.path);
      const latestFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{bib,tex,ltx,sty,cls}"),
        "**/{node_modules,.git,.zotero,dist,build,out}/**");
      const latestPaths = new Set([...latestFiles.map((uri) => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/")), config.bibFile]);
      const plannedPaths = new Set([...bibSources, ...texSources].map((source) => source.path));
      if (latestPaths.size !== plannedPaths.size || [...latestPaths].some((relative) => !plannedPaths.has(relative))) {
        throw new Error("The project file list changed during the migration preview. Please retry.");
      }
      for (const source of [...bibSources, ...texSources]) {
        await this.assertSaved(folder, source.path);
        if (await readProjectText(folder.uri.fsPath, source.path) !== source.text) throw new Error(`${source.path} changed during the migration preview. Please retry.`);
      }
      const backup = await writeProjectChanges(folder.uri.fsPath, updates, "migration");
      this.log(`Citation key migration completed. Backup: ${backup}`);
      void vscode.window.showInformationMessage(`Migrated ${plan.keys.length} citation key(s). Project bibliography and references are consistent.`);
    });
  }

  async deleteAllCitations(): Promise<void> {
    const folder = await this.folder();
    if (!folder) return;
    let deleted = false;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const snapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = snapshot === undefined ? newProjectConfig(getProjectSettings(folder.uri).citationCommand) : parseProjectConfig(JSON.parse(snapshot));
      const collect = async (): Promise<MigrationSource[]> => {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/*.{bib,tex,ltx,sty,cls}"),
          "**/{node_modules,.git,.zotero,dist,build,out}/**");
        const paths = new Set(uris.map((uri) => path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join("/")));
        if (config.bibFile) {
          await this.assertSaved(folder, config.bibFile);
          if (await readProjectText(folder.uri.fsPath, config.bibFile) !== undefined) paths.add(config.bibFile);
        }
        const sources: MigrationSource[] = [];
        for (const relative of [...paths].sort()) {
          await this.assertSaved(folder, relative);
          const text = await readProjectText(folder.uri.fsPath, relative);
          if (text === undefined) throw new Error("The project file list changed while preparing deletion. Please retry.");
          sources.push({ path: relative, text });
        }
        return sources;
      };
      const sources = await collect();
      const plan = planCitationDeletion(config, sources.filter((source) => source.path.endsWith(".bib")), sources.filter((source) => !source.path.endsWith(".bib")));
      const updates = [...plan.changes, { path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(plan.config, null, 2) + "\n" }];
      const preview = `.zotero/delete-citations-preview-${randomUUID()}.md`;
      await writeProjectText(folder.uri.fsPath, preview, citationDeletionPreview({ ...plan, changes: updates }), undefined);
      await vscode.window.showTextDocument(vscode.Uri.file(await projectPath(folder.uri.fsPath, preview)));
      const confirm = await vscode.window.showWarningMessage("Delete all citations and release the project library?", {
        modal: true,
        detail: `Review the opened preview: ${plan.citationCount} citation invocation(s) and ${plan.bibliographyCount} project bibliography entry/entries will be removed. The library, collection and imported-key mapping will be cleared. Original files will be backed up. Zotero records are kept.`,
      }, "Delete all citations");
      if (confirm !== "Delete all citations") return;
      const current = await collect();
      if (current.length !== sources.length || sources.some((source) => !current.some((file) => file.path === source.path && file.text === source.text))) {
        throw new Error("The project files changed during the deletion preview. Please retry.");
      }
      for (const update of updates) await this.assertSaved(folder, update.path);
      const backup = await writeProjectChanges(folder.uri.fsPath, updates, "reset");
      this.log(`Deleted ${plan.citationCount} citation invocation(s) and ${plan.bibliographyCount} bibliography entries; project library released. Backup: ${backup}`);
      deleted = true;
    });
    if (deleted) void vscode.window.showInformationMessage("All project citations were deleted. Choose a new library with “Set library”.", "Set library")
      .then((choice) => { if (choice === "Set library") void vscode.commands.executeCommand("zoteroLatexAssistant.connectProject"); });
  }

  async updateBib(item?: ZoteroItem): Promise<void> {
    await this.writeBib(item ? [item] : undefined);
  }

  async importItems(items: readonly ZoteroItem[], folder: vscode.WorkspaceFolder): Promise<void> {
    if (!items.length) throw new Error("Select at least one source in the list.");
    await this.writeBib(items, folder);
  }

  async synchronizeItems(selected: readonly ZoteroItem[], shown: readonly ZoteroItem[], folder: vscode.WorkspaceFolder,
    resolvedKeys: Readonly<Record<string, string>> = {}, databaseBinding?: ZoteroDatabaseBinding): Promise<void> {
    await this.writeBib(selected, folder, true, { shown, resolvedKeys }, databaseBinding);
  }

  async prepareCitation(items: readonly ZoteroItem[], folder: vscode.WorkspaceFolder, databaseBinding?: ZoteroDatabaseBinding): Promise<ProjectConfig> {
    await this.assertSaved(folder, CONFIG_FILE);
    const snapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
    const config = snapshot === undefined ? undefined : parseProjectConfig(JSON.parse(snapshot));
    if (databaseBinding && config?.serverId !== databaseBinding.serverId) throw new Error("The Zotero database binding changed. Reopen the source list.");
    if (!config?.library) throw new Error("Run “Zotero: Set library” first.");
    if (!config.bibFile) throw new Error("Run “Zotero: Set .bib file” first.");
    await this.assertSaved(folder, config.bibFile);
    if (items.some((item) => !isImportableItem(item) || item.library.type !== config.library!.type || item.library.id !== config.library!.id)) {
      throw new Error("The source does not belong to the LaTeX project library.");
    }
    const existing = await readProjectText(folder.uri.fsPath, config.bibFile);
    const presence = await this.presence(config, items, existing ?? "");
    const missing = items.filter((item) => !presence.itemKeys.includes(item.key));
    const untrackedExisting = items.filter((item) => presence.itemKeys.includes(item.key) && !config.importedItemKeys.includes(item.key));
    if (untrackedExisting.length) {
      await this.locked(folder, async () => {
        await this.assertSaved(folder, CONFIG_FILE);
        await this.assertSaved(folder, config.bibFile);
        if (await readProjectText(folder.uri.fsPath, config.bibFile) !== existing) throw new Error("The .bib file changed during citation preparation. Please retry.");
        const next = parseProjectConfig({ ...config, importedItemKeys: [...new Set([...config.importedItemKeys, ...untrackedExisting.map((item) => item.key)])],
          citationKeys: { ...config.citationKeys, ...Object.fromEntries(untrackedExisting.map((item) => [item.key, presence.citationKeys[item.key]!])) } });
        await writeProjectChanges(folder.uri.fsPath, [{ path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(next, null, 2) + "\n" }], "bibliography");
      });
    }
    if (missing.length) await this.writeBib(missing, folder, false, undefined, databaseBinding ?? { serverId: config.serverId });
    await this.assertSaved(folder, CONFIG_FILE);
    await this.assertSaved(folder, config.bibFile);
    const current = await readProjectConfig(folder.uri.fsPath);
    if (!current?.library || current.library.type !== config.library.type || current.library.id !== config.library.id
      || current.collectionKey !== config.collectionKey || current.bibFile !== config.bibFile
      || current.serverId !== config.serverId) {
      throw new Error("The project binding changed during preparation. Please cite again.");
    }
    const saved = new Set(bibEntries(await readProjectText(folder.uri.fsPath, current.bibFile) ?? "").map((entry) => entry.key));
    if (items.some((item) => !saved.has(projectCitationKey(current, item.key)))) {
      throw new Error("A source is still missing from the project .bib. The citation was not inserted.");
    }
    return current;
  }

  private async writeBib(selection?: readonly ZoteroItem[], projectFolder?: vscode.WorkspaceFolder, notify = true,
    synchronize?: { readonly shown: readonly ZoteroItem[]; readonly resolvedKeys: Readonly<Record<string, string>> }, databaseBinding?: ZoteroDatabaseBinding): Promise<void> {
    const folder = projectFolder ?? await this.folder();
    if (!folder) return;
    await this.locked(folder, async () => {
      await this.assertSaved(folder, CONFIG_FILE);
      const configSnapshot = await readProjectText(folder.uri.fsPath, CONFIG_FILE);
      const config = configSnapshot === undefined ? undefined : parseProjectConfig(JSON.parse(configSnapshot));
      if (databaseBinding && config?.serverId !== databaseBinding.serverId) throw new Error("The Zotero database binding changed. Reopen the source list.");
      if (!config?.library) throw new Error("Run “Zotero: Set library” first.");
      if (!config.bibFile) throw new Error("Run “Zotero: Set .bib file” first.");
      const library = config.library;
      assertBibliographyScope(config, synchronize?.shown);
      const client = new ZoteroClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) });
      client.clearCache();
      const items = (await client.listItems(config.library, config.collectionKey || undefined))
        .filter(isImportableItem);
      await this.assertSaved(folder, config.bibFile);
      const old = await readProjectText(folder.uri.fsPath, config.bibFile);
      const presence = await this.presence(config, [...items, ...(selection ?? [])], old ?? "", synchronize?.resolvedKeys);
      const input = { config, items, presence, bibliography: old ?? "",
        ...(selection ? { selection } : {}), ...(synchronize ? { synchronize } : {}) };
      let keys = bibliographyItemKeys(input);
      if (!selection && !keys.length) {
        const selected = await vscode.window.showQuickPick(items.map((source) => ({ label: source.title,
          description: itemDescription(source), source })), { title: "Select sources for the project .bib", canPickMany: true });
        if (!selected?.length) return;
        keys = selected.map((entry) => entry.source.key);
      }
      // Export the project sources by their stable library/item identities.
      const target = await projectPath(folder.uri.fsPath, config.bibFile);
      const document = vscode.workspace.textDocuments.find((entry) => entry.uri.fsPath === target);
      if (document?.isDirty) throw new Error("Save the open changes to the .bib file first.");
      const plan = planBibliographyUpdate(input, keys);
      const { newItemKeys: newKeys, pendingItemKeys: pending } = plan;
      const texSources = plan.uncheckedCitationKeys.size ? await this.texSources(folder) : [];
      let backend = getBibliographyExporter(folder.uri);
      const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Zotero: Updating BibLaTeX …" }, async () => {
        const raw = new Map(plan.preservedExports);
        if (pending.length) {
          this.log(backend === "better-biblatex" ? "Exporting metadata with the full local Better BibLaTeX translator." : "Exporting metadata with the explicitly selected native Zotero exporter.");
          if (backend === "better-biblatex") {
            try {
              const exports = await new BetterBibtexClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) }).exportItems(library, pending);
              for (const key of pending) raw.set(key, exports[key]!);
            } catch (error) {
              if (!(error instanceof ZoteroError) || error.code !== "EXPORT_UNAVAILABLE") throw error;
              const useNative = "Use Zotero export";
              const choice = await vscode.window.showWarningMessage(
                "Better BibLaTeX is unavailable in Zotero. Use Zotero's built-in BibLaTeX exporter for this project?",
                { modal: true, detail: "This exports the selected sources locally and continues the current action. The choice is saved for this project. To use the full Better BibLaTeX translator, install and enable Better BibTeX in Zotero instead." }, useNative);
              if (choice !== useNative) throw new ZoteroError("CANCELLED", "Export cancelled. No bibliography changes were written.");
              await vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri)
                .update("bibliographyExporter", "native", vscode.ConfigurationTarget.WorkspaceFolder);
              backend = "native";
              this.log("The user selected the local Zotero exporter for this project; continuing the pending import.");
            }
          }
          if (backend === "native") {
            for (const key of pending) raw.set(key, await client.exportItem(library, key));
          }
        }
        const bbt = backend === "native" && newKeys.length ? await new BetterBibtexClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) })
          .citationKeys(library, newKeys) : undefined;
        if (backend === "native" && newKeys.length) this.log(bbt ? "Using new citation keys from Better BibTeX." : "Better BibTeX unavailable; using new keys from the native Zotero export.");
        const hasReferences = bibliographyExportsHaveReferences(plan, raw);
        const preserved = keys.filter((key) => !pending.includes(key));
        const aliases: Record<string, string> = {};
        if (hasReferences && preserved.length) {
          if (backend === "better-biblatex") {
            const names = await new BetterBibtexClient({ ...getClientOptions(), ...(config.serverId ? { serverId: config.serverId } : {}) }).citationKeys(library, preserved, true);
            if (!names) throw new Error("Better BibTeX is unavailable while resolving bibliography references. The files were not changed.");
            Object.assign(aliases, names);
          } else {
            for (const key of preserved) {
              try {
                const exported = bibEntries(await client.exportItem(library, key));
                if (exported.length !== 1) throw new Error("Zotero did not export a single unambiguous source while resolving bibliography references.");
                aliases[key] = exported[0]!.key;
              } catch (error) {
                if (!(error instanceof ZoteroError) || error.status !== 404) throw error;
              }
            }
          }
        }
        const completed = completeBibliographyUpdate(plan, raw, bbt, aliases);
        if (completed.duplicateDetails) {
          const decision = await vscode.window.showWarningMessage(
            "Possible duplicate sources have the same title, author surnames and publication year.",
            { modal: true, detail: completed.duplicateDetails }, "Import anyway");
          if (decision !== "Import anyway") return undefined;
        }
        return completed;
      });
      if (result === undefined) return;
      await this.assertSaved(folder, config.bibFile);
      await this.assertSaved(folder, CONFIG_FILE);
      if (await readProjectText(folder.uri.fsPath, CONFIG_FILE) !== configSnapshot) throw new Error("The project configuration has changed in the meantime. Please retry.");
      const { text, config: next, removedCitationKeys } = result;
      const mapping = next.citationKeys!;
      const texChanges = planTexCitationRemoval(texSources, removedCitationKeys);
      if (removedCitationKeys.size) await this.assertTexUnchanged(folder, texSources);
      await writeProjectChanges(folder.uri.fsPath, [{ path: config.bibFile, previous: old, text },
        { path: CONFIG_FILE, previous: configSnapshot, text: JSON.stringify(next, null, 2) + "\n" }, ...texChanges], "bibliography");
      if (texChanges.length) this.log(`Removed citations for unchecked sources from ${texChanges.map((change) => change.path).join(", ")}.`);
      // Nur neu übernommene Keys festhalten; alte Quellen und manuell gesetzte andere Keys nicht umbenennen.
      if (newKeys.length && config.serverId && this.secrets) {
        const serverId = config.serverId;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
          title: "Pinning citation keys in Zotero … Confirm authorization in Zotero if requested." }, async () => {
          const failures: string[] = [];
          const writer = new ZoteroWriter({ ...getClientOptions(), serverId }, this.secrets);
          for (const key of newKeys) {
            try {
              const detail = await client.getItem(library, key);
              if (typeof detail.data.citationKey === "string") {
                if (detail.data.citationKey && detail.data.citationKey !== mapping[key]) throw new Error("A different native citation key has been set in Zotero. It was not overwritten.");
                if (detail.data.citationKey !== mapping[key]) await writer.updateItem(detail, { citationKey: mapping[key]! });
                continue;
              }
              const extra = typeof detail.data.extra === "string" ? detail.data.extra : "";
              const pinned = pinnedCitationKeyExtra(extra, mapping[key]!);
              if (pinned !== extra) await writer.updateItem({ ...detail, data: { ...detail.data, extra } }, { extra: pinned });
            } catch (error) {
              failures.push(key);
              this.log(`Citation key ${key} saved only in the project: ${error instanceof Error ? error.message : String(error)}`);
              // Nach verweigerter Freigabe oder Verbindungsfehler keine weiteren Freigaben anfragen.
              break;
            }
          }
          if (failures.length) void vscode.window.showWarningMessage("The .bib was updated. Some new citation keys could not be pinned in Zotero; they remain saved in the project.");
        });
      } else if (newKeys.length) {
        this.log("New keys saved in the project. Writing them back requires a library linked to Zotero 10+ and write authorization.");
      }
      if (notify) void vscode.window.showInformationMessage(`${config.bibFile} updated: ${keys.length} Zotero sources. Other existing entries are preserved.${texChanges.length ? ` Citations for unchecked sources were removed from ${texChanges.length} LaTeX file(s).` : ""}`);
    });
  }
}
