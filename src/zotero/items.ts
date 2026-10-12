import { ZoteroError } from "../shared/errors";
import type { LibraryRef, ZoteroCreator, ZoteroItem } from "../shared/types";
import { isRecord, libraryPrefix, optionalString, validateKey } from "./validation";
import { extraCitationKeys, validateCitationKey } from "../biblatex/keys";

export function itemsPath(library: LibraryRef, collectionKey?: string): string {
  const prefix = libraryPrefix(library);
  return collectionKey === undefined
    ? `${prefix}/items/top`
    : `${prefix}/collections/${validateKey(collectionKey)}/items/top`;
}

export function parseItem(value: unknown, library: LibraryRef): ZoteroItem {
  if (!isRecord(value) || !isRecord(value.data) || typeof value.data.itemType !== "string") {
    throw new ZoteroError("INVALID_RESPONSE", "Zotero returned invalid source metadata.");
  }
  const data = value.data;
  if (data.creators !== undefined && !Array.isArray(data.creators)) {
    throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid creator list.");
  }
  const creators: ZoteroCreator[] = (data.creators ?? []).map((creator: unknown) => {
    if (!isRecord(creator)) {
      throw new ZoteroError("INVALID_RESPONSE", "Zotero returned invalid creator metadata.");
    }
    return {
      creatorType: optionalString(creator, "creatorType"),
      firstName: optionalString(creator, "firstName"),
      lastName: optionalString(creator, "lastName"),
      name: optionalString(creator, "name"),
    };
  });
  const pinned = typeof data.extra === "string" ? extraCitationKeys(data.extra) : [];
  let citationKey: string | undefined;
  if (typeof data.citationKey === "string" && data.citationKey) {
    try { citationKey = validateCitationKey(data.citationKey); } catch { /* Keep malformed metadata browsable. */ }
  } else if (pinned.length && new Set(pinned).size === 1) {
    try { citationKey = validateCitationKey(pinned[0]); } catch { /* Invalid extra metadata must not prevent browsing. */ }
  }
  return {
    library,
    key: validateKey(value.key),
    itemType: data.itemType as string,
    title: optionalString(data, "title") || optionalString(data, "filename")
      || (data.itemType === "note" ? "Note" : "Untitled"),
    creators,
    date: optionalString(data, "date"),
    doi: optionalString(data, "DOI") || (typeof data.extra === "string" ? data.extra.match(/^\s*DOI\s*:\s*(.+)$/mi)?.[1]?.trim() ?? "" : ""),
    ...(typeof data.ISBN === "string" ? { isbn: data.ISBN } : {}),
    url: optionalString(data, "url"),
    ...(citationKey ? { citationKey } : {}),
  };
}

export function creatorNameList(item: ZoteroItem): string[] {
  const authors = item.creators.filter((creator) => creator.creatorType === "author");
  return (authors.length ? authors : item.creators)
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "))
    .filter(Boolean);
}

export function creatorNames(item: ZoteroItem): string {
  return creatorNameList(item).join(", ");
}

export function itemDescription(item: ZoteroItem): string {
  const year = item.date.match(/\b\d{4}\b/)?.[0] ?? "";
  return [creatorNames(item), year].filter(Boolean).join(" · ");
}
