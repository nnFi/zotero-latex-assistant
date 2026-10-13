import type { CitationSource } from "./sourceMetadata";
import { isRecord } from "../zotero/validation";
import { isbnIdentities } from "./isbn";

const books = ["book", "monograph", "edited-book", "reference-book"];
const chapters = ["book-chapter", "book-section", "book-part", "reference-entry"];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const normalized = (value: string): string => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .replace(/<[^>]*>/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Crossref can index either ISBN form. Search both identities of a 978 ISBN. */
export function isbnFilterValues(isbn13: string): string[] {
  if (!isbn13.startsWith("978")) return [isbn13];
  const digits = isbn13.slice(3, 12);
  const check = (11 - [...digits].reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0) % 11) % 11;
  return [isbn13, digits + (check === 10 ? "X" : String(check))];
}

/** A shared book ISBN alone never establishes a chapter or whole-book match. */
export function isbnRecordMatch(record: Record<string, unknown>, detail: CitationSource, isbn13: string): "match" | "different" | "incomplete" {
  const { item, data } = detail;
  const types = item.itemType === "book" ? books : item.itemType === "bookSection" ? chapters : [];
  if (!text(record.type) || !Array.isArray(record.ISBN)) return "incomplete";
  if (!types.includes(text(record.type))
    || !record.ISBN.some((value) => typeof value === "string" && isbnIdentities(value).includes(isbn13))) return "different";
  if (!Array.isArray(record.title) || !normalized(item.title)) return "incomplete";
  const titles = record.title.filter((title): title is string => typeof title === "string" && Boolean(title.trim()));
  if (!titles.length) return "incomplete";
  const subtitles = Array.isArray(record.subtitle) ? record.subtitle.filter((title): title is string => typeof title === "string") : [];
  const titleMatches = titles.some((title) => normalized(title) === normalized(item.title)
    || subtitles.some((subtitle) => normalized(`${title}: ${subtitle}`) === normalized(item.title)));
  if (!titleMatches) return "different";
  const year = item.date.match(/\b\d{4}\b/)?.[0];
  const years = ["issued", "published", "published-print", "published-online"].flatMap((field) => {
    const dates = record[field];
    return isRecord(dates) && Array.isArray(dates["date-parts"]) ? dates["date-parts"].flatMap((parts) =>
      Array.isArray(parts) && Number.isInteger(parts[0]) ? [String(parts[0])] : []) : [];
  });
  if (year && !years.length) return "incomplete";
  if (year && !years.includes(year)) return "different";
  for (const role of ["author", "editor"] as const) {
    const people = item.creators.filter((creator) => creator.creatorType === role);
    if (!people.length) continue;
    const deposited = record[role];
    if (!Array.isArray(deposited) || !deposited.length || !deposited.every(isRecord)) return "incomplete";
    if (deposited.length !== people.length) return "different";
    if (deposited.some((candidate) => !text(candidate.name) && !text(candidate.family))) return "incomplete";
    const used = new Set<number>();
    for (const person of people) {
      const candidates = deposited.flatMap((candidate, index) => {
        if (used.has(index)) return [];
        if (person.name) return normalized(person.name) === normalized(text(candidate.name)) ? [index] : [];
        if (!normalized(person.lastName) || normalized(person.lastName) !== normalized(text(candidate.family))) return [];
        const expected = normalized(person.firstName).split(" ").filter(Boolean);
        const found = normalized(text(candidate.given)).split(" ").filter(Boolean);
        // Compare full supplied names; tolerate initials only when one side is abbreviated.
        const matches = expected.every((name, offset) => found[offset] !== undefined
          && (name === found[offset] || ((name.length === 1 || found[offset]!.length === 1) && name[0] === found[offset]![0])));
        return matches ? [index] : [];
      });
      if (!candidates.length) {
        if (!person.name && person.firstName && deposited.some((candidate) => normalized(person.lastName) === normalized(text(candidate.family)) && !text(candidate.given))) return "incomplete";
        return "different";
      }
      if (candidates.length !== 1) return "incomplete";
      used.add(candidates[0]!);
    }
  }
  if (data.edition && !text(record["edition-number"])) return "incomplete";
  if (data.edition && normalized(text(data.edition)) !== normalized(text(record["edition-number"]))) return "different";
  if (item.itemType === "bookSection") {
    if (data.bookTitle && (!Array.isArray(record["container-title"]) || !record["container-title"].length)) return "incomplete";
    if (data.bookTitle && (!Array.isArray(record["container-title"])
      || !record["container-title"].some((title) => normalized(text(title)) === normalized(text(data.bookTitle))))) return "different";
    const pages = (value: unknown) => text(value).normalize("NFKC").replace(/[–—]/g, "-").replace(/\s/g, "");
    if (data.pages && !text(record.page)) return "incomplete";
    if (data.pages && pages(data.pages) !== pages(record.page)) return "different";
  }
  return "match";
}
