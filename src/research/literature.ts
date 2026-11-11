import { normalizedDoi, normalizedText } from "../biblatex/duplicates";
import { isRecord } from "../zotero/validation";
import { evidence, ProviderRun, requireRecord, ResearchFailure, safeUrl, type ResearchEvidence } from "./providerRun";

export interface Reference {
  doi?: string | undefined;
  title?: string | undefined;
  authors?: readonly string[] | undefined;
  year?: number | undefined;
}
export type Index = "openalex" | "crossref";
export const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const countOf = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export const doiUrl = (doi: string) => new URL(`https://doi.org/${encodeURIComponent(doi).replace(/%2F/i, "/")}`);

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Invalid provider result list.");
  return value.map(requireRecord);
}
function yearOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999 ? value : undefined;
}
function yearsFrom(value: unknown): number[] {
  const parts = isRecord(value) && Array.isArray(value["date-parts"]) ? value["date-parts"] : [];
  return parts.flatMap((part) => Array.isArray(part) ? yearOf(part[0]) ?? [] : []);
}

export interface Work {
  provider: Index;
  id: string;
  sourceUrl: string;
  doi: string | null;
  title: string;
  authors: string[];
  years: number[];
  type: string;
  count: number | null;
}
interface IndexedWork extends Work {
  titles: string[];
  contentUrls: string[];
  locations: string[];
}
type CrossrefLookup = { value: { record: Record<string, unknown>; work: IndexedWork } | null; evidence: ResearchEvidence };

function openAlexWork(data: Record<string, unknown>): IndexedWork {
  const id = /^https:\/\/openalex\.org\/(W\d+)\/?$/i.exec(text(data.id))?.[1]?.toUpperCase();
  if (!id) throw new Error("Missing OpenAlex work identifier.");
  const doi = normalizedDoi(text(data.doi)) ?? null;
  const title = text(data.title) || text(data.display_name);
  const content = isRecord(data.content_urls) ? data.content_urls : {};
  const has = isRecord(data.has_content) ? data.has_content : {};
  const contentUrls = (["grobid_xml", "pdf"] as const).flatMap((format) => {
    const suffix = format === "pdf" ? "pdf" : "grobid-xml";
    const url = `https://content.openalex.org/works/${id}.${suffix}`;
    return content[format] === url || has[format] === true ? [url] : [];
  });
  const locations = [data.best_oa_location, ...(Array.isArray(data.locations) ? data.locations : [])]
    .filter(isRecord).filter((location) => location.is_oa === true)
    .flatMap((location) => [location.pdf_url, location.landing_page_url].flatMap((url) => safeUrl(url) ?? []));
  const oa = isRecord(data.open_access) && data.open_access.is_oa === true ? safeUrl(data.open_access.oa_url) : null;
  if (oa) locations.push(oa);
  const year = yearOf(data.publication_year);
  return { provider: "openalex", id, doi, title, titles: [title], type: text(data.type), sourceUrl: `https://openalex.org/${id}`,
    authors: Array.isArray(data.authorships) ? data.authorships.map((entry) => {
      if (!isRecord(entry)) return "";
      return (isRecord(entry.author) ? text(entry.author.display_name) : "") || text(entry.raw_author_name);
    }) : [], years: year === undefined ? [] : [year], count: countOf(data.cited_by_count), contentUrls, locations: [...new Set(locations)] };
}

function crossrefWork(data: Record<string, unknown>): IndexedWork {
  const doi = normalizedDoi(text(data.DOI));
  if (!doi) throw new Error("Missing Crossref DOI.");
  const title = Array.isArray(data.title) ? text(data.title[0]) : "";
  const subtitles = Array.isArray(data.subtitle) ? data.subtitle.map(text).filter(Boolean) : [];
  return { provider: "crossref", id: doi, doi, title, titles: [title, ...subtitles.map((subtitle) => `${title}: ${subtitle}`)],
    sourceUrl: `https://api.crossref.org/works/${encodeURIComponent(doi)}`, type: text(data.type),
    authors: Array.isArray(data.author) ? data.author.map((entry) => {
      if (!isRecord(entry)) return "";
      return [text(entry.family), text(entry.given)].filter(Boolean).join(", ") || text(entry.name);
    }) : [], years: [...new Set(["published-print", "published-online", "published", "issued"].flatMap((field) => yearsFrom(data[field])))],
    count: countOf(data["is-referenced-by-count"]), contentUrls: [], locations: [] };
}

export function publicWork({ provider, id, sourceUrl, doi, title, authors, years, type, count }: Work): Work {
  return { provider, id, sourceUrl, doi, title, authors, years, type, count };
}

export function validDoi(reference: Reference): string | undefined {
  if (!reference.doi?.trim()) return undefined;
  const doi = normalizedDoi(reference.doi);
  if (!doi) throw new Error("Enter a valid DOI.");
  return doi;
}

