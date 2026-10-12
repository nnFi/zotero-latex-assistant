import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, readProjectText, saveProjectConfig } from "../src/config/project";
import { withProjectWriteLock } from "../src/config/projectLock";
import { ZoteroProjectService } from "../src/zotero/projectService";
import type { LibraryRef } from "../src/shared/types";

async function fixture(t: { after(fn: () => Promise<void>): void }, library: LibraryRef = { type: "user", id: 0 }) {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-collections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const prefix = `/api/${library.type === "user" ? "users" : "groups"}/${library.id}`;
  const config = { ...newProjectConfig("parencite"), library, serverId: "db-A", collectionKey: "OLDCOL01", bibFile: "refs.bib",
    citationStyle: "authoryear", importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "Removed", ITEM0002: "Shared" } };
  await saveProjectConfig(root, config);
  const collections = new Map<string, { key: string; version: number; data: { name: string; parentCollection: string | false } }>();
  const seed = (key: string, parent: string | false = false) => collections.set(key, { key, version: 10, data: { name: key, parentCollection: parent } });
  seed("ROOTCOL1"); seed("OLDCOL01", "ROOTCOL1"); seed("NEWCOL01", "ROOTCOL1"); seed("FREECOL1"); seed("FREECH01", "FREECOL1");
  const items = new Map([
    ["ITEM0001", { key: "ITEM0001", version: 3, data: { itemType: "book", title: "Old source", citationKey: "Removed", collections: ["OLDCOL01"] } }],
    ["ITEM0002", { key: "ITEM0002", version: 4, data: { itemType: "book", title: "Shared source", citationKey: "ProviderRenamed", collections: ["OLDCOL01", "NEWCOL01"] } }],
    ["ITEM0003", { key: "ITEM0003", version: 5, data: { itemType: "book", title: "New source", citationKey: "New", collections: ["NEWCOL01"] } }],
  ]);
  const controls = { afterAuthorization: undefined as (() => Promise<void>) | undefined,
    afterFirstItems: undefined as (() => Promise<void>) | undefined, rejectStatus: 0, failedCode: 0, lostCreate: false,
    noDelete: false, wrongStoredName: false, changedServer: false };
  const calls: { url: URL; method: string; body?: string }[] = [];
  let itemReads = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    calls.push({ url, method, ...(init?.body ? { body: String(init.body) } : {}) });
    const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": controls.changedServer ? "db-B" : "db-A" };
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/local/authorize") { await controls.afterAuthorization?.(); return json({ key: "A".repeat(32), remember: true }); }
    if (url.pathname === "/better-bibtex/json-rpc") return json({}, 404);
    if (url.pathname === `${prefix}/collections`) {
      if (method === "POST") {
        if (controls.rejectStatus) return json({}, controls.rejectStatus);
        const data = JSON.parse(String(init?.body))[0];
        if (controls.failedCode) return json({ successful: {}, unchanged: {}, failed: { 0: { key: data.key, code: controls.failedCode } } });
        assert.equal(data.version, 0);
        const saved = { key: data.key as string, version: 1, data: { name: controls.wrongStoredName ? "Wrong name" : data.name as string, parentCollection: data.parentCollection as string | false } };
        collections.set(saved.key, saved);
        if (controls.lostCreate) throw new TypeError("Lost create response");
        return json({ successful: { 0: saved }, failed: {}, unchanged: {} });
      }
      return json([...collections.values()]);
    }
    if (url.pathname.endsWith("/items/top") || url.pathname === `${prefix}/items/top`) {
      const collectionKey = url.pathname.includes("/collections/") ? url.pathname.split("/").at(-3) : undefined;
      const response = json([...items.values()].filter((item) => !collectionKey || item.data.collections.includes(collectionKey)));
      if (++itemReads === 1) await controls.afterFirstItems?.();
      return response;
    }
    const key = url.pathname.split("/").at(-1)!;
    if (url.pathname.startsWith(`${prefix}/collections/`)) {
      const saved = collections.get(key);
      if (!saved) return json({}, 404);
      if (method === "DELETE") {
        assert.equal(init?.body, undefined);
        assert.equal((init!.headers as Record<string, string>)["If-Unmodified-Since-Version"], String(saved.version));
        assert.equal((init!.headers as Record<string, string>)["Zotero-Server-ID"], "db-A");
        if (!controls.noDelete) {
          const removed = new Set([key]);
          for (;;) {
            const before = removed.size;
            for (const child of collections.values()) if (child.data.parentCollection && removed.has(child.data.parentCollection)) removed.add(child.key);
            if (removed.size === before) break;
          }
          removed.forEach((entry) => collections.delete(entry));
          for (const item of items.values()) item.data.collections = item.data.collections.filter((entry) => !removed.has(entry));
        }
        return new Response(null, { status: 204, headers });
      }
      return json(saved);
    }
    return json({}, 404);
  };
  const service = new ZoteroProjectService(root, { fetch });
  const writes = () => calls.filter((call) => ["POST", "DELETE", "PATCH"].includes(call.method) && call.url.pathname.startsWith(prefix));
  return { root, config, library, service, fetch, calls, controls, collections, items, seed, writes };
}

