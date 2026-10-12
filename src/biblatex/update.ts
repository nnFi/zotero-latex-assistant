import type { ProjectConfig, ZoteroItem } from "../shared/types";
import { parseProjectConfig } from "../config/project";
import { bibEntries, rekeyExport, synchronizeBibliography } from "./importer";
import { bibliographyReferenceKeys, rewriteBibliographyReferences } from "./migration";
import { legacyCitationKey, projectCitationKey, reserveCitationKey } from "./keys";
import { selectedImportKeys } from "./selection";
import type { BibliographyPresence } from "./presence";
import { removeBibliographyReferences } from "./deletion";
import { newBibliographyDuplicates } from "./duplicates";
import { bibliographyRecords } from "./fields";

export interface BibliographyUpdateInput {
  readonly config: ProjectConfig;
  readonly items: readonly ZoteroItem[];
  readonly bibliography: string;
  readonly presence: BibliographyPresence;
  readonly selection?: readonly ZoteroItem[];
  readonly synchronize?: { readonly shown: readonly ZoteroItem[]; readonly resolvedKeys: Readonly<Record<string, string>> };
}

export interface BibliographyUpdatePlan {
  readonly config: ProjectConfig;
  readonly bibliography: string;
  readonly itemKeys: readonly string[];
  readonly citationKeys: Readonly<Record<string, string>>;
  readonly trackedItemKeys: readonly string[];
  readonly newItemKeys: readonly string[];
  readonly pendingItemKeys: readonly string[];
  readonly preservedExports: ReadonlyMap<string, string>;
  readonly uncheckedCitationKeys: ReadonlySet<string>;
  readonly replacedCitationKeys: ReadonlySet<string>;
  readonly occupiedCitationKeys: ReadonlySet<string>;
}

export function assertBibliographyScope(config: ProjectConfig, shown?: readonly ZoteroItem[]): void {
  if (!config.library) throw new Error("Run “Zotero: Set library” first.");
  if (shown?.some((item) => item.library.type !== config.library!.type || item.library.id !== config.library!.id)) {
    throw new Error("The source list does not belong to the linked project library.");
  }
}

/** Determine the desired membership from actual file contents and the reviewed selection. */
export function bibliographyItemKeys(input: BibliographyUpdateInput): string[] {
  const { config, items, presence, selection, synchronize } = input;
  assertBibliographyScope(config, synchronize?.shown);
  const shown = new Set(synchronize?.shown.map((item) => item.key) ?? []);
  const selectionConfig = synchronize ? { ...config, importedItemKeys: config.importedItemKeys.filter((key) => !shown.has(key)) } : config;
  selectedImportKeys(selectionConfig, items, selection ?? []);
  const present = new Set(presence.itemKeys);
  const keys = new Set([...config.importedItemKeys.filter((key) => present.has(key)), ...presence.itemKeys]
    .filter((key) => !synchronize || !shown.has(key)));
  selection?.forEach((item) => keys.add(item.key));
  return [...keys];
}

/** Plan preservation, export requirements and key ownership without fetching or writing anything. */
export function planBibliographyUpdate(input: BibliographyUpdateInput, itemKeys = bibliographyItemKeys(input)): BibliographyUpdatePlan {
  const { config, bibliography, presence, selection, synchronize } = input;
  assertBibliographyScope(config, synchronize?.shown);
  if (!config.library) throw new Error("Run “Zotero: Set library” first.");
  const shown = new Set(synchronize?.shown.map((item) => item.key) ?? []);
  const mapping: Record<string, string> = { ...config.citationKeys };
  for (const key of config.importedItemKeys) if (!Object.hasOwn(mapping, key)) mapping[key] = legacyCitationKey(config.library, key);
  Object.assign(mapping, presence.citationKeys);
  const unchecked = new Set<string>();
  if (synchronize) for (const item of synchronize.shown) {
    if (itemKeys.includes(item.key)) continue;
    const name = mapping[item.key] ?? item.citationKey ?? synchronize.resolvedKeys[item.key];
    if (name) unchecked.add(name);
  }
  const replaced = new Set<string>();
  if (synchronize) {
    for (const name of [...config.importedItemKeys.map((key) => projectCitationKey(config, key)), ...Object.values(presence.citationKeys)]) replaced.add(name);
  }
  for (const key of itemKeys) if (mapping[key]) replaced.add(mapping[key]!);
  const tracked = synchronize ? new Set([...config.importedItemKeys.filter((key) => !shown.has(key)), ...itemKeys])
    : new Set([...config.importedItemKeys, ...itemKeys]);
  for (const key of Object.keys(mapping)) if (!tracked.has(key)) delete mapping[key];
  const entries = new Map(bibEntries(bibliography).map((entry) => [entry.key, entry]));
  const preserved = new Map<string, string>();
  const pending: string[] = [];
  for (const key of itemKeys) {
    const preserve = synchronize || (selection && !selection.some((item) => item.key === key));
    const entry = preserve && mapping[key] ? entries.get(mapping[key]!) : undefined;
    if (entry) preserved.set(key, bibliography.slice(entry.entryStart, entry.entryEnd));
    else pending.push(key);
  }
  return { config, bibliography, itemKeys: [...itemKeys], citationKeys: mapping, trackedItemKeys: [...tracked],
    newItemKeys: itemKeys.filter((key) => !Object.hasOwn(mapping, key)), pendingItemKeys: pending, preservedExports: preserved,
    uncheckedCitationKeys: unchecked, replacedCitationKeys: replaced,
    occupiedCitationKeys: new Set([...entries.keys()].filter((key) => !replaced.has(key))) };
}

