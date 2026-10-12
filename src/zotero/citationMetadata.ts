import { createHash } from "node:crypto";
import { extraCitationKeys, pinnedCitationKeyExtra, validateCitationKey } from "../biblatex/keys";
import { normalizedText } from "../biblatex/duplicates";
import type { SourceMetadata } from "./metadata";

export function sourceCitationKey(input: SourceMetadata, requestId: string): string {
  const extraKeys = extraCitationKeys(input.fields.extra ?? "");
  const supplied = [input.citationKey, input.fields.citationKey, ...extraKeys].filter((value): value is string => value !== undefined && value !== "");
  if (new Set(supplied).size > 1) throw new Error("Conflicting citation keys were supplied.");
  if (supplied.length) return validateCitationKey(supplied[0]);
  const creator = input.creators.find((v) => v.creatorType === "author") ?? input.creators[0];
  const author = creator ? "name" in creator ? creator.name : creator.lastName : "source";
  const slug = (value: string) => normalizedText(value).replace(/[^a-z0-9]/g, "");
  const year = input.fields.date?.match(/\b\d{4}\b/)?.[0] ?? "";
  const title = normalizedText(input.title).split(" ").slice(0, 2).map(slug).join("").slice(0, 24);
  return `${slug(author).slice(0, 24) || "source"}${year}${title}_${createHash("sha256").update(requestId).digest("hex").slice(0, 10)}`;
}

/** Validate only explicit key changes; unrelated note/metadata edits keep their existing semantics. */
export function citationKeysForUpdate(original: Record<string, unknown>, candidate: Record<string, unknown>, patch: Record<string, unknown>): string[] {
  const extraKeys = (data: Record<string, unknown>) => extraCitationKeys(typeof data.extra === "string" ? data.extra : "");
  const previousExtra = [...new Set(extraKeys(original))].sort();
  const nextExtra = [...new Set(extraKeys(candidate))].sort();
  const extraChanged = Object.hasOwn(patch, "extra") && JSON.stringify(previousExtra) !== JSON.stringify(nextExtra);
  if (!Object.hasOwn(patch, "citationKey") && !extraChanged) return [];
  const native = typeof candidate.citationKey === "string" ? candidate.citationKey : "";
  const keys = [...new Set([native, ...nextExtra].filter(Boolean))];
  if (nextExtra.length > 1 || keys.length > 1) throw new Error("Conflicting citation keys in native and Extra fields. Supply matching keys or remove the obsolete Extra key.");
  return keys.map(validateCitationKey);
}

export function withCitationKey(input: SourceMetadata, key: string, template: Record<string, unknown>): SourceMetadata {
  const fields = { ...input.fields };
  if (Object.hasOwn(template, "citationKey")) {
    fields.citationKey = key;
    if (fields.extra !== undefined) fields.extra = fields.extra.replace(/^\s*Citation Key\s*:\s*.*(?:\r?\n|$)/gmi, "").trim();
  } else if (Object.hasOwn(template, "extra")) {
    fields.extra = pinnedCitationKeyExtra(fields.extra ?? "", key);
  } else throw new Error("This Zotero type exposes neither citationKey nor extra; a fixed citation key cannot be stored.");
  return { ...input, citationKey: key, fields };
}
