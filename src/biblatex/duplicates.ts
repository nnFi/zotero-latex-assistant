import { bibliographyRecords, type BibRecord } from "./fields";

export interface BibliographyDuplicate {
  readonly first: string;
  readonly second: string;
  readonly reason: "doi" | "title-author-year";
}

export function normalizedDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let doi = value.replace(/\\([_%&#])/g, "$1").replace(/[{}]/g, "").trim()
    .replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
  try { doi = decodeURIComponent(doi); } catch { return undefined; }
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi.toLowerCase() : undefined;
}

export function normalizedText(value: string): string {
  return value.replace(/\\([_%&#])/g, "$1").replace(/\\(?:["'`^~=.uvHc])\s*\{?([\p{L}])\}?/gu, "$1")
    .replace(/\\(?:emph|textit|textbf|textsc|textnormal|textrm|textsf|texttt|mkbibemph|mkbibitalic|mkbibbold)\s*/g, "")
    .replace(/[{}]/g, "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function fingerprint(record: BibRecord): string | undefined {
  const title = record.fields.get("title")?.value;
  const author = record.fields.get("author")?.value;
  const year = (record.fields.get("date")?.value ?? record.fields.get("year")?.value)?.match(/\b\d{4}\b/)?.[0];
  if (!title || !author || !year) return undefined;
  const normalizedTitle = normalizedText(title);
  const authors = author.split(/\s+and\s+/i).map((name) => normalizedText(name.includes(",") ? name.split(",")[0]! : name.trim().split(/\s+/).at(-1)!));
  if (normalizedTitle.length < 12 || !authors.length || authors.some((name) => !name || name === "others")) return undefined;
  return [normalizedTitle, [...new Set(authors)].sort().join("|"), year].join("\0");
}

export function findBibliographyDuplicates(text: string): BibliographyDuplicate[] {
  const records = bibliographyRecords(text);
  const doiGroups = new Map<string, BibRecord[]>();
  const titleGroups = new Map<string, BibRecord[]>();
  const duplicates: BibliographyDuplicate[] = [];
  for (const record of records) {
    if (["xdata", "set"].includes(record.type)) continue;
    const doi = normalizedDoi(record.fields.get("doi")?.value);
    if (doi) {
      for (const previous of doiGroups.get(doi) ?? []) duplicates.push({ first: previous.key, second: record.key, reason: "doi" });
      doiGroups.set(doi, [...(doiGroups.get(doi) ?? []), record]);
    }
    const identity = fingerprint(record);
    if (!identity) continue;
    for (const previous of titleGroups.get(identity) ?? []) {
      const previousDoi = normalizedDoi(previous.fields.get("doi")?.value);
      // Two explicitly different DOIs identify distinct publications or versions.
      if (doi && previousDoi) continue;
      duplicates.push({ first: previous.key, second: record.key, reason: "title-author-year" });
    }
    titleGroups.set(identity, [...(titleGroups.get(identity) ?? []), record]);
  }
  return duplicates;
}

export function newBibliographyDuplicates(previous: string, next: string): BibliographyDuplicate[] {
  const identity = (duplicate: BibliographyDuplicate): string => JSON.stringify([duplicate.reason, ...[duplicate.first, duplicate.second].sort()]);
  const existing = new Set(findBibliographyDuplicates(previous).map(identity));
  return findBibliographyDuplicates(next).filter((duplicate) => !existing.has(identity(duplicate)));
}
