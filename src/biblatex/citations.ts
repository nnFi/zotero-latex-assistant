import type { LibraryRef, ProjectConfig, ProjectSettings, ZoteroItem } from "../shared/types";
import { citationKey } from "./exporter";
import { isImportableItem } from "./selection";
import { projectCitationKey, validateCitationKey } from "./keys";
import { citationLanguage, localizedLocator, type CitationLanguage } from "./language";

export interface CitationNotes {
  readonly prenote?: string;
  readonly postnote?: string;
  readonly language?: CitationLanguage;
  readonly styleId?: string;
}

/** Eingaben sind Text, keine ausführbaren TeX-Anweisungen oder optionalen Argumentgrenzen. */
function noteText(text: string): string {
  const replacements: Record<string, string> = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}",
    "[": "{[}", "]": "{]}", "%": "\\%", "&": "\\&", "_": "\\_", "#": "\\#", "$": "\\$",
    "^": "\\textasciicircum{}", "~": "\\textasciitilde{}" };
  return text.replace(/\s+/g, " ").trim().replace(/[\\{}\[\]%&_#$^~]/g, (character) => replacements[character]!);
}

export function citationText(command: ProjectSettings["citationCommand"], library: LibraryRef, itemKeys: readonly string[], notes: CitationNotes = {}, mapping?: Readonly<Record<string, string>>): string {
  if (!["autocite", "parencite", "textcite"].includes(command)) throw new Error("Invalid LaTeX citation command.");
  if (!itemKeys.length) throw new Error("Select a source to cite.");
  const keys = [...new Set(itemKeys)].map((key) => {
    const legacy = citationKey(library, key); // validiert Bibliothek und Zotero-Objektschlüssel
    return mapping && Object.hasOwn(mapping, key) ? validateCitationKey(mapping[key]) : legacy;
  });
  const pre = noteText(notes.prenote ?? "");
  const post = noteText(notes.language ? localizedLocator(notes.postnote ?? "", notes.language) : notes.postnote ?? "");
  const argumentsText = pre ? `[${pre}][${post}]` : post ? `[${post}]` : "";
  return `\\${command}${argumentsText}{${keys.join(",")}}`;
}

export interface CitationTarget {
  isCurrent(): boolean;
  insert(text: string): Promise<boolean>;
}

/** Erst Import / Dateiprüfung abschließen, dann an der unveränderten Cursorposition einfügen. */
export async function insertPreparedCitation(items: readonly ZoteroItem[], target: CitationTarget,
  prepare: () => Promise<ProjectConfig>, notes: CitationNotes = {}): Promise<string> {
  if (!items.length || items.some((item) => !isImportableItem(item))) throw new Error("Only bibliographic sources can be cited.");
  const changed = "The LaTeX document has changed or been closed. Set the cursor position again and retry.";
  if (!target.isCurrent()) throw new Error(changed);
  const config = await prepare();
  if (notes.styleId !== undefined && notes.styleId !== config.citationStyle) throw new Error("The citation style changed. Please cite again.");
  if (!config.library || !config.bibFile) throw new Error("Set the project library and .bib file first.");
  if (items.some((item) => item.library.type !== config.library!.type || item.library.id !== config.library!.id)) {
    throw new Error("The source does not belong to the LaTeX project library.");
  }
  const mapping = Object.fromEntries(items.map((item) => [item.key, projectCitationKey(config, item.key)]));
  const { language: _language, ...plainNotes } = notes;
  const text = citationText(config.citationCommand, config.library, items.map((item) => item.key),
    config.citationStyleType === "biblatex" ? plainNotes
      : { ...notes, language: notes.language ?? citationLanguage(config.citationLocale ?? "en-US", !config.citationLocale) }, mapping);
  if (!target.isCurrent()) throw new Error(changed);
  if (!await target.insert(text)) throw new Error("The citation could not be inserted. Check the LaTeX document.");
  return text;
}
