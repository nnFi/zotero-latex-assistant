import { normalizeDoi } from "./crossref";
import { normalizeIsbn } from "./isbn";
import { isRecord } from "../zotero/validation";
import { metadataSchema, type SourceMetadata } from "../zotero/metadata";
import { Literature, type Work } from "./literature";
import { ProviderRun, requireRecord, ResearchFailure, type ResearchEvidence } from "./providerRun";

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

function openAlexMetadata(work: Work, record: Record<string, unknown>): Pick<IdentifierResult, "metadata" | "warnings"> {
  const location = isRecord(record.primary_location) ? record.primary_location : {};
  const source = isRecord(location.source) ? location.source : {};
  const mappings: Record<string, string> = { book: "book", "book-chapter": "bookSection", dissertation: "thesis",
    "conference-paper": "conferencePaper", report: "report", preprint: "preprint", dataset: "dataset", software: "computerProgram" };
  let itemType = mappings[work.type];
  if (work.type === "article") {
    const originalType = text(record.raw_type) || text(record.type_crossref);
    if (originalType === "journal-article") itemType = "journalArticle";
    else if (originalType === "proceedings-article") itemType = "conferencePaper";
    else if (originalType === "posted-content") itemType = "preprint";
    else if (source.type === "journal") itemType = "journalArticle";
    else if (source.type === "conference") itemType = "conferencePaper";
  }
  if (!itemType || !work.title || !work.doi) throw new Error("OpenAlex metadata lacks an unambiguous source type, title or DOI. Review the source manually.");

  const authorships = Array.isArray(record.authorships) ? record.authorships : [];
  const names = work.authors.map((name, index) => {
    const authorship: unknown = authorships[index];
    return (isRecord(authorship) && text(authorship.raw_author_name)) || name;
  });
  const creators = names.filter(Boolean).map((name) => ({ creatorType: itemType === "computerProgram" ? "programmer" : "author", name }));
  const warnings: string[] = ["Metadata comes from the OpenAlex index. Review it before using the source."];
  const biblio = isRecord(record.biblio) ? record.biblio : {};
  const date = text(record.publication_date);
  const container: Record<string, string> = {};
  if (itemType === "journalArticle" && source.type === "journal") container.publicationTitle = text(source.display_name);
  if (itemType === "conferencePaper" && source.type === "conference") container.proceedingsTitle = text(source.display_name);
  if (itemType === "bookSection" && isRecord(record.volume)) container.bookTitle = text(record.volume.display_name);
  if (itemType === "preprint" && source.type === "repository") container.repository = text(source.display_name);
  if (itemType === "thesis" || itemType === "report") publisherFields(itemType, "", "", "OpenAlex", warnings);
  const pages = [...new Set([text(biblio.first_page), text(biblio.last_page)].filter(Boolean))].join("-");
  const metadata = metadataSchema.parse({ itemType, title: work.title, creators, fields: {
    DOI: work.doi, url: doiUrl(work.doi), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : String(work.years[0] ?? ""),
    ...container, volume: text(biblio.volume), issue: text(biblio.issue), pages, language: text(record.language),
  } });
  return { metadata, warnings };
}

export const identifierProviders = ["crossref", "datacite", "openalex", "openlibrary"] as const;
export interface IdentifierResult {
  identifier: { kind: "doi" | "isbn"; value: string };
  provider: typeof identifierProviders[number];
  sourceUrl: string;
  metadata: SourceMetadata;
  warnings: string[];
}
export interface IdentifierLookupOptions {
  run?: ProviderRun;
  evidence?: ResearchEvidence[];
  openAlexFallback?: boolean;
}

export class IdentifierClient {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async lookup(input: string, { run = new ProviderRun(this.fetch), evidence, openAlexFallback = true }: IdentifierLookupOptions = {}): Promise<IdentifierResult> {
    const identifier = normalizeIdentifier(input);
    if (identifier.kind === "doi") {
      const key = encodeURIComponent(identifier.value);
      const registries = [
        { provider: "crossref", url: new URL(`https://api.crossref.org/works/${key}`),
          decode: (body: unknown) => requireRecord(requireRecord(body).message), map: crossrefMetadata },
        { provider: "datacite", url: new URL(`https://api.datacite.org/dois/${key}`),
          decode: (body: unknown) => requireRecord(requireRecord(requireRecord(body).data).attributes), map: dataciteMetadata },
      ] as const;
      const failures: ResearchEvidence[] = [];
      for (const { provider, url, decode, map } of registries) {
        const result = await run.json(provider, url, decode);
        evidence?.push(result.evidence);
        if (!result.value) {
          failures.push(result.evidence);
          continue;
        }
        const mapped = map(result.value);
        if (mapped.metadata.fields.DOI !== identifier.value) throw new ResearchFailure("mismatch", "The returned DOI does not match the requested identifier.");
        const warnings = [...failures.filter(({ status }) => status !== "not-found").map(lookupFailure), ...mapped.warnings];
        return { identifier, provider, sourceUrl: url.href, metadata: mapped.metadata, warnings };
      }
      if (openAlexFallback) {
        const result = await new Literature(run).openAlexDoi(identifier.value);
        evidence?.push(result.evidence);
        if (result.value) {
          const { record, work } = result.value;
          const mapped = openAlexMetadata(work, record);
          return { identifier, provider: "openalex", sourceUrl: work.sourceUrl, metadata: mapped.metadata,
            warnings: [...failures.map(lookupFailure), ...mapped.warnings] };
        }
        failures.push(result.evidence);
      }
      throw new Error(`Identifier lookup failed. ${failures.map(lookupFailure).join(" ")}`);
    }
    const url = new URL("https://openlibrary.org/api/books");
    const bibkey = `ISBN:${identifier.value}`;
    url.search = new URLSearchParams({ bibkeys: bibkey, format: "json", jscmd: "data" }).toString();
    const lookup = await run.json("openlibrary", url, requireRecord);
    evidence?.push(lookup.evidence);
    if (lookup.evidence.status !== "ok" && lookup.evidence.status !== "not-found") {
      throw new Error(`Identifier lookup failed. ${lookupFailure(lookup.evidence)}`);
    }
    const data = lookup.value?.[bibkey];
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

function lookupFailure({ provider, status, reason }: ResearchEvidence) {
  return `${provider} (${status}): ${reason}`;
}
