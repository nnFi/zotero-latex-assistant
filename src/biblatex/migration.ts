import type { ProjectConfig } from "../shared/types";
import { parseProjectConfig, type ProjectFileChange } from "../config/project";
import { bibExpressionCode, bibliographyRecords, type BibField } from "./fields";
import { refreshBibliographyChecksum } from "./importer";
import { projectCitationKey, validateCitationKey } from "./keys";
import { texArgument, texCode } from "./texSyntax";

export interface MigrationSource { readonly path: string; readonly text: string }
export interface KeyMigration { readonly itemKey: string; readonly previous: string; readonly next: string }
export interface MigrationPlan {
  readonly config: ProjectConfig;
  readonly keys: readonly KeyMigration[];
  readonly changes: readonly ProjectFileChange[];
  readonly referenceCount: number;
}
interface Edit { readonly start: number; readonly end: number; readonly text: string }
const referenceFields = new Set(["crossref", "xref", "related", "entryset", "xdata"]);
export const citationCommands = new Set([
  "cite", "autocite", "parencite", "textcite", "footcite", "smartcite", "supercite", "footcitetext",
  "citeauthor", "citetitle", "citeyear", "citeyearpar", "citedate", "citeurl", "fullcite", "footfullcite", "nocite",
  "citefield", "citename", "citelist", "entrydata", "defcitealias", "defbibentryset",
  "textcquote", "blockcquote", "foreigntextcquote", "foreignblockcquote",
  "citet", "citep", "citealt", "citealp", "Citet", "Citep", "Citealt", "Citealp", "Cite", "Autocite", "Parencite", "Textcite", "Footcite", "Smartcite",
  "Citeauthor", "Citetitle", "Citeyear", "Citeyearpar", "Citedate", "Citeurl", "Fullcite", "Footfullcite",
  "cites", "autocites", "parencites", "textcites", "footcites", "smartcites", "supercites", "footcitetexts",
  "Cites", "Autocites", "Parencites", "Textcites", "Footcites", "Smartcites", "volcite", "volcites",
  "pvolcite", "pvolcites", "fvolcite", "fvolcites", "tvolcite", "tvolcites", "avolcite", "avolcites", "svolcite", "svolcites",
]);

function apply(text: string, edits: readonly Edit[]): string {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}

function keyList(value: string, replacements: ReadonlyMap<string, string>): string {
  return value.replace(/[^,\s]+/gu, (key) => replacements.get(key) ?? key);
}

function referenceEdits(text: string, field: BibField, replacements: ReadonlyMap<string, string>): Edit[] {
  if (field.literal) {
    const edits: Edit[] = [];
    const value = text.slice(field.literal.start, field.literal.end);
    for (const token of value.matchAll(/[^,\s]+/gu)) {
      const replacement = replacements.get(token[0]);
      if (replacement) edits.push({ start: field.literal.start + token.index!, end: field.literal.start + token.index! + token[0].length, text: replacement });
    }
    return edits;
  }
  const rewritten = keyList(field.value!, replacements);
  if (rewritten === field.value) return [];
  const expression = text.slice(field.start, field.end);
  if (bibExpressionCode(expression) !== expression) throw new Error("Resolve the commented bibliography reference expression to literal keys before migrating or updating it.");
  return [{ start: field.start, end: field.end, text: `{${rewritten}}` }];
}

export function bibliographyReferenceKeys(text: string): readonly string[] | undefined {
  const keys = new Set<string>();
  for (const entry of bibliographyRecords(text)) {
    for (const field of entry.fields.values()) {
      if (referenceFields.has(field.name)) {
        if (field.value === undefined) return undefined;
        for (const key of field.value.split(",").map((value) => value.trim()).filter(Boolean)) keys.add(key);
      }
    }
  }
  return [...keys];
}

