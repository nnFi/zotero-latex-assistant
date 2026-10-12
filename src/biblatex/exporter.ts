import type { LibraryRef } from "../shared/types";
import type { ZoteroClient } from "../zotero/client";
import type { BetterBibtexClient } from "../zotero/betterBibtex";
import { bibEntries, rekeyExport } from "./importer";
import { legacyCitationKey, validateCitationKey } from "./keys";
import { bibliographyReferenceKeys, rewriteBibliographyReferences } from "./migration";

export function citationKey(library: LibraryRef, key: string): string {
  return legacyCitationKey(library, key);
}

export async function exportProjectItems(client: ZoteroClient | BetterBibtexClient, library: LibraryRef, keys: readonly string[], mapping?: Readonly<Record<string, string>>): Promise<string[]> {
  const exports: string[] = [];
  const batch = "exportItems" in client ? await client.exportItems(library, keys) : undefined;
  const raw = new Map<string, string>();
  for (const key of keys) raw.set(key, batch ? batch[key]! : await client.exportItem(library, key));
  const hasReferences = [...raw.values()].some((text) => { const references = bibliographyReferenceKeys(text); return references === undefined || references.length > 0; });
  const aliases = new Map<string, string>();
  for (const key of keys) {
    const text = raw.get(key)!;
    const entries = bibEntries(text);
    if (entries.length !== 1) throw new Error("Zotero did not export a single unambiguous BibLaTeX entry.");
    const name = mapping && Object.hasOwn(mapping, key) ? validateCitationKey(mapping[key]) : citationKey(library, key);
    const original = entries[0]!.key;
    if (hasReferences && aliases.has(original) && aliases.get(original) !== name) throw new Error(`Bibliography reference “${original}” is ambiguous between exported sources.`);
    aliases.set(original, name);
    exports.push(rekeyExport(text, name));
  }
  const renames = new Map([...aliases].filter(([original, next]) => original !== next));
  for (let i = 0; i < exports.length; i++) exports[i] = rewriteBibliographyReferences(exports[i]!, renames);
  return exports;
}
