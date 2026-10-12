import { CONFIG_FILE, parseProjectConfig, type ProjectFileChange } from "../config/project";
import type { ProjectConfig } from "../shared/types";
import { bibEntries } from "./importer";
import { planBiblatexResources } from "./texResources";
import { planBiblatexStyle, type TexSource } from "./texStyle";

/** Shared Set .bib file plan: preserve contents and keys, update literal TeX resources. */
export function planProjectBibFile(config: ProjectConfig, snapshot: string | undefined, bibFile: string,
  oldBib: string | undefined, selectedBib: string | undefined, sources: readonly TexSource[]): readonly ProjectFileChange[] {
  if (oldBib !== undefined) bibEntries(oldBib);
  if (selectedBib !== undefined) bibEntries(selectedBib);
  const resourceChanges = planBiblatexResources(sources, config.bibFile, bibFile);
  let updated = sources.map((source) => resourceChanges.find((change) => change.path === source.path) ?? source);
  if (config.citationStyleType === "biblatex" && config.citationStyle) {
    const styleChanges = planBiblatexStyle(updated, config.citationStyle, bibFile);
    updated = updated.map((source) => styleChanges.find((change) => change.path === source.path) ?? source);
  }
  const next = parseProjectConfig({ ...config, bibFile });
  const changes: ProjectFileChange[] = updated.flatMap((source, i) => source.text === sources[i]!.text
    ? [] : [{ path: source.path, previous: sources[i]!.text, text: source.text }]);
  if (config.bibFile !== bibFile || snapshot === undefined) {
    changes.push({ path: CONFIG_FILE, previous: snapshot, text: JSON.stringify(next, null, 2) + "\n" });
  }
  // The UI also supports new paths; carry literature forward only when the target is absent.
  if (selectedBib === undefined && oldBib !== undefined) changes.unshift({ path: bibFile, previous: undefined, text: oldBib });
  return changes;
}