/** Keep crossrefs from freshly exported provider keys aligned with persistent project keys. */
export function rewriteBibliographyReferences(text: string, replacements: ReadonlyMap<string, string>, recordKeys?: ReadonlySet<string>): string {
  if (!replacements.size) return text;
  const edits: Edit[] = [];
  for (const entry of bibliographyRecords(text)) {
    if (recordKeys && !recordKeys.has(entry.key)) continue;
    for (const field of entry.fields.values()) {
      if (!referenceFields.has(field.name)) continue;
      if (field.value === undefined) throw new Error(`Cannot resolve bibliography reference “${field.name}” in “${entry.key}”. Resolve its string expression before updating.`);
      edits.push(...referenceEdits(text, field, replacements));
    }
  }
  return edits.length ? refreshBibliographyChecksum(apply(text, edits)) : text;
}

export function migrateTexReferences(text: string, replacements: ReadonlyMap<string, string>,
  declaredCommands: ReadonlyMap<string, boolean> = new Map()): { text: string; count: number } {
  const code = texCode(text);
  const edits: Edit[] = [];
  for (const command of code.matchAll(/\\([a-zA-Z]+)\*?/g)) {
    let slashes = 0;
    for (let i = command.index! - 1; i >= 0 && code[i] === "\\"; i--) slashes++;
    if (slashes % 2) continue;
    const name = command[1]!;
    if (!citationCommands.has(name) && !declaredCommands.has(name)) continue;
    let position = command.index! + command[0].length;
    if (name === "defbibentryset" || name.startsWith("foreign")) {
      const first = texArgument(code, position, "{", "}");
      if (!first) continue;
      position = first.end;
    }
    const multiple = declaredCommands.get(name) ?? name.endsWith("s");
    for (;;) {
      let optional;
      for (;;) {
        optional = texArgument(code, position, "[", "]") ?? (multiple ? texArgument(code, position, "(", ")") : undefined);
        if (!optional) break;
        position = optional.end;
      }
      // Volume citation commands take the volume number before their key argument.
      if (name.toLowerCase().includes("volcite")) {
        const volume = texArgument(code, position, "{", "}");
        if (!volume) break;
        position = volume.end;
        while ((optional = texArgument(code, position, "[", "]"))) position = optional.end;
      }
      const keys = texArgument(code, position, "{", "}");
      if (!keys) break;
      if (replacements.size && /[\\{}#]/.test(keys.content)) throw new Error("Dynamic LaTeX citation arguments cannot be migrated safely. Replace key macros or custom wrappers with literal citation keys before retrying.");
      for (const token of keys.content.matchAll(/[^,\s]+/gu)) {
        const replacement = replacements.get(token[0]);
        if (!replacement) continue;
        const start = keys.start + 1 + token.index!;
        edits.push({ start, end: start + token[0].length, text: replacement });
      }
      position = keys.end;
      if (!multiple) break;
    }
  }
  return { text: apply(text, edits), count: edits.length };
}

/** Plan every change before a confirmation or a write; key replacements are simultaneous. */
export function planCitationKeyMigration(config: ProjectConfig, bibliography: readonly MigrationSource[], tex: readonly MigrationSource[],
  targets: Readonly<Record<string, string>>): MigrationPlan {
  if (!config.library || !config.bibFile) throw new Error("Set the project library and .bib file before migrating citation keys.");
  const active = bibliography.find((source) => source.path === config.bibFile);
  if (!active) throw new Error("The project .bib file is missing. Update it before migrating citation keys.");
  const keys: KeyMigration[] = [];
  const mapping: Record<string, string> = Object.fromEntries(config.importedItemKeys.map((key) => [key, projectCitationKey(config, key)]));
  for (const [itemKey, target] of Object.entries(targets)) {
    if (!config.importedItemKeys.includes(itemKey)) throw new Error("Only imported project sources can be migrated.");
    const next = validateCitationKey(target);
    const previous = mapping[itemKey]!;
    if (previous !== next) keys.push({ itemKey, previous, next });
    mapping[itemKey] = next;
  }
  const nextConfig = parseProjectConfig({ ...config, citationKeys: mapping });
  const replacements = new Map(keys.map((key) => [key.previous, key.next]));
  const records = new Map(bibliography.map((source) => [source.path, bibliographyRecords(source.text)]));
  const activeKeys = new Set(records.get(active.path)!.map((record) => record.key));
  for (const key of keys) if (!activeKeys.has(key.previous)) throw new Error(`Citation key “${key.previous}” is missing from the project .bib.`);
  for (const [file, entries] of records) {
    const finalKeys = new Set<string>();
    for (const entry of entries) {
      if (file !== active.path && (replacements.has(entry.key) || keys.some((key) => key.next === entry.key))) {
        throw new Error(`Citation key “${entry.key}” is also used in ${file}. Resolve the ambiguous bibliography before migrating.`);
      }
      const name = file === active.path ? replacements.get(entry.key) ?? entry.key : entry.key;
      if (finalKeys.has(name)) throw new Error(`Citation key “${name}” already exists in ${file}.`);
      finalKeys.add(name);
      const aliasField = entry.fields.get("ids");
      if (replacements.size && aliasField && aliasField.value === undefined) throw new Error(`Cannot resolve bibliography aliases in “${entry.key}”. Resolve their string expression before migrating.`);
      const aliases = aliasField?.value?.split(",").map((value) => value.trim()) ?? [];
      if (keys.some((key) => aliases.includes(key.next))) throw new Error(`A target citation key is already used as an alias in ${file}.`);
    }
  }
  const changes: ProjectFileChange[] = [];
  let referenceCount = 0;
  const declaredCommands = new Map<string, boolean>();
  for (const source of tex) {
    for (const definition of texCode(source.text).matchAll(/\\Declare(Multi)?CiteCommand\*?\s*\{\s*\\([a-zA-Z]+)\s*\}/g)) {
      declaredCommands.set(definition[2]!, !!definition[1]);
    }
  }
  for (const source of bibliography) {
    const edits: Edit[] = [];
    for (const entry of records.get(source.path)!) {
      const renamed = source.path === active.path ? replacements.get(entry.key) : undefined;
      if (renamed) edits.push({ start: entry.keyStart, end: entry.keyEnd, text: renamed });
      for (const field of entry.fields.values()) {
        if (!referenceFields.has(field.name) || !replacements.size) continue;
        if (field.value === undefined) throw new Error(`Cannot resolve bibliography reference “${field.name}” in “${entry.key}”. Resolve its string expression before migrating.`);
        const references = referenceEdits(source.text, field, replacements);
        if (references.length) {
          edits.push(...references);
          referenceCount += (field.value.match(/[^,\s]+/gu) ?? []).filter((key) => replacements.has(key)).length;
        }
      }
    }
    if (edits.length) changes.push({ path: source.path, previous: source.text, text: refreshBibliographyChecksum(apply(source.text, edits)) });
  }
  for (const source of tex) {
    const migrated = migrateTexReferences(source.text, replacements, declaredCommands);
    referenceCount += migrated.count;
    if (migrated.text !== source.text) changes.push({ path: source.path, previous: source.text, text: migrated.text });
  }
  return { config: nextConfig, keys, changes, referenceCount };
}

export function migrationPreview(plan: MigrationPlan): string {
  let text = "# Citation key migration preview\n\nNo bibliography, configuration or LaTeX files have been changed yet.\n\n";
  text += plan.keys.map((key) => `- ${key.previous} → ${key.next}`).join("\n");
  text += `\n\n${plan.referenceCount} citation/bibliography reference(s) will be updated. The project citation-key mapping will be updated with the same changes.\nOriginal files will be backed up before applying the migration.\n`;
  for (const change of plan.changes) {
    const longest = Math.max(2, ...[...((change.previous ?? "") + change.text).matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    text += `\n## ${change.path}\n\n### Before\n\n${fence}\n${change.previous ?? ""}\n${fence}\n\n### After\n\n${fence}\n${change.text}\n${fence}\n`;
  }
  return text;
}
