import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";
import { bibliographyRecords } from "../src/biblatex/fields";
import { bibEntries } from "../src/biblatex/importer";
import { bibliographyItemKeys, bibliographyExportsHaveReferences, completeBibliographyUpdate, planBibliographyUpdate } from "../src/biblatex/update";

const library = { type: "user" as const, id: 0 };
const item = (key: string): ZoteroItem => ({ library, key, itemType: "book", title: key, creators: [], date: "", doi: "", url: "" });
const first = item("ITEM0001");
const second = item("ITEM0002");
const third = item("ITEM0003");
const config: ProjectConfig = { version: 1, library, collectionKey: "", bibFile: "refs.bib", citationStyle: "numeric",
  citationCommand: "autocite", importedItemKeys: [first.key, second.key], citationKeys: { ITEM0001: "StableParent", ITEM0002: "StableChild" } };
const bibliography = '@book{StableParent,title={Manual parent}}\n@inbook{StableChild,title={Manual child},crossref={StableParent}}\n';
const presence = { itemKeys: [first.key, second.key], citationKeys: config.citationKeys! };

test("Single-source imports preserve unrelated manual fields while full refreshes request new metadata", () => {
  const input = { config, bibliography, presence, items: [first, second, third], selection: [third] };
  const snapshot = JSON.stringify(input);
  const plan = planBibliographyUpdate(input);
  assert.deepEqual(plan.itemKeys, [first.key, second.key, third.key]);
  assert.deepEqual(plan.pendingItemKeys, [third.key]);
  const exports = new Map([...plan.preservedExports, [third.key, '@book{ProviderNew,title={New source}}']]);
  const result = completeBibliographyUpdate(plan, exports, { ITEM0003: "NewProjectKey" });
  assert.deepEqual(bibEntries(result.text).map((entry) => entry.key), ["StableParent", "StableChild", "NewProjectKey"]);
  assert.match(result.text, /title=\{Manual parent\}/);
  assert.match(result.text, /title=\{Manual child\},crossref=\{StableParent\}/);
  assert.equal(result.config.citationKeys?.ITEM0003, "NewProjectKey");
  assert.equal(JSON.stringify(input), snapshot, "Planning and completion must not mutate their inputs");
  const refresh = planBibliographyUpdate({ config, bibliography, presence, items: [first, second] });
  assert.deepEqual(refresh.pendingItemKeys, [first.key, second.key]);
  assert.equal(refresh.preservedExports.size, 0);
});