test("assigned collections and ancestors are blocked before authorization, even with descendant deletion enabled", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.collection(f.library, "OLDCOL01")).assignedToProject, true);
  assert.equal((await f.service.collection(f.library, "ROOTCOL1")).deletionBlocked, true);
  for (const key of ["OLDCOL01", "ROOTCOL1"]) {
    await assert.rejects(f.service.deleteCollection(f.library, key, 10, true), /Assign a different collection/);
  }
  assert.equal(f.writes().length, 0); assert(!f.calls.some((call) => call.url.pathname === "/api/local/authorize"));
});

test("project collection switch shares Set library cleanup, stable keys, manual fields and transactional backups", async (t) => {
  const f = await fixture(t);
  const bib = "@book{Removed,title={Old}}\n@book{Shared,title={Custom title},note={My thoughts},related={Removed}}\n";
  const tex = String.raw`Text \parencite[see][14]{Removed,Shared}. \cite{Removed}`;
  await writeFile(path.join(f.root, "refs.bib"), bib); await writeFile(path.join(f.root, "main.tex"), tex);
  await writeFile(path.join(f.root, "other.bib"), "@book{Elsewhere,title={Keep},related={Removed,Outside}}\n");
  const preview = await f.service.setCollection(f.library, "NEWCOL01", true);
  assert.equal(preview.status, "preview"); assert.deepEqual(preview.removedCitationKeys, ["Removed"]);
  assert.equal(await readProjectText(f.root, "refs.bib"), bib);
  const result = await f.service.setCollection(f.library, "NEWCOL01");
  assert.equal(result.status, "assigned"); assert.equal(result.removedBibliographyCount, 1);
  const next = (await readProjectConfig(f.root))!;
  assert.deepEqual(next.importedItemKeys, ["ITEM0002"]); assert.deepEqual(next.citationKeys, { ITEM0002: "Shared" });
  assert.equal(next.citationStyle, "authoryear"); assert.equal(next.citationCommand, "parencite"); assert.equal(next.bibFile, "refs.bib");
  const updatedBib = (await readProjectText(f.root, "refs.bib"))!;
  assert.match(updatedBib, /Custom title/); assert.match(updatedBib, /My thoughts/); assert(!updatedBib.includes("Removed")); assert(!updatedBib.includes("@book{New"));
  assert.equal(await readProjectText(f.root, "main.tex"), String.raw`Text \parencite[see][14]{Shared}. `);
  assert.match((await readProjectText(f.root, "other.bib"))!, /related=\{Outside\}/);
  assert.equal(await readProjectText(f.root, `${result.backup}/refs.bib`), bib);
  assert.equal(await readProjectText(f.root, `${result.backup}/main.tex`), tex);
  assert.equal(f.writes().length, 0);
  assert.equal((await f.service.setCollection(f.library, "NEWCOL01")).status, "unchanged");
});

test("an assigned collection can only be deleted after a completed switch, with sources preserved", async (t) => {
  const f = await fixture(t);
  const preview = await f.service.setCollection(f.library, "NEWCOL01", true);
  assert.equal(preview.status, "preview");
  await assert.rejects(f.service.deleteCollection(f.library, "OLDCOL01", 10), /assigned/);
  await f.service.setCollection(f.library, "NEWCOL01");
  const result = await f.service.deleteCollection(f.library, "OLDCOL01", 10);
  assert.equal(result.status, "deleted"); assert.equal(result.sourcesDeleted, false);
  assert.equal(f.items.size, 3); assert.deepEqual(f.items.get("ITEM0002")!.data.collections, ["NEWCOL01"]);
  assert.equal((await readProjectConfig(f.root))!.collectionKey, "NEWCOL01");
  assert.equal((await f.service.deleteCollection(f.library, "OLDCOL01", 10)).status, "already-deleted");
});

