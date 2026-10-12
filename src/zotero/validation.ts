import { ZoteroError } from "../shared/errors";
import type { LibraryRef } from "../shared/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function libraryPrefix(library: LibraryRef): string {
  if (!Number.isSafeInteger(library.id) || library.id < 0
    || !["user", "group"].includes(library.type)
    || (library.type === "group" && library.id === 0)) {
    throw new ZoteroError("INVALID_CONFIG", "Invalid Zotero library ID.");
  }
  return `${library.type === "user" ? "users" : "groups"}/${library.id}`;
}

export function validateKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{8}$/.test(value)) {
    throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an invalid item key.");
  }
  return value;
}

export function optionalString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new ZoteroError("INVALID_RESPONSE", `The Zotero field “${field}” does not contain valid text.`);
  }
  return value;
}

/** Zotero local JSON uses boolean true; Web API responses may use numeric 1. */
export function isTrashedData(data: Record<string, unknown>): boolean {
  return data.deleted === true || data.deleted === 1;
}
