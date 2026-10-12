import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, symlink, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { CONFIG_FILE, newProjectConfig, readProjectText, saveProjectConfig } from "../src/config/project";
import { ZoteroProjectService } from "../src/zotero/projectService";
import { readLocalPdf } from "../src/zotero/attachmentFiles";

const library = { type: "user" as const, id: 0 };
const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "db-A" };

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-pdf-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const config = { ...newProjectConfig(), library, collectionKey: "COLL2345", serverId: "db-A" };
  await saveProjectConfig(root, config);
  const pdfPath = path.join(root, "paper ä #.pdf");
  const bytes = Buffer.from("%PDF-1.7\nBinary PDF payload\x00\xff\n%%EOF", "latin1");
  await writeFile(pdfPath, bytes);
  const source = { key: "ITEM2345", version: 10, data: { itemType: "book", title: "Source", collections: ["COLL2345"] } };
  const attachment = { key: "PDF12345", version: 10, data: { itemType: "attachment", parentItem: "ITEM2345", title: "Paper",
    filename: "paper.pdf", contentType: "application/pdf", linkMode: "imported_file", deleted: false } };
  const control = { fileUrl: pathToFileURL(pdfPath).href, available: true, changedServer: false, beforeFile: undefined as (() => Promise<void>) | undefined };
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    const responseHeaders = control.changedServer ? { ...headers, "Zotero-Server-ID": "db-B" } : headers;
    const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { headers: responseHeaders, status });
    if (url.pathname === "/api/") return new Response("", { headers: responseHeaders });
    if (url.pathname.endsWith("/collections/COLL2345")) return json({ key: "COLL2345", data: { name: "Project" } });
    if (url.pathname.endsWith("/items/ITEM2345")) return json(source);
    if (url.pathname.endsWith("/items/ITEM2345/children")) return json([attachment, { key: "PDF23456", version: 10, data: { ...attachment.data, filename: "second.pdf" } }]);
    if (url.pathname.endsWith("/items/PDF12345")) return json(attachment);
    if (url.pathname.endsWith("/items/PDF12345/file/view/url")) {
      await control.beforeFile?.();
      return new Response(control.fileUrl, { headers: responseHeaders, status: control.available ? 200 : 404 });
    }
    return json({}, 404);
  };
  return { root, config, pdfPath, bytes, source, attachment, control, calls, service: new ZoteroProjectService(root, { fetch }) };
}

test("attachment list supports multiple PDFs without opening any file or requesting write permission", async (t) => {
  const f = await fixture(t);
  const result = await f.service.attachments(library, "ITEM2345") as { attachments: { key: string; kind: string }[] };
  assert.deepEqual(result.attachments.map((value) => value.key), ["PDF12345", "PDF23456"]);
  assert(result.attachments.every((value) => value.kind === "pdf"));
  assert(!f.calls.some((value) => value.includes("/file/")));
  f.attachment.data.parentItem = "OTHER234";
  await assert.rejects(f.service.attachments(library, "ITEM2345"), /another source/);
});

test("PDF handoff returns canonical path and hash, and optionally the unchanged original binary", async (t) => {
  const f = await fixture(t);
  const file = await f.service.attachment(library, "ITEM2345", "PDF12345");
  assert.equal(file.localPath, f.pdfPath); assert.equal(file.fileUri, pathToFileURL(f.pdfPath).href);
  assert.equal(file.sha256, createHash("sha256").update(f.bytes).digest("hex"));
  assert.equal(file.sizeBytes, f.bytes.length); assert(!file.pdfBase64);
  const inline = await f.service.attachment(library, "ITEM2345", "PDF12345", true);
  assert.deepEqual(Buffer.from(inline.pdfBase64!, "base64"), f.bytes);
  assert(!Object.hasOwn(inline, "text"));
});

test("PDF access rejects foreign library, source collection, unrelated attachment and trashed attachment before file resolution", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.attachment({ type: "group", id: 42 }, "ITEM2345", "PDF12345"), /outside/);
  f.source.data.collections = ["OTHER234"];
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /does not belong/);
  f.source.data.collections = ["COLL2345"];
  f.attachment.data.parentItem = "OTHER234";
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /must belong/);
  f.attachment.data.parentItem = "ITEM2345"; f.attachment.data.deleted = true;
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /must belong/);
  assert(!f.calls.some((value) => value.includes("/file/")));
});

test("remote URLs, unavailable local PDFs, invalid bytes and non-PDF attachments are reported without download or extraction", async (t) => {
  const f = await fixture(t);
  f.control.fileUrl = "https://example.org/paper.pdf";
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /Only local/);
  f.control.fileUrl = pathToFileURL(path.join(f.root, "missing.pdf")).href;
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /not available/);
  f.control.fileUrl = pathToFileURL(f.pdfPath).href;
  await writeFile(f.pdfPath, "This is not PDF content");
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /does not contain a PDF/);
  f.attachment.data.filename = "note.html"; f.attachment.data.contentType = "text/html";
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /Only local PDF/);
  assert(f.calls.every((value) => value.startsWith("/api/")));
});

test("PDF read fails if project binding changes before the result or the saved Zotero instance does not match", async (t) => {
  const f = await fixture(t);
  f.control.beforeFile = async () => { await saveProjectConfig(f.root, { ...f.config, collectionKey: "OTHER234" }, await readProjectText(f.root, CONFIG_FILE)); };
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /configuration changed/);
  await saveProjectConfig(f.root, f.config, await readProjectText(f.root, CONFIG_FILE)); f.control.beforeFile = undefined; f.control.changedServer = true;
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345"), /does not match/);
});

test("file validation rejects non-files, nonlocal file hosts and excessive sizes; resolves Zotero-linked PDFs", async (t) => {
  const f = await fixture(t);
  await assert.rejects(readLocalPdf("file://remote-host/share/paper.pdf"), /Only local/);
  await assert.rejects(readLocalPdf(pathToFileURL(f.root).href), /regular PDF/);
  const link = path.join(f.root, "linked.pdf"); await symlink(f.pdfPath, link);
  assert.equal((await readLocalPdf(pathToFileURL(link).href)).localPath, f.pdfPath);
  const file = await open(f.pdfPath, "w");
  await file.truncate(101 * 1024 * 1024); await file.close();
  await assert.rejects(readLocalPdf(pathToFileURL(f.pdfPath).href), /100 MiB/);
});

test("large locally available PDF handoff works by path but does not embed more than 5 MiB", async (t) => {
  const f = await fixture(t);
  const file = await open(f.pdfPath, "r+"); await file.truncate(6 * 1024 * 1024); await file.close();
  assert.equal((await f.service.attachment(library, "ITEM2345", "PDF12345")).sizeBytes, 6 * 1024 * 1024);
  await assert.rejects(f.service.attachment(library, "ITEM2345", "PDF12345", true), /5 MiB/);
});
