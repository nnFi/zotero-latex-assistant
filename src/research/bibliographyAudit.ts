import { randomUUID } from "node:crypto";
import { referencedCitationKeys } from "../biblatex/deletion";
import { bibliographyRecords, type BibRecord } from "../biblatex/fields";
import { readProjectConfig, newProjectConfig } from "../config/project";
import { readProjectSources, type ProjectSource } from "../config/projectSources";
import { inspectBibliography } from "../zotero/bibliographySelection";
import { Literature, type Reference } from "./literature";
import type { ProviderRun } from "./providerRun";
import { PubcheckClient } from "./pubcheck";
import type { CitationSource } from "./sourceMetadata";

const pageSize = 5;
const lifetime = 30 * 60 * 1000;
const types: Record<string, string> = { article: "journalArticle", book: "book", inbook: "bookSection", incollection: "bookSection",
  inproceedings: "conferencePaper", conference: "conferencePaper", phdthesis: "thesis", mastersthesis: "thesis",
  thesis: "thesis", report: "report", techreport: "report", online: "webpage", misc: "document" };

function splitAuthors(value: string) {
  let depth = 0, start = 0;
  const names = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "\\") { index++; continue; }
    if (character === "{") depth++;
    if (character === "}") depth--;
    if (depth || !/\s/.test(character ?? "")) continue;
    const separator = /^\s+and\s+/i.exec(value.slice(index));
    if (!separator) continue;
    names.push(value.slice(start, index).trim());
    start = index + separator[0].length;
    index = start - 1;
  }
  names.push(value.slice(start).trim());
  return names.filter(Boolean);
}

function entryOf(entry: BibRecord) {
  const field = (name: string) => entry.fields.get(name)?.value?.trim() ?? "";
  const authors = splitAuthors(field("author"));
  const title = field("title");
  const doi = field("doi");
  const date = field("date") || field("year");
  const year = date.match(/\b\d{4}\b/)?.[0];
  const reference: Reference = { title, doi, authors, year: year ? Number(year) : undefined };
  const creators = authors.filter((name) => !/^(?:others|et al\.?)$/i.test(name)).map((name) => {
    const comma = name.startsWith("{") ? -1 : name.indexOf(",");
    return comma < 0 ? { creatorType: "author", name, firstName: "", lastName: "" }
      : { creatorType: "author", name: "", lastName: name.slice(0, comma), firstName: name.slice(comma + 1).trim() };
  });
  const source: CitationSource = { item: { itemType: types[entry.type] ?? "document", title, creators, doi, date, isbn: field("isbn") },
    data: { publicationTitle: field("journaltitle") || field("journal") || field("booktitle") } };
  return { citationKey: entry.key, reference, source };
}

function compareCitations(sources: readonly ProjectSource[], keys: readonly string[]) {
  const scannedFiles = sources.map((source) => source.path);
  try {
    if (!sources.length) throw new Error("No LaTeX sources were supplied or found.");
    const cited = new Set(referencedCitationKeys(sources));
    const entries = new Set(keys);
    return { status: "compared" as const, scannedFiles, missingFromBibliography: [...cited].filter((key) => !entries.has(key)),
      notCited: [...entries].filter((key) => !cited.has(key)), reason: null };
  } catch (error) {
    return { status: "incomplete" as const, scannedFiles, missingFromBibliography: [], notCited: [],
      reason: error instanceof Error ? error.message : "The LaTeX sources could not be compared." };
  }
}

type Entry = ReturnType<typeof entryOf>;
type CitationComparison = ReturnType<typeof compareCitations>;
type AuditResult = { citationKey: string; title: string; pubcheck: Awaited<ReturnType<PubcheckClient["checkBibliographyEntry"]>>;
  reference: Awaited<ReturnType<Literature["check"]>> | null; problem: string | null };
interface AuditPage {
  status: "checked" | "ambiguous" | "not-found";
  bibFile: string | null;
  candidates: string[];
  total: number;
  offset: number;
  nextToken: string | null;
  results: AuditResult[];
  citationComparison: CitationComparison | null;
}
interface Audit {
  expires: number;
  entries: Entry[];
  literature: Literature;
  bibFile: string | null;
  candidates: string[];
  comparison: CitationComparison;
  pubcheckUnavailable: boolean;
  nextOffset: number;
  lastPage?: { offset: number; result: Promise<AuditPage> };
}

