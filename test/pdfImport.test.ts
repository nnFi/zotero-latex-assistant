import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, readFile, mkdir, open } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { newProjectConfig, saveProjectConfig, readProjectText, CONFIG_FILE } from "../src/config/project";
import { ZoteroProjectService } from "../src/zotero/projectService";
import type { LibraryRef } from "../src/shared/types";

const parentKey = "ITEM2345";
const collection = "COLL2345";
const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "db-A" };
const pdfBytes = Buffer.from("%PDF-1.7\nPDF payload\x00\xff\x80\n%%EOF", "latin1");
const hash = (bytes: Buffer, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");

async function fixture(t: { after(fn: () => Promise<void>): void }, library: LibraryRef = { type: "user", id: 0 }) {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-pdf-write-")); t.after(() => rm(root, { force: true, recursive: true }));
  const config = { ...newProjectConfig(), library, collectionKey: collection, serverId: "db-A", bibFile: "refs.bib" };
  await saveProjectConfig(root, config); await writeFile(path.join(root, "refs.bib"), "Original bibliography");
  const pdfPath = path.join(root, "paper ä # + space.pdf"); await writeFile(pdfPath, pdfBytes);
  const source: Record<string, unknown> = { itemType: "book", title: "Source", collections: [collection], version: 10 };
  const items = new Map<string, Record<string, unknown>>([[parentKey, source]]);
  const prefix = `/api/${library.type === "user" ? "users" : "groups"}/${library.id}`;
  const storage = (key: string) => path.join(root, "storage", key, String(items.get(key)!.filename));
  const uploads = new Map<string, { key: string; params: URLSearchParams; bytes?: Buffer }>();
  const counts = { creates: 0, authorizes: 0, uploadAuthorizations: 0, uploads: 0, registrations: 0 };
  let version = 10;
  const control = { denied: false, changedServer: false, remember: true, loseCreate: false, absentCreate: false, loseUpload: false,
    loseRegistration: false, badStoredBytes: false, rejectRegistration: false, existingFile: false, redirectUpload: false,
    createStatus: undefined as number | undefined, failedCode: undefined as number | undefined,
    malformedCreate: false, readStatus: undefined as number | undefined,
    uploadUrl: undefined as string | undefined, beforeAuthorization: undefined as (() => Promise<void>) | undefined,
    beforeUpload: undefined as (() => Promise<void>) | undefined };
  let validAuth = false;
  const postedKeys: string[] = [];
  const entry = (key: string) => ({ key, version: items.get(key)!.version, data: items.get(key) });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "http://localhost:23119"); assert.equal(init?.redirect, "error");
    const p = url.pathname;
    const responseHeaders = control.changedServer ? { ...headers, "Zotero-Server-ID": "db-B" } : headers;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: responseHeaders });
    if (p === "/api/") return new Response("", { headers: responseHeaders });
    if (p === `${prefix}/collections/${collection}`) return json({ key: collection, data: { name: "Test" } });
    if (p === "/api/local/authorize") {
      counts.authorizes++; if (control.denied) return json({ denied: true }, 403);
      await control.beforeAuthorization?.(); validAuth = true;
      return json({ key: "A".repeat(32), remember: control.remember });
    }
    if (p.startsWith("/api/local/uploads/")) {
      counts.uploads++;
      assert.equal((init!.headers as Record<string, string>)["Zotero-API-Key"], undefined);
      assert.equal((init!.headers as Record<string, string>)["Content-Type"], "application/pdf");
      if (control.redirectUpload) return new Response(null, { status: 302, headers: { ...responseHeaders, Location: "https://evil.example/upload" } });
      const pending = uploads.get(p.split("/").at(-1)!)!;
      pending.bytes = Buffer.from(init!.body as Uint8Array);
      assert.equal(hash(pending.bytes, "md5"), pending.params.get("md5"));
      await control.beforeUpload?.();
      if (control.loseUpload) { control.loseUpload = false; throw new TypeError("lost upload response"); }
      return new Response("", { status: 201, headers: responseHeaders });
    }
    if (init?.method === "POST") {
      assert.equal((init.headers as Record<string, string>)["Zotero-Server-ID"], "db-A");
      assert.equal((init.headers as Record<string, string>)["Zotero-API-Key"], "A".repeat(32));
      if (!validAuth) return json({}, 401);
      if (!control.remember) validAuth = false;
      if (p === `${prefix}/items`) {
        counts.creates++;
        const data = (JSON.parse(String(init.body)) as Record<string, unknown>[])[0]!;
        postedKeys.push(String(data.key));
        if (control.createStatus) return json({}, control.createStatus);
        if (control.failedCode) return json({ successful: {}, unchanged: {}, failed: { 0: { key: data.key, code: control.failedCode } } });
        if (control.malformedCreate) return json({ successful: {}, unchanged: {}, failed: {} });
        assert.equal(data.version, 0); assert.equal(data.itemType, "attachment"); assert.equal(data.parentItem, parentKey);
        assert.equal(data.linkMode, "imported_file"); assert(!items.has(String(data.key)));
        data.version = ++version;
        if (!control.absentCreate) items.set(String(data.key), data);
        if (control.loseCreate || control.absentCreate) { control.loseCreate = false; throw new TypeError("lost create response"); }
        return json({ successful: { 0: entry(String(data.key)) }, failed: {}, unchanged: {} });
      }
      if (p.endsWith("/file")) {
        const key = p.split("/").at(-2)!;
        assert.equal((init.headers as Record<string, string>)["If-None-Match"], "*");
        assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/x-www-form-urlencoded");
        const params = new URLSearchParams(String(init.body));
        if (params.has("upload")) {
          counts.registrations++;
          if (control.rejectRegistration || items.get(key)!.md5) return json({}, 412);
          const pending = uploads.get(params.get("upload")!)!;
          assert(pending.bytes); assert.equal(pending.key, key);
          await mkdir(path.dirname(storage(key)), { recursive: true });
          await writeFile(storage(key), control.badStoredBytes ? Buffer.from("%PDF-1.7\nWrong contents\n%%EOF") : pending.bytes);
          Object.assign(items.get(key)!, { md5: pending.params.get("md5"), mtime: Number(pending.params.get("mtime")), version: ++version });
          if (control.loseRegistration) { control.loseRegistration = false; throw new TypeError("lost registration response"); }
          return new Response(null, { status: 204, headers: responseHeaders });
        }
        counts.uploadAuthorizations++;
        assert(!String(init.body).includes("+"), "spaces must use percent encoding");
        assert.equal(params.get("filename"), path.basename(pdfPath)); assert.equal(Number(params.get("filesize")), pdfBytes.length);
        assert(Number(params.get("mtime")) >= 10000000000); assert.equal(params.get("md5"), hash(pdfBytes, "md5"));
        if (control.existingFile) {
          await mkdir(path.dirname(storage(key)), { recursive: true }); await writeFile(storage(key), pdfBytes);
          Object.assign(items.get(key)!, { md5: hash(pdfBytes, "md5"), version: ++version });
          return json({ exists: 1 });
        }
        const uploadKey = String(uploads.size + 1).padStart(32, "U"); uploads.set(uploadKey, { key, params });
        return json({ uploadKey, url: control.uploadUrl ?? `http://localhost:23119/api/local/uploads/${uploadKey}`, contentType: "application/pdf", prefix: "", suffix: "" });
      }
    }
    if (p === `${prefix}/items/${parentKey}/children`) return json([...items.keys()].filter((key) => key !== parentKey).map(entry));
    const match = p.match(/\/items\/([A-Z0-9]{8})(\/file\/view\/url)?$/);
    if (match && items.has(match[1]!)) {
      if (match[1] !== parentKey && control.readStatus) return json({}, control.readStatus);
      return match[2] ? new Response(pathToFileURL(storage(match[1]!)).href, { headers: responseHeaders }) : json(entry(match[1]!));
    }
    return json({}, 404);
  };
  const service = new ZoteroProjectService(root, { fetch });
  const restarted = () => new ZoteroProjectService(root, { fetch: (input, init) => fetch(input, init) });
  const attach = (requestId = "pdf-write-request", using = service, title?: string) => using.attachPdf(library, parentKey, pdfPath, requestId, 10, title);
  return { root, config, library, pdfPath, source, items, control, counts, service, restarted, attach, storage, postedKeys };
}

