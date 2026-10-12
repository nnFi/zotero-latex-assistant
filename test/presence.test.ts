import assert from "node:assert/strict";
import { test } from "node:test";
import { bibliographyPresence, resolveBibliographyPresence } from "../src/biblatex/presence";
import { parseItem } from "../src/zotero/items";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";

const library = { type: "user" as const, id: 0 };
const item = (key: string): ZoteroItem => ({ library, key, itemType: "book", title: "Same title", creators: [], date: "2024", doi: "", url: "" });
const config: ProjectConfig = { version: 1, library, collectionKey: "", bibFile: "refs.bib", citationStyle: "numeric",
  citationCommand: "autocite", importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "Mueller2024", ITEM0002: "Deleted2024" } };

test("Actual bibliography keys mark existing sources; stale imported sources remain unmarked", () => {
  const presence = bibliographyPresence(config, [item("ITEM0001"), item("ITEM0002")], "@book{Mueller2024,title={Different title}}\n");
  assert.deepEqual(presence, { itemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Mueller2024" } });
  assert.deepEqual(bibliographyPresence(config, [item("ITEM0001")], "").itemKeys, []);
});

test("Legacy, pinned and Better BibTeX keys recognize sources absent from the import list", () => {
  const items = [item("ITEM0003"), { ...item("ITEM0004"), citationKey: "Pinned2024" }, item("ITEM0005")];
  const text = "@book{zotero-user-0-ITEM0003,title={Legacy}}\n@article{Pinned2024,title={Pinned}}\n@book{BBT2024,title={BBT}}";
  assert.deepEqual(bibliographyPresence(config, items, text, { ITEM0005: "BBT2024" }).itemKeys, ["ITEM0003", "ITEM0004", "ITEM0005"]);
});

test("A changed Zotero key never overrides the persisted project key", () => {
  const source = { ...item("ITEM0001"), citationKey: "Changed2025" };
  assert.deepEqual(bibliographyPresence(config, [source], "@book{Changed2025,title={Changed}}", { ITEM0001: "Changed2025" }).itemKeys, []);
  assert.deepEqual(bibliographyPresence(config, [source], "@book{Mueller2024,title={Original}}", { ITEM0001: "Changed2025" }).itemKeys, ["ITEM0001"]);
});

test("Foreign libraries, notes, identical titles and ambiguous keys cannot produce false markers", () => {
  const items = [{ ...item("ITEM0001"), library: { type: "group" as const, id: 42 } },
    { ...item("ITEM0002"), itemType: "note" }, item("ITEM0003"),
    { ...item("ITEM0004"), citationKey: "Duplicate" }, { ...item("ITEM0005"), citationKey: "Duplicate" }];
  const text = "@book{Mueller2024,title={Same title}}\n@book{Deleted2024,title={Note}}\n@book{Duplicate,title={Same title}}";
  assert.deepEqual(bibliographyPresence(config, items, text).itemKeys, []);
});

test("Damaged bibliography reports an error instead of using the saved import list", () => {
  assert.throws(() => bibliographyPresence(config, [item("ITEM0001")], "@book{Mueller2024,title={Incomplete}"), /Incomplete/);
});

test("Resolving external keys preserves project mappings, offline sources and ambiguous-key protection", async () => {
  const attemptedKeys = new Set<string>();
  const sources = [
    { ...item("ITEM0001"), citationKey: "Changed2025" },
    { ...item("ITEM0003"), citationKey: "Pinned2024" },
    item("ITEM0004"), item("ITEM0005"), item("ITEM0006"),
    { ...item("ITEM0007"), itemType: "note" },
    { ...item("ITEM0008"), library: { type: "group" as const, id: 42 } },
  ];
  const bibliography = ["Mueller2024", "Deleted2024", "Pinned2024", "External2024", "Ambiguous2024"]
    .map((key) => `@book{${key},title={Source}}`).join("\n");
  const lookedUp: string[][] = [];
  const lookup = async (keys: readonly string[]) => {
    lookedUp.push([...keys]);
    return { ITEM0004: "External2024", ITEM0005: "Ambiguous2024", ITEM0006: "Ambiguous2024" };
  };
  const result = await resolveBibliographyPresence(config, sources, bibliography, { attemptedKeys, lookup });
  assert.deepEqual(lookedUp, [["ITEM0004", "ITEM0005", "ITEM0006"]]);
  assert.deepEqual(result.citationKeys, {
    ITEM0001: "Mueller2024", ITEM0002: "Deleted2024", ITEM0003: "Pinned2024", ITEM0004: "External2024",
  });
  const repeated = await resolveBibliographyPresence(config, sources, bibliography,
    { attemptedKeys, lookup, resolvedKeys: result.resolvedKeys });
  assert.deepEqual(repeated, result);
  assert.equal(lookedUp.length, 1);
});

test("Large groups sharing a citation key remain ambiguous without hiding unique sources", () => {
  const sources = Array.from({ length: 5000 }, (_, index) => ({
    ...item(String(index).padStart(8, "0")), citationKey: "SharedKey",
  }));
  sources.push({ ...item("UNIQUE01"), citationKey: "UniqueKey" });
  const presence = bibliographyPresence({ ...config, importedItemKeys: [], citationKeys: {} }, sources,
    "@book{SharedKey,title={Ambiguous}}\n@book{UniqueKey,title={Unique}}");
  assert.deepEqual(presence, { itemKeys: ["UNIQUE01"], citationKeys: { UNIQUE01: "UniqueKey" } });
});

test("Pinned citation keys are read from Extra without rejecting unrelated or malformed metadata", () => {
  const raw = { key: "ITEM0001", data: { itemType: "book", extra: "DOI: 10.1234/example\nCitation Key: Mueller2024" } };
  assert.equal(parseItem(raw, library).citationKey, "Mueller2024");
  for (const extra of ["Citation Key: bad key", "Citation Key: One\nCitation Key: Two", "Other: information"]) {
    assert.equal(parseItem({ ...raw, data: { ...raw.data, extra } }, library).citationKey, undefined);
  }
});
