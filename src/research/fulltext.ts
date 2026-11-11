import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { normalizedDoi, normalizedText } from "../biblatex/duplicates";
import { isRecord } from "../zotero/validation";
import { inspectHtml, xmlSections, type ArticleSection } from "./articleContent";
import { compareAuthor, doiUrl, Literature, safeUrl, text, validDoi, type Reference } from "./literature";
import { evidence, readLimited, ResearchFailure, type ResearchEvidence } from "./providerRun";
import { getPublicDocument, type DocumentRequest } from "./publicDocuments";

type Content = { format: "pdf"; bytes: Buffer } | { format: "xml" | "html"; sections: ArticleSection[] };
type Document = { content: Content | null; links: string[]; archives: string[]; restricted?: boolean;
  doi?: string | null; title?: string | undefined; authors?: string[]; url: URL };
interface FulltextFile { localPath: string; fileUri: string; byteSize: number; sha256: string }
const MiB = 1024 * 1024;

async function temporaryDocument(filename: string, bytes: Buffer): Promise<FulltextFile> {
  const directory = await mkdtemp(join(tmpdir(), "zotero-fulltext-"));
  const localPath = join(directory, filename);
  try { await writeFile(localPath, bytes, { mode: 0o600, flag: "wx" }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  setTimeout(() => { void rm(directory, { recursive: true, force: true }).catch(() => {}); }, 30 * 60 * 1000).unref();
  return { localPath, fileUri: pathToFileURL(localPath).href, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function handoff(content: Content, sourceUrl: string) {
  if (content.format === "pdf") {
    const embedded = content.bytes.length <= 5 * MiB;
    const file = embedded
      ? { fileUri: sourceUrl, localPath: null, byteSize: content.bytes.length, sha256: createHash("sha256").update(content.bytes).digest("hex") }
      : await temporaryDocument("publication.pdf", content.bytes);
    return { format: "pdf" as const, ...file, ...(embedded ? { pdfBase64: content.bytes.toString("base64") } : {}), sections: [] };
  }
  const article = content.sections.map(({ heading, text: body }) => [heading, body].filter(Boolean).join("\n\n")).join("\n\n");
  const bytes = Buffer.from(article, "utf8");
  const file = bytes.length > 128 * 1024 ? await temporaryDocument("publication.txt", bytes) : null;
  return { format: content.format, fileUri: file?.fileUri ?? null, localPath: file?.localPath ?? null, byteSize: bytes.length,
    sha256: file?.sha256 ?? null, sections: file ? [] : content.sections };
}

function firstAuthorOf(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return isRecord(first) ? text(first.text) || text(first.name) : text(first);
}
function archiveMatch(reference: Reference, doi: string | undefined, title: string, author: string, year: unknown) {
  if (doi && reference.doi && doi === reference.doi) return true;
  if (doi && reference.doi && doi !== reference.doi) return false;
  return Boolean(reference.title && reference.authors?.[0] && normalizedText(reference.title) === normalizedText(title)
    && compareAuthor(reference.authors[0], author) === "match"
    && (!reference.year || !year || String(year).slice(0, 4) === String(reference.year)));
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid archive record.");
  return value;
}
function archiveLinks(values: unknown[]) {
  return [...new Set(values.flatMap((value) => safeUrl(value) ?? []))];
}

class FulltextRun {
  private readonly events: ResearchEvidence[] = [];
  private readonly visited = new Set<string>();
  private readonly archives = new Set<string>();
  private readonly deadline = AbortSignal.timeout(52000);
  private publicationUrl: string | null = null;

  constructor(private readonly literature: Literature, private readonly download: DocumentRequest) {}

  private async visit(url: URL, provider: string) {
    if (this.visited.has(url.href) || this.visited.size >= 22 || this.deadline.aborted) return null;
    this.visited.add(url.href);
    let final = url;
    const response = await this.literature.run.request(provider === "openalex-content" ? provider : url.hostname, url, async (signal) => {
      const fetched = await this.download(url, signal, provider === "openalex-content" ? this.literature.run.openAlexKey : undefined);
      final = fetched.url;
      return fetched.response;
    }, async (result): Promise<Document> => {
      const mime = result.headers.get("content-type")?.toLowerCase() ?? "";
      const nonPdf = /(?:text\/|xml|html|json)/.test(mime);
      let bytes = await readLimited(result, nonPdf ? 8 * MiB : 40 * MiB);
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        try { bytes = gunzipSync(bytes, { maxOutputLength: nonPdf ? 8 * MiB : 40 * MiB }); }
        catch { throw new ResearchFailure("incomplete", "Compressed content is invalid or too large."); }
      }
      const base = { url: final, links: [], archives: [] };
      if (bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) && bytes.subarray(-2048).includes(Buffer.from("%%EOF"))) {
        return { ...base, content: { format: "pdf", bytes } };
      }
      if (bytes.length > 8 * MiB) throw new ResearchFailure("incomplete", "Non-PDF content exceeds the size limit.");
      const source = bytes.toString("utf8").trim();
      if (/xml/.test(mime) || /^<(?:\?xml\b|(?:[\w.-]+:)?(?:TEI|article)(?:\s|>))/.test(source)) {
        const sections = xmlSections(source);
        if (sections.length) return { ...base, content: { format: "xml", sections } };
      }
      if (/html/.test(mime) || /^<(?:!doctype html|html|head|body|article)\b/i.test(source)) {
        const html = inspectHtml(source, final);
        return { ...html, url: final, content: html.sections.length ? { format: "html", sections: html.sections } : null };
      }
      return { ...base, content: null };
    }, true, this.deadline);
    this.visited.add(final.href);
    if (provider === "publisher" && final.href !== url.href) this.publicationUrl = final.href;
    const item = response.value;
    const event = { ...response.evidence, provider, sourceUrl: final.href };
    return { item, event };
  }

  private async documents(urls: string[], provider: string, reference: Reference, follow = true): Promise<{ sourceUrl: string; content: Content } | null> {
    for (const value of urls.slice(0, 6)) {
      const visit = await this.visit(new URL(value), provider);
      if (!visit) continue;
      const { item, event } = visit;
      if (!item) { this.events.push(event); continue; }
      const sameDoi = item.doi && reference.doi && item.doi === reference.doi;
      if ((item.doi && reference.doi && item.doi !== reference.doi)
        || (!sameDoi && item.title && reference.title && normalizedText(item.title) !== normalizedText(reference.title))
        || (!sameDoi && item.authors?.[0] && reference.authors?.[0] && compareAuthor(reference.authors[0], item.authors[0]) === "mismatch")) {
        this.events.push({ ...event, status: "mismatch", reason: "The page identifies a different publication." });
        continue;
      }
      if (provider === "publisher") this.publicationUrl ??= item.url.href;
      if (!reference.title && item.title) reference.title = item.title;
      if (!reference.authors?.length && item.authors?.length) reference.authors = item.authors;
      item.archives.forEach((archive) => this.archives.add(archive));
      if (item.content) {
        this.events.push(event);
        return { sourceUrl: item.url.href, content: item.content };
      }
      this.events.push({ ...event, status: item.restricted ? "restricted" : "not-found",
        reason: item.restricted ? "The publisher marks the article as restricted." : "No readable full text in this response." });
      if (follow) {
        const found = await this.documents(item.links, provider, reference, false);
        if (found) return found;
      }
    }
    return null;
  }

  private async dblp(reference: Reference) {
    const query = reference.title || reference.doi;
    if (!query || (!reference.doi && !reference.authors?.[0])) return [];
    const url = new URL("https://dblp.org/search/publ/api");
    url.search = new URLSearchParams({ q: query.replace(/[+|$]/g, " "), format: "json", h: "10" }).toString();
    const lookup = await this.literature.run.json("dblp", url, (body) => {
      const hits = object(object(body).result).hits;
      const data = object(hits);
      const entries = Array.isArray(data.hit) ? data.hit : data.hit ? [data.hit] : [];
      const matches = entries.map((entry) => object(object(entry).info)).filter((item) =>
        archiveMatch(reference, normalizedDoi(text(item.doi)), text(item.title).replace(/\.$/, ""),
          firstAuthorOf(isRecord(item.authors) ? item.authors.author : undefined), item.year));
      if (!matches.length) throw new ResearchFailure("not-found", "DBLP returned no matching publication.");
      if (matches.length > 1) throw new ResearchFailure("ambiguous", "Several DBLP entries match the publication.");
      const record = matches[0]!;
      return archiveLinks(Array.isArray(record.ee) ? record.ee : [record.ee]);
    });
    this.events.push(lookup.evidence);
    return lookup.value ?? [];
  }

  private async zenodo(reference: Reference) {
    const quoted = (value: string) => JSON.stringify(value);
    const terms = [];
    if (reference.doi) terms.push(`doi:${quoted(reference.doi)}`, `related_identifiers.identifier:${quoted(reference.doi)}`);
    if (reference.title && reference.authors?.[0]) terms.push(`title:${quoted(reference.title)}`);
    if (!terms.length) return [];
    const url = new URL("https://zenodo.org/api/records");
    url.search = new URLSearchParams({ q: terms.join(" OR "), size: "10" }).toString();
    const lookup = await this.literature.run.json("zenodo", url, (body) => {
      const hits = object(object(body).hits).hits;
      if (!Array.isArray(hits)) throw new Error("Invalid Zenodo response.");
      const records = hits.map(object);
      const relatedVersions = records.filter((item) => {
        const metadata = object(item.metadata);
        const related = Array.isArray(metadata.related_identifiers) ? metadata.related_identifiers.filter(isRecord) : [];
        return Boolean(reference.doi && (normalizedDoi(text(metadata.doi) || text(item.doi)) === reference.doi
          || related.some((entry) => normalizedDoi(text(entry.identifier)) === reference.doi
            && /^(?:isidenticalto|isversionof|isnewversionof|ispreviousversionof|isvariantformof)$/i.test(text(entry.relation).replace(/[-_]/g, "")))));
      });
      const matches = relatedVersions.length ? relatedVersions : records.filter((item) => {
        const metadata = object(item.metadata);
        const creator = firstAuthorOf(metadata.creators);
        const doi = normalizedDoi(text(metadata.doi) || text(item.doi));
        const primary = doi && !doi.startsWith("10.5281/zenodo.") ? doi : undefined;
        return archiveMatch(reference, primary, text(metadata.title), creator, metadata.publication_date);
      });
      if (!relatedVersions.length && matches.length > 1) throw new ResearchFailure("ambiguous", "Several Zenodo records match the title and author.");
      const links = archiveLinks(matches.flatMap((item) => {
        const metadata = object(item.metadata);
        const open = metadata.access_right === "open" || (isRecord(item.access) && item.access.files === "public");
        if (!open || !Array.isArray(item.files)) return [];
        return item.files.filter(isRecord).filter((file) => /\.(?:pdf|xml)$/i.test(text(file.key)) && isRecord(file.links))
          .map((file) => object(file.links).content ?? object(file.links).self);
      }));
      if (!matches.length) throw new ResearchFailure("not-found", "Zenodo returned no matching record.");
      if (!links.length) throw new ResearchFailure("not-found", "Matching Zenodo records have no public PDF or XML.");
      return links;
    });
    this.events.push(lookup.evidence);
    return lookup.value ?? [];
  }

  async retrieve(input: Reference) {
    const reference = { ...input, doi: validDoi(input) };
    const fromOpenAlex = await this.literature.identify("openalex", reference);
    const work = fromOpenAlex.value && this.literature.usableIdentity(reference, fromOpenAlex.value) ? fromOpenAlex.value : null;
    this.events.push(fromOpenAlex.value && !work ? { ...fromOpenAlex.evidence, status: "mismatch", reason: "Reference metadata does not match the work." } : fromOpenAlex.evidence);
    let found: Awaited<ReturnType<FulltextRun["documents"]>> = null;
    if (work) {
      reference.doi ??= work.doi ?? undefined;
      reference.title ??= work.title;
      reference.authors = reference.authors?.length ? reference.authors : work.authors;
      reference.year ??= work.years[0];
      if (work.contentUrls.length && this.literature.run.openAlexKey) {
        found = await this.documents(work.contentUrls, "openalex-content", reference);
      } else if (work.contentUrls.length) {
        this.events.push(evidence("openalex-content", work.sourceUrl, "skipped", "OpenAlex hosted downloads require OPENALEX_API_KEY."));
      }
      found ??= await this.documents(work.locations, "openalex-location", reference);
      if (!found && !work.contentUrls.length && !work.locations.length) {
        this.events.push(evidence("openalex", work.sourceUrl, "not-found", "No downloadable copy or open-access location is indexed."));
      }
    }

    if (!found && !reference.doi) {
      const crossref = await this.literature.identify("crossref", input);
      const matched = crossref.value && this.literature.usableIdentity(input, crossref.value) ? crossref.value : null;
      this.events.push(crossref.value && !matched ? { ...crossref.evidence, status: "mismatch", reason: "Reference metadata does not match the work." } : crossref.evidence);
      reference.doi = matched?.doi ?? undefined;
    }
    if (!found && reference.doi) found = await this.documents([doiUrl(reference.doi).href], "publisher", reference);
    if (!found) found = await this.documents([...this.archives], "linked-archive", reference);
    if (!found && !this.deadline.aborted && (!work?.type || /article|proceeding|conference/i.test(work.type))) {
      found = await this.documents(await this.dblp(reference), "dblp", reference);
    }
    if (!found && !this.deadline.aborted) found = await this.documents(await this.zenodo(reference), "zenodo", reference);
    if (!found && (this.deadline.aborted || this.visited.size >= 22)) {
      this.events.push(evidence("fulltext", "", "incomplete", "Full-text lookup reached its time or page limit."));
    }

    const document = found ? { sourceUrl: found.sourceUrl, ...await handoff(found.content, found.sourceUrl) } : null;
    return { status: document ? "available" as const : "unresolved" as const, doi: reference.doi ?? null,
      publicationUrl: this.publicationUrl, document, evidence: this.events, contentVerified: false as const,
      guidance: document ? "Read the publication and cite the page or named section supporting the claim." : "Full text is unresolved. The content check remains open.",
      ...(document && "pdfBase64" in document ? { fileUri: document.fileUri, pdfBase64: document.pdfBase64 } : {}) };
  }
}

export function getFulltext(literature: Literature, reference: Reference, download = getPublicDocument) {
  return new FulltextRun(literature, download).retrieve(reference);
}