/** Keep a stable input snapshot and provider state across pages of one audit. */
export class BibliographyAudit {
  private readonly audits = new Map<string, Audit>();
  constructor(private readonly makeRun: () => ProviderRun) {}

  async start(input: { bibtex: string; latex?: string | undefined } | { project: string; bibFile?: string | undefined }): Promise<AuditPage> {
    let bib: string, latex: ProjectSource[], bibFile: string | null = null, candidates: string[] = [];
    if ("bibtex" in input) {
      bib = input.bibtex;
      latex = input.latex?.trim() ? [{ path: "(input)", text: input.latex }] : [];
    } else {
      const config = await readProjectConfig(input.project) ?? newProjectConfig();
      const selection = await inspectBibliography(input.project, config, input.bibFile);
      candidates = selection.candidates;
      if (selection.text === undefined) return { status: selection.status === "ambiguous" ? "ambiguous" : "not-found", bibFile,
        candidates, total: 0, offset: 0, nextToken: null, results: [], citationComparison: null };
      bib = selection.text;
      bibFile = selection.bibFile;
      latex = await readProjectSources(input.project);
    }
    const records = bibliographyRecords(bib);
    const entries = records.filter((entry) => !["xdata", "set"].includes(entry.type)).map(entryOf);
    this.expire();
    const paged = entries.length > pageSize;
    if (paged && this.audits.size >= 16) {
      const completed = [...this.audits].find(([, audit]) => audit.nextOffset < 0);
      if (!completed) throw new Error("Too many active bibliography audits. Continue an existing audit or wait for it to expire.");
      this.audits.delete(completed[0]);
    }
    const id = randomUUID();
    const audit: Audit = { expires: Date.now() + lifetime, entries, literature: new Literature(this.makeRun()), bibFile, candidates,
      comparison: compareCitations(latex, records.filter((entry) => entry.type !== "xdata").map((entry) => entry.key)),
      pubcheckUnavailable: false, nextOffset: 0 };
    if (paged) {
      this.audits.set(id, audit);
      setTimeout(() => this.audits.delete(id), lifetime).unref();
    }
    return this.page(id, audit, 0);
  }

  continue(token: string) {
    this.expire();
    const [id, offset, extra] = token.split(":");
    const audit = this.audits.get(id ?? "");
    if (!audit || !offset || !/^\d+$/.test(offset) || extra !== undefined) throw new Error("The bibliography continuation expired or is invalid. Start a new audit.");
    return this.page(id!, audit, Number(offset));
  }

  private expire() {
    for (const [id, audit] of this.audits) if (audit.expires <= Date.now()) this.audits.delete(id);
  }

  private page(id: string, audit: Audit, offset: number) {
    if (audit.lastPage?.offset === offset) return audit.lastPage.result;
    if (offset !== audit.nextOffset) throw new Error("Use the continuation token returned by the preceding bibliography page.");
    const result = this.checkPage(id, audit, offset);
    audit.lastPage = { offset, result };
    return result;
  }

  private async checkPage(id: string, audit: Audit, offset: number): Promise<AuditPage> {
    const pubcheckClient = new PubcheckClient();
    const results: AuditResult[] = [];
    for (const entry of audit.entries.slice(offset, offset + pageSize)) {
      const pubcheck = await pubcheckClient.checkBibliographyEntry(entry.source, audit.literature.run);
      if (["unavailable", "skipped"].includes(pubcheck.evidence.status)) audit.pubcheckUnavailable = true;
      let reference: AuditResult["reference"] = null, problem: string | null = null;
      try {
        reference = await audit.literature.check(entry.reference);
      } catch (error) { problem = error instanceof Error ? error.message : "Reference could not be checked."; }
      results.push({ citationKey: entry.citationKey, title: entry.source.item.title, pubcheck, reference, problem });
    }
    const next = offset + results.length;
    audit.nextOffset = next < audit.entries.length ? next : -1;
    return { status: "checked", bibFile: audit.bibFile, candidates: audit.candidates, total: audit.entries.length, offset,
      nextToken: audit.nextOffset >= 0 ? `${id}:${next}` : null, results, citationComparison: audit.pubcheckUnavailable ? audit.comparison : null };
  }
}
