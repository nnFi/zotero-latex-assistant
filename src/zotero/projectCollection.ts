import { CONFIG_FILE, newProjectConfig, readProjectConfig, readProjectText, withProjectLibrary, writeProjectChanges } from "../config/project";
import type { LibraryRef } from "../shared/types";
import { ZoteroClient, type ZoteroClientOptions } from "./client";
import { BetterBibtexClient } from "./betterBibtex";
import { planCollectionChange } from "../biblatex/collectionChange";
import { resolveBibliographyPresence } from "../biblatex/presence";
import { isImportableItem } from "../biblatex/selection";
import { projectTexSources } from "../biblatex/scientificWorkflow";
import { isTrashedData, libraryPrefix, validateKey } from "./validation";

/** Same binding and cleanup rules as the extension's Set library command. */
export async function setProjectCollection(root: string, options: ZoteroClientOptions, library: LibraryRef, collectionKey: string | null, dryRun: boolean) {
  libraryPrefix(library);
  if (collectionKey !== null) validateKey(collectionKey);
  const snapshot = await readProjectText(root, CONFIG_FILE);
  const base = await readProjectConfig(root) ?? newProjectConfig();
  const client = new ZoteroClient(options);
  client.clearCache();
  const connection = await client.checkConnection();
  const bound = new ZoteroClient({ ...options, ...(connection.serverId ? { serverId: connection.serverId } : {}) });
  const target = collectionKey ? await bound.getCollectionDetail(library, collectionKey) : null;
  if (target && isTrashedData(target.data)) throw new Error("A trashed collection cannot be assigned to the project.");
  let next = withProjectLibrary(base, library, collectionKey ?? "", connection.serverId);
  const sameDatabase = base.library?.type === library.type && base.library.id === library.id && base.serverId === connection.serverId;
  const same = sameDatabase && base.collectionKey === next.collectionKey;
  const changedCollection = sameDatabase && base.collectionKey !== next.collectionKey;
  const readSources = async () => {
    const sources = await projectTexSources(root, true);
    if (base.bibFile && !sources.some((source) => source.path === base.bibFile)) {
      const text = await readProjectText(root, base.bibFile);
      if (text !== undefined) sources.push({ path: base.bibFile, text });
    }
    return sources.sort((a, b) => a.path.localeCompare(b.path));
  };
  const sources = changedCollection ? await readSources() : [];
  const items = (await bound.listItems(library, collectionKey ?? undefined)).filter(isImportableItem);
  const changes: { path: string; previous: string | undefined; text: string }[] = [];
  let removedCitationKeys: string[] = [];
  let removedBibliographyCount = 0;
  if (changedCollection) {
    const bibliography = sources.filter((source) => source.path.endsWith(".bib"));
    const presence = await resolveBibliographyPresence(base, items, bibliography.find((source) => source.path === base.bibFile)?.text ?? "", {
      lookup: (keys) => new BetterBibtexClient({ ...options, ...(connection.serverId ? { serverId: connection.serverId } : {}) }).citationKeys(library, keys, true),
    });
    const plan = planCollectionChange(base, next, items, presence, bibliography, sources.filter((source) => !source.path.endsWith(".bib")));
    next = plan.config; changes.push(...plan.changes);
    removedCitationKeys = [...plan.removedCitationKeys]; removedBibliographyCount = plan.bibliographyCount;
  }
  if (!same) changes.push({ path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(next, null, 2) + "\n" });
  const result = { library, collectionKey: next.collectionKey, serverId: next.serverId ?? null, retainedItemKeys: [...next.importedItemKeys],
    removedCitationKeys, removedBibliographyCount, changedFiles: changes.map((change) => change.path), writeReady: Boolean(next.collectionKey && next.serverId) };
  if (await readProjectText(root, CONFIG_FILE) !== snapshot) throw new Error("The project configuration changed during the collection switch. Retry.");
  if (dryRun || same) return { ...result, status: dryRun ? "preview" as const : "unchanged" as const, backup: null, projectFilesChanged: false };
  bound.clearCache();
  await bound.checkConnection();
  if (target) {
    const latest = await bound.getCollectionDetail(library, target.collection.key);
    if (latest.version !== target.version || isTrashedData(latest.data)) throw new Error("The selected collection changed during preparation. Retry.");
  }
  const latestKeys = (await bound.listItems(library, collectionKey ?? undefined)).filter(isImportableItem).map((item) => item.key).sort();
  if (JSON.stringify(latestKeys) !== JSON.stringify(items.map((item) => item.key).sort())) throw new Error("Collection membership changed during the switch. Retry.");
  if (changedCollection && JSON.stringify(await readSources()) !== JSON.stringify(sources)) throw new Error("Project files changed during the collection switch. Retry.");
  if (await readProjectText(root, CONFIG_FILE) !== snapshot) throw new Error("The project configuration changed during the collection switch. Retry.");
  const backup = await writeProjectChanges(root, changes, "bibliography");
  return { ...result, status: "assigned" as const, backup: backup ?? null, projectFilesChanged: true };
}
