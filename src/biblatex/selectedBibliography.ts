import { CONFIG_FILE, writeProjectChanges } from "../config/project";
import type { ProjectConfig } from "../shared/types";
import type { ZoteroClient, ZoteroClientOptions } from "../zotero/client";
import { BetterBibtexClient } from "../zotero/betterBibtex";
import { inspectBibliography } from "../zotero/bibliographySelection";
import { isImportableItem } from "./selection";
import { isTrashedData, validateKey } from "../zotero/validation";
import { resolveBibliographyPresence } from "./presence";
import { planBibliographyUpdate, completeBibliographyUpdate } from "./update";
import { bibliographyReferenceKeys } from "./migration";

/** Add an explicit selection to an existing bibliography; no TeX document required. */
export async function addSelectedBibliography(root: string, config: ProjectConfig, snapshot: string, client: ZoteroClient,
  options: ZoteroClientOptions, itemKeys: readonly string[], backend: "native" | "better-biblatex", requested: string | undefined,
  dryRun: boolean, checkProject: () => Promise<void>) {
  if (!config.library) throw new Error("Select a Zotero library first.");
  if (!itemKeys.length || itemKeys.length > 100 || new Set(itemKeys).size !== itemKeys.length) throw new Error("Supply 1 to 100 unique Zotero item keys.");
  itemKeys.forEach(validateKey);
  const inspected = await inspectBibliography(root, config, requested);
  const base = { bibFile: inspected.bibFile, candidates: inspected.candidates, importedItemKeys: [] as string[],
    citationKeys: {} as Record<string, string>, changedFiles: [] as string[], backup: null as string | null, projectFilesChanged: false };
  if (!inspected.bibFile || inspected.text === undefined) {
    await checkProject();
    return { ...base, status: inspected.status };
  }
  const library = config.library;
  const next = { ...config, bibFile: inspected.bibFile };
  const items = (await client.listItems(library, config.collectionKey || undefined)).filter(isImportableItem);
  const chosen = itemKeys.map((key) => {
    const item = items.find((item) => item.key === key);
    if (!item) throw new Error(`Source ${key} is outside the selected Zotero scope.`);
    return item;
  });
  const bbt = new BetterBibtexClient({ ...options, ...(config.serverId ? { serverId: config.serverId } : {}) });
  const presence = await resolveBibliographyPresence(next, items, inspected.text, { lookup: (keys) => bbt.citationKeys(library, keys, true) });
  const desired = [...new Set([...presence.itemKeys, ...itemKeys])];
  // An empty selection tells the shared planner to preserve every existing entry, including chosen sources.
  const plan = planBibliographyUpdate({ config: next, items, bibliography: inspected.text, presence, selection: [] }, desired);
  const versions = new Map<string, number>();
  const verify = async (key: string) => {
    const detail = await client.getItem(library, key);
    if (isTrashedData(detail.data) || detail.data.parentItem || !isImportableItem(detail.item)
      || (config.collectionKey && !(Array.isArray(detail.data.collections) && detail.data.collections.includes(config.collectionKey)))) {
      throw new Error("A selected source left the Zotero scope before bibliography import.");
    }
    return detail;
  };
  for (const item of chosen) {
    const detail = await verify(item.key);
    if (detail.item.citationKey !== item.citationKey) throw new Error("A source citation key changed before export. Retry.");
    versions.set(item.key, detail.version);
  }
  const raw = new Map(plan.preservedExports);
  if (backend === "better-biblatex" && plan.pendingItemKeys.length) {
    const exports = await bbt.exportItems(library, plan.pendingItemKeys);
    plan.pendingItemKeys.forEach((key) => raw.set(key, exports[key]!));
  } else for (const key of plan.pendingItemKeys) raw.set(key, await client.exportItem(library, key));
  for (const key of plan.pendingItemKeys) {
    const refs = bibliographyReferenceKeys(raw.get(key)!);
    if (refs === undefined || refs.length) throw new Error("Resolve exported bibliography dependencies through the manual import workflow first.");
  }
  const result = completeBibliographyUpdate(plan, raw);
  if (result.duplicateDetails) throw new Error(`Review possible bibliography duplicates before import: ${result.duplicateDetails}`);
  await checkProject();
  client.clearCache(); await client.checkConnection();
  for (const key of itemKeys) if ((await verify(key)).version !== versions.get(key)) throw new Error("A selected source changed during export. Retry.");
  const latest = await inspectBibliography(root, config, requested);
  if (JSON.stringify(latest) !== JSON.stringify(inspected)) throw new Error("Project bibliography selection or contents changed during export. Retry.");
  await checkProject();
  const configText = JSON.stringify(result.config, null, 2) + "\n";
  const changes = [
    ...(result.text !== inspected.text ? [{ path: inspected.bibFile, previous: inspected.text, text: result.text }] : []),
    ...(configText !== snapshot ? [{ path: CONFIG_FILE, previous: snapshot, text: configText }] : []),
  ];
  const output = { ...base, importedItemKeys: [...plan.pendingItemKeys],
    citationKeys: Object.fromEntries(itemKeys.map((key) => [key, result.config.citationKeys![key]!])), changedFiles: changes.map((change) => change.path) };
  if (dryRun || !changes.length) return { ...output, status: dryRun ? "preview" as const : "unchanged" as const };
  const backup = await writeProjectChanges(root, changes, "bibliography");
  return { ...output, status: "imported" as const, backup: backup ?? null, projectFilesChanged: true };
}
