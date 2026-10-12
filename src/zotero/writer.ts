import { ZoteroClient, type ZoteroClientOptions } from "./client";
import { ZoteroError } from "../shared/errors";
import type { ZoteroItemDetail } from "../shared/types";
import { isRecord, libraryPrefix, validateKey } from "./validation";

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** Separater Schreibadapter: Instanzbindung, lokale Freigabe und optimistische Versionsprüfung. */
export class ZoteroWriter extends ZoteroClient {
  constructor(options: ZoteroClientOptions, private readonly secrets: SecretStore) { super(options); }

  async updateItem(detail: ZoteroItemDetail, patch: Record<string, unknown>): Promise<void> {
    if (!detail.serverId) {
      throw new ZoteroError("WRITE_UNSUPPORTED", "Local editing requires Zotero 10 or newer. Open the item in Zotero to edit it.");
    }
    const allowed = editableData(detail.data);
    if (!Object.keys(patch).length) return;
    for (const [field, value] of Object.entries(patch)) {
      if (!Object.hasOwn(allowed, field) || typeof value !== typeof allowed[field]
        || Array.isArray(value) !== Array.isArray(allowed[field])) {
        throw new Error(`The field “${field}” cannot be changed with this operation.`);
      }
    }
    const connection = await this.checkConnection();
    if (connection.serverId !== detail.serverId) throw new ZoteroError("CONFLICT", "A different Zotero database is connected. Reload it.");
    const secretName = `zotero-local:${connection.apiUrl}:${detail.serverId}`;
    let key = await this.secrets.get(secretName);
    for (let attempt = 0; attempt < 2; attempt++) {
      let remember = Boolean(key);
      if (!key) {
        const authorization = await this.readJson(await this.request("local/authorize", {
          method: "POST", headers: { "Content-Type": "application/json", "Zotero-Server-ID": detail.serverId },
          body: JSON.stringify({ appName: "Zotero LaTeX Assistant" }),
          signal: AbortSignal.timeout(60000),
        }));
        if (!isRecord(authorization) || typeof authorization.key !== "string" || !/^[a-zA-Z0-9]{32}$/.test(authorization.key)
          || typeof authorization.remember !== "boolean") throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero write authorization.");
        key = authorization.key;
        remember = authorization.remember;
        if (remember) await this.secrets.store(secretName, key);
      }
      try {
        const response = await this.request(`${libraryPrefix(detail.item.library)}/items/${validateKey(detail.item.key)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json", "Zotero-API-Key": key,
            "Zotero-Server-ID": detail.serverId, "If-Unmodified-Since-Version": String(detail.version) },
          body: JSON.stringify(patch),
        });
        await response.body?.cancel();
        return;
      } catch (error) {
        if (!(error instanceof ZoteroError) || error.code !== "AUTH_REQUIRED" || attempt === 1) throw error;
        await this.secrets.delete(secretName);
        key = undefined;
      }
    }
  }
}

export function editableData(data: Record<string, unknown>): Record<string, unknown> {
  const immutable = new Set(["key", "version", "itemType", "dateAdded", "dateModified", "parentItem", "deleted"]);
  return Object.fromEntries(Object.entries(data).filter(([field, value]) => !immutable.has(field)
    && (typeof value === "string" || ["creators", "tags", "collections", "relations"].includes(field))));
}

export function metadataPatch(original: Record<string, unknown>, edited: unknown): Record<string, unknown> {
  if (!isRecord(edited)) throw new Error("Metadata must be a JSON object.");
  const allowed = editableData(original);
  if (Object.keys(edited).some((field) => !Object.hasOwn(allowed, field))) throw new Error("Unknown or protected metadata fields.");
  const patch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(edited)) {
    if (JSON.stringify(value) !== JSON.stringify(original[field])) patch[field] = value;
  }
  return patch;
}
