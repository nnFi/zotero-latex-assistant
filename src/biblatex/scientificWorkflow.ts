import { readdir } from "node:fs/promises";
import { CONFIG_FILE, projectPath, readProjectText, writeProjectChanges } from "../config/project";
import type { ProjectConfig } from "../shared/types";
import type { ZoteroClient, ZoteroClientOptions } from "../zotero/client";
import { BetterBibtexClient } from "../zotero/betterBibtex";
import { isImportableItem } from "./selection";
import { projectCitationKey, legacyCitationKey } from "./keys";
import { referencedCitationKeys } from "./deletion";
import { bibEntries } from "./importer";
import { resolveBibliographyPresence } from "./presence";
import { planBibliographyUpdate, completeBibliographyUpdate } from "./update";
import { bibliographyReferenceKeys } from "./migration";
import { isTrashedData } from "../zotero/validation";

export async function projectTexSources(root: string, includeBibliographies = false): Promise<{ path: string; text: string }[]> {
  const sources: { path: string; text: string }[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(relative ? await projectPath(root, relative) : root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && ![".git", ".zotero", ".codex", ".claude", "node_modules", "dist", "build", "out"].includes(entry.name)) await walk(file);
      if (entry.isFile() && (/\.(tex|ltx|sty|cls)$/.test(entry.name) || (includeBibliographies && entry.name.endsWith(".bib")))) {
        const text = await readProjectText(root, file);
        if (text !== undefined) sources.push({ path: file, text });
      }
    }
  };
  await walk("");
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

/** Import only missing explicit citations. Existing manually selected bibliography entries are preserved. */
export async function syncCitedBibliography(root: string, config: ProjectConfig, snapshot: string, client: ZoteroClient,
  options: ZoteroClientOptions, backend: "native" | "better-biblatex", dryRun: boolean, checkProject: () => Promise<void>) {
  if (!config.library || !config.bibFile) throw new Error("Set the project library and .bib file first.");
  const library = config.library;
  const sources = await projectTexSources(root);
  const citedKeys = referencedCitationKeys(sources);
  const previous = await readProjectText(root, config.bibFile);
  const bibliography = previous ?? "";
  const existing = new Set(bibEntries(bibliography).map((entry) => entry.key));
  const missing = citedKeys.filter((key) => !existing.has(key));
  const items = (await client.listItems(library, config.collectionKey || undefined)).filter(isImportableItem);
  const bbt = new BetterBibtexClient({ ...options, ...(config.serverId ? { serverId: config.serverId } : {}) });
  const preferred = missing.length ? await bbt.citationKeys(library, items.map((item) => item.key), true) : undefined;
  const presence = await resolveBibliographyPresence(config, items, bibliography, { lookup: async () => preferred });
  const chosen = missing.map((name) => {
    const matches = items.filter((item) => {
      const effective = config.citationKeys?.[item.key] ?? (config.importedItemKeys.includes(item.key)
        ? projectCitationKey(config, item.key) : item.citationKey ?? preferred?.[item.key] ?? legacyCitationKey(library, item.key));
      return effective === name;
    });
    if (matches.length !== 1) throw new Error(`Citation key ${name} has ${matches.length} matching sources in project scope. Resolve it before bibliography import.`);
    return { ...matches[0]!, citationKey: name };
  });
  const base = { citedKeys, importedItemKeys: chosen.map((item) => item.key), bibFile: config.bibFile, scannedFiles: sources.map((source) => source.path) };
  if (dryRun || !chosen.length) { await checkProject(); return { ...base, status: dryRun ? "preview" : "unchanged", projectFilesChanged: false, backup: null }; }
  const desired = [...new Set([...presence.itemKeys, ...chosen.map((item) => item.key)])];
  const versions = new Map<string, number>();
  for (const source of chosen) {
    const detail = await client.getItem(library, source.key);
    if (isTrashedData(detail.data) || detail.data.parentItem || !isImportableItem(detail.item)
      || (config.collectionKey && !(Array.isArray(detail.data.collections) && detail.data.collections.includes(config.collectionKey)))) {
      throw new Error("A cited source left the project collection before export.");
    }
    const effective = config.citationKeys?.[source.key] ?? (config.importedItemKeys.includes(source.key)
      ? projectCitationKey(config, source.key) : detail.item.citationKey ?? preferred?.[source.key] ?? legacyCitationKey(library, source.key));
    if (effective !== source.citationKey) throw new Error("A source citation key changed before export. Retry.");
    versions.set(source.key, detail.version);
  }
  const plan = planBibliographyUpdate({ config, items: [...chosen, ...items.filter((item) => !chosen.some((source) => source.key === item.key))],
    bibliography, presence, selection: [] }, desired);
  const raw = new Map(plan.preservedExports);
  if (backend === "better-biblatex") {
    const exports = await bbt.exportItems(library, plan.pendingItemKeys);
    plan.pendingItemKeys.forEach((key) => raw.set(key, exports[key]!));
  } else for (const key of plan.pendingItemKeys) raw.set(key, await client.exportItem(library, key));
  // Do not silently import uncited dependent entries or leave an unresolved provider crossref.
  for (const key of plan.pendingItemKeys) {
    const refs = bibliographyReferenceKeys(raw.get(key)!);
    if (refs === undefined || refs.length) throw new Error("Resolve exported bibliography dependencies through the manual import workflow first.");
  }
  const result = completeBibliographyUpdate(plan, raw);
  if (result.duplicateDetails) throw new Error(`Review possible bibliography duplicates before automatic import: ${result.duplicateDetails}`);
  for (const source of chosen) if (result.config.citationKeys?.[source.key] !== source.citationKey) throw new Error("Citation-key collision. No project files were changed.");
  await checkProject();
  client.clearCache();
  for (const source of chosen) {
    const detail = await client.getItem(library, source.key);
    if (isTrashedData(detail.data) || (config.collectionKey && !(Array.isArray(detail.data.collections) && detail.data.collections.includes(config.collectionKey)))) {
      throw new Error("A cited source left the project collection before import.");
    }
    if (detail.version !== versions.get(source.key) || !isImportableItem(detail.item) || detail.data.parentItem) {
      throw new Error("A cited source changed during export. Retry.");
    }
  }
  if (JSON.stringify(await projectTexSources(root)) !== JSON.stringify(sources)) throw new Error("LaTeX files changed during bibliography preparation. Retry.");
  await checkProject();
  const backup = await writeProjectChanges(root, [
    { path: config.bibFile, previous, text: result.text },
    { path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(result.config, null, 2) + "\n" },
  ], "bibliography");
  return { ...base, status: "imported", projectFilesChanged: true, backup: backup ?? null };
}
