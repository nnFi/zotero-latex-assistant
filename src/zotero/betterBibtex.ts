import { ZoteroClient } from "./client";
import type { LibraryRef } from "../shared/types";
import { ZoteroError } from "../shared/errors";
import { isRecord, libraryPrefix, validateKey } from "./validation";
import { validateCitationKey } from "../biblatex/keys";
import { bibEntries } from "../biblatex/importer";

export const BETTER_BIBLATEX_TRANSLATOR = "Better BibLaTeX";
const EXPORT_UNAVAILABLE = "Better BibLaTeX export requires Better BibTeX for Zotero. Install and enable the plugin, then restart Zotero. To use the native exporter explicitly, set zoteroLatexAssistant.bibliographyExporter to native.";

/** Ausschließlich lesende BBT-Methoden; kein Regenerieren oder Autoexport anlegen. */
export class BetterBibtexClient extends ZoteroClient {
  private async rpc(method: "api.ready" | "item.citationkey" | "item.search" | "user.groups" | "item.export", params: unknown[]): Promise<unknown> {
    const json = await this.readJson(await this.request("../better-bibtex/json-rpc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
    }, true));
    if (!isRecord(json) || json.jsonrpc !== "2.0" || json.id !== method) throw new ZoteroError("INVALID_RESPONSE", "Invalid Better BibTeX response.");
    if (isRecord(json.error)) throw new ZoteroError("HTTP_ERROR", `Better BibTeX: ${String(json.error.message ?? "Request failed")}`, { status: json.error.code === -32601 ? 404 : 400 });
    if (!Object.hasOwn(json, "result")) throw new ZoteroError("INVALID_RESPONSE", "Better BibTeX did not return a result.");
    return json.result;
  }

  private async ready(): Promise<boolean> {
    // Instanzprüfung erfolgt über die native API, bevor der Plugin-Endpunkt genutzt wird.
    await this.checkConnection();
    const ready = await this.rpc("api.ready", []).catch((error: unknown) => {
      if (error instanceof ZoteroError && [404, 405, 501].includes(error.status ?? 0)) return undefined;
      throw error;
    });
    if (ready === undefined) return false;
    if (!isRecord(ready) || typeof ready.betterbibtex !== "string" || typeof ready.zotero !== "string") {
      throw new ZoteroError("INVALID_RESPONSE", "Better BibTeX returned invalid version information.");
    }
    return true;
  }

  private async resolveKeys(library: LibraryRef, keys: readonly string[], exportScope = false, allowMissing = false): Promise<{ keys: Readonly<Record<string, string>>; libraryId?: number }> {
    const result: Record<string, string> = {};
    let libraryName: string | undefined;
    for (let start = 0; start < keys.length; start += 50) {
      const batch = keys.slice(start, start + 50);
      if (library.type === "user" && library.id === 0) {
        const values = await this.rpc("item.citationkey", [batch]);
        if (!isRecord(values)) throw new ZoteroError("INVALID_RESPONSE", "Better BibTeX did not return a key mapping.");
        for (const key of batch) {
          if (allowMissing && (values[key] === null || values[key] === undefined)) continue;
          result[key] = validateCitationKey(values[key]);
        }
      } else {
        // BBT-libraryID ist nicht die Gruppen-ID. CSL-URIs binden das Ergebnis eindeutig an die externe Bibliothek.
        const values = await this.rpc("item.search", [[ ["joinMode", "any"], ...batch.map((key) => ["key", "is", key]) ], "*"]);
        if (!Array.isArray(values)) throw new ZoteroError("INVALID_RESPONSE", "Better BibTeX returned an invalid source list.");
        for (const key of batch) {
          const matches = values.filter((value: unknown) => {
            if (!isRecord(value) || typeof value.id !== "string") return false;
            try {
              const url = new URL(value.id);
              return ["zotero.org", "www.zotero.org"].includes(url.hostname)
                && ["http:", "https:"].includes(url.protocol)
                && url.pathname === `/${library.type === "group" ? "groups" : "users"}/${library.id}/items/${key}`;
            } catch { return false; }
          });
          if (allowMissing && !matches.length) continue;
          if (matches.length !== 1 || !isRecord(matches[0])) throw new Error("The Better BibTeX key could not be unambiguously matched to the project library.");
          result[key] = validateCitationKey(matches[0].citekey);
          if (exportScope) {
            const name = matches[0].library;
            if (typeof name !== "string" || !name || (libraryName && name !== libraryName)) {
              throw new Error("Better BibTeX did not return a consistent library for the selected sources.");
            }
            libraryName = name;
          }
        }
      }
    }
    if (!libraryName) return { keys: result };
    // BBT uses internal library IDs. Resolve the name verified by the source CSL URI.
    const groups = await this.rpc("user.groups", [false]);
    if (!Array.isArray(groups)) throw new ZoteroError("INVALID_RESPONSE", "Better BibTeX did not return a valid library list.");
    const matches = groups.filter((group: unknown) => isRecord(group) && group.name === libraryName);
    if (matches.length !== 1 || !isRecord(matches[0]) || !Number.isSafeInteger(matches[0].id) || (matches[0].id as number) <= 0) {
      throw new Error("The Better BibTeX export library could not be identified unambiguously.");
    }
    return { keys: result, libraryId: matches[0].id as number };
  }

  async citationKeys(library: LibraryRef, keys: readonly string[], allowMissing = false): Promise<Readonly<Record<string, string>> | undefined> {
    libraryPrefix(library); keys.forEach(validateKey);
    if (!keys.length) return {};
    if (!await this.ready()) return undefined;
    return (await this.resolveKeys(library, keys, false, allowMissing)).keys;
  }

  /** Export through the installed translator; never create files or auto-export jobs in Zotero. */
  async exportItems(library: LibraryRef, keys: readonly string[]): Promise<Readonly<Record<string, string>>> {
    libraryPrefix(library); keys.forEach(validateKey);
    if (!keys.length) return {};
    if (!await this.ready()) throw new ZoteroError("EXPORT_UNAVAILABLE", EXPORT_UNAVAILABLE);
    const unique = [...new Set(keys)];
    const resolved = await this.resolveKeys(library, unique, true);
    if (new Set(Object.values(resolved.keys)).size !== unique.length) throw new Error("Better BibTeX returned duplicate citation keys for the selected sources.");
    const exportedItems: Record<string, string> = {};
    for (const key of unique) {
      const citationKey = resolved.keys[key]!;
      const params: unknown[] = [[citationKey], BETTER_BIBLATEX_TRANSLATOR];
      if (resolved.libraryId !== undefined) params.push(resolved.libraryId);
      const text = await this.rpc("item.export", params).catch((error: unknown) => {
        if (error instanceof ZoteroError && [404, 405, 501].includes(error.status ?? 0)) {
          throw new ZoteroError("EXPORT_UNAVAILABLE", EXPORT_UNAVAILABLE, { cause: error });
        }
        throw error;
      });
      if (typeof text !== "string") throw new ZoteroError("INVALID_RESPONSE", "Better BibLaTeX did not return bibliography text.");
      const entries = bibEntries(text);
      if (entries.length !== 1 || entries[0]!.key !== citationKey) {
        throw new ZoteroError("INVALID_RESPONSE", "Better BibLaTeX did not export the requested source unambiguously. The project files were not changed.");
      }
      exportedItems[key] = text;
    }
    return exportedItems;
  }

  override async exportItem(library: LibraryRef, key: string): Promise<string> {
    return (await this.exportItems(library, [key]))[key]!;
  }
}
