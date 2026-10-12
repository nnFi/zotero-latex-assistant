import { ZoteroClient, type ZoteroClientOptions } from "./client";
import { ZoteroError } from "../shared/errors";
import type { LibraryRef, ZoteroItemDetail } from "../shared/types";
import { isRecord, isTrashedData, libraryPrefix, validateKey } from "./validation";
import type { UploadPdf } from "./attachmentFiles";

// Explicit no-write rejections only. Timeouts, unknown statuses and 5xx remain uncertain.
const rejectedWithoutWrite = (status: unknown): boolean => typeof status === "number"
  && [400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429].includes(status);

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

/** Separater Schreibadapter: Instanzbindung, lokale Freigabe und optimistische Versionsprüfung. */
export class ZoteroWriter extends ZoteroClient {
  constructor(options: ZoteroClientOptions, private readonly secrets: SecretStore) { super(options); }

  async updateItem(detail: ZoteroItemDetail, patch: Record<string, unknown>, preflight?: () => Promise<void>): Promise<void> {
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
    const response = await this.authorizedWrite(detail.serverId, `${libraryPrefix(detail.item.library)}/items/${validateKey(detail.item.key)}`,
      "PATCH", patch, { "If-Unmodified-Since-Version": String(detail.version) }, preflight);
    await response.body?.cancel();
  }

  async createItem(library: LibraryRef, serverId: string, key: string, data: Record<string, unknown>,
    preflight: () => Promise<void>, onRejected?: () => Promise<void>): Promise<ZoteroItemDetail> {
    validateKey(key);
    const response = await this.authorizedWrite(serverId, `${libraryPrefix(library)}/items`, "POST",
      [{ ...data, key, version: 0 }], {}, preflight, true, onRejected);
    const result = await this.readJson(response);
    // The batch API can reject a row within HTTP 200. Contradictory/partial replies are uncertain.
    if (isRecord(result) && isRecord(result.successful) && !Object.keys(result.successful).length
      && isRecord(result.unchanged) && !Object.keys(result.unchanged).length
      && isRecord(result.failed) && Object.keys(result.failed).length === 1 && isRecord(result.failed["0"])
      && (result.failed["0"].key === undefined || result.failed["0"].key === key)
      && rejectedWithoutWrite(result.failed["0"].code)) {
      await onRejected?.();
      throw new ZoteroError("HTTP_ERROR", "Zotero rejected creation without saving the item. Retry with the same requestId and input.",
        { status: result.failed["0"].code as number });
    }
    if (!isRecord(result) || !isRecord(result.successful) || !isRecord(result.successful["0"])
      || result.successful["0"].key !== key || (isRecord(result.failed) && Object.keys(result.failed).length)) {
      throw new ZoteroError("INVALID_RESPONSE", "Zotero did not confirm creation. Inspect the allocated item key before retrying.");
    }
    this.clearCache();
    return this.getItem(library, key);
  }

  /** deleted=1 is recoverable trash; DELETE would permanently erase the source. */
  async trashItem(detail: ZoteroItemDetail, preflight: () => Promise<void>): Promise<ZoteroItemDetail> {
    if (!detail.serverId) throw new ZoteroError("WRITE_UNSUPPORTED", "Trashing requires Zotero 10 or newer.");
    const response = await this.authorizedWrite(detail.serverId,
      `${libraryPrefix(detail.item.library)}/items/${validateKey(detail.item.key)}`, "PATCH", { deleted: 1 },
      { "If-Unmodified-Since-Version": String(detail.version) }, preflight);
    await response.body?.cancel();
    this.clearCache();
    const saved = await this.getItem(detail.item.library, detail.item.key);
    if (!isTrashedData(saved.data) || !await this.isItemTrashed(detail.item.library, detail.item.key)) {
      throw new ZoteroError("INVALID_RESPONSE", "The write completed, but the trash state could not be verified. Inspect Zotero before retrying.");
    }
    return saved;
  }

