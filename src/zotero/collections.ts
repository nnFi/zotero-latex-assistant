import { ZoteroError } from "../shared/errors";
import type { LibraryRef, ZoteroCollection } from "../shared/types";
import { isRecord, libraryPrefix, validateKey } from "./validation";

export function collectionsPath(library: LibraryRef, parentKey?: string): string {
  const prefix = libraryPrefix(library);
  return parentKey === undefined
    ? `${prefix}/collections/top`
    : `${prefix}/collections/${validateKey(parentKey)}/collections`;
}

export function parseCollection(value: unknown, library: LibraryRef): ZoteroCollection {
  if (!isRecord(value) || !isRecord(value.data) || typeof value.data.name !== "string") {
    throw new ZoteroError("INVALID_RESPONSE", "Zotero returned invalid collection metadata.");
  }
  const parent = value.data.parentCollection;
  return {
    library,
    key: validateKey(value.key),
    name: value.data.name,
    parentKey: parent === false || parent === undefined || parent === null ? null : validateKey(parent),
  };
}
