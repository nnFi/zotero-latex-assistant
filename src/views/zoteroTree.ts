import * as vscode from "vscode";
import { CONFIG_SECTION, getClientOptions } from "../config/settings";
import { ZoteroClient } from "../zotero/client";
import type { LibraryRef, ZoteroCollection, ZoteroLibrary } from "../shared/types";
import { readProjectConfig } from "../config/project";
import type { ProjectConfig } from "../shared/types";

const VIEW_ID = "zoteroLatexAssistant.libraries";

type NodeData =
  | { readonly kind: "library"; readonly library: ZoteroLibrary }
  | { readonly kind: "collection"; readonly collection: ZoteroCollection }
  | { readonly kind: "items"; readonly library: LibraryRef }
  | { readonly kind: "message" };

class ZoteroTreeItem extends vscode.TreeItem {
  constructor(readonly data: NodeData, label: string, state = vscode.TreeItemCollapsibleState.None) {
    super(label, state);
  }
}

/** Seitenleiste dient der Navigation; Quellen werden ausschließlich in der Tabelle geladen. */
class ZoteroTreeProvider implements vscode.TreeDataProvider<ZoteroTreeItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ZoteroTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private project: ProjectConfig | undefined;
  private readonly collections = new Map<string, Promise<readonly ZoteroCollection[]>>();

  constructor(private readonly output: vscode.OutputChannel) {}

  refresh(): void {
    this.collections.clear();
    this.changed.fire();
  }

  getTreeItem(item: ZoteroTreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(parent?: ZoteroTreeItem): Promise<ZoteroTreeItem[]> {
    try {
      const folder = (vscode.window.activeTextEditor && vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri))
        || vscode.workspace.workspaceFolders?.[0];
      try { this.project = folder?.uri.scheme === "file" ? await readProjectConfig(folder.uri.fsPath) : undefined; }
      catch { this.project = undefined; }
      const client = new ZoteroClient(getClientOptions());
      if (!parent) {
        return (await client.listLibraries()).map((library) => this.libraryItem(library));
      }
      switch (parent.data.kind) {
        case "library": {
          const library = parent.data.library;
          const collections = await this.libraryCollections(client, library);
          const allItems = new ZoteroTreeItem(
            { kind: "items", library }, "All items", vscode.TreeItemCollapsibleState.None,
          );
          allItems.id = `${parent.id}/items`;
          allItems.iconPath = new vscode.ThemeIcon("list-unordered");
          allItems.tooltip = "All items in this library, including sources without a collection.";
          allItems.contextValue = "zoteroItems";
          allItems.command = { command: "zoteroLatexAssistant.openSourceList", title: "Open source list", arguments: [allItems] };
          return [allItems, ...this.collectionItems(collections, null)];
        }
        case "collection": {
          const collection = parent.data.collection;
          const collections = await this.libraryCollections(client, collection.library);
          return this.collectionItems(collections, collection.key);
        }
        case "items":
        case "message":
          return [];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zotero content could not be loaded.";
      this.output.appendLine(`[Sidebar] ${message}`);
      const item = this.messageItem("Zotero content unavailable");
      item.description = "Retry";
      item.tooltip = message;
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = {
        command: "zoteroLatexAssistant.refresh",
        title: "Retry",
      };
      return [item];
    }
  }

  private libraryItem(library: ZoteroLibrary): ZoteroTreeItem {
    const item = new ZoteroTreeItem(
      { kind: "library", library }, library.name,
      library.type === "user" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `${library.type}:${library.id}`;
    item.contextValue = "zoteroLibrary";
    item.command = { command: "zoteroLatexAssistant.openSourceList", title: "Open source list", arguments: [item] };
    item.iconPath = new vscode.ThemeIcon(library.type === "group" ? "organization" : "library");
    item.description = library.type === "group" ? `Group ${library.id}` : "Personal";
    if (this.isProjectLibrary(library)) item.description += " · Project library";
    item.tooltip = library.itemCount === undefined
      ? library.name
      : `${library.name}: ${library.itemCount} items including attachments and notes`;
    return item;
  }

  private async libraryCollections(client: ZoteroClient, library: LibraryRef): Promise<readonly ZoteroCollection[]> {
    const key = `${library.type}:${library.id}`;
    let pending = this.collections.get(key);
    if (!pending) {
      pending = client.listAllCollections(library);
      this.collections.set(key, pending);
      void pending.catch(() => { if (this.collections.get(key) === pending) this.collections.delete(key); });
    }
    return pending;
  }

  private collectionItems(collections: readonly ZoteroCollection[], parentKey: string | null): ZoteroTreeItem[] {
    const parents = new Set(collections.map((collection) => collection.parentKey));
    return collections.filter((collection) => collection.parentKey === parentKey).sort((a, b) => a.name.localeCompare(b.name)).map((collection) => {
      const hasChildren = parents.has(collection.key);
      const item = new ZoteroTreeItem(
        { kind: "collection", collection }, collection.name,
        hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      );
      item.id = `${collection.library.type}:${collection.library.id}/collection/${collection.key}`;
      item.contextValue = "zoteroCollection";
      item.command = { command: "zoteroLatexAssistant.openSourceList", title: "Open source list", arguments: [item] };
      item.iconPath = new vscode.ThemeIcon("folder");
      item.tooltip = `Collection: ${collection.name}`;
      if (this.isProjectLibrary(collection.library) && this.project?.collectionKey === collection.key) {
        item.description = "Linked to project";
        item.iconPath = new vscode.ThemeIcon("folder-active");
      }
      return item;
    });
  }

  private messageItem(label: string): ZoteroTreeItem {
    const item = new ZoteroTreeItem({ kind: "message" }, label);
    item.iconPath = new vscode.ThemeIcon("info");
    return item;
  }

  private isProjectLibrary(library: LibraryRef): boolean {
    return this.project?.library?.type === library.type && this.project.library.id === library.id;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function registerZoteroTree(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const provider = new ZoteroTreeProvider(output);
  const projectWatcher = vscode.workspace.createFileSystemWatcher("**/.zotero/config.json");
  context.subscriptions.push(
    provider,
    projectWatcher,
    projectWatcher.onDidChange(() => provider.refresh()),
    projectWatcher.onDidCreate(() => provider.refresh()),
    projectWatcher.onDidDelete(() => provider.refresh()),
    vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider }),
    vscode.commands.registerCommand("zoteroLatexAssistant.refresh", () => {
      new ZoteroClient(getClientOptions()).clearCache();
      provider.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${CONFIG_SECTION}.apiUrl`)
        || event.affectsConfiguration(`${CONFIG_SECTION}.requestTimeoutMs`)) {
        provider.refresh();
      }
    }),
  );
}
