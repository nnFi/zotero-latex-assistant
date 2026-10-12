import assert from "node:assert/strict";
import { test } from "node:test";
import { BetterBibtexClient } from "../src/zotero/betterBibtex";
import { ZoteroError } from "../src/shared/errors";
import { exportProjectItems } from "../src/biblatex/exporter";

function client(handler: (method: string, params: unknown[]) => unknown, nativeServer = "database-A") {
  return new BetterBibtexClient({ serverId: "database-A", fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/") return new Response("", { headers: { "Zotero-API-Version": "3", "Zotero-Server-ID": nativeServer } });
    assert.equal(url.pathname, "/better-bibtex/json-rpc");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const request = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] };
    assert.ok(["api.ready", "item.citationkey", "item.search", "user.groups", "item.export"].includes(request.method));
    const result = request.method === "api.ready" ? { betterbibtex: "8.0", zotero: "10.0" } : handler(request.method, request.params);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  } });
}

test("Better-BibTeX-Schlüssel der persönlichen Bibliothek werden über die dokumentierte lesende RPC-Methode übernommen", async () => {
  const bbt = client((method, params) => { assert.equal(method, "item.citationkey"); assert.deepEqual(params, [["ITEM0001"]]); return { ITEM0001: "Mueller2024Methoden" }; });
  assert.deepEqual(await bbt.citationKeys({ type: "user", id: 0 }, ["ITEM0001"]), { ITEM0001: "Mueller2024Methoden" });
});

test("Gruppen-IDs werden nicht mit internen BBT-libraryIDs verwechselt; die CSL-URI bestimmt die richtige Gruppe", async () => {
  const bbt = client((method) => { assert.equal(method, "item.search"); return [
    { id: "http://zotero.org/groups/42/items/ITEM0001", citekey: "Group2024Correct" },
    { id: "http://zotero.org/groups/99/items/ITEM0001", citekey: "WrongGroup" },
  ]; });
  assert.deepEqual(await bbt.citationKeys({ type: "group", id: 42 }, ["ITEM0001"]), { ITEM0001: "Group2024Correct" });
  await assert.rejects(client(() => [{ id: "http://zotero.org/groups/99/items/ITEM0001", citekey: "Wrong" }]).citationKeys({ type: "group", id: 42 }, ["ITEM0001"]), /unambiguously/);
});

test("Ohne Plugin ist ein nativer Fallback möglich; Netzwerk- oder ungültige Plugin-Antworten werden nicht verschwiegen", async () => {
  const absent = new BetterBibtexClient({ fetch: async (input) => new URL(String(input)).pathname === "/api/"
    ? new Response("", { headers: { "Zotero-API-Version": "3" } }) : new Response("", { status: 404 }) });
  assert.equal(await absent.citationKeys({ type: "user", id: 0 }, ["ITEM0001"]), undefined);
  await assert.rejects(client(() => ({ ITEM0001: "x}\\input{file}" })).citationKeys({ type: "user", id: 0 }, ["ITEM0001"]), /Invalid citation key/);
  await assert.rejects(client(() => ({}), "database-B").citationKeys({ type: "user", id: 0 }, ["ITEM0001"]), (error: unknown) => error instanceof ZoteroError && error.code === "CONFLICT");
});

test("Mehrere Quellen werden gebündelt in höchstens 50 Schlüsseln pro Plugin-Abfrage gelesen", async () => {
  const sizes: number[] = [];
  const keys = Array.from({ length: 51 }, (_, i) => String(i).padStart(8, "0"));
  const bbt = client((_method, params) => { const batch = params[0] as string[]; sizes.push(batch.length); return Object.fromEntries(batch.map((key) => [key, `Author${key}`])); });
  assert.equal(Object.keys((await bbt.citationKeys({ type: "user", id: 0 }, keys))!).length, 51);
  assert.deepEqual(sizes, [50, 1]);
});