  /** Three-phase local upload. Never replace an existing file or send PDF bytes to a remote host. */
  async uploadNewPdf(library: LibraryRef, serverId: string, attachmentKey: string, pdf: UploadPdf,
    preflight: () => Promise<void>): Promise<void> {
    const endpoint = `${libraryPrefix(library)}/items/${validateKey(attachmentKey)}/file`;
    const headers = { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": "*" };
    // Encode spaces as %20: older local Zotero versions treat form '+' literally in filenames.
    const form = (params: Record<string, string>) => new URLSearchParams(params).toString().replace(/\+/g, "%20");
    const response = await this.authorizedWrite(serverId, endpoint, "POST", form({ md5: pdf.md5, filename: pdf.filename,
      filesize: String(pdf.sizeBytes), mtime: String(Math.max(0, pdf.mtimeMs)), contentType: "application/pdf" }), headers, preflight, false);
    const authorization = await this.readJson(response);
    if (!isRecord(authorization)) throw new ZoteroError("INVALID_RESPONSE", "Invalid local file upload authorization.");
    if (authorization.exists === 1) return;
    const connection = await this.checkConnection();
    const base = new URL(connection.apiUrl);
    let upload: URL;
    try { upload = new URL(String(authorization.url)); } catch { throw new Error("Invalid local file upload URL."); }
    if (connection.serverId !== serverId || upload.origin !== base.origin || upload.username || upload.password || upload.search || upload.hash
      || typeof authorization.uploadKey !== "string" || !/^[a-zA-Z0-9]{32}$/.test(authorization.uploadKey)
      || upload.pathname !== `/api/local/uploads/${authorization.uploadKey}`
      || authorization.contentType !== "application/pdf" || authorization.prefix !== "" || authorization.suffix !== "") {
      throw new ZoteroError("INVALID_RESPONSE", "Upload must target this Zotero instance's local raw-file endpoint.");
    }
    await preflight();
    const uploaded = await this.request(upload.pathname.slice("/api/".length), {
      method: "POST", headers: { "Content-Type": "application/pdf" },
      body: new Uint8Array(pdf.data), signal: AbortSignal.timeout(60000),
    });
    await uploaded.body?.cancel();
    if (uploaded.status !== 201) throw new ZoteroError("INVALID_RESPONSE", "Zotero did not confirm receiving the PDF bytes.");
    const registered = await this.authorizedWrite(serverId, endpoint, "POST", form({ upload: authorization.uploadKey }), headers, preflight, false);
    await registered.body?.cancel();
    if (registered.status !== 204) throw new ZoteroError("INVALID_RESPONSE", "Zotero did not confirm registering the PDF file.");
  }

  private async authorizedWrite(serverId: string, path: string, method: "POST" | "PATCH", body: unknown,
    headers: Record<string, string>, preflight?: () => Promise<void>, json = true, onRejected?: () => Promise<void>): Promise<Response> {
    this.clearCache();
    const connection = await this.checkConnection();
    if (!serverId || connection.serverId !== serverId) throw new ZoteroError("CONFLICT", "A different Zotero database is connected. Reload it.");
    const secretName = `zotero-local:${connection.apiUrl}:${serverId}`;
    let key = await this.secrets.get(secretName);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!key) {
        const authorization = await this.readJson(await this.request("local/authorize", {
          method: "POST", headers: { "Content-Type": "application/json", "Zotero-Server-ID": serverId },
          body: JSON.stringify({ appName: "Zotero LaTeX Assistant" }),
          signal: AbortSignal.timeout(60000),
        }));
        if (!isRecord(authorization) || typeof authorization.key !== "string" || !/^[a-zA-Z0-9]{32}$/.test(authorization.key)
          || typeof authorization.remember !== "boolean") throw new ZoteroError("INVALID_RESPONSE", "Invalid Zotero write authorization.");
        key = authorization.key;
        if (authorization.remember) await this.secrets.store(secretName, key);
      }
      // Only the actual write response can confirm rejection, never a preflight or later GET.
      await preflight?.();
      try {
        const response = await this.request(path, {
          method, headers: { "Content-Type": "application/json", "Zotero-API-Key": key,
            "Zotero-Server-ID": serverId, ...headers }, body: json ? JSON.stringify(body) : String(body),
        });
        return response;
      } catch (error) {
        if (error instanceof ZoteroError && rejectedWithoutWrite(error.status)) await onRejected?.();
        if (!(error instanceof ZoteroError) || error.code !== "AUTH_REQUIRED") throw error;
        await this.secrets.delete(secretName);
        if (attempt === 1) throw error;
        key = undefined;
      }
    }
    throw new ZoteroError("AUTH_REQUIRED", "Zotero requires new write authorization.");
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