test("PDF import stores an exact independent copy under its parent, with Unicode filename and verified hashes", async (t) => {
  const f = await fixture(t);
  const result = await f.attach(undefined, undefined, "My paper");
  assert.equal(result.status, "attached"); assert.equal(result.verified, true); assert.equal(result.attachment.parentKey, parentKey);
  assert.equal(result.attachment.title, "My paper"); assert.equal(result.sha256, hash(pdfBytes));
  assert.notEqual(result.localPath, f.pdfPath); assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1); assert.equal(f.counts.registrations, 1);
  assert.equal(await readProjectText(f.root, "refs.bib"), "Original bibliography");
  await rm(f.pdfPath); assert.deepEqual(await readFile(result.localPath), pdfBytes);
});

test("group libraries and single-use local authorizations support all upload phases", async (t) => {
  const f = await fixture(t, { type: "group", id: 42 }); f.control.remember = false;
  const result = await f.attach();
  assert.equal(result.library.type, "group"); assert.equal(f.counts.authorizes, 3);
  assert.deepEqual(await readFile(result.localPath), pdfBytes);
});

test("same request survives process restart; a new request for identical stored bytes reuses the attachment", async (t) => {
  const f = await fixture(t); const original = await f.attach();
  const retry = await f.attach(undefined, f.restarted()); assert.equal(retry.status, "already-attached"); assert.equal(retry.attachmentKey, original.attachmentKey);
  const duplicate = await f.attach("different-request", f.restarted(), "Another title");
  assert.equal(duplicate.status, "already-attached"); assert.equal(duplicate.attachmentKey, original.attachmentKey);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1);
  await assert.rejects(f.attach(undefined, f.restarted(), "Changed title"), /different input/);
});

