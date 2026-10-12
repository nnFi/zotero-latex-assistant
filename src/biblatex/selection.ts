import type { ProjectConfig, ZoteroItem } from "../shared/types";

export function isImportableItem(item: ZoteroItem): boolean {
  return !["attachment", "note", "annotation"].includes(item.itemType);
}

/** Eine Mehrfachauswahl wird vollständig geprüft, bevor irgendeine Datei geändert wird. */
export function selectedImportKeys(config: ProjectConfig, available: readonly ZoteroItem[], selected: readonly ZoteroItem[]): string[] {
  if (!config.library) throw new Error("Set the project library first.");
  const keys = new Set(config.importedItemKeys);
  for (const item of selected) {
    if (item.library.type !== config.library.type || item.library.id !== config.library.id
      || !isImportableItem(item) || (!config.importedItemKeys.includes(item.key)
        && !available.some((source) => source.key === item.key && isImportableItem(source)))) {
      throw new Error("A selected source does not belong to the linked project library / collection.");
    }
    keys.add(item.key);
  }
  return [...keys];
}
