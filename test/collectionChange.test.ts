import assert from "node:assert/strict";
import { test } from "node:test";
import { newProjectConfig, withProjectLibrary } from "../src/config/project";
import { planCollectionChange } from "../src/biblatex/collectionChange";
import { bibEntries, mergeBibliography } from "../src/biblatex/importer";
import type { ZoteroItem } from "../src/shared/types";

const library = { type: "user" as const, id: 0 };
const config = { ...newProjectConfig(), library, collectionKey: "OLDCOL01", bibFile: "refs.bib",
  importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "Removed", ITEM0002: "Shared" } };
const selected = withProjectLibrary(config, library, "NEWCOL01");
const item = (key: string): ZoteroItem => ({ library, key, title: key, itemType: "book", date: "", creators: [], doi: "", url: "" });

test("collection switch retains the intersection, stable project keys and manually edited metadata", () => {
  const bibliography = mergeBibliography("% Keep comment\n@string{pub={Press}}\n", ["@book{Removed,title={Old}}", "@book{Shared,title={Custom title},publisher=pub,crossref={Removed}}"]);
  const plan = planCollectionChange(config, selected, [item("ITEM0002"), item("ITEM0003")],
    { itemKeys: config.importedItemKeys, citationKeys: config.citationKeys }, [{ path: "refs.bib", text: bibliography }],
    [{ path: "main.tex", text: 'Text \\parencite[see][14]{Removed,Shared}. \\autocite{Removed}' }]);
  assert.deepEqual(plan.config.importedItemKeys, ["ITEM0002"]);
  assert.deepEqual(plan.config.citationKeys, { ITEM0002: "Shared" });
  assert.equal(plan.config.collectionKey, "NEWCOL01");
  const text = plan.changes.find((change) => change.path === "refs.bib")!.text;
  assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["Shared"]);
  assert.match(text, /Custom title/); assert.match(text, /publisher=pub/); assert.match(text, /crossref=\{\}/);
  assert.match(text, /@string\{pub/);
  assert.equal(plan.changes.find((change) => change.path === "main.tex")!.text, 'Text \\parencite[see][14]{Shared}. ');
});

test("an empty or disjoint newly selected collection clears every old bibliography record and its citations", () => {
  const bibliography = '@book{Removed,title={Old}}\n@book{Shared,title={Old}}\n@article{OldExternal,title={Old external import}}';
  const plan = planCollectionChange(config, selected, [], { itemKeys: [], citationKeys: {} },
    [{ path: "refs.bib", text: bibliography }], [{ path: "main.tex", text: '\\autocite{Removed} \\cite{OldExternal} \\cite{Elsewhere}' }]);
  assert.equal(plan.bibliographyCount, 3);
  assert.deepEqual(bibEntries(plan.changes.find((change) => change.path === "refs.bib")!.text), []);
  assert.deepEqual(plan.config.importedItemKeys, []); assert.deepEqual(plan.config.citationKeys, {});
  assert.equal(plan.changes.find((change) => change.path === "main.tex")!.text, '  \\cite{Elsewhere}');
});

test("already present sources resolved in the new collection are retained without automatically importing new sources", () => {
  const plan = planCollectionChange(config, selected, [item("ITEM0003"), item("ITEM0004")],
    { itemKeys: ["ITEM0003"], citationKeys: { ITEM0003: "Recognized" } },
    [{ path: "refs.bib", text: '@book{Recognized,title={Keep}}\n@book{Unmatched,title={Outside}}' }], []);
  assert.deepEqual(plan.config.importedItemKeys, ["ITEM0003"]);
  assert.deepEqual(plan.config.citationKeys, { ITEM0003: "Recognized" });
  assert.deepEqual(bibEntries(plan.changes.find((change) => change.path === "refs.bib")!.text).map((entry) => entry.key), ["Recognized"]);
});

test("collection pruning cleans references in other bibliographies without deleting their own entries", () => {
  const plan = planCollectionChange(config, selected, [], { itemKeys: [], citationKeys: {} },
    [{ path: "refs.bib", text: '@book{Removed,title={Old}}' }, { path: "other.bib", text: '@book{Independent,related={Removed,Other}}' }], []);
  const other = plan.changes.find((change) => change.path === "other.bib")!.text;
  assert.match(other, /related=\{Other\}/); assert.equal(bibEntries(other)[0]!.key, "Independent");
});

test("missing bibliography still prunes old source tracking and citations while keeping shared keys", () => {
  const plan = planCollectionChange(config, selected, [item("ITEM0002")], { itemKeys: [], citationKeys: {} }, [],
    [{ path: "main.tex", text: '\\cite{Removed,Shared}' }]);
  assert.deepEqual(plan.config.citationKeys, { ITEM0002: "Shared" });
  assert.equal(plan.changes[0]!.text, '\\cite{Shared}'); assert.equal(plan.bibliographyCount, 0);
});

test("invalid or ambiguous project files abort collection pruning before any partial plan", () => {
  const presence = { itemKeys: [], citationKeys: {} };
  assert.throws(() => planCollectionChange(config, selected, [{ ...item("ITEM0001"), library: { type: "group", id: 42 } }], presence, [], []), /different library/);
  assert.throws(() => planCollectionChange(config, selected, [], presence, [{ path: "refs.bib", text: '@book{Removed,title={broken}' }], []), /Incomplete/);
  assert.throws(() => planCollectionChange(config, selected, [], presence, [], [{ path: "main.tex", text: '\\cite{\\dynamicKey}' }]), /Dynamic/);
});
