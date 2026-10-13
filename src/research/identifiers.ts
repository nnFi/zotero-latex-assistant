import { APP_VERSION } from "../shared/version";
import { normalizeDoi } from "./crossref";
import { normalizeIsbn } from "./isbn";
import { isRecord } from "../zotero/validation";
import { metadataSchema, type SourceMetadata } from "../zotero/metadata";

export function normalizeIdentifier(input: string): { kind: "doi" | "isbn"; value: string } {
  return /^(?:10\.|doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i.test(input.trim())
    ? { kind: "doi", value: normalizeDoi(input).toLowerCase() } : { kind: "isbn", value: normalizeIsbn(input) };
}
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const first = (value: unknown): string => Array.isArray(value) ? text(value[0]) : "";
const named = (value: unknown): string => Array.isArray(value) ? value.filter(isRecord).map((v) => text(v.name)).filter(Boolean).join("; ") : "";
const doiUrl = (doi: string): string => `https://doi.org/${encodeURIComponent(doi).replace(/%2F/gi, "/")}`;
function dateParts(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value["date-parts"]) || !Array.isArray(value["date-parts"][0])) return "";
  const parts = value["date-parts"][0];
  return parts.length && parts.length <= 3 && parts.every((part: unknown) => Number.isInteger(part))
    ? parts.map((part: number, index: number) => index ? String(part).padStart(2, "0") : String(part)).join("-") : "";
}
function publisherFields(itemType: string, publisher: string, institution: string, provider: string, warnings: string[]): Record<string, string> {
  const field = itemType === "thesis" ? "university" : itemType === "report" ? "institution" : undefined;
  if (!field) return { publisher };
  if (institution) return { [field]: institution };
  warnings.push(`${provider} metadata does not identify the ${itemType === "thesis" ? "degree-granting university" : "issuing institution"}. `
    + `The optional ${field} field was not populated from provider metadata; publisher, repository and affiliations were not used as substitutes.`);
  return {};
}
function crossrefMetadata(data: Record<string, unknown>): Pick<IdentifierResult, "metadata" | "warnings"> {
  const types: Record<string, string> = { "journal-article": "journalArticle", book: "book", monograph: "book", "edited-book": "book",
    "reference-book": "book", "book-chapter": "bookSection", "book-part": "bookSection", "book-section": "bookSection", "reference-entry": "bookSection",
    "proceedings-article": "conferencePaper", report: "report", dissertation: "thesis", "posted-content": "preprint", dataset: "dataset" };
  const itemType = types[text(data.type)];
  if (!itemType) throw new Error(`Unsupported Crossref source type: ${text(data.type) || "missing"}. Use a reviewed manual source type.`);
  const creators: SourceMetadata["creators"] = [];
  for (const role of ["author", "editor"] as const) {
    if (!Array.isArray(data[role])) continue;
    for (const person of data[role].filter(isRecord)) {
      if (text(person.family)) creators.push({ creatorType: role, firstName: text(person.given), lastName: text(person.family) });
      else if (text(person.name)) creators.push({ creatorType: role, name: text(person.name) });
    }
  }
  const warnings: string[] = [];
  const containerField = itemType === "bookSection" ? "bookTitle" : itemType === "conferencePaper" ? "proceedingsTitle"
    : itemType === "preprint" ? "repository" : "publicationTitle";
  const metadata = metadataSchema.parse({ itemType, title: first(data.title), creators, fields: {
    DOI: normalizeDoi(text(data.DOI)).toLowerCase(), url: doiUrl(normalizeDoi(text(data.DOI))),
    date: dateParts(data["published-print"]) || dateParts(data["published-online"]) || dateParts(data.published) || dateParts(data.issued),
    ...publisherFields(itemType, text(data.publisher), named(data.institution), "Crossref", warnings),
    [containerField]: first(data["container-title"]),
    volume: text(data.volume), issue: text(data.issue), pages: text(data.page), ISBN: first(data.ISBN), ISSN: first(data.ISSN),
    language: text(data.language), abstractNote: text(data.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  } });
  return { metadata, warnings };
}
function dataciteMetadata(data: Record<string, unknown>): Pick<IdentifierResult, "metadata" | "warnings"> {
  const types = isRecord(data.types) ? data.types : {};
  const mappings: Record<string, string> = { JournalArticle: "journalArticle", Book: "book", BookChapter: "bookSection", Report: "report",
    Dissertation: "thesis", ConferencePaper: "conferencePaper", Dataset: "dataset", Preprint: "preprint", Software: "computerProgram" };
  const itemType = mappings[text(types.resourceType).replace(/[\s_-]/g, "")] ?? mappings[text(types.resourceTypeGeneral)];
  if (!itemType) throw new Error("Unsupported DataCite source type. Use a reviewed manual source type.");
  const creators: SourceMetadata["creators"] = [];
  for (const person of Array.isArray(data.creators) ? data.creators.filter(isRecord) : []) {
    const creatorType = itemType === "computerProgram" ? "programmer" : "author";
    if (text(person.familyName)) creators.push({ creatorType, firstName: text(person.givenName), lastName: text(person.familyName) });
    else if (text(person.name)) creators.push({ creatorType, name: text(person.name) });
  }
  const container = isRecord(data.container) ? data.container : {};
  const publisher = isRecord(data.publisher) ? text(data.publisher.name) : text(data.publisher);
  const warnings: string[] = [];
  const metadata = metadataSchema.parse({ itemType, title: Array.isArray(data.titles) && isRecord(data.titles[0]) ? text(data.titles[0].title) : "", creators,
    fields: { DOI: normalizeDoi(text(data.doi)).toLowerCase(), url: doiUrl(normalizeDoi(text(data.doi))),
      date: typeof data.publicationYear === "number" ? String(data.publicationYear) : text(data.publicationYear),
      // DataCite publisher/affiliations/HostingInstitution/Producer do not establish these roles.
      ...publisherFields(itemType, publisher, "", "DataCite", warnings),
      [itemType === "bookSection" ? "bookTitle" : itemType === "conferencePaper" ? "proceedingsTitle" : itemType === "preprint" ? "repository" : "publicationTitle"]: text(container.title),
      language: text(data.language), versionNumber: text(data.version),
      abstractNote: Array.isArray(data.descriptions) ? data.descriptions.filter(isRecord).filter((v) => v.descriptionType === "Abstract").map((v) => text(v.description)).join("\n") : "" } });
  return { metadata, warnings };
}

export interface IdentifierResult {
  identifier: { kind: "doi" | "isbn"; value: string };
  provider: "crossref" | "datacite" | "openlibrary";
  sourceUrl: string;
  metadata: SourceMetadata;
  warnings: string[];
}
/** Only fixed public endpoints. No local credentials or project contents leave the machine. */
export class IdentifierClient {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}
  private async request(url: URL): Promise<Record<string, unknown> | null> {
    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetch(url, { headers: { Accept: "application/json", "User-Agent": `ZoteroLaTeXAssistant/${APP_VERSION}` },
        signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404) return null;
        throw new Error(`Metadata provider returned HTTP ${response.status}.`);
      }
      // Bound metadata in memory even when Content-Length is absent or misleading.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty metadata response.");
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 2 * 1024 * 1024) throw new Error("Metadata response exceeds 2 MiB.");
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      throw new Error(`Identifier lookup failed: ${error instanceof Error ? error.message : "provider unavailable"}`);
    }
    if (!isRecord(payload)) throw new Error("Invalid metadata response.");
    return payload;
  }
  async lookup(input: string): Promise<IdentifierResult> {
    const identifier = normalizeIdentifier(input);
    if (identifier.kind === "doi") {
      const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(identifier.value)}`);
      const result = await this.request(url);
      let mapped: Pick<IdentifierResult, "metadata" | "warnings">; let provider: IdentifierResult["provider"]; let sourceUrl = url.href;
      if (result) {
        if (!isRecord(result.message)) throw new Error("Invalid Crossref metadata response.");
        mapped = crossrefMetadata(result.message); provider = "crossref";
      } else {
        const fallback = new URL(`https://api.datacite.org/dois/${encodeURIComponent(identifier.value)}`);
        const result = await this.request(fallback);
        if (!result) throw new Error("DOI not found at Crossref or DataCite.");
        if (!isRecord(result.data) || !isRecord(result.data.attributes)) throw new Error("Invalid DataCite metadata response.");
        mapped = dataciteMetadata(result.data.attributes); provider = "datacite"; sourceUrl = fallback.href;
      }
      if (mapped.metadata.fields.DOI !== identifier.value) throw new Error("The returned DOI does not match the requested identifier.");
      return { identifier, provider, sourceUrl, ...mapped };
    }
    const url = new URL("https://openlibrary.org/api/books");
    const bibkey = `ISBN:${identifier.value}`;
    url.search = new URLSearchParams({ bibkeys: bibkey, format: "json", jscmd: "data" }).toString();
    const result = await this.request(url);
    const data = result?.[bibkey];
    if (!isRecord(data)) throw new Error("ISBN not found at Open Library.");
    const identifiers = isRecord(data.identifiers) ? data.identifiers : {};
    const returnedIsbns = [identifiers.isbn_13, identifiers.isbn_10].flatMap((v) => Array.isArray(v) ? v : []);
    if (!returnedIsbns.some((v) => { try { return normalizeIsbn(text(v)) === identifier.value; } catch { return false; } })) {
      throw new Error("The returned ISBN does not match the requested edition.");
    }
    const title = text(data.title);
    const metadata = metadataSchema.parse({ itemType: "book", title: title && text(data.subtitle) ? `${title}: ${text(data.subtitle)}` : title,
      creators: Array.isArray(data.authors) ? data.authors.filter(isRecord).filter((v) => text(v.name)).map((v) => ({ creatorType: "author", name: text(v.name) })) : [],
      fields: { ISBN: identifier.value, date: text(data.publish_date), publisher: named(data.publishers), place: named(data.publish_places),
        numPages: Number.isInteger(data.number_of_pages) ? String(data.number_of_pages) : "",
        url: `https://openlibrary.org/isbn/${identifier.value}` } });
    return { identifier, provider: "openlibrary", sourceUrl: url.href, metadata, warnings: [] };
  }
}