test("child collections require explicit subtree deletion and the protected project binding survives", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.deleteCollection(f.library, "FREECOL1", 10), /subcollections/);
  const result = await f.service.deleteCollection(f.library, "FREECOL1", 10, true);
  assert.deepEqual(result.deletedCollectionKeys, ["FREECH01", "FREECOL1"]);
  assert(f.collections.has("OLDCOL01")); assert.equal(f.items.size, 3);
});

test("delete versions, project binding and collection hierarchy are rechecked after authorization", async (t) => {
  for (const change of ["version", "assignment", "hierarchy", "descendant-version", "assignedChild"]) {
    const f = await fixture(t);
    f.controls.afterAuthorization = async () => {
      if (change === "version") f.collections.get("FREECOL1")!.version++;
      if (change === "assignment") await saveProjectConfig(f.root, { ...f.config, collectionKey: "FREECOL1" }, await readProjectText(f.root, CONFIG_FILE));
      if (change === "hierarchy") f.seed("ADDED001", "FREECOL1");
      if (change === "descendant-version") f.collections.get("FREECH01")!.version++;
      if (change === "assignedChild") f.collections.get("OLDCOL01")!.data.parentCollection = "FREECOL1";
    };
    await assert.rejects(f.service.deleteCollection(f.library, "FREECOL1", 10, true), /changed|assigned/);
    assert.equal(f.writes().length, 0); assert(f.collections.has("FREECOL1"));
  }
});

test("failed deletion verification and foreign-library requests cannot report success", async (t) => {
  const f = await fixture(t); f.controls.noDelete = true;
  await assert.rejects(f.service.deleteCollection(f.library, "FREECH01", 9), /changed/);
  await assert.rejects(f.service.deleteCollection(f.library, "FREECH01", 10), /verified/);
  await assert.rejects(f.service.deleteCollection({ type: "group", id: 42 }, "FREECH01", 10), /scope/);
  assert(f.collections.has("FREECH01"));
});

test("collection creation supports top level and parents, does not implicitly assign, and is idempotent", async (t) => {
  const f = await fixture(t);
  const created = await f.service.createCollection("Top-level collection", null, "collection-request-001");
  assert.equal(created.collection.parentKey, null); assert.equal(created.collection.name, "Top-level collection");
  assert.equal((await readProjectConfig(f.root))!.collectionKey, "OLDCOL01");
  assert.equal((await f.service.createCollection("Top-level collection", null, "collection-request-001")).status, "already-created");
  const child = await f.service.createCollection("Subcollection", created.collection.key, "collection-request-002");
  assert.equal(child.collection.parentKey, created.collection.key); assert.equal(f.writes().length, 2);
  await assert.rejects(f.service.createCollection("Different name", null, "collection-request-001"), /different input/);
});

test("uncertain collection creation reconciles the original key after a process restart", async (t) => {
  const f = await fixture(t); f.controls.lostCreate = true;
  await assert.rejects(f.service.createCollection("New collection", null, "collection-request-001"));
  f.controls.lostCreate = false;
  const restarted = new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) });
  assert.equal((await restarted.createCollection("New collection", null, "collection-request-001")).status, "already-created");
  assert.equal(f.writes().length, 1);
});

test("explicitly rejected collection creates reuse their reserved key, including batch row rejections", async (t) => {
  for (const batch of [false, true]) {
    const f = await fixture(t);
    if (batch) f.controls.failedCode = 403; else f.controls.rejectStatus = 403;
    await assert.rejects(f.service.createCollection("New collection", null, "collection-request-001"));
    f.controls.failedCode = 0; f.controls.rejectStatus = 0;
    const created = await f.service.createCollection("New collection", null, "collection-request-001");
    assert.equal(created.status, "created");
    const keys = f.writes().map((call) => JSON.parse(call.body!)[0].key);
    assert.equal(keys[0], keys[1]);
  }
});

test("lost absent collection creates remain unresolved rather than producing another collection", async (t) => {
  const f = await fixture(t); f.controls.lostCreate = true;
  await assert.rejects(f.service.createCollection("New collection", null, "collection-request-001"));
  const allocated = JSON.parse(f.writes()[0]!.body!)[0].key;
  f.collections.delete(allocated);
  await assert.rejects(new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) }).createCollection("New collection", null, "collection-request-001"), /unresolved/);
  assert.equal(f.writes().length, 1);
});

test("parent changes during authorization and incorrect stored names block collection create success", async (t) => {
  const f = await fixture(t);
  f.controls.afterAuthorization = async () => { f.collections.get("FREECOL1")!.version++; };
  await assert.rejects(f.service.createCollection("New child", "FREECOL1", "collection-request-001"), /parent collection changed/);
  assert.equal(f.writes().length, 0);
  f.controls.afterAuthorization = undefined; f.controls.wrongStoredName = true;
  await assert.rejects(f.service.createCollection("New child", "FREECOL1", "collection-request-002"), /verified/);
});

