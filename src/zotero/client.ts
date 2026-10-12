import { ZoteroError } from "../shared/errors";
import type { LibraryRef, ZoteroAttachment, ZoteroCollection, ZoteroCollectionDetail, ZoteroConnectionInfo, ZoteroItem, ZoteroItemDetail, ZoteroLibrary } from "../shared/types";
import { collectionsPath, parseCollection } from "./collections";
import { itemsPath, parseItem } from "./items";
import { isRecord, isTrashedData, libraryPrefix, validateKey } from "./validation";
import { coordinatorFor, type RequestCoordinator } from "./requestCoordinator";
import { parseAttachment } from "./attachments";

export interface ZoteroClientOptions {
  readonly apiUrl?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly serverId?: string;
}

/** Lokaler, ausschließlich lesender Adapter. Keine Datenbank- oder Cloud-Zugriffe. */
export class ZoteroClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;
  private readonly serverId: string | undefined;
  private readonly coordinator: RequestCoordinator;

  constructor(options: ZoteroClientOptions = {}) {
    try {
      this.baseUrl = new URL(options.apiUrl ?? "http://localhost:23119/api/");
    } catch (cause) {
      throw new ZoteroError("INVALID_CONFIG", "Invalid Zotero API URL.", { cause });
    }

    if (
      this.baseUrl.protocol !== "http:"
      || !["localhost", "127.0.0.1", "[::1]"].includes(this.baseUrl.hostname)
      || !["/api", "/api/"].includes(this.baseUrl.pathname)
      || this.baseUrl.username || this.baseUrl.password
      || this.baseUrl.search || this.baseUrl.hash
    ) {
      throw new ZoteroError(
        "INVALID_CONFIG",
        "Use a local Zotero API URL such as http://localhost:23119/api/.",
      );
    }
    this.baseUrl.pathname = "/api/";
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 60000) {
      throw new ZoteroError("INVALID_CONFIG", "The request timeout must be an integer between 100 and 60000 milliseconds.");
    }
    this.fetch = options.fetch ?? globalThis.fetch;
    this.serverId = options.serverId;
    this.coordinator = coordinatorFor(this.fetch, this.baseUrl);
  }

  clearCache(): void { this.coordinator.invalidate(); }

  async checkConnection(): Promise<ZoteroConnectionInfo> {
    const response = await this.request("");
    const apiVersion = response.headers.get("Zotero-API-Version");
    const serverId = response.headers.get("Zotero-Server-ID");
    // /api/ muss nicht JSON liefern; hier zählen Status und API-Version.
    await response.body?.cancel();
    if (apiVersion !== "3") {
      throw new ZoteroError(
        "INVALID_RESPONSE",
        "Zotero did not return supported API version 3. Check the Zotero version and API URL.",
      );
    }
    return {
      apiUrl: this.baseUrl.href,
      apiVersion,
      ...(serverId ? { serverId } : {}),
    };
  }

  async listLibraries(): Promise<readonly ZoteroLibrary[]> {
    // 0 ist die dokumentierte lokale ID der persönlichen Bibliothek.
    // Eine kleine Anfrage bestätigt ihre Erreichbarkeit, ohne alle Einträge zu laden.
    const personal = await this.request("users/0/items?format=json&limit=1");
    const rawItemCount = personal.headers.get("Total-Results");
    const itemCount = rawItemCount === null ? undefined : Number(rawItemCount);
    await personal.body?.cancel();

    const libraries: ZoteroLibrary[] = [{
      type: "user", id: 0, name: "My library",
      ...(itemCount !== undefined && Number.isSafeInteger(itemCount) && itemCount >= 0
        ? { itemCount } : {}),
    }];
    const seenGroups = new Set<number>();

    // Explizite Seitengröße funktioniert auch bei älteren lokalen API-Versionen.
    for (let start = 0; ; start += 100) {
      if (start >= 100000) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned too many groups. Fetch cancelled.");
      const response = await this.request(`users/0/groups?format=json&limit=100&start=${start}`);
      const groups = await this.readJson(response);
      if (!Array.isArray(groups)) {
        throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid group list.");
      }
      if (groups.length > 100) throw new ZoteroError("INVALID_RESPONSE", "Zotero did not respect the requested group page size.");
      for (const group of groups) {
        if (
          !isRecord(group) || !Number.isSafeInteger(group.id) || (group.id as number) <= 0
          || !isRecord(group.data) || typeof group.data.name !== "string"
        ) {
          throw new ZoteroError("INVALID_RESPONSE", "Zotero returned invalid group metadata.");
        }
        const id = group.id as number;
        if (seenGroups.has(id)) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned repeated group pages. Fetch cancelled.");
        seenGroups.add(id);
        libraries.push({ type: "group", id, name: group.data.name });
      }
      if (groups.length < 100) {
        return libraries;
      }
    }
  }

  async listCollections(library: LibraryRef, parentKey?: string): Promise<readonly ZoteroCollection[]> {
    return this.readPagedList(collectionsPath(library, parentKey), (value) => parseCollection(value, library));
  }

  async listAllCollections(library: LibraryRef): Promise<readonly ZoteroCollection[]> {
    return this.readPagedList(`${libraryPrefix(library)}/collections`, (value) => parseCollection(value, library));
  }

  async listItems(library: LibraryRef, collectionKey?: string): Promise<readonly ZoteroItem[]> {
    return this.readPagedList(itemsPath(library, collectionKey), (value) => parseItem(value, library));
  }

  async getCollection(library: LibraryRef, key: string): Promise<ZoteroCollection> {
    const collection = parseCollection(await this.readJson(await this.request(
      `${libraryPrefix(library)}/collections/${validateKey(key)}?format=json`)), library);
    if (collection.key !== key) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned a different collection.");
    return collection;
  }

  async getCollectionDetail(library: LibraryRef, key: string): Promise<ZoteroCollectionDetail> {
    const response = await this.request(`${libraryPrefix(library)}/collections/${validateKey(key)}?format=json`);
    const value = await this.readJson(response);
    const collection = parseCollection(value, library);
    if (collection.key !== key || !isRecord(value) || !isRecord(value.data)
      || !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
      throw new ZoteroError("INVALID_RESPONSE", "Invalid collection key or version.");
    }
    const serverId = response.headers.get("Zotero-Server-ID");
    return { collection, version: value.version as number, data: value.data, ...(serverId ? { serverId } : {}) };
  }

  async searchItems(library: LibraryRef, collectionKey: string | undefined, query: string): Promise<readonly ZoteroItem[]> {
    return this.readPagedList(`${itemsPath(library, collectionKey)}?${new URLSearchParams({ q: query, qmode: "everything" })}`,
      (value) => parseItem(value, library));
  }

  async itemTemplate(itemType: string): Promise<Record<string, unknown>> {
    // The local API exposes itemTypeFields, but not the Web API's items/new endpoint.
    const fields = await this.readJson(await this.request(`itemTypeFields?${new URLSearchParams({ itemType })}`));
    if (!Array.isArray(fields) || !fields.length || fields.some((entry) => !isRecord(entry) || typeof entry.field !== "string")) {
      throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero item fields.");
    }
    return { itemType, ...Object.fromEntries(fields.map((entry: { field: string }) => [entry.field, ""])) };
  }

  async creatorTypes(itemType: string): Promise<string[]> {
    const types = await this.readJson(await this.request(`itemTypeCreatorTypes?${new URLSearchParams({ itemType })}`));
    if (!Array.isArray(types) || types.some((entry) => !isRecord(entry) || typeof entry.creatorType !== "string")) {
      throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero creator types.");
    }
    return types.map((entry: { creatorType: string }) => entry.creatorType);
  }

  async isItemTrashed(library: LibraryRef, key: string): Promise<boolean> {
    validateKey(key);
    // Zotero 10.0.6's itemKey scope excludes trash even on /items/trash.
    // Page the documented trash resource and inspect exact keys locally instead.
    const items = await this.readPagedList(`${libraryPrefix(library)}/items/trash`, (value) => {
      if (!isRecord(value) || !isRecord(value.data)) throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero trash response.");
      return { key: validateKey(value.key), trashed: isTrashedData(value.data) };
    });
    return items.some((item) => item.key === key && item.trashed);
  }

  async listTrash(library: LibraryRef): Promise<readonly ZoteroItemDetail[]> {
    return this.readPagedList(`${libraryPrefix(library)}/items/trash`, (value) => {
      const item = parseItem(value, library);
      if (!isRecord(value) || !isRecord(value.data) || !Number.isSafeInteger(value.version)
        || (value.version as number) < 0 || !isTrashedData(value.data)) {
        throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero trash item.");
      }
      return { item, data: value.data, version: value.version as number };
    });
  }

  async listItemNotes(library: LibraryRef, key: string): Promise<readonly { key: string; version: number; parentKey: string; note: string }[]> {
    return this.readPagedList(`${libraryPrefix(library)}/items/${validateKey(key)}/children?itemType=note`, (value) => {
      if (!isRecord(value) || !isRecord(value.data) || value.data.itemType !== "note"
        || value.data.parentItem !== key || typeof value.data.note !== "string" || isTrashedData(value.data)
        || !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
        throw new ZoteroError("INVALID_RESPONSE", "Invalid source note or parent.");
      }
      return { key: validateKey(value.key), version: value.version as number, parentKey: key, note: value.data.note };
    });
  }

  async listAttachmentMetadata(library: LibraryRef, collectionKey?: string): Promise<readonly ZoteroAttachment[]> {
    const prefix = libraryPrefix(library);
    const path = collectionKey === undefined ? `${prefix}/items`
      : `${prefix}/collections/${validateKey(collectionKey)}/items`;
    // Gemeinsame gefilterte Metadatenabfrage statt einer Anfrage pro Quelle; keine Dateiinhalte.
    return this.readPagedList(`${path}?itemType=attachment`, parseAttachment);
  }

  async getItem(library: LibraryRef, key: string): Promise<ZoteroItemDetail> {
    const response = await this.request(`${libraryPrefix(library)}/items/${validateKey(key)}?format=json`);
    const value = await this.readJson(response);
    const item = parseItem(value, library);
    if (item.key !== key) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned a different item than requested.");
    if (!isRecord(value) || !isRecord(value.data) || !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
      throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid item version.");
    }
    const serverId = response.headers.get("Zotero-Server-ID");
    return { item, data: value.data, version: value.version as number, ...(serverId ? { serverId } : {}) };
  }

  async listItemAttachments(library: LibraryRef, key: string): Promise<readonly ZoteroAttachment[]> {
    return this.readPagedList(`${libraryPrefix(library)}/items/${validateKey(key)}/children?itemType=attachment`, parseAttachment);
  }

  async attachmentFileUrl(library: LibraryRef, key: string): Promise<string> {
    // Local API returns a file: URL here; do not follow /file redirects or download remote URLs.
    return (await this.request(`${libraryPrefix(library)}/items/${validateKey(key)}/file/view/url`)).text();
  }

  async exportItem(library: LibraryRef, key: string): Promise<string> {
    const response = await this.request(`${libraryPrefix(library)}/items/${validateKey(key)}?format=biblatex`);
    return response.text();
  }

  async itemBibliography(library: LibraryRef, key: string, style: string, locale = "en-US"): Promise<string> {
    const query = new URLSearchParams({ format: "bib", style, locale });
    return (await this.request(`${libraryPrefix(library)}/items/${validateKey(key)}?${query}`)).text();
  }

  private async readPagedList<T>(path: string, parse: (value: unknown) => T): Promise<T[]> {
    const results: T[] = [];
    const seen = new Set<string>();
    for (let start = 0; ; start += 100) {
      if (start >= 100000) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned too many results. Choose a smaller project collection.");
      const response = await this.request(`${path}${path.includes("?") ? "&" : "?"}format=json&limit=100&start=${start}`);
      const page = await this.readJson(response);
      if (!Array.isArray(page)) {
        throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid result list.");
      }
      if (page.length > 100) throw new ZoteroError("INVALID_RESPONSE", "Zotero did not respect the requested page size.");
      const parsed = page.map(parse);
      for (const value of page) {
        if (isRecord(value) && typeof value.key === "string") {
          if (seen.has(value.key)) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned repeated result pages. Fetch cancelled; refresh again.");
          seen.add(value.key);
        }
      }
      results.push(...parsed);
      if (page.length < 100) return results;
    }
  }

  protected async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch (cause) {
      if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) {
        throw new ZoteroError("TIMEOUT", "Timed out while reading the Zotero response.", { cause });
      }
      throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid JSON response.", { cause });
    }
  }

  protected async request(path: string, options: RequestInit = {}, readOnly = false): Promise<Response> {
    const action = async (): Promise<Response> => {
      const response = await this.performRequest(path, options);
      try {
        const body = response.status === 204 ? null : await response.arrayBuffer();
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (cause) {
        if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) {
          throw new ZoteroError("TIMEOUT", "Timed out while reading the Zotero response.", { cause });
        }
        throw new ZoteroError("UNAVAILABLE", "The connection to Zotero was interrupted while reading.", { cause });
      }
    };
    const method = options.method ?? "GET";
    const url = new URL(path, this.baseUrl);
    // Export und Stilverarbeitung sind teurer und sollen nicht im Rohdaten-Cache landen.
    const cacheable = method === "GET" && (!url.searchParams.has("format") || url.searchParams.get("format") === "json");
    if (cacheable || readOnly) return this.coordinator.read(`${this.baseUrl.href}:${this.serverId ?? ""}:${path}:${readOnly ? String(options.body) : ""}`, action);
    const response = await this.coordinator.schedule(action);
    if (method !== "GET") this.clearCache();
    return response;
  }

  private async performRequest(path: string, options: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetch(new URL(path, this.baseUrl), {
        ...options,
        method: options.method ?? "GET",
        headers: { Accept: "application/json", "Zotero-API-Version": "3",
          ...(this.serverId ? { "Zotero-Server-ID": this.serverId } : {}), ...options.headers },
        signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
      });
    } catch (cause) {
      if (cause instanceof Error && ["TimeoutError", "AbortError"].includes(cause.name)) {
        throw new ZoteroError("TIMEOUT", "Zotero did not respond within the configured timeout.", { cause });
      }
      throw new ZoteroError(
        "UNAVAILABLE",
        "Zotero is unavailable. Start Zotero and check the local API URL.",
        { cause },
      );
    }

    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401) throw new ZoteroError("AUTH_REQUIRED", "Zotero requires new write authorization.", { status: response.status });
      if (response.status === 412) throw new ZoteroError("CONFLICT", "The item has changed or a different Zotero database is connected. Reload it.", { status: response.status });
      if ([404, 405, 501].includes(response.status) && options.method && options.method !== "GET" && new URL(path, this.baseUrl).pathname.startsWith("/api/")) {
        throw new ZoteroError("WRITE_UNSUPPORTED", "Local editing requires Zotero 10 or newer. Open the item in Zotero to edit it.", { status: response.status });
      }
      if (response.status === 403) {
        throw new ZoteroError(
          "FORBIDDEN",
          options.method === "POST" && new URL(path, this.baseUrl).pathname.startsWith("/api/") ? "Zotero denied write authorization."
            : "Zotero denied access. Allow communication with other applications under Settings → Advanced.",
          { status: response.status },
        );
      }
      throw new ZoteroError("HTTP_ERROR", `Zotero request failed (HTTP ${response.status}).`, { status: response.status });
    }
    if (this.serverId && new URL(path, this.baseUrl).pathname.startsWith("/api/") && response.headers.get("Zotero-Server-ID") !== this.serverId) {
      await response.body?.cancel();
      throw new ZoteroError("CONFLICT", "The Zotero database does not match the saved project binding.");
    }
    return response;
  }
}