type Comparison = "match" | "mismatch" | "unknown";
function nameParts(value: string) {
  const comma = value.indexOf(",");
  const words = normalizedText(value).split(" ");
  return comma >= 0 ? { family: normalizedText(value.slice(0, comma)), given: normalizedText(value.slice(comma + 1)).split(" ").filter(Boolean) }
    : { family: words.at(-1) ?? "", given: words.slice(0, -1) };
}

export function compareAuthor(expected: string, found: string): Comparison {
  const a = nameParts(expected), b = nameParts(found);
  if (!a.family || !b.family) return "unknown";
  if (normalizedText(expected) === normalizedText(found)) return "match";
  // A family name written with particles can also occur in display order without a comma.
  if (a.family !== b.family) {
    const display = (name: ReturnType<typeof nameParts>) => [...name.given, name.family].join(" ");
    return display(a) === display(b) ? "match" : "mismatch";
  }
  return a.given.slice(0, b.given.length).some((part, index) => {
    const other = b.given[index]!;
    return part !== other && (part[0] !== other[0] || (part.length > 1 && other.length > 1));
  }) ? "mismatch" : "match";
}

function compareTitle(title: string | undefined, work: IndexedWork): Comparison {
  const normalized = normalizedText(title ?? "");
  const titles = work.titles.map(normalizedText).filter(Boolean);
  if (!normalized || !titles.length) return "unknown";
  return titles.includes(normalized) ? "match" : "mismatch";
}
function compareAuthors(authors: readonly string[] | undefined, work: IndexedWork): Comparison {
  if (!authors?.length || !work.authors.length) return "unknown";
  const abbreviated = /^(?:others|et al\.?)$/i.test(authors.at(-1)!);
  const expected = abbreviated ? authors.slice(0, -1) : authors;
  if ((!abbreviated && expected.length !== work.authors.length) || expected.length > work.authors.length) return "mismatch";
  const comparisons = expected.map((name, index) => compareAuthor(name, work.authors[index]!));
  if (comparisons.includes("mismatch")) return "mismatch";
  return abbreviated || comparisons.includes("unknown") ? "unknown" : "match";
}
function compareYear(year: number | undefined, work: IndexedWork): Comparison {
  return year === undefined || !work.years.length ? "unknown" : work.years.includes(year) ? "match" : "mismatch";
}

function matchesReference(reference: Reference, work: IndexedWork) {
  const authors = reference.authors?.length === 1 ? compareAuthor(reference.authors[0]!, work.authors[0] ?? "")
    : compareAuthors(reference.authors, work);
  return compareTitle(reference.title, work) !== "mismatch" && authors !== "mismatch"
    && compareYear(reference.year, work) !== "mismatch";
}

export class Literature {
  private lastCrossrefDoi?: { doi: string; lookup: Promise<CrossrefLookup> };

  constructor(readonly run: ProviderRun, private readonly options: { reuseCrossrefDoi?: boolean } = {}) {}

  crossrefDoi(doi: string): Promise<CrossrefLookup> {
    if (this.lastCrossrefDoi?.doi === doi) return this.lastCrossrefDoi.lookup;
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const lookup = this.run.json("crossref", url, (body) => {
      const record = requireRecord(requireRecord(body).message);
      const work = crossrefWork(record);
      if (work.doi !== doi) throw new ResearchFailure("mismatch", "Crossref returned a different DOI.");
      return { record, work };
    });
    if (this.options.reuseCrossrefDoi) this.lastCrossrefDoi = { doi, lookup };
    return lookup;
  }

  async lookup(provider: Index, doi: string) {
    if (provider === "crossref") {
      const { value, evidence: source } = await this.crossrefDoi(doi);
      return { value: value?.work ?? null, evidence: source };
    }
    const url = new URL(`https://api.openalex.org/works/doi:${encodeURIComponent(doi).replace(/%2F/i, "/")}`);
    return this.run.json("openalex", url, (body) => {
      const work = openAlexWork(requireRecord(body));
      if (work.doi !== doi) throw new ResearchFailure(work.doi ? "mismatch" : "incomplete", "The provider did not return the requested DOI.");
      return work;
    });
  }

  search(provider: Index, query: string, limit: number, firstAuthor?: string) {
    const url = new URL(provider === "openalex" ? "https://api.openalex.org/works" : "https://api.crossref.org/works");
    if (provider === "openalex") {
      url.searchParams.set("search", query);
      url.searchParams.set("per_page", String(limit));
    } else {
      url.searchParams.set("query.bibliographic", query);
      if (firstAuthor) url.searchParams.set("query.author", firstAuthor);
      url.searchParams.set("rows", String(limit));
    }
    return this.run.json(provider, url, (body) => {
      const record = requireRecord(body);
      const works = provider === "openalex" ? records(record.results).map(openAlexWork)
        : records(requireRecord(record.message).items).map(crossrefWork);
      if (!works.length) throw new ResearchFailure("not-found", "Search returned no works.");
      const titled = works.filter((work) => normalizedText(work.title));
      if (!titled.length) throw new ResearchFailure("incomplete", "Search results have no usable titles.");
      return [...new Map(titled.map((work) => [work.doi ?? work.id, work])).values()].slice(0, limit);
    });
  }