test("project assignment handles empty collections, missing bibliography and a fresh project without imports", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{Removed,Shared}`);
  const result = await f.service.setCollection(f.library, "FREECH01");
  assert.deepEqual(result.retainedItemKeys, []); assert.equal(await readProjectText(f.root, "main.tex"), "");
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined);
  const freshRoot = await mkdtemp(path.join(tmpdir(), "zotero-collection-fresh-"));
  t.after(() => rm(freshRoot, { recursive: true, force: true }));
  const fresh = new ZoteroProjectService(freshRoot, { fetch: f.fetch });
  const available = await fresh.listCollections(f.library) as { collections: { key: string }[] };
  assert(available.collections.some((entry) => entry.key === "NEWCOL01"));
  assert.equal((await fresh.setCollection(f.library, "NEWCOL01")).status, "assigned");
  assert.equal((await readProjectConfig(freshRoot))!.bibFile, ""); assert.deepEqual((await readProjectConfig(freshRoot))!.importedItemKeys, []);
});

test("whole-library assignment follows Set library rules and disables source writes", async (t) => {
  const f = await fixture(t);
  const result = await f.service.setCollection(f.library, null);
  assert.equal(result.collectionKey, ""); assert.equal(result.writeReady, false);
  assert.deepEqual((await readProjectConfig(f.root))!.importedItemKeys, ["ITEM0001", "ITEM0002"]);
  // Collection management remains available when only the project library is bound.
  assert.equal((await f.service.createCollection("Another root", null, "collection-request-001")).status, "created");
});

test("cross-library or database switches with existing imports are blocked before project writes", async (t) => {
  const f = await fixture(t); const snapshot = await readProjectText(f.root, CONFIG_FILE);
  await assert.rejects(f.service.setCollection({ type: "group", id: 42 }, null), /Delete all citations/);
  f.controls.changedServer = true;
  await assert.rejects(f.service.setCollection(f.library, "NEWCOL01"), /Delete all citations/);
  assert.equal(await readProjectText(f.root, CONFIG_FILE), snapshot);
});

test("project file, configuration and collection membership races prevent partial assignment", async (t) => {
  for (const change of ["tex", "config", "membership"]) {
    const f = await fixture(t); const bib = "@book{Removed,title={Old}}\n@book{Shared,title={Keep}}\n";
    await writeFile(path.join(f.root, "refs.bib"), bib); await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{Removed,Shared}`);
    f.controls.afterFirstItems = async () => {
      if (change === "tex") await writeFile(path.join(f.root, "main.tex"), "Concurrent edit");
      if (change === "config") await saveProjectConfig(f.root, { ...f.config, citationCommand: "textcite" }, await readProjectText(f.root, CONFIG_FILE));
      if (change === "membership") f.items.get("ITEM0002")!.data.collections = ["OLDCOL01"];
    };
    await assert.rejects(f.service.setCollection(f.library, "NEWCOL01"), /changed/);
    assert.equal(await readProjectText(f.root, "refs.bib"), bib); assert.equal((await readProjectConfig(f.root))!.collectionKey, "OLDCOL01");
  }
});

test("group library collection management uses group-scoped endpoints and the same deletion protection", async (t) => {
  const f = await fixture(t, { type: "group", id: 42 });
  const created = await f.service.createCollection("Group collection", null, "collection-request-001");
  await f.service.setCollection(f.library, created.collection.key);
  await assert.rejects(f.service.deleteCollection(f.library, created.collection.key, 1), /assigned/);
  await f.service.setCollection(f.library, "NEWCOL01");
  assert.equal((await f.service.deleteCollection(f.library, created.collection.key, 1)).status, "deleted");
  assert(f.writes().every((call) => call.url.pathname.startsWith("/api/groups/42/")));
});

test("extension and MCP share a write lock so assignment cannot race with collection deletion", async (t) => {
  const f = await fixture(t);
  await withProjectWriteLock(f.root, async () => {
    await assert.rejects(f.service.deleteCollection(f.library, "FREECH01", 10), /Another MCP write/);
    await assert.rejects(f.service.setCollection(f.library, "NEWCOL01"), /Another MCP write/);
  });
  assert.equal(f.writes().length, 0);
  assert.equal((await f.service.setCollection(f.library, "NEWCOL01")).status, "assigned");
});
