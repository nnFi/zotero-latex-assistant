import type { SourceMetadata } from "./metadata";

interface Requirements { core: string[]; recommended: string[]; roles: string[] }
const profiles: Record<string, Requirements> = {
  journalArticle: { core: ["date", "publicationTitle", "creators"], recommended: ["volume", "issue", "pages", "DOI"], roles: ["author"] },
  book: { core: ["date", "publisher", "creators"], recommended: ["ISBN", "edition", "place"], roles: ["author", "editor"] },
  bookSection: { core: ["date", "bookTitle", "publisher", "creators"], recommended: ["pages", "ISBN"], roles: ["author"] },
  report: { core: ["date", "institution", "creators"], recommended: ["reportNumber", "reportType", "url"], roles: ["author"] },
  thesis: { core: ["date", "university", "creators"], recommended: ["thesisType", "url"], roles: ["author"] },
  webpage: { core: ["url", "websiteTitle"], recommended: ["creators", "date", "accessDate"], roles: ["author"] },
  conferencePaper: { core: ["date", "proceedingsTitle", "creators"], recommended: ["conferenceName", "pages", "publisher", "DOI"], roles: ["author"] },
  preprint: { core: ["date", "repository", "creators"], recommended: ["DOI", "url"], roles: ["author"] },
  newspaperArticle: { core: ["date", "publicationTitle", "creators"], recommended: ["pages", "url"], roles: ["author"] },
  magazineArticle: { core: ["date", "publicationTitle", "creators"], recommended: ["volume", "issue", "pages", "url"], roles: ["author"] },
  dataset: { core: ["date", "creators"], recommended: ["DOI", "url", "versionNumber"], roles: ["author"] },
  computerProgram: { core: ["creators"], recommended: ["date", "versionNumber", "url"], roles: ["programmer"] },
};

/** Citation-quality guidance. Only type and title are mandatory for creation. */
export function metadataCompleteness(input: SourceMetadata, validFields?: readonly string[]) {
  const profile = profiles[input.itemType] ?? { core: ["date"], recommended: ["creators", "url"], roles: [] };
  const supported = (field: string) => field === "creators" || !validFields || validFields.includes(field);
  const required = ["itemType", "title"];
  const recommended = [...profile.core, ...profile.recommended].filter(supported);
  const has = (field: string) => field === "title" ? Boolean(input.title.trim())
    : field === "itemType" ? Boolean(input.itemType.trim())
    : field === "creators" ? input.creators.some((creator) => (!profile.roles.length || profile.roles.includes(creator.creatorType))
      && Boolean("name" in creator ? creator.name.trim() : creator.lastName.trim() || creator.firstName.trim()))
      : Boolean(input.fields[field]?.trim());
  const missingRequired = required.filter((field) => !has(field));
  const missingRecommended = recommended.filter((field) => !has(field));
  return { complete: missingRequired.length === 0, profile: Object.hasOwn(profiles, input.itemType) ? input.itemType : "generic",
    required, recommended, creatorRoles: profile.roles, missingRequired, missingRecommended };
}