function requiredExport(exports: ReadonlyMap<string, string>, key: string): string {
  const text = exports.get(key);
  if (text === undefined) throw new Error(`Missing BibLaTeX export for source “${key}”.`);
  return text;
}

export function bibliographyExportsHaveReferences(plan: BibliographyUpdatePlan, exports: ReadonlyMap<string, string>): boolean {
  return plan.pendingItemKeys.some((key) => {
    const references = bibliographyReferenceKeys(requiredExport(exports, key));
    return references === undefined || references.length > 0;
  });
}

export interface BibliographyUpdateResult {
  readonly text: string;
  readonly config: ProjectConfig;
  readonly removedCitationKeys: ReadonlySet<string>;
  readonly duplicateDetails: string;
}

/** Complete a plan from validated exports; the caller owns dialogs and the eventual transaction. */
export function completeBibliographyUpdate(plan: BibliographyUpdatePlan, exports: ReadonlyMap<string, string>,
  preferredKeys?: Readonly<Record<string, string>>, preservedProviderKeys: Readonly<Record<string, string>> = {}): BibliographyUpdateResult {
  const mapping = { ...plan.citationKeys };
  const exportedKey = (key: string): string => {
    const entries = bibEntries(requiredExport(exports, key));
    if (entries.length !== 1) throw new Error("Zotero did not export a single unambiguous BibLaTeX entry.");
    return entries[0]!.key;
  };
  for (const key of plan.newItemKeys) {
    const providerKey = exportedKey(key);
    reserveCitationKey(mapping, key, preferredKeys ? preferredKeys[key]! : providerKey, plan.occupiedCitationKeys);
  }
  const hasReferences = bibliographyExportsHaveReferences(plan, exports);
  const aliases = new Map<string, string>();
  const assignAlias = (source: string, target: string): void => {
    if (hasReferences && aliases.has(source) && aliases.get(source) !== target) {
      throw new Error(`Bibliography reference “${source}” is ambiguous between project sources. The files were not changed.`);
    }
    aliases.set(source, target);
  };
  for (const key of plan.pendingItemKeys) assignAlias(exportedKey(key), mapping[key]!);
  for (const key of plan.itemKeys) if (!plan.pendingItemKeys.includes(key) && preservedProviderKeys[key]) {
    assignAlias(preservedProviderKeys[key]!, mapping[key]!);
  }
  const renames = new Map([...aliases].filter(([previous, next]) => previous !== next));
  const keyed = plan.itemKeys.map((key) => rekeyExport(requiredExport(exports, key), mapping[key]!));
  const merged = synchronizeBibliography(plan.bibliography, keyed, plan.replacedCitationKeys);
  let text = rewriteBibliographyReferences(merged, renames, new Set(plan.pendingItemKeys.map((key) => mapping[key]!)));
  const retained = new Set(bibEntries(text).map((entry) => entry.key));
  const removed = new Set([...plan.uncheckedCitationKeys].filter((key) => !retained.has(key)));
  text = removeBibliographyReferences(text, removed, plan.config.bibFile);
  const duplicates = newBibliographyDuplicates(plan.bibliography, text);
  const definite = duplicates.filter((duplicate) => duplicate.reason === "doi");
  if (definite.length) throw new Error(`Duplicate DOI detected for ${definite.map((duplicate) => `“${duplicate.first}” and “${duplicate.second}”`).join("; ")}. The project files were not changed. Keep one source for each publication.`);
  const records = new Map(bibliographyRecords(text).map((record) => [record.key, record]));
  const duplicateDetails = duplicates.map((duplicate) => {
    const first = records.get(duplicate.first)!;
    const second = records.get(duplicate.second)!;
    return `${duplicate.first} ↔ ${duplicate.second}\nTitle: ${first.fields.get("title")?.value}\nAuthors: ${first.fields.get("author")?.value} / ${second.fields.get("author")?.value}\nDate/year: ${first.fields.get("date")?.value ?? first.fields.get("year")?.value} / ${second.fields.get("date")?.value ?? second.fields.get("year")?.value}`;
  }).join("\n\n");
  return { text, config: parseProjectConfig({ ...plan.config, importedItemKeys: [...plan.trackedItemKeys], citationKeys: mapping }),
    removedCitationKeys: removed, duplicateDetails };
}