test("The full Better BibLaTeX translator preserves fields, strings and LaTeX markup", async () => {
  const bibliography = "@string{publisher = {Example Press}}\n@article{Mueller2024,\n title = {A {LaTeX} study},\n journaltitle = {Journal},\n date = {2024-03-12},\n langid = {german},\n eprinttype = {arxiv},\n eprint = {2403.12345},\n urldate = {2026-10-11},\n publisher = publisher\n}\n";
  const bbt = client((method, params) => {
    if (method === "item.citationkey") return { ITEM0001: "Mueller2024" };
    assert.equal(method, "item.export");
    assert.deepEqual(params, [["Mueller2024"], "Better BibLaTeX"]);
    return bibliography;
  });
  assert.deepEqual(await bbt.exportItems({ type: "user", id: 0 }, ["ITEM0001"]), { ITEM0001: bibliography });
  assert.equal(await bbt.exportItem({ type: "user", id: 0 }, "ITEM0001"), bibliography);
  assert.deepEqual(await exportProjectItems(bbt, { type: "user", id: 0 }, ["ITEM0001"], { ITEM0001: "StableProject2024" }),
    [bibliography.replace("@article{Mueller2024,", "@article{StableProject2024,")]);
});

test("Group exports use the verified internal BBT library ID rather than the external group ID", async () => {
  const bbt = client((method, params) => {
    if (method === "item.search") return [
      { id: "http://zotero.org/groups/42/items/ITEM0001", citekey: "Group2024", library: "Science" },
      { id: "http://zotero.org/groups/99/items/ITEM0001", citekey: "Wrong2024", library: "Other" },
    ];
    if (method === "user.groups") { assert.deepEqual(params, [false]); return [{ id: 7, name: "Science" }, { id: 42, name: "Different group" }]; }
    assert.equal(method, "item.export");
    assert.deepEqual(params, [["Group2024"], "Better BibLaTeX", 7]);
    return "@book{Group2024,title={Correct group}}";
  });
  assert.deepEqual(await bbt.exportItems({ type: "group", id: 42 }, ["ITEM0001"]), { ITEM0001: "@book{Group2024,title={Correct group}}" });
});

test("Duplicate library names prevent an ambiguous group export", async () => {
  const bbt = client((method) => {
    if (method === "item.search") return [{ id: "http://zotero.org/groups/42/items/ITEM0001", citekey: "Group2024", library: "Science" }];
    assert.equal(method, "user.groups", "An ambiguous scope must not reach item.export");
    return [{ id: 7, name: "Science" }, { id: 8, name: "Science" }];
  });
  await assert.rejects(bbt.exportItems({ type: "group", id: 42 }, ["ITEM0001"]), /identified unambiguously/);
});

test("Missing BBT never silently invokes native metadata export", async () => {
  const absent = new BetterBibtexClient({ fetch: async (input) => {
    const url = new URL(String(input));
    assert.ok(["/api/", "/better-bibtex/json-rpc"].includes(url.pathname));
    return url.pathname === "/api/" ? new Response("", { headers: { "Zotero-API-Version": "3" } }) : new Response("", { status: 404 });
  } });
  await assert.rejects(absent.exportItems({ type: "user", id: 0 }, ["ITEM0001"]), /requires Better BibTeX/);
  await assert.rejects(absent.exportItem({ type: "user", id: 0 }, "ITEM0001"), /requires Better BibTeX/);
});

test("Incomplete, unexpected or mismatched translator results fail before producing project exports", async () => {
  for (const result of [null, { result: "@book{Author2024,title={Wrapped}}" }, "", "@book{Author2024,title={Incomplete}",
    "@book{Wrong2024,title={Different source}}", "@book{Author2024,title={A}}\n@book{Extra2024,title={B}}"] ) {
    const bbt = client((method) => method === "item.citationkey" ? { ITEM0001: "Author2024" } : result);
    await assert.rejects(bbt.exportItems({ type: "user", id: 0 }, ["ITEM0001"]));
  }
});

test("Duplicate source citation keys cannot export the same BBT record twice", async () => {
  const bbt = client((method) => {
    assert.equal(method, "item.citationkey");
    return { ITEM0001: "Duplicated", ITEM0002: "Duplicated" };
  });
  await assert.rejects(bbt.exportItems({ type: "user", id: 0 }, ["ITEM0001", "ITEM0002"]), /duplicate citation keys/);
});

test("Optional reference lookup tolerates deleted sources while ordinary citation lookup remains strict", async () => {
  const bbt = client(() => ({ ITEM0001: "Existing2024", ITEM0002: null }));
  assert.deepEqual(await bbt.citationKeys({ type: "user", id: 0 }, ["ITEM0001", "ITEM0002"], true), { ITEM0001: "Existing2024" });
  await assert.rejects(bbt.citationKeys({ type: "user", id: 0 }, ["ITEM0001", "ITEM0002"]), /Invalid citation key/);
});
