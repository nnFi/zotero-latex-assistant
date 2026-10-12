import type { ProjectConfig } from "../shared/types";
import { parseProjectConfig, type ProjectFileChange } from "../config/project";
import { bibEntries, managedBibliographyKeys, refreshBibliographyChecksum, synchronizeBibliography } from "./importer";
import { bibliographyRecords } from "./fields";
import { projectCitationKey } from "./keys";
import { citationCommands, type MigrationSource } from "./migration";
import { texArgument, texCode, texCommandMatches, type TexArgument } from "./texSyntax";

interface Edit { start: number; end: number; text: string }
export interface CitationDeletionPlan {
  readonly config: ProjectConfig;
  readonly changes: readonly ProjectFileChange[];
  readonly citationCount: number;
  readonly bibliographyCount: number;
}
const quotes = new Map([
  ["textcquote", "textquote"], ["blockcquote", "blockquote"],
  ["foreigntextcquote", "foreigntextquote"], ["foreignblockcquote", "foreignblockquote"],
  ["hyphentextcquote", "hyphentextquote"], ["hyphenblockcquote", "hyphenblockquote"], ["hybridblockcquote", "hybridblockquote"],
]);
const environments = new Map([
  ["displaycquote", "displayquote"], ["foreigndisplaycquote", "foreigndisplayquote"], ["hyphendisplaycquote", "hyphendisplayquote"],
]);
function apply(text: string, edits: readonly Edit[]): string {
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
function skipOptions(code: string, position: number, multiple: boolean): number {
  for (;;) {
    const optional = texArgument(code, position, "[", "]") ?? (multiple ? texArgument(code, position, "(", ")") : undefined);
    if (!optional) return position;
    position = optional.end;
  }
}

/** Remove whole invocations or selected literal keys, preserving notes on retained citations and quote bodies. */
export function deleteTexCitations(text: string, declared: ReadonlyMap<string, boolean> = new Map(),
  removedKeys?: ReadonlySet<string>, onKeys?: (keys: readonly string[], command: string) => void): { text: string; count: number } {
  if (removedKeys && !removedKeys.size) return { text, count: 0 };
  const code = texCode(text);
  const edits: Edit[] = [];
  let count = 0;
  let consumed = 0;
  const openEnvironments: { name: string; converted: boolean }[] = [];
  for (const command of code.matchAll(/\\([a-zA-Z]+)\*?/g)) {
    const start = command.index!;
    if (start < consumed) continue;
    let slashes = 0;
    for (let i = start - 1; i >= 0 && code[i] === "\\"; i--) slashes++;
    if (slashes % 2) continue;
    const name = command[1]!;
    let position = start + command[0].length;
    let quote = quotes.get(name);
    let environment = false;
    if (name === "begin" || name === "end") {
      const arg = texArgument(code, position, "{", "}");
      quote = arg && environments.get(arg.content);
      if (!quote || !arg) continue;
      if (name === "end") {
        const open = openEnvironments.pop();
        if (open?.name !== arg.content) throw new Error("Unbalanced citation quote environment. Fix it before deleting citations.");
        if (open.converted) edits.push({ start: arg.start, end: arg.end, text: `{${quote}}` });
        continue;
      }
      environment = true;
      openEnvironments.push({ name: arg.content, converted: false });
      position = arg.end;
    } else if (!citationCommands.has(name) && !declared.has(name) && !quote && !["citetalias", "citepalias"].includes(name)) continue;
    let language = "";
    if (name.startsWith("foreign") || name.startsWith("hyphen") || name.startsWith("hybrid")
      || (environment && quote !== "displayquote") || name === "defbibentryset") {
      const arg = texArgument(code, position, "{", "}");
      if (!arg) continue;
      language = text.slice(arg.start, arg.end);
      position = arg.end;
    }
    const multiple = !quote && (declared.get(name) ?? (name.toLowerCase().endsWith("cites") || name === "footcitetexts"));
    if (multiple) {
      let common;
      while ((common = texArgument(code, position, "(", ")"))) position = common.end;
    }
    let end = position;
    const groups: { start: number; end: number; keys: TexArgument; kept?: readonly string[]; removed: number }[] = [];
    for (;;) {
      const groupStart = end;
      position = skipOptions(code, end, false);
      if (name.toLowerCase().includes("volcite")) {
        const volume = texArgument(code, position, "{", "}");
        if (!volume) break;
        position = skipOptions(code, volume.end, false);
      }
      const keys = texArgument(code, position, "{", "}");
      if (!keys) break;
      if (removedKeys && /[\\{}#]/.test(keys.content)) {
        throw new Error("Dynamic LaTeX citation keys cannot be matched to unchecked sources safely. Replace key macros with literal citation keys before updating the bibliography.");
      }
      const tokens = keys.content.match(/[^,\s]+/gu) ?? [];
      onKeys?.(tokens, name);
      const kept = removedKeys ? tokens.filter((key) => !removedKeys.has(key)) : undefined;
      groups.push({ start: groupStart, end: keys.end, keys, ...(kept ? { kept } : {}), removed: kept ? tokens.length - kept.length : 1 });
      end = keys.end;
      if (!multiple) break;
    }
    if (!groups.length) {
      if (environment) throw new Error("Incomplete citation quote environment. Fix it before deleting citations.");
      continue;
    }
    const affected = groups.filter((group) => group.removed);
    if (!affected.length) continue;
    const retained = groups.filter((group) => group.kept?.length);
    if (retained.length) {
      for (const group of affected) {
        if (!group.kept?.length) edits.push({ start: group.start, end: group.end, text: "" });
        else {
          // Keep comments inside the key argument; only the actual literal key list changes.
          const raw = text.slice(group.keys.start + 1, group.keys.end - 1);
          const hidden = code.slice(group.keys.start + 1, group.keys.end - 1);
          let comments = "";
          for (let i = 0; i < raw.length; i++) {
            if (raw[i] === "%" && hidden[i] === " ") {
              const newline = raw.indexOf("\n", i);
              const stop = newline < 0 ? raw.length : newline + 1;
              comments += raw.slice(i, stop);
              i = stop - 1;
            }
          }
          edits.push({ start: group.keys.start + 1, end: group.keys.end - 1,
            text: group.kept.join(",") + (comments ? ` ${comments}` : "") });
        }
      }
      count += affected.reduce((sum, group) => sum + group.removed, 0);
      consumed = end;
      continue;
    }
    if (quote) {
      const punctuation = texArgument(code, end, "[", "]");
      if (!environment && !texArgument(code, punctuation?.end ?? end, "{", "}")) {
        throw new Error(`Incomplete \\${name} quote. Fix it before deleting citations.`);
      }
      const star = command[0].endsWith("*") ? "*" : "";
      // Quote equivalents accept [citation][punctuation]; an empty first option removes only the citation.
      if (environment) openEnvironments.at(-1)!.converted = true;
      edits.push({ start, end, text: environment ? `\\begin{${quote}}${language}[]` : `\\${quote}${star}${language}[]` });
    } else {
      if (["citefield", "citename", "citelist", "entrydata", "defcitealias"].includes(name)) {
        const extra = texArgument(code, end, "{", "}");
        if (!extra) throw new Error(`Incomplete \\${name} command. Fix it before deleting citations.`);
        end = extra.end;
      }
      edits.push({ start, end, text: "" });
    }
    count += affected.reduce((sum, group) => sum + group.removed, 0);
    consumed = end;
  }
  if (openEnvironments.length) throw new Error("Unclosed citation quote environment. Fix it before deleting citations.");
  return { text: apply(text, edits), count };
}

/** Share the parser used for citation removal; definitions alone do not cite a source. */
export function referencedCitationKeys(sources: readonly MigrationSource[]): readonly string[] {
  const declared = new Map<string, boolean>();
  for (const source of sources) for (const definition of texCommandMatches(texCode(source.text), /\\Declare(Multi)?CiteCommand\*?\s*\{\s*\\([a-zA-Z]+)\s*\}/g)) {
    declared.set(definition[2]!, !!definition[1]);
  }
  const keys = new Set<string>();
  for (const source of sources) {
    const code = texCode(source.text);
    // A literal citation inside a macro definition is not evidence that the macro is invoked.
    for (const definition of texCommandMatches(code, /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|def|gdef|edef|xdef)\*?/g)) {
      let position = definition.index! + definition[0].length;
      const name = texArgument(code, position, "{", "}");
      if (name) position = name.end;
      else {
        const token = /^\s*\\[a-zA-Z]+(?:#[1-9])*/.exec(code.slice(position));
        if (!token) continue;
        position += token[0].length;
      }
      let option;
      while ((option = texArgument(code, position, "[", "]"))) position = option.end;
      const body = texArgument(code, position, "{", "}");
      if (!body) continue;
      if (texCommandMatches(body.content, /\\([a-zA-Z]+)\*?/g).some((command) => citationCommands.has(command[1]!) || declared.has(command[1]!))) {
        throw new Error("Citations in custom macro definitions cannot establish actual use. Resolve the wrapper to explicit citation commands before automatic import.");
      }
    }
    deleteTexCitations(source.text, declared, new Set([""]), (tokens, command) => {
    if (["defcitealias", "defbibentryset"].includes(command)) return;
    if (tokens.includes("*")) throw new Error("Automatic bibliography import requires explicit citation keys; resolve nocite{*} first.");
    tokens.forEach((key) => keys.add(key));
    });
  }
  return [...keys];
}

/** Retained sources must no longer reference entries explicitly removed from the bibliography. */
export function removeBibliographyReferences(text: string, removed: ReadonlySet<string>, file = "Bibliography"): string {
  if (!removed.size) return text;
  const edits: Edit[] = [];
  for (const entry of bibliographyRecords(text)) for (const field of entry.fields.values()) {
    if (!["crossref", "xref", "related", "entryset", "xdata"].includes(field.name)) continue;
    if (field.value === undefined) throw new Error(`${file}: cannot resolve ${field.name} in “${entry.key}”. Resolve its reference expression before removing sources.`);
    const keys = field.value.split(",").map((key) => key.trim()).filter(Boolean);
    const remaining = keys.filter((key) => !removed.has(key));
    if (remaining.length !== keys.length) edits.push({ start: field.start, end: field.end, text: `{${remaining.join(",")}}` });
  }
  return edits.length ? refreshBibliographyChecksum(apply(text, edits)) : text;
}

export function planTexCitationRemoval(sources: readonly MigrationSource[], removed: ReadonlySet<string>): readonly ProjectFileChange[] {
  if (!removed.size) return [];
  const declared = new Map<string, boolean>();
  for (const source of sources) for (const definition of texCode(source.text).matchAll(/\\Declare(Multi)?CiteCommand\*?\s*\{\s*\\([a-zA-Z]+)\s*\}/g)) {
    declared.set(definition[2]!, !!definition[1]);
  }
  return sources.flatMap((source) => {
    const result = deleteTexCitations(source.text, declared, removed);
    return result.text === source.text ? [] : [{ path: source.path, previous: source.text, text: result.text }];
  });
}

/** Reset the library only together with the actual document and bibliography changes. */
export function planCitationDeletion(config: ProjectConfig, bibliography: readonly MigrationSource[], tex: readonly MigrationSource[]): CitationDeletionPlan {
  const active = bibliography.find((source) => source.path === config.bibFile);
  const removed = new Set(config.library ? config.importedItemKeys.map((key) => projectCitationKey(config, key)) : []);
  if (active) managedBibliographyKeys(active.text).forEach((key) => removed.add(key));
  const changes: ProjectFileChange[] = [];
  const declared = new Map<string, boolean>();
  for (const source of tex) for (const definition of texCode(source.text).matchAll(/\\Declare(Multi)?CiteCommand\*?\s*\{\s*\\([a-zA-Z]+)\s*\}/g)) {
    declared.set(definition[2]!, !!definition[1]);
  }
  let citationCount = 0;
  for (const source of tex) {
    const result = deleteTexCitations(source.text, declared);
    citationCount += result.count;
    if (result.text !== source.text) changes.push({ path: source.path, previous: source.text, text: result.text });
  }
  let bibliographyCount = 0;
  for (const source of bibliography) {
    let text = source.text;
    if (source.path === config.bibFile) {
      bibliographyCount = bibEntries(text).filter((entry) => removed.has(entry.key)).length;
      if (bibliographyCount) text = synchronizeBibliography(text, [], removed);
    }
    text = removeBibliographyReferences(text, removed, source.path);
    if (text !== source.text) changes.push({ path: source.path, previous: source.text, text });
  }
  const { serverId: _server, ...base } = config;
  const next = parseProjectConfig({ ...base, library: null, collectionKey: "", importedItemKeys: [], citationKeys: {} });
  return { config: next, changes, citationCount, bibliographyCount };
}

export function citationDeletionPreview(plan: CitationDeletionPlan): string {
  let text = `# Delete all citations – preview\n\n${plan.citationCount} citation invocation(s) and ${plan.bibliographyCount} project bibliography entry/entries will be removed.\n\nThe project library, collection, database binding and imported-key mapping will be cleared. You can then choose another library with “Set library”.\n\nQuoted text, unrelated bibliography entries, resource paths and citation styles are retained. No Zotero records are deleted. Originals will be backed up before applying these changes.\n`;
  for (const change of plan.changes) {
    const longest = Math.max(2, ...[...((change.previous ?? "") + change.text).matchAll(/`+/g)].map((match) => match[0].length));
    const fence = "`".repeat(longest + 1);
    text += `\n## ${change.path}\n\n### Before\n\n${fence}\n${change.previous ?? ""}\n${fence}\n\n### After\n\n${fence}\n${change.text}\n${fence}\n`;
  }
  return text;
}