test("matching filenames with different bytes preserve the older attachment and create a separate stored PDF", async (t) => {
  const f = await fixture(t);
  const oldBytes = Buffer.from("%PDF-1.7\nAn older different paper\n%%EOF");
  f.items.set("OLD23456", { itemType: "attachment", parentItem: parentKey, linkMode: "imported_file", contentType: "application/pdf",
    filename: path.basename(f.pdfPath), title: "Older paper", version: 9, md5: hash(oldBytes, "md5") });
  await mkdir(path.dirname(f.storage("OLD23456")), { recursive: true }); await writeFile(f.storage("OLD23456"), oldBytes);
  const result = await f.attach(); assert.equal(result.status, "attached"); assert.notEqual(result.attachmentKey, "OLD23456");
  assert.deepEqual(await readFile(f.storage("OLD23456")), oldBytes); assert.equal(f.counts.creates, 1);
});

test("a tampered journal cannot move the upload outside the requested parent scope", async (t) => {
  const f = await fixture(t); f.control.loseUpload = true; await assert.rejects(f.attach());
  const journalPath = path.join(f.root, ".zotero/mcp/attachments", hash(Buffer.from("pdf-write-request")) + ".json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.expected.parentItem = "OTHER234"; await writeFile(journalPath, JSON.stringify(journal));
  f.items.get(journal.key)!.parentItem = "OTHER234";
  await assert.rejects(f.attach(undefined, f.restarted()), /another parent source/);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1); assert.equal(f.counts.registrations, 0);
});

test("a source/library/version outside the project and non-PDF files fail before writes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.attachPdf({ type: "group", id: 42 }, parentKey, f.pdfPath, "foreign-request", 10), /outside/);
  await assert.rejects(f.service.attachPdf(f.library, parentKey, f.pdfPath, "stale-request", 9), /version changed/);
  f.source.collections = ["OTHER234"]; await assert.rejects(f.attach(), /does not belong/); f.source.collections = [collection];
  f.source.deleted = 1; await assert.rejects(f.attach(), /trashed/); delete f.source.deleted;
  for (const file of ["relative.pdf", "https://example.org/file.pdf", f.root, path.join(f.root, "missing.pdf")]) {
    await assert.rejects(f.service.attachPdf(f.library, parentKey, file, "bad-file-request", 10));
  }
  await writeFile(f.pdfPath, "Not a PDF document"); await assert.rejects(f.attach(), /does not contain a PDF/);
  const file = await open(f.pdfPath, "w"); await file.truncate(101 * 1024 * 1024); await file.close();
  await assert.rejects(f.attach(), /100 MiB/);
  assert.equal(f.counts.creates, 0); assert.equal(f.counts.authorizes, 0);
});

test("denied authorization creates no attachment and a later authorized retry is possible", async (t) => {
  const f = await fixture(t); f.control.denied = true;
  await assert.rejects(f.attach(), /denied/); assert.equal(f.counts.creates, 0);
  f.control.denied = false; assert.equal((await f.attach(undefined, f.restarted())).status, "attached");
});