test("A fixed key stored by the MCP survives native exports with another generated key and later metadata refreshes", () => {
  const source = { ...third, citationKey: "mcpFixed2026" };
  const plan = planBibliographyUpdate({ config, bibliography, presence, items: [first, second, source], selection: [source] });
  const exports = new Map([...plan.preservedExports, [third.key, '@book{NativeGenerated,title={Imported source}}']]);
  const result = completeBibliographyUpdate(plan, exports, { ITEM0003: "AnotherProviderKey" });
  assert.equal(result.config.citationKeys?.ITEM0003, "mcpFixed2026");
  assert.match(result.text, /@book\{mcpFixed2026,/);
  const refresh = planBibliographyUpdate({ config: result.config, bibliography: result.text,
    presence: { itemKeys: result.config.importedItemKeys, citationKeys: result.config.citationKeys! },
    items: [first, second, { ...source, citationKey: "changedInZotero" }], selection: [source] });
  const refreshed = completeBibliographyUpdate(refresh, new Map([...refresh.preservedExports, [third.key, '@book{ChangedNative,title={Corrected source}}']]));
  assert.equal(refreshed.config.citationKeys?.ITEM0003, "mcpFixed2026");
});

test("Synchronization removes unchecked sources and references but retains sources outside the shown collection", () => {
  const tracked = { ...config, importedItemKeys: [...config.importedItemKeys, third.key],
    citationKeys: { ...config.citationKeys, ITEM0003: "OutsideCollection" } };
  const input = { config: tracked, bibliography: bibliography + '@book{OutsideCollection,title={Keep outside collection}}\n',
    presence: { itemKeys: tracked.importedItemKeys, citationKeys: tracked.citationKeys }, items: [second], selection: [second],
    synchronize: { shown: [first, second], resolvedKeys: {} } };
  const plan = planBibliographyUpdate(input);
  assert.deepEqual(plan.itemKeys, [third.key, second.key]);
  assert.deepEqual(plan.pendingItemKeys, []);
  const result = completeBibliographyUpdate(plan, plan.preservedExports);
  assert.deepEqual(result.config.importedItemKeys, [third.key, second.key]);
  assert.deepEqual([...result.removedCitationKeys], ["StableParent"]);
  assert.deepEqual(bibEntries(result.text).map((entry) => entry.key), ["OutsideCollection", "StableChild"]);
  assert.match(result.text, /crossref=\{\}/);
  assert.equal(result.config.citationKeys?.ITEM0001, undefined);
});

test("New provider references resolve to persistent keys of preserved project sources", () => {
  const parentOnly = { ...config, importedItemKeys: [first.key], citationKeys: { ITEM0001: "StableParent" } };
  const plan = planBibliographyUpdate({ config: parentOnly, bibliography: '@book{StableParent,title={Manual parent}}',
    presence: { itemKeys: [first.key], citationKeys: parentOnly.citationKeys }, items: [first, second], selection: [second] });
  const exports = new Map([...plan.preservedExports, [second.key, '@inbook{ProviderChild,title={New child},crossref={ProviderParent}}']]);
  assert.equal(bibliographyExportsHaveReferences(plan, exports), true);
  const result = completeBibliographyUpdate(plan, exports, { ITEM0002: "NewChild" }, { ITEM0001: "ProviderParent" });
  assert.equal(bibliographyRecords(result.text).find((record) => record.key === "NewChild")?.fields.get("crossref")?.value, "StableParent");
  const ambiguous = new Map([...plan.preservedExports, [second.key, '@inbook{ProviderParent,title={New child},crossref={ProviderParent}}']]);
  assert.throws(() => completeBibliographyUpdate(plan, ambiguous, { ITEM0002: "NewChild" }, { ITEM0001: "ProviderParent" }), /ambiguous between project sources/);
});

test("Missing exports and key collisions fail without consuming a plan that can be retried", () => {
  const plan = planBibliographyUpdate({ config, bibliography: bibliography + '@book{Occupied,title={External source}}',
    presence, items: [first, second, third], selection: [third] });
  assert.throws(() => completeBibliographyUpdate(plan, plan.preservedExports), /Missing BibLaTeX export/);
  const exports = new Map([...plan.preservedExports, [third.key, '@book{ProviderNew,title={New source}}']]);
  assert.throws(() => completeBibliographyUpdate(plan, exports, { ITEM0003: "Occupied" }), /already in use/);
  assert.equal(plan.citationKeys.ITEM0003, undefined);
  const result = completeBibliographyUpdate(plan, exports, { ITEM0003: "ValidNewKey" });
  assert.equal(result.config.citationKeys?.ITEM0003, "ValidNewKey");
  assert.equal(completeBibliographyUpdate(plan, exports, { ITEM0003: "ValidNewKey" }).text, result.text);
  assert.throws(() => bibliographyItemKeys({ config, bibliography, presence, items: [first], selection: [{ ...third, library: { type: "group", id: 42 } }] }), /selected source/);
});

test("Duplicate publications are classified before any caller can commit the planned bibliography", () => {
  const parentOnly = { ...config, importedItemKeys: [first.key], citationKeys: { ITEM0001: "StableParent" } };
  const original = '@book{StableParent,title={A detailed scientific study},author={Smith, John},year=2024,doi={10.1234/same}}';
  const plan = planBibliographyUpdate({ config: parentOnly, bibliography: original,
    presence: { itemKeys: [first.key], citationKeys: parentOnly.citationKeys }, items: [first, second], selection: [second] });
  const exports = new Map([...plan.preservedExports, [second.key, '@book{New,title={Other},doi={10.1234/SAME}}']]);
  assert.throws(() => completeBibliographyUpdate(plan, exports), /Duplicate DOI/);
  exports.set(second.key, '@book{New,title={A detailed scientific study},author={John Smith},year=2024}');
  const result = completeBibliographyUpdate(plan, exports);
  assert.match(result.duplicateDetails, /StableParent ↔ New/);
  assert.match(result.duplicateDetails, /Title: A detailed scientific study/);
  assert.equal(plan.bibliography, original);
});
