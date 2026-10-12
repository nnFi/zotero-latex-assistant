import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import type { CitationStyle } from "../shared/types";
import { canonicalLocale, citationLanguage, type CitationLanguage } from "../biblatex/language";

function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
    }).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

export function parseStyle(xml: string): CitationStyle | undefined {
  xml = xml.replace(/<!--[\s\S]*?-->/g, "");
  const info = xml.match(/<info(?:\s[^>]*)?>([\s\S]*?)<\/info>/)?.[1];
  const id = info?.match(/<id(?:\s[^>]*)?>([\s\S]*?)<\/id>/)?.[1];
  const title = info?.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/)?.[1];
  const root = xml.match(/<style\b([^>]*)>/)?.[1] ?? "";
  const locale = attribute(root, "default-locale");
  const parent = [...(info ?? "").matchAll(/<link\b([^>]*)\/?\s*>/g)]
    .find((match) => attribute(match[1]!, "rel") === "independent-parent");
  const parentId = parent ? attribute(parent[1]!, "href") : undefined;
  return id && title ? { id: xmlText(id), title: xmlText(title),
    ...(locale ? { locale: canonicalLocale(locale) } : {}), ...(parentId ? { parentId } : {}) } : undefined;
}

function attribute(attributes: string, name: string): string | undefined {
  const value = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`))?.[2];
  return value === undefined ? undefined : xmlText(value);
}

/** CSL locale precedence: exact dialect, base language, then unqualified locale. */
function overrideTerms(xml: string, language: CitationLanguage): CitationLanguage {
  const locales = [...xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<locale\b([^>]*)>([\s\S]*?)<\/locale>/g)];
  let result = language;
  for (const tag of [undefined, language.locale.split("-")[0], language.locale]) {
    for (const block of locales) {
      const declared = attribute(block[1]!, "xml:lang");
      if ((declared ? canonicalLocale(declared) : undefined) !== tag) continue;
      for (const term of block[2]!.matchAll(/<term\b([^>]*)>([\s\S]*?)<\/term>/g)) {
        const name = attribute(term[1]!, "name");
        if (attribute(term[1]!, "form") !== "short" || (name !== "page" && name !== "chapter")) continue;
        const body = term[2]!;
        const single = xmlText(body.match(/<single\b[^>]*>([\s\S]*?)<\/single>/)?.[1] ?? body);
        const multiple = xmlText(body.match(/<multiple\b[^>]*>([\s\S]*?)<\/multiple>/)?.[1] ?? body);
        result = name === "page" ? { ...result, page: single, pages: multiple } : { ...result, chapter: single };
      }
    }
  }
  return result;
}

/** Read visible styles and hidden parent styles locally; parents stay out of the picker. */
export async function listInstalledStyles(directory: string): Promise<readonly CitationStyle[]> {
  const all = new Map<string, { style: CitationStyle; xml: string; visible: boolean }>();
  for (const folder of [directory, path.join(directory, "hidden")]) {
    let entries;
    try { entries = await readdir(folder, { withFileTypes: true }); }
    catch (error) {
      if (folder !== directory && (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".csl")) continue;
      const xml = await readFile(path.join(folder, entry.name), "utf8");
      const style = parseStyle(xml);
      if (style && !all.has(style.id)) all.set(style.id, { style, xml, visible: folder === directory });
    }
  }
  const resolve = (id: string): CitationLanguage => {
    const chain: { style: CitationStyle; xml: string }[] = [];
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current && !seen.has(current)) {
      seen.add(current);
      const entry = all.get(current);
      if (!entry) break; // No remote parent fetches.
      chain.push(entry);
      current = entry.style.parentId;
    }
    const locale = chain.find((entry) => entry.style.locale)?.style.locale;
    // CSL rendering definitions of a dependent style come from its independent parent.
    const parent = chain.at(-1);
    const language = citationLanguage(locale ?? "en-US", !locale);
    return parent && !parent.style.parentId ? overrideTerms(parent.xml, language) : language;
  };
  return [...all.values()].filter((entry) => entry.visible).map(({ style }) => ({ ...style, language: resolve(style.id) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