test("scope, source, file and database changes during authorization prevent attachment creation", async (t) => {
  for (const change of ["scope", "version", "file", "database"]) {
    const f = await fixture(t);
    f.control.beforeAuthorization = async () => {
      if (change === "scope") await saveProjectConfig(f.root, { ...f.config, collectionKey: "OTHER234" }, await readProjectText(f.root, CONFIG_FILE));
      if (change === "version") f.source.version = 11;
      if (change === "file") await writeFile(f.pdfPath, "%PDF-1.7\nChanged file\n%%EOF");
      if (change === "database") f.control.changedServer = true;
    };
    await assert.rejects(f.attach()); assert.equal(f.counts.creates, 0);
  }
});

test("lost attachment-create response is reconciled without a second item POST", async (t) => {
  const f = await fixture(t); f.control.loseCreate = true;
  await assert.rejects(f.attach(), /same requestId/);
  const result = await f.attach(undefined, f.restarted()); assert.equal(result.status, "attached"); assert.equal(f.counts.creates, 1);
});

test("an unresolved create with absent allocated key never gets resubmitted", async (t) => {
  const f = await fixture(t); f.control.absentCreate = true;
  await assert.rejects(f.attach());
  await assert.rejects(f.attach(undefined, f.restarted()), /will not be submitted again/); assert.equal(f.counts.creates, 1);
});

test("a definitively rejected PDF creation retries the same request and allocated attachment key", async (t) => {
  const f = await fixture(t); f.control.createStatus = 403;
  await assert.rejects(f.attach()); assert.equal(f.items.size, 1); assert.equal(f.counts.uploads, 0);
  f.control.createStatus = undefined;
  const result = await f.attach(undefined, f.restarted());
  assert.equal(result.status, "attached"); assert.equal(f.counts.creates, 2); assert.equal(f.items.size, 2);
  assert.deepEqual(f.postedKeys, [result.attachmentKey, result.attachmentKey]);
  assert.deepEqual(await readFile(result.localPath), pdfBytes);
});

test("attachment journals distinguish explicit HTTP/batch rejections from uncertain creation responses", async (t) => {
  for (const scenario of [400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429, "failed-400", "failed-403", "failed-412"] as const) {
    await t.test(`${scenario} retries the reserved attachment`, async (t) => {
      const f = await fixture(t);
      if (typeof scenario === "number") f.control.createStatus = scenario;
      else f.control.failedCode = Number(scenario.slice(7));
      await assert.rejects(f.attach()); assert.equal(f.items.size, 1); assert.equal(f.counts.uploads, 0);
      f.control.createStatus = undefined; f.control.failedCode = undefined;
      const result = await f.attach(undefined, f.restarted());
      assert.equal(result.status, "attached"); assert.equal(f.counts.creates, scenario === 401 ? 3 : 2);
      assert(f.postedKeys.every((key) => key === result.attachmentKey)); assert.equal(f.items.size, 2);
    });
  }
  for (const scenario of [408, 500, 501, 503, "malformed", "failed-500"] as const) {
    await t.test(`${scenario} never resubmits an uncertain attachment creation`, async (t) => {
      const f = await fixture(t);
      if (typeof scenario === "number") f.control.createStatus = scenario;
      if (scenario === "malformed") f.control.malformedCreate = true;
      if (scenario === "failed-500") f.control.failedCode = 500;
      await assert.rejects(f.attach());
      await assert.rejects(f.attach(undefined, f.restarted()), /will not be submitted again/);
      assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 0);
    });
  }
});

test("rejected PDF retry still requires identical input and an unchanged parent version", async (t) => {
  const f = await fixture(t); f.control.createStatus = 403;
  await assert.rejects(f.attach()); f.control.createStatus = undefined;
  await assert.rejects(f.attach(undefined, f.restarted(), "Changed title"), /different input/);
  f.source.version = 11;
  await assert.rejects(f.attach(undefined, f.restarted()), /parent source changed/);
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 0);
});

test("revoked grant and denied renewal leave PDF creation safely retryable on the same key", async (t) => {
  const f = await fixture(t); f.control.createStatus = 401;
  f.control.beforeAuthorization = async () => { f.control.denied = true; };
  await assert.rejects(f.attach(), /denied/); assert.equal(f.counts.creates, 1);
  f.control.beforeAuthorization = undefined; f.control.denied = false; f.control.createStatus = undefined;
  const result = await f.attach(undefined, f.restarted());
  assert.equal(result.status, "attached"); assert.deepEqual(f.postedKeys, [result.attachmentKey, result.attachmentKey]);
});

