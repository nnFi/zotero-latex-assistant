import { createHash } from "node:crypto";

export interface BibEntry { readonly key: string; readonly keyStart: number; readonly keyEnd: number; readonly entryStart: number; readonly entryEnd: number }
export interface BibSpecial { readonly type: string; readonly start: number; readonly end: number }

/** Liest Grenzen und Schlüssel, ohne Feldinhalte oder TeX-Makros umzuschreiben. */
export function bibEntries(text: string): BibEntry[] {
  return parseBibliography(text).entries;
}

export function parseBibliography(text: string): { entries: BibEntry[]; specials: BibSpecial[] } {
  const entries: BibEntry[] = [];
  const specials: BibSpecial[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "%") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (text[i] === "\\") { i++; continue; }
    if (text[i] !== "@") continue;
    const header = text.slice(i).match(/^@([a-z]+)\s*([({])/i);
    if (!header) throw new Error("Invalid BibLaTeX entry. The file was not changed.");
    const special = ["comment", "preamble", "string"].includes(header[1]!.toLowerCase());
    const open = header[2]!;
    const entryStart = i;
    const start = i + header[0].length;
    if (!special) {
      const keyMatch = text.slice(start).match(/^\s*([^\s,{}()]+)\s*,/);
      if (!keyMatch) throw new Error("BibLaTeX entry without a valid key.");
      const key = keyMatch[1]!;
      const keyStart = start + keyMatch[0].indexOf(key);
      entries.push({ key, keyStart, keyEnd: keyStart + key.length, entryStart, entryEnd: 0 });
    }
    const entryDepth = open === "{" ? 1 : 0;
    let braces = entryDepth;
    let quoted = false;
    let closed = false;
    for (i = start; i < text.length; i++) {
      const char = text[i];
      if (char === "\\") { i++; continue; }
      // Percent signs are literal inside field values, including URL escapes.
      if (char === "%" && !quoted && braces === entryDepth) { while (i < text.length && text[i] !== "\n") i++; continue; }
      if (char === '"' && braces === entryDepth) { quoted = !quoted; continue; }
      if (char === "{") braces++;
      if (char === "}") {
        braces--;
        if (braces < 0 || (quoted && braces < entryDepth)) throw new Error("Unbalanced braces in the BibLaTeX file.");
        if (!quoted && open === "{" && braces === 0) { closed = true; break; }
      }
      if (!quoted && open === "(" && char === ")" && braces === 0) { closed = true; break; }
    }
    if (!closed) throw new Error("Incomplete BibLaTeX entry. The file was not changed.");
    if (!special) entries[entries.length - 1] = { ...entries[entries.length - 1]!, entryEnd: i + 1 };
    else specials.push({ type: header[1]!.toLowerCase(), start: entryStart, end: i + 1 });
  }
  const keys = entries.map((entry) => entry.key);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate citation keys in the BibLaTeX file.");
  return { entries, specials };
}

export function rekeyExport(text: string, key: string): string {
  const entries = bibEntries(text);
  if (entries.length !== 1) throw new Error("Zotero did not export a single unambiguous BibLaTeX entry.");
  const entry = entries[0]!;
  return text.slice(0, entry.keyStart) + key + text.slice(entry.keyEnd);
}

const START = "% BEGIN ZOTERO LATEX ASSISTANT ";
const END = "% END ZOTERO LATEX ASSISTANT";
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

function bibliographyParts(existing: string, allowModified = false): { before: string; content: string; after: string } {
  const starts = [...existing.matchAll(/^% BEGIN ZOTERO LATEX ASSISTANT .*$/gm)];
  const ends = [...existing.matchAll(/^% END ZOTERO LATEX ASSISTANT\r?$/gm)];
  let before = existing;
  let after = "";
  let managed = "";
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || starts[0]!.index! >= ends[0]!.index!) {
      throw new Error("The managed Zotero section is damaged. The file was not changed.");
    }
    const start = starts[0]!;
    const end = ends[0]!;
    const contentStart = existing.indexOf("\n", start.index!) + 1;
    const content = existing.slice(contentStart, end.index!);
    const hash = start[0].slice(START.length).trim();
    if (!allowModified && digest(content) !== hash) throw new Error("The Zotero section was changed manually. Save these changes separately before updating; update cancelled.");
    before = existing.slice(0, start.index);
    managed = content;
    after = existing.slice(end.index! + end[0].length);
  }
  return { before, content: managed, after };
}

/** An explicitly reviewed key migration preserves content and renews the managed checksum. */
export function refreshBibliographyChecksum(text: string): string {
  bibEntries(text);
  const { content } = bibliographyParts(text, true);
  return text.replace(/^% BEGIN ZOTERO LATEX ASSISTANT [^\r\n]*/m, START + digest(content));
}

export function mergeBibliography(existing: string, exports: readonly string[]): string {
  const { before, after } = bibliographyParts(existing);
  return composeBibliography(before, after, exports);
}

function composeBibliography(before: string, after: string, exports: readonly string[]): string {
  const unmanagedKeys = new Set(bibEntries(before + after).map((entry) => entry.key));
  const content = exports.map((text) => text.trim()).join("\n\n") + "\n";
  for (const entry of bibEntries(content)) {
    if (unmanagedKeys.has(entry.key)) throw new Error(`Citation key “${entry.key}” already exists outside the Zotero section.`);
  }
  return before + (before && !before.endsWith("\n") ? "\n" : "")
    + START + digest(content) + "\n" + content + END + (after || "\n");
}

function removeEntries(text: string, keys: ReadonlySet<string>): string {
  let result = text;
  for (const entry of bibEntries(text).reverse()) {
    if (keys.has(entry.key)) result = result.slice(0, entry.entryStart) + result.slice(entry.entryEnd);
  }
  return result;
}

/** Every managed entry belongs to this project's reset, including stale mappings. */
export function managedBibliographyKeys(text: string): readonly string[] {
  return bibEntries(bibliographyParts(text, true).content).map((entry) => entry.key);
}

/** Replace only identified sources; unrelated references, macros and comments survive. */
export function synchronizeBibliography(existing: string, exports: readonly string[], replacedKeys: ReadonlySet<string>): string {
  bibEntries(existing); // Validate the complete file before accepting intentional manual removals.
  const { before, content, after } = bibliographyParts(existing, true);
  const managedRemainder = removeEntries(content, replacedKeys);
  const remainingBefore = removeEntries(before, replacedKeys) + (managedRemainder.trim() ? managedRemainder : "");
  return composeBibliography(remainingBefore, removeEntries(after, replacedKeys), exports);
}
