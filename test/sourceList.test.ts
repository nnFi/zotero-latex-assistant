import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { sourceListHtml } from "../src/views/sourceListHtml";
import { selectedImportKeys } from "../src/biblatex/selection";
import type { ProjectConfig, ZoteroItem } from "../src/shared/types";

const library = { type: "user" as const, id: 0 };
const source = (key: string, title: string): ZoteroItem => ({ library, key, title, itemType: "book",
  creators: [{ creatorType: "author", firstName: "Anna", lastName: "Müller", name: "" }], date: "2024", doi: "", url: "" });
const config: ProjectConfig = { version: 1, library, collectionKey: "ROOT0001", bibFile: "literatur.bib",
  citationStyle: "apa", citationCommand: "autocite", importedItemKeys: ["IMPORTED"] };

test("Quellenliste enthält Checkboxen und einen Zotero-Knopf pro Zeile, keine Detailformulare", () => {
  const html = sourceListHtml("Quellen", [source("ITEM0001", "Titel A"), source("ITEM0002", "Titel B")], ["ITEM0001"], "project");
  assert.equal((html.match(/class="pick"/g) ?? []).length, 2);
  assert.equal((html.match(/data-action="open">Open in Zotero/g) ?? []).length, 2);
  assert.match(html, /<th>Title<\/th><th>Creators<\/th><th>Item type<\/th>/);
  assert.match(html, /In project \.bib<\/span>/);
  assert.match(html, /data-key="ITEM0001" data-in-bib="true"[\s\S]*?class="pick"[^>]*checked/);
  assert.match(html, /data-key="ITEM0002" data-in-bib="false"[^]*?class="pick"[^>]*>/);
  assert.equal((html.match(/class="pick"[^>]*\bchecked\b/g) ?? []).length, 1);
  assert.match(html, /Anna Müller/);
  assert.doesNotMatch(html, /<form|Edit metadata|data-action="details"/);
  assert.ok(html.indexOf('id="import"') < html.indexOf("<table"));
  assert.ok(html.indexOf('id="doi"') < html.indexOf("<table"));
  assert.ok(html.indexOf('id="refresh"') < html.indexOf("<table"));
  assert.match(html, /Refresh list/);
  assert.equal((html.match(/data-action="cite"/g) ?? []).length, 2);
});

test("Listenansichten schützen Quellendaten und den gespeicherten Auswahlkontext gegen HTML-Injektion", () => {
  const hostile = '</script><script>alert("evil")</script>';
  const html = sourceListHtml(hostile, [source("ITEM0001", hostile)], [], hostile);
  assert.ok(!html.includes(hostile));
  assert.match(html, /default-src 'none'/);
  assert.equal((html.match(/<script /g) ?? []).length, 1);
});

test("Notizen und Anhänge bleiben sichtbar, sind aber nicht für BibLaTeX auswählbar", () => {
  const html = sourceListHtml("Liste", [{ ...source("ITEM0001", "Notiz"), itemType: "note" }], [], "project");
  assert.match(html, /class="pick"[^>]+disabled/);
  assert.match(html, /Open in Zotero/);
  assert.match(html, /data-action="cite"[^>]*disabled data-unavailable="true"/);
});

test("Eine Mehrfachauswahl ergänzt den vorhandenen Importbestand und beseitigt doppelte Häkchen", () => {
  const first = source("ITEM0001", "A");
  const second = source("ITEM0002", "B");
  assert.deepEqual(selectedImportKeys(config, [first, second], [first, second, first]), ["IMPORTED", "ITEM0001", "ITEM0002"]);
  assert.deepEqual(config.importedItemKeys, ["IMPORTED"]);
});

test("Fremde Bibliotheken, nicht vorhandene Quellen und Anhänge brechen die gesamte Auswahl ab", () => {
  const first = source("ITEM0001", "A");
  const foreign = { ...source("ITEM0002", "B"), library: { type: "group" as const, id: 42 } };
  const attachment = { ...source("ITEM0003", "C"), itemType: "attachment" };
  for (const invalid of [foreign, source("MISSING1", "Fehlt"), attachment]) {
    assert.throws(() => selectedImportKeys(config, [first, foreign, attachment], [first, invalid]), /selected source/);
    assert.deepEqual(config.importedItemKeys, ["IMPORTED"]);
  }
});

test("Bereits importierte Quellen dürfen außerhalb der neuen Sammlung weiter ausgewählt werden", () => {
  const existing = source("ITEM0001", "Existing source from the previous collection");
  const added = source("ITEM0002", "Source from the new collection");
  const tracked = { ...config, importedItemKeys: [existing.key] };
  assert.deepEqual(selectedImportKeys(tracked, [added], [existing, added]), [existing.key, added.key]);
  assert.throws(() => selectedImportKeys(tracked, [added], [source("ITEM0003", "Unimported source outside the new collection")]), /selected source/);
  assert.throws(() => selectedImportKeys(tracked, [added], [{ ...existing, library: { type: "group", id: 42 } }]), /selected source/);
});