test("a lost PDF creation response after reauthorization remains uncertain", async (t) => {
  const f = await fixture(t); f.control.createStatus = 401;
  f.control.beforeAuthorization = async () => {
    if (f.counts.authorizes === 2) { f.control.createStatus = undefined; f.control.loseCreate = true; }
  };
  await assert.rejects(f.attach()); assert.equal(f.counts.creates, 2);
  for (const key of f.postedKeys) f.items.delete(key);
  f.control.beforeAuthorization = undefined;
  await assert.rejects(f.attach(undefined, f.restarted()), /will not be submitted again/);
  assert.equal(f.counts.creates, 2);
});

test("HTTP rejection while reading a created attachment never permits another create POST", async (t) => {
  const f = await fixture(t); f.control.readStatus = 403;
  await assert.rejects(f.attach()); assert.equal(f.items.size, 2);
  for (const key of f.postedKeys) f.items.delete(key);
  f.control.readStatus = undefined;
  await assert.rejects(f.attach(undefined, f.restarted()), /will not be submitted again/);
  assert.equal(f.counts.creates, 1);
});

test("lost raw-upload response resumes on the same attachment without overwriting other files", async (t) => {
  const f = await fixture(t); f.control.loseUpload = true;
  await assert.rejects(f.attach());
  const result = await f.attach(undefined, f.restarted()); assert.equal(result.status, "attached");
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 2); assert.equal(f.counts.registrations, 1);
});

test("lost registration response is verified on disk without another upload or attachment", async (t) => {
  const f = await fixture(t); f.control.loseRegistration = true;
  await assert.rejects(f.attach());
  const result = await f.attach(undefined, f.restarted()); assert.equal(result.status, "already-attached");
  assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1); assert.equal(f.counts.registrations, 1);
});

test("existing-file upload authorization still verifies the local stored bytes", async (t) => {
  const f = await fixture(t); f.control.existingFile = true;
  const result = await f.attach(); assert.equal(result.verified, true); assert.equal(f.counts.uploads, 0); assert.equal(f.counts.registrations, 0);
});

test("external or unrelated upload URLs and redirects never receive PDF bytes", async (t) => {
  for (const url of ["https://evil.example/upload", "http://localhost:9999/api/local/uploads/" + "U".repeat(32),
    "http://localhost:23119/api/users/0/items", "http://user:pass@localhost:23119/api/local/uploads/" + "U".repeat(32)]) {
    const f = await fixture(t); f.control.uploadUrl = url;
    await assert.rejects(f.attach(), /local raw-file endpoint/); assert.equal(f.counts.uploads, 0);
  }
  const f = await fixture(t); f.control.redirectUpload = true;
  await assert.rejects(f.attach()); assert.equal(f.counts.registrations, 0);
});

test("a changed/trashed/moved attachment or different registered bytes is never recreated or overwritten", async (t) => {
  for (const change of ["title", "deleted", "parentItem", "bytes"]) {
    const f = await fixture(t); const result = await f.attach(); const stored = f.items.get(result.attachmentKey)!;
    if (change === "title") stored.title = "Edited";
    if (change === "deleted") stored.deleted = true;
    if (change === "parentItem") stored.parentItem = "OTHER234";
    if (change === "bytes") await writeFile(result.localPath, "%PDF-1.7\nDifferent bytes\n%%EOF");
    await assert.rejects(f.attach(undefined, f.restarted()), /changed|does not match/); assert.equal(f.counts.creates, 1); assert.equal(f.counts.uploads, 1);
  }
  const f = await fixture(t); f.control.badStoredBytes = true;
  await assert.rejects(f.attach(), /does not match/); assert.equal(f.counts.creates, 1);
});

test("source or attachment changes after staging abort registration without replacing files", async (t) => {
  const f = await fixture(t); f.control.beforeUpload = async () => { f.source.version = 11; };
  await assert.rejects(f.attach(), /parent source changed/); assert.equal(f.counts.registrations, 0);
  const other = await fixture(t); other.control.beforeUpload = async () => { const attachment = [...other.items].find(([key]) => key !== parentKey)![1]; attachment.version = 99; };
  await assert.rejects(other.attach(), /changed before upload/); assert.equal(other.counts.registrations, 0);
});

test("registration precondition failure leaves the allocated attachment and can resume using its original request", async (t) => {
  const f = await fixture(t); f.control.rejectRegistration = true;
  await assert.rejects(f.attach(), /incomplete or uncertain/); assert.equal(f.counts.creates, 1);
  f.control.rejectRegistration = false; assert.equal((await f.attach(undefined, f.restarted())).status, "attached");
  assert.equal(f.counts.creates, 1);
});
