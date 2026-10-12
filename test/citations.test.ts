import assert from "node:assert/strict";
import { test } from "node:test";
import { citationText, insertPreparedCitation } from "../src/biblatex/citations";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";

const library = { type: "user" as const, id: 0 };
const item: ZoteroItem = { library, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };
const config: ProjectConfig = { version: 1, library, collectionKey: "ROOT0001", bibFile: "references.bib",
  citationStyle: "apa", citationCommand: "autocite", importedItemKeys: [item.key] };

test("Alle drei Zitierbefehle verwenden dieselben stabilen Schlüssel wie der Bib-Export", () => {
  for (const command of ["autocite", "parencite", "textcite"] as const) {
    assert.equal(citationText(command, library, [item.key]), `\\${command}{zotero-user-0-ITEM0001}`);
  }
  assert.equal(citationText("textcite", { type: "group", id: 42 }, ["ITEM0001", "ITEM0002", "ITEM0001"]),
    "\\textcite{zotero-group-42-ITEM0001,zotero-group-42-ITEM0002}");
});

test("Ungültige Schlüssel und Befehle können keine zusätzlichen TeX-Anweisungen einschleusen", () => {
  assert.throws(() => citationText("autocite", library, ["KEY}\\input{file}"]));
  assert.throws(() => citationText("input" as "autocite", library, [item.key]));
  assert.throws(() => citationText("autocite", library, []));
});

test("Importvorbereitung wird vollständig abgeschlossen, bevor die ausgewählte Zitation eingefügt wird", async () => {
  const actions: string[] = [];
  const result = await insertPreparedCitation([item], { isCurrent: () => true, insert: async (text) => {
    actions.push(text); return true;
  } }, async () => { actions.push("Quelle importieren"); return { ...config, citationCommand: "parencite" }; });
  assert.deepEqual(actions, ["Quelle importieren", "\\parencite{zotero-user-0-ITEM0001}"]);
  assert.equal(result, actions[1]);
});

test("Importfehler fügen keinen unbelegten Zitationsschlüssel in das Dokument ein", async () => {
  let inserted = false;
  await assert.rejects(insertPreparedCitation([item], { isCurrent: () => true, insert: async () => { inserted = true; return true; } },
    async () => { throw new Error("Bib import failed"); }), /Bib import failed/);
  assert.equal(inserted, false);
});

test("Ein geschlossenes oder während des Imports geändertes Zieldokument wird nicht bearbeitet", async () => {
  let prepared = false; let inserted = false;
  const prepare = async () => { prepared = true; return config; };
  await assert.rejects(insertPreparedCitation([item], { isCurrent: () => false, insert: async () => true }, prepare), /closed/);
  assert.equal(prepared, false);
  let current = true;
  await assert.rejects(insertPreparedCitation([item], { isCurrent: () => current, insert: async () => { inserted = true; return true; } },
    async () => { current = false; return config; }), /has changed/);
  assert.equal(inserted, false);
});

test("Notizen, Anhänge und Quellen einer fremden Bibliothek werden nicht zitiert", async () => {
  for (const itemType of ["attachment", "note", "annotation"]) {
    await assert.rejects(insertPreparedCitation([{ ...item, itemType }], { isCurrent: () => true, insert: async () => true }, async () => config), /bibliographic sources/);
  }
  await assert.rejects(insertPreparedCitation([{ ...item, library: { type: "group", id: 42 } }], { isCurrent: () => true, insert: async () => true }, async () => config), /LaTeX project library/);
});

test("Fehlende Projekteinstellungen und abgewiesene Editoränderungen ergeben eine klare Fehlermeldung", async () => {
  const target = { isCurrent: () => true, insert: async () => false };
  await assert.rejects(insertPreparedCitation([item], target, async () => ({ ...config, bibFile: "" })), /Bib|bib/);
  await assert.rejects(insertPreparedCitation([item], target, async () => config), /could not be inserted/);
});

test("Seitenzahl, Seitenbereich und Zusatz werden als passende optionale BibLaTeX-Argumente eingefügt", () => {
  assert.equal(citationText("parencite", library, [item.key], { postnote: "14–16", prenote: "vgl." }),
    "\\parencite[vgl.][14–16]{zotero-user-0-ITEM0001}");
  assert.equal(citationText("textcite", library, [item.key], { postnote: "42" }),
    "\\textcite[42]{zotero-user-0-ITEM0001}");
  assert.equal(citationText("autocite", library, [item.key], { prenote: "siehe" }),
    "\\autocite[siehe][]{zotero-user-0-ITEM0001}");
  assert.equal(citationText("autocite", library, [item.key], { postnote: " ", prenote: "" }),
    "\\autocite{zotero-user-0-ITEM0001}");
});

test("Freie Fundstellen werden als Text eingefügt und können keine Argumentgrenzen oder TeX-Anweisungen einschleusen", () => {
  assert.equal(citationText("parencite", library, [item.key], { postnote: "Kap. 3 & 4" }),
    "\\parencite[Kap. 3 \\& 4]{zotero-user-0-ITEM0001}");
  const result = citationText("autocite", library, [item.key], { postnote: "]\\input{secret}%" });
  assert.equal(result, "\\autocite[{]}\\textbackslash{}input\\{secret\\}\\%]{zotero-user-0-ITEM0001}");
});