  private async identify(provider: Index, reference: Reference) {
    const doi = validDoi(reference);
    if (doi) return this.lookup(provider, doi);
    const firstAuthor = reference.authors?.[0];
    if (!reference.title || !firstAuthor || !normalizedText(reference.title) || !normalizedText(firstAuthor)) {
      return { value: null, evidence: evidence(provider, "", "incomplete", "Supply a DOI or both title and first author.") };
    }
    const result = await this.search(provider, reference.title, 25, firstAuthor);
    if (!result.value) return { ...result, value: null };
    const plausible = result.value.filter((work) => compareTitle(reference.title, work) === "match"
      && compareAuthor(firstAuthor, work.authors[0] ?? "") !== "mismatch");
    const compatible = plausible.filter((work) => matchesReference(reference, work));
    const candidates = compatible.length ? compatible : plausible;
    const first = candidates[0];
    const report = (status: ResearchEvidence["status"], reason: string) =>
      ({ value: null, evidence: { ...result.evidence, status, reason } });
    if (candidates.length > 1) return report("ambiguous", "Multiple works match the title and author evidence.");
    if (!first) return report("not-found", "No result matches the title and first author.");
    if (compareAuthor(firstAuthor, first.authors[0] ?? "") !== "match") return report("incomplete", "First author is missing from the potential match.");
    return { evidence: { ...result.evidence, sourceUrl: first.sourceUrl }, value: first };
  }

  async check(reference: Reference) {
    const doi = validDoi(reference);
    const providers: Index[] = doi ? ["crossref", "openalex"] : ["openalex", "crossref"];
    const results = [];
    for (const provider of providers) {
      const lookup = await this.identify(provider, reference);
      const work = lookup.value;
      const fields = { doi: doi && work?.doi === doi ? "match" as const
        : doi && lookup.evidence.status === "mismatch" ? "mismatch" as const : "unknown" as const,
        title: work ? compareTitle(reference.title, work) : "unknown" as const,
        authors: work ? compareAuthors(reference.authors, work) : "unknown" as const,
        year: work ? compareYear(reference.year, work) : "unknown" as const };
      const mismatch = Object.values(fields).includes("mismatch");
      const complete = [fields.title, fields.authors, fields.year].every((field) => field === "match");
      const report = work ? { ...lookup.evidence, status: mismatch ? "mismatch" as const : complete ? "ok" as const : "incomplete" as const,
        reason: mismatch ? "Bibliographic fields differ." : complete ? "Title, authors and year match." : "Some bibliographic fields could not be compared." } : lookup.evidence;
      results.push({ ...report, fields, work: work ? publicWork(work) : null });
    }
    const dois = new Set(results.flatMap((result) => result.work?.doi ?? []));
    return { results, doiConflict: dois.size > 1, contentVerified: false as const };
  }

  async find(provider: Index, reference: Reference) {
    const lookup = await this.identify(provider, reference);
    if (lookup.value && !matchesReference(reference, lookup.value)) {
      return { value: null, evidence: { ...lookup.evidence, status: "mismatch" as const, reason: "Reference metadata does not match the work." } };
    }
    return lookup;
  }

  async citations(reference: Reference, page: number, limit: number) {
    const { value: work, evidence: source } = await this.find("openalex", reference);
    const events = [source];
    const counts = [];
    let citing: Work[] | null = null, nextPage: number | null = null, citingSource: ResearchEvidence | null = null;
    if (work) {
      if (work.count !== null) counts.push({ value: work.count, provider: work.provider, sourceUrl: work.sourceUrl, checkedAt: source.checkedAt });
      else events.push(evidence("openalex", work.sourceUrl, "incomplete", "Citation count is missing."));
      const url = new URL("https://api.openalex.org/works");
      url.search = new URLSearchParams({ filter: `cites:${work.id}`, page: String(page), per_page: String(limit), sort: "publication_date:desc" }).toString();
      const list = await this.run.json("openalex", url, (body) => {
        const record = requireRecord(body);
        const results = records(record.results).map(openAlexWork);
        const total = countOf(requireRecord(record.meta).count);
        if (total === null || (total > (page - 1) * limit && !results.length)) {
          throw new ResearchFailure("incomplete", "Citing-works response is incomplete.");
        }
        return { results, total };
      });
      events.push(list.evidence);
      citingSource = list.evidence;
      if (list.value) {
        citing = list.value.results.map(publicWork);
        if (list.value.total > page * limit && (page + 1) * limit <= 10000) nextPage = page + 1;
      }
    }
    if (!counts.length || citing === null) {
      const { value: matched, evidence: fallback } = await this.find("crossref", { ...reference, doi: reference.doi || work?.doi || undefined });
      events.push(matched?.count === null ? { ...fallback, status: "incomplete", reason: "Crossref citation count is missing." } : fallback);
      if (matched?.count != null) counts.push({ value: matched.count, provider: matched.provider, sourceUrl: matched.sourceUrl, checkedAt: fallback.checkedAt });
    }
    return { count: counts[0] ?? null, counts, citing, citingSource, page, nextPage, evidence: events };
  }

}