test("Checkboxen, Filter, Sammelimport und Auswahl nach Neuladen arbeiten zusammen", () => {
  type Handler = (event: unknown) => void;
  class Element {
    value = "";
    checked = false;
    disabled = false;
    hidden = false;
    indeterminate = false;
    textContent = "";
    dataset: Record<string, string> = {};
    readonly listeners = new Map<string, Handler>();
    addEventListener(type: string, handler: Handler): void { this.listeners.set(type, handler); }
    querySelector(_selector: string): Element { throw new Error("Kein Kind vorhanden"); }
  }
  function render(saved?: unknown, present: readonly string[] = [], stateId = "scope") {
    const nodes = Object.fromEntries(["list-header", "search", "all", "import", "doi", "refresh", "selection", "empty", "status"].map((id) => [id, new Element()]));
    nodes["list-header"]!.dataset.stateId = stateId;
    const picks = [new Element(), new Element(), new Element()];
    picks[2]!.disabled = true;
    const rows = picks.map((pick, index) => {
      const row = new Element();
      row.dataset = { key: ["ITEM0001", "ITEM0002", "ITEM0003"][index]!, search: ["alpha", "beta", "notiz"][index]! };
      row.dataset.inBib = String(present.includes(row.dataset.key!));
      pick.checked = present.includes(row.dataset.key!) && !pick.disabled;
      row.querySelector = () => pick;
      return row;
    });
    const tbody = new Element();
    const messages: unknown[] = [];
    let state: unknown;
    let receive: Handler | undefined;
    const html = sourceListHtml("Liste", [], [], stateId);
    const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
    runInNewContext(script, {
      document: {
        getElementById: (id: string) => nodes[id],
        querySelector: () => tbody,
        querySelectorAll: (selector: string) => selector === "tbody tr" ? rows : selector === "button" ? [nodes.import, nodes.doi, nodes.refresh]
          : picks.filter((pick) => !pick.dataset.unavailable),
      },
      window: { addEventListener: (_type: string, handler: Handler) => { receive = handler; } },
      acquireVsCodeApi: () => ({ getState: () => saved, setState: (value: unknown) => { state = value; }, postMessage: (value: unknown) => messages.push(value) }),
    });
    return { nodes, picks, rows, messages, state: () => JSON.parse(JSON.stringify(state)), receive: (message: unknown) => receive?.(message),
      clickRowAction: (action: string, row: number) => {
        const button = { disabled: false, dataset: { action }, closest: () => rows[row] };
        tbody.listeners.get("click")!({ target: { closest: () => button } });
      } };
  }
  const first = render();
  assert.equal(first.nodes.import!.disabled, false);
  first.picks[0]!.checked = true;
  first.picks[0]!.listeners.get("change")!({});
  assert.equal(first.nodes.import!.disabled, false);
  first.nodes.search!.value = "beta";
  first.nodes.search!.listeners.get("input")!({});
  assert.equal(first.rows[0]!.hidden, true);
  first.nodes.all!.checked = true;
  first.nodes.all!.listeners.get("change")!({});
  assert.deepEqual(first.state().selected, ["ITEM0001", "ITEM0002"]);
  first.nodes.import!.listeners.get("click")!({});
  assert.deepEqual(JSON.parse(JSON.stringify(first.messages[0])), { type: "synchronize", keys: ["ITEM0001", "ITEM0002"] });
  first.receive({ data: { type: "error", message: "Export fehlgeschlagen" } });
  first.receive({ data: { type: "complete" } });
  assert.equal(first.nodes.import!.disabled, false);
  assert.equal(first.nodes.status!.textContent, "Export fehlgeschlagen");
  assert.equal(first.picks[2]!.disabled, true);
  const refreshed = render(first.state());
  assert.equal(refreshed.nodes.search!.value, "beta");
  assert.equal(refreshed.picks[0]!.checked, true);
  assert.equal(refreshed.picks[1]!.checked, true);
  assert.equal(refreshed.picks[2]!.checked, false);
  refreshed.nodes.refresh!.listeners.get("click")!({});
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.messages[0])), { type: "refresh" });
  refreshed.receive({ data: { type: "error", message: "Erneut versuchen" } });
  refreshed.clickRowAction("cite", 0);
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.messages[1])), { type: "cite", key: "ITEM0001" });
  assert.equal(refreshed.nodes.status!.textContent, "Inserting citation …");
  assert.equal(refreshed.nodes.import!.disabled, true);
  const selectionBeforeCancel = refreshed.state();
  refreshed.receive({ data: { type: "complete" } });
  assert.equal(refreshed.nodes.import!.disabled, false);
  assert.equal(refreshed.nodes.refresh!.disabled, false);
  assert.equal(refreshed.nodes.search!.disabled, false);
  assert.equal(refreshed.picks[2]!.disabled, true);
  assert.equal(refreshed.nodes.status!.textContent, "");
  assert.deepEqual(refreshed.state(), selectionBeforeCancel, "Cancellation preserves the filter and pending selections");
  refreshed.nodes.refresh!.listeners.get("click")!({});
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.messages[2])), { type: "refresh" });
  const inBib = render({ id: "scope", selected: [], present: [] }, ["ITEM0001"]);
  assert.equal(inBib.picks[0]!.checked, true, "A saved empty selection must not hide existing .bib entries");
  inBib.picks[0]!.checked = false;
  inBib.picks[0]!.listeners.get("change")!({});
  assert.equal(render(inBib.state(), ["ITEM0001"]).picks[0]!.checked, false, "Pending removals survive refresh while the file is unchanged");
  inBib.picks[1]!.checked = true;
  inBib.picks[1]!.listeners.get("change")!({});
  const deleted = render(inBib.state());
  assert.equal(deleted.picks[0]!.checked, false, "A deleted .bib entry must lose its automatic check");
  assert.equal(deleted.picks[1]!.checked, true, "Manual selections for new sources survive a refresh");
  const added = render(deleted.state(), ["ITEM0001", "ITEM0002"]);
  assert.equal(added.picks[0]!.checked, true);
  assert.equal(added.picks[1]!.checked, true);
  const otherDatabase = render(first.state(), [], "scope:database-B");
  assert.equal(otherDatabase.nodes.search!.value, "", "A new database does not inherit the previous filter");
  assert.equal(otherDatabase.picks[0]!.checked, false, "Matching item keys do not carry pending selections between databases");
  assert.equal(otherDatabase.picks[1]!.checked, false);
});
