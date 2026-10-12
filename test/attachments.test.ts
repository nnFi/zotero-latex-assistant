import assert from "node:assert/strict";
import { test } from "node:test";
import { ZoteroClient } from "../src/zotero/client";
import { attachmentKind, attachmentsByItem, parseAttachment } from "../src/zotero/attachments";
import { attachmentBadges } from "../src/views/attachmentBadges";
import { sourceListHtml } from "../src/views/sourceListHtml";
import type { ZoteroItem } from "../src/shared/types";

const pdf = { key: "ATTACH01", data: { itemType: "attachment", parentItem: "ITEM0001", title: "Volltext", filename: "Artikel.pdf", contentType: "application/pdf", linkMode: "imported_file" } };

test("Anhangsmetadaten kommen gesammelt aus dem gefilterten Sammlungspfad; kein Abruf je Quelle oder Datei", async () => {
  const calls: string[] = [];
  const client = new ZoteroClient({ fetch: async (input) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(url.pathname, "/api/groups/42/collections/ROOT0001/items");
    assert.equal(url.searchParams.get("itemType"), "attachment");
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("limit"), "100");
    return new Response(JSON.stringify([pdf, { key: "ATTACH02", data: { itemType: "attachment", parentItem: "ITEM0001", filename: "Abb.png", contentType: "image/png" } }]));
  } });
  const attachments = await client.listAttachmentMetadata({ type: "group", id: 42 }, "ROOT0001");
  assert.deepEqual(attachments.map((attachment) => attachment.kind), ["pdf", "image"]);
  assert.equal(attachmentsByItem(attachments).get("ITEM0001")?.length, 2);
  assert.equal(calls.length, 1);
});

test("Anhangslisten werden paginiert und eigenständige Anhänge ihrer eigenen Tabellenzeile zugeordnet", async () => {
  const offsets: number[] = [];
  const client = new ZoteroClient({ fetch: async (input) => {
    const url = new URL(String(input)); assert.equal(url.pathname, "/api/users/0/items");
    const start = Number(url.searchParams.get("start")); offsets.push(start);
    return new Response(JSON.stringify(start === 0 ? Array.from({ length: 100 }, (_, i) => ({ ...pdf, key: String(i).padStart(8, "0") })) : []));
  } });
  assert.equal((await client.listAttachmentMetadata({ type: "user", id: 0 })).length, 100);
  assert.deepEqual(offsets, [0, 100]);
  const standalone = parseAttachment({ key: "ATTACH03", data: { itemType: "attachment", filename: "Buch.epub" } });
  assert.equal(attachmentsByItem([standalone]).get("ATTACH03")?.[0]?.kind, "ebook");
});

test("Dateitypen werden aus MIME-Typ und Dateiendung erkannt, Links bleiben als Links gekennzeichnet", () => {
  assert.equal(attachmentKind("application/pdf", "", ""), "pdf");
  assert.equal(attachmentKind("", "Quelle.PDF", ""), "pdf");
  assert.equal(attachmentKind("image/svg+xml", "", ""), "image");
  assert.equal(attachmentKind("text/html", "", ""), "web");
  assert.equal(attachmentKind("application/pdf", "", "linked_url"), "link");
  assert.equal(attachmentKind("", "Quelle.docx", ""), "document");
  assert.equal(attachmentKind("audio/mpeg", "", ""), "audio");
  assert.equal(attachmentKind("video/mp4", "", ""), "video");
  assert.equal(attachmentKind("", "Quelle.zip", ""), "archive");
  assert.equal(attachmentKind("application/octet-stream", "unknown.bin", ""), "file");
});

test("Keine, unbekannte und mehrere Anhänge sind unterscheidbar und Dateinamen können kein HTML einschleusen", () => {
  assert.match(attachmentBadges([]), /No attachment/);
  assert.match(attachmentBadges(undefined, "Offline"), /title="Offline">\?/);
  const entry = parseAttachment(pdf);
  const html = attachmentBadges([entry, { ...entry, key: "ATTACH02", filename: '<script>alert("evil")</script>' }]);
  assert.match(html, /<svg/);
  assert.match(html, /PDF ×2/);
  assert.doesNotMatch(html, /<script>/);
  const source: ZoteroItem = { library: { type: "user", id: 0 }, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };
  const table = sourceListHtml("Liste", [source], [], "scope", attachmentsByItem([entry]));
  assert.match(table, /<th>Attachments<\/th>/);
  assert.match(table, /PDF/);
  assert.match(table, /Open in Zotero/);
});

test("Ungültige Anhangsmetadaten werden abgewiesen, statt einen Dateityp zu erfinden", () => {
  for (const value of [null, { ...pdf, data: { ...pdf.data, contentType: 42 } }, { ...pdf, data: { ...pdf.data, parentItem: "../../file" } }]) {
    assert.throws(() => parseAttachment(value));
  }
});
