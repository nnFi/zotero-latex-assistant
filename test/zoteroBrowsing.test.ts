import assert from "node:assert/strict";
import { test } from "node:test";
import { ZoteroClient } from "../src/zotero/client";
import { ZoteroError } from "../src/shared/errors";
import { creatorNames, itemDescription } from "../src/zotero/items";
import type { LibraryRef } from "../src/shared/types";

const library: LibraryRef = { type: "user", id: 0 };
const collection = { key: "ROOT0001", data: { name: "SeminarWiemann", parentCollection: false } };
const source = {
  key: "ITEM0001",
  data: {
    itemType: "book", title: "Forschungsmethoden", date: "2024-03-12", DOI: "10.1234/example",
    creators: [{ creatorType: "author", firstName: "Anna", lastName: "Müller" }],
  },
};

function clientReturning(value: unknown): ZoteroClient {
  return new ZoteroClient({ fetch: async () => new Response(JSON.stringify(value)) });
}

test("Sammlungen auf oberster Ebene kommen aus dem dokumentierten collections/top-Endpunkt", async () => {
  const client = new ZoteroClient({ fetch: async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/users/0/collections/top");
    assert.equal(url.searchParams.get("limit"), "100");
    return new Response(JSON.stringify([collection]));
  } });
  assert.deepEqual(await client.listCollections(library), [{
    library, key: "ROOT0001", name: "SeminarWiemann", parentKey: null,
  }]);
});

test("Untergeordnete Sammlungen bleiben der richtigen Gruppenbibliothek und Elternsammlung zugeordnet", async () => {
  const group: LibraryRef = { type: "group", id: 42 };
  const client = new ZoteroClient({ fetch: async (input) => {
    assert.equal(new URL(String(input)).pathname, "/api/groups/42/collections/ROOT0001/collections");
    return new Response(JSON.stringify([{
      key: "CHILD001", data: { name: "Unterordner", parentCollection: "ROOT0001" },
    }]));
  } });
  assert.deepEqual(await client.listCollections(group, "ROOT0001"), [{
    library: group, key: "CHILD001", name: "Unterordner", parentKey: "ROOT0001",
  }]);
});

test("Quellen werden nur aus der aufgeklappten Sammlung geladen", async () => {
  const client = new ZoteroClient({ fetch: async (input) => {
    assert.equal(new URL(String(input)).pathname, "/api/users/0/collections/ROOT0001/items/top");
    return new Response(JSON.stringify([source]));
  } });
  const items = await client.listItems(library, "ROOT0001");
  assert.equal(items[0]?.title, "Forschungsmethoden");
  assert.equal(items[0]?.doi, "10.1234/example");
  assert.equal(items[0]?.date, "2024-03-12");
  assert.equal(items[0]?.library, library);
});

test("Alle Einträge lädt den gesamten Bibliotheksbestand einschließlich Quellen ohne Sammlung", async () => {
  const client = new ZoteroClient({ fetch: async (input) => {
    assert.equal(new URL(String(input)).pathname, "/api/users/0/items/top");
    return new Response(JSON.stringify([source]));
  } });
  assert.equal((await client.listItems(library)).length, 1);
});

test("Mehr als 100 Quellen werden vollständig über mehrere Ergebnisseiten gelesen", async () => {
  const offsets: number[] = [];
  const client = new ZoteroClient({ fetch: async (input) => {
    const start = Number(new URL(String(input)).searchParams.get("start"));
    offsets.push(start);
    return new Response(JSON.stringify(Array.from({ length: start === 0 ? 100 : 1 }, (_, index) => ({
      ...source, key: (start + index).toString(36).toUpperCase().padStart(8, "0"),
    }))));
  } });
  const items = await client.listItems(library, "ROOT0001");
  assert.equal(items.length, 101);
  assert.equal(new Set(items.map((item) => item.key)).size, 101);
  assert.deepEqual(offsets, [0, 100]);
});

