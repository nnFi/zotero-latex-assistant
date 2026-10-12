import * as vscode from "vscode";
import { getClientOptions } from "../config/settings";
import { CONFIG_FILE, readProjectConfig, readProjectText } from "../config/project";
import * as path from "node:path";
import type { LibraryRef, ZoteroAttachment, ZoteroCollection, ZoteroItem } from "../shared/types";
import { ZoteroClient } from "../zotero/client";
import { isRecord, libraryPrefix, validateKey } from "../zotero/validation";
import type { ProjectController } from "./projectCommands";
import { sourceListHtml } from "./sourceListHtml";
import { attachmentsByItem } from "../zotero/attachments";
import type { CitationController } from "./citationCommands";
import { projectCitationKey } from "../biblatex/keys";
import { resolveBibliographyPresence, type BibliographyPresence } from "../biblatex/presence";
import { BetterBibtexClient } from "../zotero/betterBibtex";
import { ZoteroError } from "../shared/errors";

export interface SourceListScope {
  readonly library: LibraryRef;
  readonly collectionKey?: string;
  readonly title: string;
}

interface ListSelection {
  readonly data?: { readonly library?: LibraryRef; readonly collection?: ZoteroCollection; readonly item?: ZoteroItem };
  readonly scope?: SourceListScope;
}

