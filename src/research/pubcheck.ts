import { APP_VERSION } from "../shared/version";
import type { ZoteroItemDetail } from "../shared/types";
import { isRecord } from "../zotero/validation";
import { normalizeDoi } from "./crossref";
import { isbnIdentities, parseIsbnList } from "./isbn";
import { isbnFilterValues, isbnRecordMatch } from "./crossrefIsbn";
import { candidateSource, type CitationSource } from "./sourceMetadata";
import type { SourceMetadata } from "../zotero/metadata";

export const pubcheckVerdicts = ["VERIFIED", "RETRACTED", "NOT_FOUND", "METADATA_MISMATCH", "INVALID_IDENTIFIER", "UNVERIFIABLE", "ERROR"] as const;
type Verdict = typeof pubcheckVerdicts[number];
export interface SourceCheck {
  itemKey: string;
  title: string;
  version: number;
  pubcheck: {
    provider: "pubcheck"; endpoint: string; checkedAt: string; verdict: Verdict;
    metadataMatches: boolean | null; contentVerified: false;
    reasons: string[]; comparedFields: string[]; uncomparedFields: string[]; warnings: string[];
    resolved: Record<string, unknown> | null; advisories: Record<string, unknown>[];
    retractionSnapshot: Record<string, unknown> | null;
    isbnValidation?: { isbns: string[]; status: "matched" | "unconfirmed" | "invalid" | "unavailable"; provider: "crossref" | "local"; sourceUrl: string | null; reason: string };
    isbnChecks?: { isbn: string; verdict: Verdict; metadataMatches: boolean | null; reasons: string[]; resolved: Record<string, unknown> | null;
      warnings: string[]; advisories: Record<string, unknown>[]; retractionSnapshot: Record<string, unknown> | null }[];
  };
  citations: {
    provider: "crossref"; count: number | null; status: "available" | "not-found" | "unavailable" | "no-doi" | "invalid-doi" | "invalid-isbn" | "ambiguous" | "unsupported-type" | "not-requested";
    doi: string | null; isbn: string | null; matchedBy: "doi" | "isbn" | null; sourceUrl: string | null; checkedAt: string | null; reason: string;
  };
}
const endpoint = "https://pubcheck.net/api/browser/lookup";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
// Send only citation metadata, never abstracts, notes, credentials, PDFs or surrounding text.
const literal = (value: string): string => value.replace(/<[^>]*>/g, " ").replace(/[{}\\\r\n]/g, " ").replace(/\s+/g, " ").trim();
function reference(detail: CitationSource) {
  const { item, data } = detail;
  const fields: Record<string, string> = { title: literal(item.title) };
  fields.author = item.creators.filter((v) => v.creatorType === "author").map((v) => v.name
    ? `{${literal(v.name)}}` : [literal(v.lastName), literal(v.firstName)].filter(Boolean).join(", ")).join(" and ");
  fields.year = item.date.match(/\b\d{4}\b/)?.[0] ?? "";
  fields.journal = literal(text(data.publicationTitle) || text(data.proceedingsTitle) || text(data.bookTitle));
  fields.doi = literal(item.doi);
  let validDoi = false;
  if (fields.doi) { try { fields.doi = normalizeDoi(item.doi).toLowerCase(); validDoi = true; } catch { /* PubCheck reports invalid identifiers. */ } }
  if (/[{}\\]/.test(fields.doi)) throw new Error("The DOI contains unsupported bibliography delimiters.");
  const rawIsbn = item.isbn || text(data.ISBN);
  let isbns: string[] = [], isbnError: string | undefined;
  if (rawIsbn.trim()) { try { isbns = parseIsbnList(rawIsbn); } catch (error) { isbnError = error instanceof Error ? error.message : "Invalid ISBN list."; } }
  // PubCheck prioritizes the ISBN field over a valid DOI and accepts only one ISBN.
  // DOI metadata is checked first; all ISBN claims are checked separately, without dropping them.
  fields.isbn = validDoi ? "" : isbns.length === 1 ? isbns[0]! : "";
  const types: Record<string, string> = { journalArticle: "article", book: "book", bookSection: "incollection", conferencePaper: "inproceedings", thesis: "phdthesis", report: "techreport", webpage: "online" };
  const expected = [fields.title ? "title" : "", fields.author ? "authors" : "", fields.year ? "year" : "", fields.journal ? "journal" : "",
    fields.doi ? "doi" : "", fields.isbn ? "isbn" : ""].filter(Boolean);
  return { query: `@${types[item.itemType] ?? "misc"}{source,\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k} = {${v}}`).join(",\n")}\n}`,
    title: fields.title!, doi: fields.doi!, expected, validDoi, isbns, isbnError, hasIsbn: Boolean(rawIsbn.trim()) };
}

/** The browser lookup endpoint is public but not a versioned API; fail visibly on schema changes. */
export class PubcheckClient {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}
  private async json(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const response = await this.fetch(url, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": `ZoteroLaTeXAssistant/${APP_VERSION}` },
      signal: signal ?? AbortSignal.timeout(12000), redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      throw new Error(`Lookup returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty lookup response.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > 2 * 1024 * 1024) throw new Error("Lookup response exceeds 2 MiB.");
        chunks.push(next.value);
      }
    } finally { await reader.cancel(); }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!isRecord(value)) throw new Error("Invalid lookup response.");
    return value;
  }
  private async verification(detail: CitationSource, doiRecord: (doi: string) => Promise<Record<string, unknown> | null>): Promise<SourceCheck["pubcheck"]> {
    const checkedAt = new Date().toISOString();
    const base = { provider: "pubcheck" as const, endpoint, checkedAt, contentVerified: false as const };
    try {
      const supplied = reference(detail);
      if (!supplied.validDoi && supplied.isbnError) return { ...base, verdict: "INVALID_IDENTIFIER", metadataMatches: null,
        reasons: [supplied.isbnError], comparedFields: [], uncomparedFields: ["isbn"], warnings: [], resolved: null, advisories: [], retractionSnapshot: null };
      if (!supplied.validDoi && supplied.isbns.length > 1) {
        if (supplied.isbns.length > 5) throw new Error("At most five distinct ISBN identities can be checked at once.");
        const checks = await Promise.all(supplied.isbns.map(async (isbn) => {
          const result = await this.verification({ ...detail, item: { ...detail.item, isbn } }, doiRecord);
          return { isbn, verdict: result.verdict, metadataMatches: result.metadataMatches, reasons: result.reasons, resolved: result.resolved,
            warnings: result.warnings, advisories: result.advisories, retractionSnapshot: result.retractionSnapshot };
        }));
        return { ...base, verdict: "UNVERIFIABLE", metadataMatches: null,
          reasons: ["Multiple ISBN identities were checked separately. Select the exact edition before accepting an overall bibliographic match."],
          comparedFields: [], uncomparedFields: ["isbn"], warnings: [], resolved: null,
          advisories: [...new Map(checks.flatMap((check) => check.advisories).map((advisory) => [JSON.stringify(advisory), advisory])).values()],
          retractionSnapshot: null, isbnChecks: checks };
      }
      if (supplied.query.length > 20000) throw new Error("Citation metadata exceeds 20,000 characters.");
      const body = await this.json(endpoint, { method: "POST", body: JSON.stringify({ query: supplied.query }) });
      const v = body?.verification;
      if (!isRecord(v) || !pubcheckVerdicts.includes(v.verdict as Verdict) || !isRecord(v.citation)) throw new Error("PubCheck returned an unsupported verification response.");
      // Never attribute another citation's evidence to this source.
      if (text(v.citation.title) !== supplied.title || text(v.citation.doi).toLowerCase() !== supplied.doi.toLowerCase()) throw new Error("PubCheck did not return the submitted citation metadata.");
      if (!supplied.validDoi && supplied.isbns.length === 1 && !isbnIdentities(text(v.citation.isbn)).includes(supplied.isbns[0]!)) {
        throw new Error("PubCheck did not return the submitted ISBN identity.");
      }
      const resolved = isRecord(v.resolved) ? v.resolved : null;
      if (["VERIFIED", "RETRACTED", "METADATA_MISMATCH"].includes(String(v.verdict))
        && (!resolved || !text(resolved.title) || !text(resolved.source))) throw new Error("PubCheck did not return evidence for the matched record.");
      if (resolved && supplied.doi && ["VERIFIED", "RETRACTED", "METADATA_MISMATCH"].includes(String(v.verdict))
        && normalizeDoi(text(resolved.doi)).toLowerCase() !== normalizeDoi(supplied.doi).toLowerCase()) throw new Error("PubCheck resolved a different DOI.");
      if (!supplied.validDoi && supplied.isbns.length === 1 && ["VERIFIED", "RETRACTED"].includes(String(v.verdict))
        && (!resolved || !isbnIdentities(text(resolved.isbn)).includes(supplied.isbns[0]!))) throw new Error("PubCheck resolved a different ISBN identity.");
      const comparedFields = strings(v.compared_fields);
      const fullyCompared = supplied.expected.includes("title") && supplied.expected.every((field) => comparedFields.includes(field)
        && !strings(v.uncompared_fields).includes(field) && !strings(v.ignored_fields).includes(field));
      const isbnValidation = supplied.validDoi && supplied.hasIsbn ? await this.validateIsbnsForDoi(supplied, doiRecord) : undefined;
      const warnings = strings(body?.warnings);
      if (isbnValidation) {
        warnings.push("PubCheck was queried by DOI. The supplied ISBN field was checked separately against that DOI's Crossref ISBN metadata; Zotero was not changed.");
        if (isbnValidation.status !== "matched") warnings.push(isbnValidation.reason);
      }
      return { ...base, verdict: v.verdict as Verdict,
        metadataMatches: v.verdict === "METADATA_MISMATCH" ? false : v.verdict === "VERIFIED" && fullyCompared && (!isbnValidation || isbnValidation.status === "matched") ? true : null,
        reasons: strings(v.reasons), comparedFields, uncomparedFields: [...new Set([...strings(v.uncompared_fields), ...(isbnValidation && isbnValidation.status !== "matched" ? ["isbn"] : [])])], warnings,
        resolved, advisories: Array.isArray(v.advisories) ? v.advisories.filter(isRecord) : [],
        retractionSnapshot: isRecord(body?.retraction_snapshot) ? body.retraction_snapshot : null, ...(isbnValidation ? { isbnValidation } : {}) };
    } catch (error) {
      return { ...base, verdict: "ERROR", metadataMatches: null, reasons: [error instanceof Error ? error.message : "PubCheck unavailable."],
        comparedFields: [], uncomparedFields: [], warnings: [], resolved: null, advisories: [], retractionSnapshot: null };
    }
  }
  private async validateIsbnsForDoi(supplied: ReturnType<typeof reference>, doiRecord: (doi: string) => Promise<Record<string, unknown> | null>): Promise<NonNullable<SourceCheck["pubcheck"]["isbnValidation"]>> {
    const base = { isbns: supplied.isbns, provider: "crossref" as const, sourceUrl: `https://api.crossref.org/works/${encodeURIComponent(supplied.doi)}` };
    if (supplied.isbnError) return { ...base, provider: "local", sourceUrl: null, status: "invalid", reason: supplied.isbnError };
    try {
      const body = await doiRecord(supplied.doi);
      const record = body?.message;
      if (!isRecord(record)) return { ...base, status: "unconfirmed", reason: "Crossref has no ISBN metadata for the supplied DOI; the ISBN claims remain unconfirmed." };
      if (normalizeDoi(text(record.DOI)).toLowerCase() !== supplied.doi) throw new Error("Crossref returned a different DOI during ISBN validation.");
      const registered = Array.isArray(record.ISBN) ? record.ISBN.flatMap((isbn) => isbnIdentities(text(isbn))) : [];
      const matched = supplied.isbns.every((isbn) => registered.includes(isbn));
      return { ...base, status: matched ? "matched" : "unconfirmed", reason: matched
        ? "Every supplied ISBN identity is registered on the same Crossref DOI record. Formatting was normalized for checking only."
        : "Not every supplied ISBN identity is listed on this Crossref DOI record; absence is not proof of a wrong ISBN." };
    } catch (error) { return { ...base, status: "unavailable", reason: error instanceof Error ? error.message : "ISBN validation unavailable." }; }
  }
  private async isbnCitationCount(detail: CitationSource): Promise<SourceCheck["citations"]> {
    const identities = isbnIdentities(detail.item.isbn || text(detail.data.ISBN));
    const base = { provider: "crossref" as const, count: null, doi: null, isbn: identities.length === 1 ? identities[0]! : null,
      matchedBy: null, sourceUrl: null as string | null, checkedAt: new Date().toISOString() };
    if (!identities.length || identities.length > 5) return { ...base, status: "invalid-isbn", reason: "Supply 1 to 5 valid ISBN edition identities for a Crossref ISBN lookup." };
    if (!["book", "bookSection"].includes(detail.item.itemType)) return { ...base, status: "unsupported-type", reason: "ISBN citation matching supports books and book sections only; a containing book is not this source." };
    const matches = new Map<string, { record: Record<string, unknown>; sourceUrl: string; isbn: string }>();
    const deadline = AbortSignal.timeout(20000);
    let requests = 0;
    try {
      for (const isbn of identities) for (const filterIsbn of isbnFilterValues(isbn)) {
        let expectedTotal: number | undefined;
        for (let offset = 0; ; offset += 100) {
          if (offset >= 500 || ++requests > 12 || deadline.aborted) throw new Error("Crossref ISBN search could not be completed within the lookup limits; uniqueness is unknown.");
          const url = new URL("https://api.crossref.org/works");
          url.searchParams.set("filter", `isbn:${filterIsbn}`); url.searchParams.set("rows", "100"); url.searchParams.set("offset", String(offset));
          base.sourceUrl ??= url.href;
          const body = await this.json(url.href, {}, AbortSignal.any([deadline, AbortSignal.timeout(12000)]));
          if (!body) break;
          const message = body.message;
          if (!isRecord(message) || !Array.isArray(message.items) || message.items.length > 100
            || typeof message["total-results"] !== "number" || !Number.isSafeInteger(message["total-results"]) || message["total-results"] < offset + message.items.length
            || !message.items.every(isRecord)) throw new Error("Crossref returned an invalid ISBN search response.");
          const total = message["total-results"];
          if (expectedTotal !== undefined && expectedTotal !== total) throw new Error("Crossref ISBN results changed during pagination; uniqueness is unknown.");
          expectedTotal = total;
          for (const record of message.items) {
            const match = isbnRecordMatch(record, detail, isbn);
            if (match === "incomplete") throw new Error("Crossref ISBN candidate metadata is incomplete; a unique source match cannot be established.");
            if (match !== "match") continue;
            const doi = normalizeDoi(text(record.DOI)).toLowerCase();
            const existing = matches.get(doi);
            if (existing && existing.record["is-referenced-by-count"] !== record["is-referenced-by-count"]) throw new Error("Crossref returned inconsistent citation counts for the matched DOI.");
            matches.set(doi, { record, sourceUrl: url.href, isbn });
            if (matches.size > 1) return { ...base, status: "ambiguous", reason: "Multiple distinct DOI records match the ISBN and supplied book/chapter metadata; no citation counts were combined." };
          }
          if (offset + message.items.length >= total) break;
          if (message.items.length !== 100) throw new Error("Crossref ISBN results are incomplete; a unique source match cannot be established.");
        }
      }
      const matched = [...matches][0];
      if (!matched) return { ...base, status: "not-found", reason: "No exact Crossref ISBN match for this book/chapter and its supplied metadata; this does not establish fabrication." };
      const [doi, candidate] = matched;
      const count = candidate.record["is-referenced-by-count"];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Crossref did not return a valid citation count.");
      return { ...base, doi, isbn: candidate.isbn, matchedBy: "isbn", sourceUrl: candidate.sourceUrl, count, status: "available",
        reason: "Inbound citations for one uniquely matched book/chapter DOI via ISBN and supplied metadata; chapter counts are not summed into a book count. Crossref coverage is incomplete." };
    } catch (error) { return { ...base, status: "unavailable", reason: error instanceof Error ? error.message : "Crossref ISBN lookup unavailable." }; }
  }
  private async citationCount(detail: CitationSource, requested: boolean, doiRecord: (doi: string) => Promise<Record<string, unknown> | null>): Promise<SourceCheck["citations"]> {
    const base = { provider: "crossref" as const, count: null, doi: null, isbn: null, matchedBy: null, sourceUrl: null, checkedAt: null };
    if (!requested) return { ...base, status: "not-requested", reason: "Citation counts were not requested." };
    const doiInput = detail.item.doi;
    if (!doiInput.trim()) {
      if (detail.item.isbn?.trim() || text(detail.data.ISBN).trim()) return this.isbnCitationCount(detail);
      return { ...base, status: "no-doi", reason: "No DOI or ISBN is available for citation-count lookup." };
    }
    let doi: string;
    try { doi = normalizeDoi(doiInput).toLowerCase(); } catch { return { ...base, status: "invalid-doi", reason: "The source DOI is invalid." }; }
    const sourceUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const lookup = { ...base, doi, sourceUrl, checkedAt: new Date().toISOString() };
    try {
      const body = await doiRecord(doi);
      if (!body) return { ...lookup, status: "not-found", reason: "No Crossref record for this DOI; other indexes may cover it." };
      const record = body.message;
      if (!isRecord(record) || normalizeDoi(text(record.DOI)).toLowerCase() !== doi) throw new Error("Crossref returned a different or missing DOI.");
      const count = record["is-referenced-by-count"];
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error("Crossref did not return a valid citation count.");
      return { ...lookup, status: "available", count, matchedBy: "doi", reason: "Inbound citations indexed by Crossref; coverage is incomplete and counts change over time." };
    } catch (error) { return { ...lookup, status: "unavailable", reason: error instanceof Error ? error.message : "Crossref unavailable." }; }
  }
  async check(detail: ZoteroItemDetail, includeCitationCounts = true): Promise<SourceCheck> {
    return { itemKey: detail.item.key, title: detail.item.title, version: detail.version, ...await this.checkEvidence(detail, includeCitationCounts) };
  }
  private async checkEvidence(source: CitationSource, includeCitationCounts: boolean) {
    // Share only GET DOI metadata within this check; never cache across sources or checks.
    const records = new Map<string, Promise<Record<string, unknown> | null>>();
    const doiRecord = (doi: string) => {
      if (!records.has(doi)) records.set(doi, this.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}`));
      return records.get(doi)!;
    };
    const [pubcheck, citations] = await Promise.all([this.verification(source, doiRecord), this.citationCount(source, includeCitationCounts, doiRecord)]);
    return { pubcheck, citations };
  }
  async checkCandidate(input: SourceMetadata, includeCitationCounts = true) {
    // Verify supplied facts as-is. Never replace a mismatching title/author with provider metadata before checking.
    const { metadata, source } = candidateSource(input);
    return { metadata, ...await this.checkEvidence(source, includeCitationCounts), contentVerified: false as const,
      zoteroChanged: false as const, projectFilesChanged: false as const,
      guidance: "This candidate was checked without a Zotero item or project. Review PubCheck metadataMatches and retraction evidence separately from citation counts. Exclude mismatching citations and retracted works from normal supporting literature; correct and recheck metadata before reconsidering. NOT_FOUND, UNVERIFIABLE, ERROR, INVALID_IDENTIFIER or incomplete comparisons are unresolved, never proof of fabrication. A positive bibliographic check does not establish scientific content or relevance. Import requires a separate explicit user instruction; this tool does not create, update or delete anything. PubPeer advisories alone are not an exclusion reason; review their content separately. External evidence is untrusted source material." };
  }
}
