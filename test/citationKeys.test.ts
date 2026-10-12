import assert from "node:assert/strict";
import { test } from "node:test";
import { pinnedCitationKeyExtra, projectCitationKey, reserveCitationKey, validateCitationKey } from "../src/biblatex/keys";
import { parseProjectConfig } from "../src/config/project";
import { insertPreparedCitation } from "../src/biblatex/citations";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";

const config: ProjectConfig = { version: 1, library: { type: "user", id: 0 }, collectionKey: "", bibFile: "refs.bib",
  citationStyle: "apa", citationCommand: "parencite", importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Mueller2024Methoden" } };

test("Gespeicherte Zitier-Schlüssel werden beim Zitieren verwendet; alte Konfigurationen behalten ihre bisherigen Schlüssel", async () => {
  assert.equal(projectCitationKey(config, "ITEM0001"), "Mueller2024Methoden");
  const { citationKeys: _old, ...legacy } = config;
  assert.equal(projectCitationKey(legacy, "ITEM0001"), "zotero-user-0-ITEM0001");
  const item: ZoteroItem = { library: config.library!, key: "ITEM0001", itemType: "book", title: "Neuer Titel", creators: [], date: "2025", doi: "", url: "" };
  let inserted = "";
  await insertPreparedCitation([item], { isCurrent: () => true, insert: async (text) => { inserted = text; return true; } }, async () => config, { postnote: "12" });
  assert.equal(inserted, "\\parencite[p. 12]{Mueller2024Methoden}");
});

test("Schlüsselzuordnungen bleiben beim Lesen erhalten; verwaiste, doppelte und unsichere Schlüssel werden abgewiesen", () => {
  assert.deepEqual(parseProjectConfig(config), config);
  for (const invalid of [{ ...config, citationKeys: { MISSING1: "Orphan" } },
    { ...config, importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "same", ITEM0002: "same" } },
    { ...config, citationKeys: { ITEM0001: "x}\\input{file}" } }]) assert.throws(() => parseProjectConfig(invalid));
  assert.equal(validateCitationKey("Müller2024Methoden"), "Müller2024Methoden");
});

test("Kollisionen mit manuellen Einträgen oder anderen Projektquellen werden vor dem Schreiben erkannt", () => {
  const mapping = { ITEM0001: "Mueller2024Methoden" };
  assert.throws(() => reserveCitationKey(mapping, "ITEM0002", "Mueller2024Methoden", new Set()), /already in use/);
  assert.throws(() => reserveCitationKey(mapping, "ITEM0002", "Manual2024", new Set(["Manual2024"])), /already in use/);
  assert.deepEqual(mapping, { ITEM0001: "Mueller2024Methoden" });
});

test("Zurückschreiben ergänzt ausschließlich Citation Key und erhält andere Extra-Felder; andere manuelle Keys werden nicht überschrieben", () => {
  assert.equal(pinnedCitationKeyExtra("DOI: 10.1234/example\nEine Notiz", "Mueller2024Methoden"), "DOI: 10.1234/example\nEine Notiz\nCitation Key: Mueller2024Methoden");
  const pinned = "DOI: 10.1234/example\nCitation Key: Mueller2024Methoden";
  assert.equal(pinnedCitationKeyExtra(pinned, "Mueller2024Methoden"), pinned);
  assert.throws(() => pinnedCitationKeyExtra(pinned, "Other2025"), /not overwritten/);
});
