import { localeTerms, primaryDialects } from "../zotero/localeTerms";

export interface CitationLanguage {
  readonly locale: string;
  readonly page: string;
  readonly pages: string;
  readonly chapter: string;
  readonly fallback: boolean;
}

export function canonicalLocale(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid citation language. Use a language tag such as de-DE or en-US.");
  try {
    const locale = Intl.getCanonicalLocales(value)[0];
    if (locale) return locale;
  } catch { /* Return a helpful error instead of the platform RangeError. */ }
  throw new Error("Invalid citation language. Use a language tag such as de-DE or en-US.");
}

export function citationLanguage(locale = "en-US", fallback = false): CitationLanguage {
  const canonical = canonicalLocale(locale);
  const primary = primaryDialects[canonical.split("-")[0]!];
  const terms = localeTerms[canonical] ?? (primary ? localeTerms[primary] : undefined);
  // Unsupported custom languages retain their locale for CSL rendering and explicitly use English locator terms.
  const [page, pages, chapter] = terms ?? localeTerms["en-US"]!;
  return { locale: canonical, page, pages, chapter, fallback: fallback || !terms };
}

export function languageDescription(language: CitationLanguage): string {
  const name = new Intl.DisplayNames(["en"], { type: "language" }).of(language.locale) ?? language.locale;
  return `${name} (${language.locale})${language.fallback ? " · fallback" : ""}`;
}

/** Explicit labels stop BibLaTeX from adding a page prefix in the document's language. */
export function localizedLocator(value: string, language: CitationLanguage): string {
  const text = value.replace(/\s+/g, " ").trim();
  // Keep non-page locators and explicit user labels as written. Roman numerals are also pages.
  const number = "(?:[0-9]+|[ivxlcdm]+)";
  const pages = new RegExp(`^${number}(?:\\s*(?:[-–—,;]|--|&)\\s*${number})*$`, "i");
  if (!pages.test(text)) return text;
  const multiple = new RegExp(`^${number}$`, "i").test(text) ? false : true;
  return `${multiple ? language.pages : language.page} ${text}`;
}
