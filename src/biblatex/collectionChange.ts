import type { ProjectConfig, ZoteroItem } from "../shared/types";
import { parseProjectConfig, type ProjectFileChange } from "../config/project";
import type { BibliographyPresence } from "./presence";
import { bibEntries, synchronizeBibliography } from "./importer";
import { projectCitationKey } from "./keys";
import { planTexCitationRemoval, removeBibliographyReferences } from "./deletion";
import type { MigrationSource } from "./migration";

/** The selected collection owns project membership; retain existing metadata and stable keys only for its sources. */
export function planCollectionChange(previous: ProjectConfig, selected: ProjectConfig, items: readonly ZoteroItem[],
  presence: BibliographyPresence, bibliography: readonly MigrationSource[], tex: readonly MigrationSource[]) {
  if (!selected.library || items.some((item) => item.library.type !== selected.library!.type || item.library.id !== selected.library!.id)) {
    throw new Error("The selected collection returned sources from a different library.");
  }
  const members = new Set(items.map((item) => item.key));
  const retained = [...new Set([...previous.importedItemKeys, ...presence.itemKeys])].filter((key) => members.has(key));
  const mapping = Object.fromEntries(retained.map((key) => [key, previous.citationKeys?.[key]
    ?? presence.citationKeys[key] ?? projectCitationKey(previous, key)]));
  const keep = new Set(Object.values(mapping));
  const removed = new Set(previous.importedItemKeys.filter((key) => !members.has(key)).map((key) => projectCitationKey(previous, key)));
  const active = bibliography.find((source) => source.path === previous.bibFile);
  if (active) for (const entry of bibEntries(active.text)) if (!keep.has(entry.key)) removed.add(entry.key);
  // A renamed source that stays in the collection must never lose its current project key.
  keep.forEach((key) => removed.delete(key));
  const changes: ProjectFileChange[] = [];
  let bibliographyCount = 0;
  for (const source of bibliography) {
    let text = source.text;
    if (source.path === previous.bibFile) {
      bibliographyCount = bibEntries(text).filter((entry) => removed.has(entry.key)).length;
      if (bibliographyCount) text = synchronizeBibliography(text, [], removed);
    }
    text = removeBibliographyReferences(text, removed, source.path);
    if (text !== source.text) changes.push({ path: source.path, previous: source.text, text });
  }
  changes.push(...planTexCitationRemoval(tex, removed));
  return { config: parseProjectConfig({ ...selected, importedItemKeys: retained, citationKeys: mapping }), changes,
    bibliographyCount, removedCitationKeys: removed };
}
