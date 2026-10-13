import type { ZoteroItem } from "../shared/types";
import { metadataSchema, type SourceMetadata } from "../zotero/metadata";

/** Bibliographic input independent of a Zotero key, library or database version. */
export interface CitationSource {
  item: Pick<ZoteroItem, "itemType" | "title" | "creators" | "date" | "doi" | "isbn">;
  data: Record<string, unknown>;
}

export function candidateSource(input: SourceMetadata): { metadata: SourceMetadata; source: CitationSource } {
  const metadata = metadataSchema.parse(input);
  if (["attachment", "note", "annotation"].includes(metadata.itemType)) throw new Error("Only bibliographic source candidates can be checked.");
  const creators = metadata.creators.map((creator) => ({ creatorType: creator.creatorType,
    name: "name" in creator ? creator.name : "", firstName: "firstName" in creator ? creator.firstName : "",
    lastName: "lastName" in creator ? creator.lastName : "" }));
  return { metadata, source: { item: { itemType: metadata.itemType, title: metadata.title, creators,
    date: metadata.fields.date ?? "", doi: metadata.fields.DOI ?? "", isbn: metadata.fields.ISBN ?? "" }, data: { ...metadata.fields } } };
}
