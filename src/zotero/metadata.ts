import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { normalizedDoi, normalizedText } from "../biblatex/duplicates";
import type { ZoteroItem } from "../shared/types";
import { ZoteroClient } from "./client";
import { isRecord } from "./validation";
import { validateCitationKey } from "../biblatex/keys";
import { isbnIdentities, normalizeIsbn } from "../research/isbn";

const name = z.string().trim().min(1).max(1000);
export const creatorSchema = z.union([
  z.object({ creatorType: name, firstName: z.string().max(1000).default(""), lastName: name }).strict(),
  z.object({ creatorType: name, name }).strict(),
]);
export const metadataSchema = z.object({
  itemType: z.string().regex(/^[a-zA-Z]+$/).describe("Zotero type, e.g. journalArticle, book, bookSection, report, thesis, webpage."),
  title: name,
  citationKey: z.string().min(1).max(200).refine((value) => { try { validateCitationKey(value); return true; } catch { return false; } }, "Invalid citation key.").optional()
    .describe("Optional fixed citation key. A stable key is generated when omitted."),
  creators: z.array(creatorSchema).max(200).default([]),
  fields: z.record(z.string(), z.string().max(50000)).default({}).describe("Zotero fields valid for this type, e.g. date, DOI, publicationTitle, publisher, ISBN, url, abstractNote."),
  tags: z.array(name).max(100).default([]),
}).strict();
export type SourceMetadata = z.infer<typeof metadataSchema>;

/** No defaults: omitted fields must never erase existing Zotero metadata. */
export const metadataUpdateSchema = z.object({
  title: name.optional(),
  creators: z.array(creatorSchema).max(200).optional(),
  fields: z.record(z.string(), z.string().max(50000)).optional(),
  tags: z.array(name).max(100).optional(),
}).strict().refine((value) => Boolean(value.title !== undefined || value.creators !== undefined
  || value.tags !== undefined || Object.keys(value.fields ?? {}).length), "Supply at least one metadata change.");
export type MetadataUpdate = z.infer<typeof metadataUpdateSchema>;

export async function validatedItemData(client: ZoteroClient, input: SourceMetadata): Promise<Record<string, unknown>> {
  if (["attachment", "note", "annotation"].includes(input.itemType)) throw new Error("Only bibliographic item types can be created.");
  const template = await client.itemTemplate(input.itemType);
  const types = await client.creatorTypes(input.itemType);
  const protectedFields = new Set(["itemType", "title", "creators", "collections", "tags", "relations", "key", "version", "deleted", "dateAdded", "dateModified", "parentItem"]);
  for (const [field, value] of Object.entries(input.fields)) {
    if (protectedFields.has(field) || !Object.hasOwn(template, field) || typeof template[field] !== "string") {
      throw new Error(`The field “${field}” is not valid for Zotero type ${input.itemType}.`);
    }
    if (field === "DOI" && value && !normalizedDoi(value)) throw new Error("Enter a valid DOI.");
    if (field === "ISBN" && value.trim()) normalizeIsbn(value);
    if (field === "citationKey" && value) validateCitationKey(value);
    if (field === "url" && value) {
      let url: URL;
      try { url = new URL(value); } catch { throw new Error("Enter a valid source URL."); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Source URLs must use HTTP or HTTPS.");
    }
  }
  if (input.creators.some((creator) => !types.includes(creator.creatorType))) throw new Error(`Invalid creator role for ${input.itemType}.`);
  return { itemType: input.itemType, title: input.title, ...input.fields,
    ...(input.fields.DOI ? { DOI: normalizedDoi(input.fields.DOI)! } : {}),
    creators: input.creators, tags: input.tags.map((tag) => ({ tag })), relations: {} };
}

export function sourceDuplicates(input: SourceMetadata, items: readonly ZoteroItem[]): { item: ZoteroItem; reason: "doi" | "isbn" | "title-author-year" }[] {
  const doi = normalizedDoi(input.fields.DOI || input.fields.extra?.match(/^\s*DOI\s*:\s*(.+)$/mi)?.[1]);
  const isbns = isbnIdentities(input.fields.ISBN);
  const year = input.fields.date?.match(/\b\d{4}\b/)?.[0];
  const authors = (creators: readonly Record<string, unknown>[]): string => [...new Set(creators
    .filter((creator) => creator.creatorType === "author")
    .map((creator) => normalizedText(String(creator.name || creator.lastName || ""))))].sort().join("|");
  const title = normalizedText(input.title);
  const names = authors(input.creators);
  return items.flatMap<{ item: ZoteroItem; reason: "doi" | "isbn" | "title-author-year" }>((item) => {
    const otherDoi = normalizedDoi(item.doi);
    if (doi && doi === otherDoi) return [{ item, reason: "doi" as const }];
    if (input.itemType === "book" && item.itemType === "book" && isbnIdentities(item.isbn).some((isbn) => isbns.includes(isbn))) {
      return [{ item, reason: "isbn" as const }];
    }
    if (doi && otherDoi) return [];
    if (title.length >= 12 && names && year && title === normalizedText(item.title)
      && names === authors(item.creators.map((creator) => ({ ...creator }))) && year === item.date.match(/\b\d{4}\b/)?.[0]) {
      return [{ item, reason: "title-author-year" as const }];
    }
    return [];
  });
}

export function itemCollections(data: Record<string, unknown>): string[] {
  if (!Array.isArray(data.collections) || data.collections.some((key) => typeof key !== "string")) throw new Error("Invalid Zotero collection membership.");
  return data.collections as string[];
}

export function containsData(saved: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([field, value]) => {
    if (field === "relations") return isRecord(saved.relations);
    return isDeepStrictEqual(saved[field], value);
  });
}
