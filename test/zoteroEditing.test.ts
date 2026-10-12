import assert from "node:assert/strict";
import { test } from "node:test";
import { ZoteroClient } from "../src/zotero/client";
import { ZoteroWriter, type SecretStore, metadataPatch } from "../src/zotero/writer";
import type { ZoteroItemDetail } from "../src/shared/types";
import { ZoteroError } from "../src/shared/errors";

const data = { itemType: "book", title: "Original", key: "ITEM0001", version: 7, date: "2024",
  creators: [{ creatorType: "author", firstName: "Anna", lastName: "Müller" }], collections: ["ROOT0001"], tags: [], relations: {}, extra: "Preserve" };
const detail: ZoteroItemDetail = { item: { library: { type: "user", id: 0 }, key: "ITEM0001", itemType: "book",
  title: "Original", creators: [], date: "2024", doi: "", url: "" }, version: 7, data, serverId: "database-A" };
const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "database-A" };

function secretStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: async (key) => values.get(key), store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
}

test("Detailabruf liefert vollständige editierbare Daten, Objektversion und Instanz-ID", async () => {
  const client = new ZoteroClient({ serverId: "database-A", fetch: async (input, init) => {
    assert.equal(new URL(String(input)).pathname, "/api/users/0/items/ITEM0001");
    assert.equal((init?.headers as Record<string, string>)["Zotero-Server-ID"], "database-A");
    return new Response(JSON.stringify({ key: "ITEM0001", version: 7, data }), { headers });
  } });
  const result = await client.getItem({ type: "user", id: 0 }, "ITEM0001");
  assert.equal(result.version, 7);
  assert.equal(result.data.extra, "Preserve");
  assert.equal(result.serverId, "database-A");
});

test("Eine andere Zotero-Instanz wird auch bei erfolgreichen HTTP-Antworten abgewiesen", async () => {
  const client = new ZoteroClient({ serverId: "database-A", fetch: async () => new Response("[]", { headers: { "Zotero-Server-ID": "database-B" } }) });
  await assert.rejects(client.listItems({ type: "user", id: 0 }), (error: unknown) => error instanceof ZoteroError && error.code === "CONFLICT");
});

test("Schreibfreigabe und Versionsprüfung erfolgen vor einem minimalen PATCH; andere Daten bleiben unberührt", async () => {
  const calls: string[] = [];
  const secrets = secretStore();
  const writer = new ZoteroWriter({ serverId: "database-A", fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push(`${init?.method} ${url.pathname}`);
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/local/authorize") {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { appName: "Zotero LaTeX Assistant" });
      assert.equal((init?.headers as Record<string, string>)["Zotero-Server-ID"], "database-A");
      return new Response(JSON.stringify({ key: "A".repeat(32), remember: true }), { headers });
    }
    assert.equal(init?.method, "PATCH");
    assert.equal((init?.headers as Record<string, string>)["If-Unmodified-Since-Version"], "7");
    assert.equal((init?.headers as Record<string, string>)["Zotero-API-Key"], "A".repeat(32));
    assert.deepEqual(JSON.parse(String(init?.body)), { title: "Changed" });
    return new Response(null, { status: 204, headers });
  } }, secrets);
  await writer.updateItem(detail, metadataPatch(data, { title: "Changed", date: "2024" }));
  assert.deepEqual(calls, ["GET /api/", "POST /api/local/authorize", "PATCH /api/users/0/items/ITEM0001"]);
  assert.equal(secrets.values.size, 1);
});

test("Einmalige Freigaben werden nicht dauerhaft gespeichert und alte Zotero-Versionen erhalten keine Schreibanfrage", async () => {
  const secrets = secretStore(); let calls = 0;
  const writer = new ZoteroWriter({ fetch: async (input) => {
    calls++;
    const url = new URL(String(input));
    return url.pathname === "/api/" ? new Response("", { headers })
      : url.pathname === "/api/local/authorize" ? new Response(JSON.stringify({ key: "B".repeat(32), remember: false }), { headers })
        : new Response(null, { status: 204, headers });
  } }, secrets);
  await writer.updateItem(detail, { title: "Change" });
  assert.equal(secrets.values.size, 0);
  const { serverId: _ignored, ...olderDetail } = detail;
  await assert.rejects(writer.updateItem(olderDetail, { title: "Change" }), (error: unknown) => error instanceof ZoteroError && error.code === "WRITE_UNSUPPORTED");
  assert.equal(calls, 3);
});

test("Versionskonflikte lösen keinen automatischen Überschreibversuch aus", async () => {
  let writes = 0;
  const writer = new ZoteroWriter({ serverId: "database-A", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/local/authorize") return new Response(JSON.stringify({ key: "C".repeat(32), remember: false }), { headers });
    writes++; return new Response("", { status: 412, headers });
  } }, secretStore());
  await assert.rejects(writer.updateItem(detail, { title: "Conflict" }), (error: unknown) => error instanceof ZoteroError && error.code === "CONFLICT");
  assert.equal(writes, 1);
});

test("Widerrufene gespeicherte Freigaben werden genau einmal neu angefordert", async () => {
  const secrets = secretStore(); await secrets.store("zotero-local:http://localhost:23119/api/:database-A", "X".repeat(32));
  let authorizations = 0; let writes = 0;
  const writer = new ZoteroWriter({ serverId: "database-A", fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/local/authorize") { authorizations++; return new Response(JSON.stringify({ key: "N".repeat(32), remember: true }), { headers }); }
    writes++; return writes === 1 ? new Response("", { status: 401, headers }) : new Response(null, { status: 204, headers });
  } }, secrets);
  await writer.updateItem(detail, { title: "Authorized" });
  assert.equal(writes, 2); assert.equal(authorizations, 1);
  assert.equal([...secrets.values.values()][0], "N".repeat(32));
});

test("Verweigerte Freigaben und geschützte Felder verändern keinen Zotero-Eintrag", async () => {
  let writes = 0;
  const writer = new ZoteroWriter({ fetch: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/local/authorize") return new Response("", { status: 403, headers });
    writes++; return new Response(null, { status: 204, headers });
  } }, secretStore());
  assert.throws(() => metadataPatch(data, { version: 8 }));
  assert.throws(() => metadataPatch(data, JSON.parse('{"__proto__": {"evil": true}}')));
  await assert.rejects(writer.updateItem(detail, { title: 42 }));
  await assert.rejects(writer.updateItem(detail, { title: "Denied" }), /denied/);
  assert.equal(writes, 0);
});