export function registerSourceList(context: vscode.ExtensionContext, projects: ProjectController, citations: CitationController): void {
  const panels = new Map<string, { panel: vscode.WebviewPanel; serverId: string | undefined }>();
  // Resolve from the installed extension root; bundling changes module-local __dirname.
  const scriptPath = vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "sourceList.js").fsPath;
  async function openList(selection?: ListSelection): Promise<void> {
    const folder = await projects.folder();
    if (!folder) return;
    const config = await readProjectConfig(folder.uri.fsPath);
    const collection = selection?.data?.collection;
    const library = collection?.library ?? selection?.data?.library ?? selection?.data?.item?.library ?? config?.library;
    const scope = selection?.scope ?? (library ? {
      library, ...(collection ? { collectionKey: collection.key } : (!selection && config?.collectionKey ? { collectionKey: config.collectionKey } : {})),
      title: collection?.name ?? (selection ? "All items" : `Project sources – ${folder.name}`),
    } : undefined);
    if (!scope) throw new Error("Run “Zotero: Set library” or choose a library / collection in the sidebar.");
    libraryPrefix(scope.library);
    if (scope.collectionKey) validateKey(scope.collectionKey);
    const scopeId = `${folder.uri.toString()}:${libraryPrefix(scope.library)}:${scope.collectionKey ?? ""}`;
    const databaseBinding = { serverId: config?.serverId };
    const stateId = JSON.stringify([scopeId, databaseBinding.serverId ?? null]);
    const existing = panels.get(scopeId);
    if (existing && existing.serverId === databaseBinding.serverId) { existing.panel.reveal(vscode.ViewColumn.Active); return; }
    existing?.panel.dispose();
    const panel = vscode.window.createWebviewPanel("zoteroSourceList", scope.title, vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    panels.set(scopeId, { panel, serverId: databaseBinding.serverId });
    let items: readonly ZoteroItem[] = [];
    let itemsByKey: ReadonlyMap<string, ZoteroItem> = new Map();
    let displayedAttachments: ReadonlyMap<string, readonly ZoteroAttachment[]> | undefined;
    let displayedAttachmentError = "";
    let busy = true;
    let disposed = false;
    let renderVersion = 0;
    let pendingRender = false;
    let resolvedKeys: Readonly<Record<string, string>> = {};
    const attemptedKeys = new Set<string>();
    async function readCurrent() {
      const current = await readProjectConfig(folder!.uri.fsPath);
      if (current?.serverId !== databaseBinding.serverId) {
        panel.dispose();
        throw new Error("The Zotero database binding changed. Reopen the source list.");
      }
      return current;
    }
    async function render(): Promise<void> {
      const version = ++renderVersion;
      const current = await readCurrent();
      const sameLibrary = current?.library?.type === scope!.library.type && current.library.id === scope!.library.id;
      let presence: BibliographyPresence = { itemKeys: [], citationKeys: {} };
      let bibliographyError = "";
      if (sameLibrary && current.bibFile) {
        try {
          const bibliography = await readProjectText(folder!.uri.fsPath, current.bibFile) ?? "";
          const result = await resolveBibliographyPresence(current, items, bibliography, { resolvedKeys, attemptedKeys,
            lookup: (keys) => new BetterBibtexClient({ ...getClientOptions(), ...(current.serverId ? { serverId: current.serverId } : {}) })
              .citationKeys(scope!.library, keys, true),
            onLookupError: (error) => projects.log(`Existing-source key lookup unavailable: ${error instanceof Error ? error.message : String(error)}`) });
          resolvedKeys = result.resolvedKeys;
          if (!disposed && version !== renderVersion) { await render(); return; }
          presence = result;
        } catch (error) {
          bibliographyError = error instanceof Error ? error.message : String(error);
          projects.log(`Project bibliography unavailable: ${bibliographyError}`);
        }
      }
      const keyNames = sameLibrary ? { ...Object.fromEntries(current.importedItemKeys.map((key) => [key, projectCitationKey(current, key)])),
        ...presence.citationKeys } : undefined;
      await readCurrent();
      if (!disposed && version === renderVersion) panel.webview.html = sourceListHtml(scope!.title, items, presence.itemKeys,
        `${stateId}:${sameLibrary ? current.bibFile : ""}`, displayedAttachments, displayedAttachmentError, keyNames, bibliographyError, scriptPath);
    }
    async function load(refresh = false): Promise<void> {
      const started = Date.now();
      projects.log(`Source list: ${libraryPrefix(scope!.library)}, collection ${scope!.collectionKey ?? "entire library"}${refresh ? ", manual refresh" : ", loading"}.`);
      await readCurrent();
      const client = new ZoteroClient({ ...getClientOptions(), ...(databaseBinding.serverId ? { serverId: databaseBinding.serverId } : {}) });
      if (refresh) client.clearCache();
      const loaded = await client.listItems(scope!.library, scope!.collectionKey);
      if (disposed) return;
      let attachments: readonly ZoteroAttachment[] | undefined;
      let attachmentError = "";
      try { attachments = await client.listAttachmentMetadata(scope!.library, scope!.collectionKey); }
      catch (error) {
        attachmentError = error instanceof Error ? error.message : String(error);
        projects.log(`Attachment metadata unavailable: ${attachmentError}`);
      }
      if (disposed) return;
      await readCurrent();
      items = loaded;
      itemsByKey = new Map(loaded.map((item) => [item.key, item]));
      resolvedKeys = {};
      attemptedKeys.clear();
      displayedAttachments = attachments === undefined ? undefined : attachmentsByItem(attachments);
      displayedAttachmentError = attachmentError;
      await render();
      projects.log(`Source list loaded: ${loaded.length} items, ${attachments?.length ?? "unknown"} attachments (${Date.now() - started} ms).`);
    }
    const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!isRecord(message) || busy || disposed) return;
      busy = true;
      try {
        await readCurrent();
        projects.log(`Source list: action ${String(message.type)}.`);
        if (message.type === "refresh") await load(true);
        if (message.type === "doi") await vscode.commands.executeCommand("zoteroLatexAssistant.searchDoi");
        if (message.type === "cite") {
          const item = typeof message.key === "string" ? itemsByKey.get(message.key) : undefined;
          if (!item) throw new Error("The source is no longer in the list. Refresh the list.");
          await citations.citeWithDetails([item], folder!, undefined, databaseBinding);
          await render();
        }
        if (message.type === "open") {
          const item = typeof message.key === "string" ? itemsByKey.get(message.key) : undefined;
          if (!item) throw new Error("The source is no longer in the list. Refresh the list.");
          await vscode.env.openExternal(vscode.Uri.parse(item.library.type === "user"
            ? `zotero://select/library/items/${validateKey(item.key)}`
            : `zotero://select/groups/${item.library.id}/items/${validateKey(item.key)}`));
        }
        if (message.type === "synchronize") {
          if (!Array.isArray(message.keys) || message.keys.some((key) => typeof key !== "string")) {
            throw new Error("Invalid source selection.");
          }
          const keys = [...new Set(message.keys as string[])];
          const selected = keys.map((key) => {
            const item = itemsByKey.get(key);
            if (!item) throw new Error("A selected source is no longer available. Refresh the list.");
            return item;
          });
          await projects.synchronizeItems(selected, items, folder!, resolvedKeys, databaseBinding);
          await load();
        }
      } catch (error) {
        if (error instanceof ZoteroError && error.code === "CANCELLED") return;
        const text = error instanceof Error ? error.message : String(error);
        projects.log(`Source list: ${text}`);
        if (!disposed) await panel.webview.postMessage({ type: "error", message: text });
        void vscode.window.showErrorMessage(text);
      } finally {
        busy = false;
        if (pendingRender && !disposed) { pendingRender = false; await projects.run(render); }
        if (!disposed) await panel.webview.postMessage({ type: "complete" });
      }
    });
    const bibWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "**/*.bib"));
    const configWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, CONFIG_FILE));
    async function changed(uri: vscode.Uri): Promise<void> {
      if (disposed) return;
      await projects.run(async () => {
        const current = await readProjectConfig(folder!.uri.fsPath);
        if (current?.serverId !== databaseBinding.serverId) { panel.dispose(); return; }
        const relative = path.relative(folder!.uri.fsPath, uri.fsPath).split(path.sep).join("/");
        if (relative !== CONFIG_FILE && relative !== current?.bibFile) return;
        if (busy) { pendingRender = true; return; }
        await render();
      });
    }
    const fileListeners = [bibWatcher, configWatcher].flatMap((watcher) => [watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed)]);
    panel.onDidDispose(() => {
      disposed = true; listener.dispose(); bibWatcher.dispose(); configWatcher.dispose();
      fileListeners.forEach((subscription) => subscription.dispose());
      if (panels.get(scopeId)?.panel === panel) panels.delete(scopeId);
    });
    context.subscriptions.push(panel);
    try { await load(); }
    catch (error) { panel.dispose(); throw error; }
    finally {
      busy = false;
      if (pendingRender && !disposed) { pendingRender = false; await projects.run(render); }
    }
  }
  for (const name of ["openSourceList", "openItem"]) {
    context.subscriptions.push(vscode.commands.registerCommand(`zoteroLatexAssistant.${name}`,
      (selection?: ListSelection) => projects.run(() => openList(selection))));
  }
}
