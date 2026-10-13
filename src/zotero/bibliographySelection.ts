import { discoverBibFile, readProjectText, validateBibFile } from "../config/project";
import type { ProjectConfig } from "../shared/types";
import { projectTexSources } from "../biblatex/scientificWorkflow";

/** Inspect saved files only. No settings, bibliography or TeX writes. */
export async function inspectBibliography(root: string, config: ProjectConfig, requested?: string) {
  if (requested !== undefined) validateBibFile(requested);
  const sources = await projectTexSources(root, true);
  const candidates = sources.filter((source) => source.path.endsWith(".bib")).map((source) => source.path);
  const configured = config.bibFile && await readProjectText(root, config.bibFile) !== undefined ? config.bibFile : undefined;
  const detected = candidates.length === 1 ? candidates[0] : discoverBibFile(candidates, sources.filter((source) => !source.path.endsWith(".bib")));
  const bibFile = requested ?? configured ?? detected;
  const text = bibFile ? await readProjectText(root, bibFile) : undefined;
  return { bibFile: text === undefined ? null : bibFile!, candidates, text,
    status: text !== undefined ? "available" as const : !requested && candidates.length ? "ambiguous" as const : "not-found" as const };
}
