import assert from "node:assert/strict";
import { test } from "node:test";
import { bibEntries, mergeBibliography, rekeyExport, synchronizeBibliography } from "../src/biblatex/importer";
import { citationKey, exportProjectItems } from "../src/biblatex/exporter";
import { ZoteroClient } from "../src/zotero/client";
import { bibliographyRecords } from "../src/biblatex/fields";

test("Native Zotero-Exporte bekommen stabile und zwischen Bibliotheken eindeutige Schlüssel", async () => {
  const client = new ZoteroClient({ fetch: async (input) => {
    assert.equal(new URL(String(input)).pathname, "/api/groups/42/items/ITEM0001");
    assert.equal(new URL(String(input)).searchParams.get("format"), "biblatex");
    return new Response('@book{mueller_old,\n title = {Ein {Buch}},\n author = {Müller, Anna},\n date = {2024}\n}');
  } });
  const exports = await exportProjectItems(client, { type: "group", id: 42 }, ["ITEM0001"]);
  assert.equal(bibEntries(exports[0]!)[0]?.key, "zotero-group-42-ITEM0001");
  assert.notEqual(citationKey({ type: "group", id: 42 }, "ITEM0001"), citationKey({ type: "user", id: 0 }, "ITEM0001"));
});

test("Bestehende Einträge und Kommentare bleiben beim Import und bei Folgeaktualisierungen erhalten", () => {
  const existing = '% Eigene Quellen\n@book{manual, title={Bleibt erhalten}}\n';
  const first = mergeBibliography(existing, ['@article{zotero-user-0-ITEM0001, title={Alt}}']);
  const next = mergeBibliography(first, ['@article{zotero-user-0-ITEM0001, title={Neu}}']);
  assert.ok(next.startsWith(existing));
  assert.match(next, /title=\{Neu\}/);
  assert.doesNotMatch(next, /title=\{Alt\}/);
  assert.equal(bibEntries(next).length, 2);
  assert.equal(mergeBibliography(next, ['@article{zotero-user-0-ITEM0001, title={Neu}}']), next);
});

test("Manuelle Änderungen am verwalteten Bereich werden nicht überschrieben", () => {
  const first = mergeBibliography("", ["@book{managed, title={Export}}"]);
  assert.throws(() => mergeBibliography(first.replace("Export", "Handarbeit"), ["@book{managed, title={Neu}}"]), /changed manually/);
  assert.throws(() => mergeBibliography(first + first, []), /damaged/);
  const outside = first + "\n@book{extra, title={Handarbeit außerhalb}}\n";
  assert.match(mergeBibliography(outside, ["@book{managed, title={Neu}}"]), /Handarbeit außerhalb/);
});

test("Kollisionen und beschädigte Bib-Dateien brechen einen Import ohne Teilergebnis ab", () => {
  assert.throws(() => mergeBibliography('@book{same,title={Manual}}', ['@book{same,title={Export}}']), /already exists/);
  for (const broken of ['@book{missing,title={oops}', '@book{,title={oops}}', '@book{key,title="oops}', '@book{key,title={x}}\n@book{key,title={y}}']) {
    assert.throws(() => mergeBibliography(broken, ['@book{new,title={OK}}']));
  }
  assert.throws(() => rekeyExport('@book{a,title={x}}\n@book{b,title={y}}', "new"), /unambiguous/);
  assert.throws(() => rekeyExport("", "new"), /unambiguous/);
});

test("Zitate, geschachtelte TeX-Felder, Kommentare und Klammernotation verfälschen die Schlüsselerkennung nicht", () => {
  const text = '% @book{fake,title={}}\n@string{pub="Publisher"}\n@preamble{"ignored"}\n@comment{Not a reference}\n@book(real, title={Text {with braces} and \\{escaped\\}}, author="Anna", url={https://example.org/\\%20})';
  assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["real"]);
  assert.equal(bibEntries(rekeyExport(text, "stable"))[0]?.key, "stable");
});

test("Percent signs in braced and quoted values survive parsing, rekeying and synchronization", () => {
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    const exported = `@online${open}provider,\n url={https://example.org/a%20b},\n title={100% {certainty}},\n note="A {\"quoted\"} value with 50% certainty"\n${close}`;
    const keyed = rekeyExport(exported, "stable");
    assert.equal(keyed, exported.replace("provider,", "stable,"));
    const merged = synchronizeBibliography("% @book{fake,title={ignored}}\n", [keyed], new Set());
    assert.deepEqual(bibEntries(merged).map((entry) => entry.key), ["stable"]);
    const fields = bibliographyRecords(merged)[0]!.fields;
    assert.equal(fields.get("url")?.value, "https://example.org/a%20b");
    assert.equal(fields.get("title")?.value, "100% {certainty}");
    assert.equal(fields.get("note")?.value, 'A {"quoted"} value with 50% certainty');
    assert.equal(synchronizeBibliography(merged, [keyed], new Set(["stable"])), merged);
  }
});

test("Percent-encoded string values resolve without consuming field comments or entry boundaries", () => {
  const text = '@string{base={https://example.org/a%20b}}\n@online{first,\n % ignored } @book{fake,title={}}\n url=base # "?q=50%", title={100% certainty}}\n@book{second,title={Keep}}';
  assert.deepEqual(bibEntries(text).map((entry) => entry.key), ["first", "second"]);
  assert.equal(bibliographyRecords(text)[0]!.fields.get("url")?.value, "https://example.org/a%20b?q=50%");
  assert.throws(() => bibEntries('@book{broken,title={100% certainty}'), /Incomplete/);
});

test("Ein Fehler im zweiten Export liefert keinen unvollständigen Bib-Bestand", async () => {
  const client = new ZoteroClient({ fetch: async (input) => new URL(String(input)).pathname.endsWith("ITEM0001")
    ? new Response("@book{a,title={A}}") : new Response("", { status: 500 }) });
  await assert.rejects(exportProjectItems(client, { type: "user", id: 0 }, ["ITEM0001", "ITEM0002"]));
});

test("Selection synchronization removes identified external and managed entries while preserving unrelated content", () => {
  const old = mergeBibliography('% Comment\n@string{pub="Publisher"}\n@book(external,title={Remove {nested} content})\n@book{unrelated,title={Keep}}\n',
    ['@article{managed,title={Remove}}', '@book{unknown,title={Unrelated managed source}}']);
  const selected = ['@book{new,title={Added}}'];
  const updated = synchronizeBibliography(old, selected, new Set(["external", "managed"]));
  assert.deepEqual(bibEntries(updated).map((entry) => entry.key), ["unrelated", "unknown", "new"]);
  assert.match(updated, /@string\{pub="Publisher"\}/);
  assert.match(updated, /% Comment/);
  const again = synchronizeBibliography(updated, selected, new Set(["new"]));
  assert.equal(synchronizeBibliography(again, selected, new Set(["new"])), again, "Repeated updates must not accumulate blank lines");
});

test("Exported crossrefs follow persistent project keys instead of the provider's current keys", async () => {
  const client = new ZoteroClient({ fetch: async (input) => new URL(String(input)).pathname.endsWith("ITEM0001")
    ? new Response("@book{ProviderParent,title={Parent}}") : new Response("@inbook{ProviderChild,title={Chapter},crossref={ProviderParent}}") });
  const exported = await exportProjectItems(client, { type: "user", id: 0 }, ["ITEM0001", "ITEM0002"], { ITEM0001: "MigratedParent", ITEM0002: "MigratedChild" });
  assert.match(exported[1]!, /@inbook\{MigratedChild,title=\{Chapter\},crossref=\{MigratedParent\}/);
});
