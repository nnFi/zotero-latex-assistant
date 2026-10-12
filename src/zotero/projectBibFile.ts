import { CONFIG_FILE, discoverBibFile, newProjectConfig, parseProjectConfig, readProjectText, validateBibFile, writeProjectChanges } from "../config/project";
import { planProjectBibFile } from "../biblatex/bibFile";
import { projectTexSources } from "../biblatex/scientificWorkflow";
import { listInstalledBiblatexStyles } from "../biblatex/styles";

/** Project-local setup without a Zotero connection. Never manufacture a bibliography. */
export async function setProjectBibFile(root: string, requested?: string, dryRun = false) {
  if (requested !== undefined) validateBibFile(requested);
  const snapshot = await readProjectText(root, CONFIG_FILE);
  const config = snapshot === undefined ? newProjectConfig() : parseProjectConfig(JSON.parse(snapshot));
  const sources = await projectTexSources(root, true);
  const candidates = sources.filter((source) => source.path.endsWith(".bib")).map((source) => source.path);
  const tex = sources.filter((source) => !source.path.endsWith(".bib"));
  const oldBib = config.bibFile ? await readProjectText(root, config.bibFile) : undefined;
  const bibFile = requested ?? (oldBib !== undefined ? config.bibFile : discoverBibFile(candidates, tex));
  const base = { project: root, bibFile: config.bibFile || null, candidates, changedFiles: [] as string[], backup: null as string | null, projectFilesChanged: false };
  if (!bibFile) return { ...base, status: candidates.length ? "ambiguous" as const : "not-found" as const };
  const selectedBib = await readProjectText(root, bibFile);
  if (selectedBib === undefined) return { ...base, status: "not-found" as const };
  const changes = planProjectBibFile(config, snapshot, bibFile, oldBib, selectedBib, tex);
  if (changes.length && config.citationStyleType === "biblatex" && config.citationStyle) {
    const styles = await listInstalledBiblatexStyles(root);
    if (!styles.some((style) => style.id === config.citationStyle)) throw new Error("The configured BibLaTeX style is not installed locally. Choose an installed style first.");
  }
  // Recheck both discovery and saved contents before changing any files.
  if (await readProjectText(root, CONFIG_FILE) !== snapshot
    || JSON.stringify(await projectTexSources(root, true)) !== JSON.stringify(sources)
    || (config.bibFile && await readProjectText(root, config.bibFile) !== oldBib)
    || await readProjectText(root, bibFile) !== selectedBib) {
    throw new Error("Project files changed during .bib selection. Retry.");
  }
  const result = { ...base, bibFile, changedFiles: changes.map((change) => change.path) };
  if (dryRun || !changes.length) return { ...result, status: dryRun ? "preview" as const : "unchanged" as const };
  const backup = await writeProjectChanges(root, changes, "bibliography");
  return { ...result, status: "selected" as const, backup: backup ?? null, projectFilesChanged: true };
}
