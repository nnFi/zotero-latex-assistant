import { parseBibliography, type BibEntry } from "./importer";

interface Piece { readonly literal?: string; readonly macro?: string }
export interface BibField {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly value: string | undefined;
  readonly literal?: { readonly start: number; readonly end: number; readonly quoted: boolean };
}
export interface BibRecord extends BibEntry {
  readonly type: string;
  readonly fields: ReadonlyMap<string, BibField>;
}

/** Mask comments between value pieces while preserving literal field contents and offsets. */
export function bibExpressionCode(text: string): string {
  const characters = text.split("");
  let braces = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"' && braces === 0) { quoted = !quoted; continue; }
    if (text[i] === "{") braces++;
    if (text[i] === "}") braces--;
    if (text[i] !== "%" || quoted || braces !== 0) continue;
    for (; i < text.length && text[i] !== "\n" && text[i] !== "\r"; i++) characters[i] = " ";
  }
  return characters.join("");
}

function skip(text: string, position: number, end: number): number {
  while (position < end) {
    if (/\s/.test(text[position]!)) { position++; continue; }
    if (text[position] === "%") { while (position < end && text[position] !== "\n") position++; continue; }
    break;
  }
  return position;
}

function value(text: string, position: number, end: number): { pieces: Piece[]; start: number; end: number } {
  position = skip(text, position, end);
  const start = position;
  const pieces: Piece[] = [];
  for (;;) {
    position = skip(text, position, end);
    const open = text[position];
    if (open === "{" || open === '"') {
      const contentStart = ++position;
      let depth = open === "{" ? 1 : 0;
      let closed = false;
      for (; position < end; position++) {
        const character = text[position];
        if (character === "\\") { position++; continue; }
        if (character === "{") depth++;
        if (character === "}") {
          depth--;
          if (open === "{" && depth === 0) { closed = true; break; }
        }
        if (open === '"' && character === '"' && depth === 0) { closed = true; break; }
      }
      if (!closed) throw new Error("Incomplete bibliography field value.");
      pieces.push({ literal: text.slice(contentStart, position) });
      position++;
    } else {
      const token = /^[^\s,{}()#%"]+/.exec(text.slice(position, end))?.[0];
      if (!token) throw new Error("Invalid bibliography field value.");
      pieces.push(/^\d+$/.test(token) ? { literal: token } : { macro: token.toLowerCase() });
      position += token.length;
    }
    const next = skip(text, position, end);
    if (text[next] !== "#") return { pieces, start, end: position };
    position = next + 1;
  }
}

/** Read literal fields and resolvable @string expressions without rewriting TeX content. */
export function bibliographyRecords(text: string): BibRecord[] {
  const structure = parseBibliography(text);
  const macros = new Map<string, Piece[]>();
  for (const special of structure.specials) {
    if (special.type !== "string") continue;
    const head = /^@string\s*[({]/i.exec(text.slice(special.start, special.end));
    const start = head ? skip(text, special.start + head[0].length, special.end - 1) : special.end;
    const name = /^[a-z0-9_:-]+/i.exec(text.slice(start, special.end))?.[0];
    const equal = name ? skip(text, start + name.length, special.end - 1) : special.end;
    if (!name || text[equal] !== "=") throw new Error("Invalid bibliography string declaration.");
    const parsed = value(text, equal + 1, special.end - 1);
    macros.set(name.toLowerCase(), parsed.pieces);
  }
  const resolve = (pieces: readonly Piece[], seen = new Set<string>()): string | undefined => {
    let result = "";
    for (const piece of pieces) {
      if (piece.literal !== undefined) { result += piece.literal; continue; }
      const name = piece.macro!;
      if (seen.has(name) || !macros.has(name)) return undefined;
      const part = resolve(macros.get(name)!, new Set([...seen, name]));
      if (part === undefined) return undefined;
      result += part;
    }
    return result;
  };
  return structure.entries.map((entry) => {
    const type = /^@([a-z]+)/i.exec(text.slice(entry.entryStart))![1]!.toLowerCase();
    const fields = new Map<string, BibField>();
    const end = entry.entryEnd - 1;
    let position = skip(text, entry.keyEnd, end);
    if (text[position] !== ",") throw new Error("Invalid bibliography entry header.");
    position++;
    while ((position = skip(text, position, end)) < end) {
      const field = /^[a-z0-9_:-]+/i.exec(text.slice(position, end))?.[0];
      const equal = field ? skip(text, position + field.length, end) : end;
      if (!field || text[equal] !== "=") throw new Error(`Invalid bibliography field in “${entry.key}”.`);
      const name = field.toLowerCase();
      if (fields.has(name)) throw new Error(`Duplicate bibliography field “${name}” in “${entry.key}”.`);
      const parsed = value(text, equal + 1, end);
      const literal = parsed.pieces.length === 1 && parsed.pieces[0]?.literal !== undefined && ["{", '"'].includes(text[parsed.start]!)
        ? { start: parsed.start + 1, end: parsed.end - 1, quoted: text[parsed.start] === '"' } : undefined;
      fields.set(name, { name, start: parsed.start, end: parsed.end, value: resolve(parsed.pieces), ...(literal ? { literal } : {}) });
      position = skip(text, parsed.end, end);
      if (position < end && text[position] !== ",") throw new Error(`Missing field separator in “${entry.key}”.`);
      if (text[position] === ",") position++;
    }
    return { ...entry, type, fields };
  });
}
