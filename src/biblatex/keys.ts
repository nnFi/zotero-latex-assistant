import type { LibraryRef, ProjectConfig } from "../shared/types";
import { libraryPrefix, validateKey } from "../zotero/validation";

export function validateCitationKey(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{N}_:.+\/-]+$/u.test(value)) {
    throw new Error("Invalid citation key. Set a key without spaces or TeX special characters in Zotero / Better BibTeX.");
  }
  return value;
}

export function legacyCitationKey(library: LibraryRef, key: string): string {
  libraryPrefix(library);
  return `zotero-${library.type}-${library.id}-${validateKey(key)}`;
}

export function projectCitationKey(config: ProjectConfig, key: string): string {
  if (!config.library) throw new Error("Set the library first.");
  validateKey(key);
  return config.citationKeys && Object.hasOwn(config.citationKeys, key)
    ? validateCitationKey(config.citationKeys[key]) : legacyCitationKey(config.library, key);
}

/** Neue Keys zuerst speichern; alte Projektzuordnungen nicht aus Metadaten neu berechnen. */
export function reserveCitationKey(mapping: Record<string, string>, key: string, candidate: string, occupied: ReadonlySet<string>): void {
  validateKey(key);
  const value = validateCitationKey(candidate);
  if (occupied.has(value) || Object.entries(mapping).some(([other, name]) => other !== key && name === value)) {
    throw new Error(`The citation key “${value}” is already in use. Set a unique key in Zotero / Better BibTeX.`);
  }
  mapping[key] = value;
}

/** Shared parsing keeps metadata reads, creation and update collision checks consistent. */
export function extraCitationKeys(extra: string): string[] {
  return [...extra.matchAll(/^\s*Citation Key\s*:\s*(.*?)\s*$/gmi)].map((entry) => entry[1]!);
}

export function pinnedCitationKeyExtra(extra: string, key: string): string {
  validateCitationKey(key);
  const existing = extraCitationKeys(extra);
  if (existing.length) {
    if (existing.some((entry) => entry !== key)) throw new Error("A different Citation Key has been set in Zotero. It was not overwritten.");
    return extra;
  }
  return `${extra}${extra && !/[\r\n]$/.test(extra) ? "\n" : ""}Citation Key: ${key}`;
}