test("Sammlungen werden ebenfalls über alle Ergebnisseiten gelesen", async () => {
  const offsets: number[] = [];
  const client = new ZoteroClient({ fetch: async (input) => {
    const start = Number(new URL(String(input)).searchParams.get("start"));
    offsets.push(start);
    return new Response(JSON.stringify(start === 0 ? Array.from({ length: 100 }, (_, index) => ({
      ...collection, key: index.toString(36).toUpperCase().padStart(8, "0"),
    })) : []));
  } });
  assert.equal((await client.listCollections(library)).length, 100);
  assert.deepEqual(offsets, [0, 100]);
});

test("Leere Bibliotheken und Sammlungen sind gültige Ergebnisse", async () => {
  const client = clientReturning([]);
  assert.deepEqual(await client.listCollections(library), []);
  assert.deepEqual(await client.listItems(library, "ROOT0001"), []);
});

test("Fehlerhafte Sammlungsantworten werden verständlich abgewiesen", async () => {
  for (const value of [{}, [{ key: "ROOT0001", data: { name: 42 } }], [
    { key: "ROOT0001", data: { name: "Sammlung", parentCollection: "../items" } },
  ]]) {
    await assert.rejects(clientReturning(value).listCollections(library),
      (error: unknown) => error instanceof ZoteroError && error.code === "INVALID_RESPONSE");
  }
});

test("Beschädigte Quellen- und Autorenmetadaten werden nicht stillschweigend übernommen", async () => {
  for (const value of [
    [{ key: "ITEM0001", data: { title: "Ohne Typ" } }],
    [{ ...source, data: { ...source.data, creators: "kein Array" } }],
    [{ ...source, data: { ...source.data, creators: [null] } }],
    [{ ...source, data: { ...source.data, DOI: 123 } }],
  ]) {
    await assert.rejects(clientReturning(value).listItems(library),
      (error: unknown) => error instanceof ZoteroError && error.code === "INVALID_RESPONSE");
  }
});

test("Ungültige Bibliotheken und Sammlungsschlüssel erzeugen keine HTTP-Anfragen", async () => {
  let calls = 0;
  const client = new ZoteroClient({ fetch: async () => { calls++; return new Response("[]"); } });
  for (const invalid of [{ type: "group", id: 0 }, { type: "user", id: -1 }] as LibraryRef[]) {
    await assert.rejects(client.listCollections(invalid), ZoteroError);
    await assert.rejects(client.listItems(invalid), ZoteroError);
  }
  for (const key of ["../items", "", "https://example.org", "SHORT"]) {
    await assert.rejects(client.listCollections(library, key), ZoteroError);
    await assert.rejects(client.listItems(library, key), ZoteroError);
  }
  assert.equal(calls, 0);
});

test("Autoren, Körperschaften und Jahr werden aus den tatsächlichen Metadaten angezeigt", async () => {
  const [item] = await clientReturning([{ ...source, data: { ...source.data, creators: [
    { creatorType: "editor", firstName: "Max", lastName: "Schmidt" },
    { creatorType: "author", firstName: "Anna", lastName: "Müller" },
    { creatorType: "author", name: "Forschungsinstitut" },
  ] } }]).listItems(library);
  assert.ok(item);
  assert.equal(creatorNames(item), "Anna Müller, Forschungsinstitut");
  assert.equal(itemDescription(item), "Anna Müller, Forschungsinstitut · 2024");
});

test("Quellen ohne Autoren oder Datum erfinden keine Angaben; einzelne Anhänge und Notizen bleiben sichtbar", async () => {
  const items = await clientReturning([
    { key: "ITEM0001", data: { itemType: "webpage", title: "REST API" } },
    { key: "ITEM0002", data: { itemType: "attachment", filename: "Quelle.pdf" } },
    { key: "ITEM0003", data: { itemType: "note", note: "<p>Eine Notiz</p>" } },
  ]).listItems(library);
  assert.ok(items[0]);
  assert.equal(itemDescription(items[0]), "");
  assert.deepEqual(items.map((item) => item.title), ["REST API", "Quelle.pdf", "Note"]);
});
