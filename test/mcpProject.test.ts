import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { newProjectConfig, saveProjectConfig, readProjectText, parseProjectConfig, CONFIG_FILE } from "../src/config/project";
import { ZoteroProjectService } from "../src/zotero/projectService";
import { metadataSchema, metadataUpdateSchema } from "../src/zotero/metadata";
import { codexConfig, claudeConfig, cursorConfig, vscodeConfig, mcpLaunch, configureMcp } from "../src/config/mcp";
import { parse as parseJsonc } from "jsonc-parser";
import { ZoteroError } from "../src/shared/errors";
import { parse } from "smol-toml";

const library = { type: "user" as const, id: 0 };
const collection = "COLL2345";
const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "db-A" };
const metadata = metadataSchema.parse({ itemType: "journalArticle", title: "A scientific test publication", creators: [
  { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
], fields: { date: "2026", DOI: "https://doi.org/10.1234/MCP-Test", publicationTitle: "Test Journal" } });

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-mcp-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { ...newProjectConfig(), library, collectionKey: collection, serverId: "db-A" };
  await saveProjectConfig(root, config);
  const items = new Map<string, Record<string, unknown>>();
  let version = 10; let writes = 0; let authorizations = 0;
  const control = { denied: false, expire: false, conflict: false, droppedResponse: false, badVerification: false,
    changedServer: false, nativeCitationKey: false, createStatus: undefined as number | undefined,
    failedCode: undefined as number | undefined, malformedCreate: false, readStatus: undefined as number | undefined,
    bbtKeys: undefined as Record<string, string> | undefined,
    afterAuthorization: undefined as (() => Promise<void>) | undefined };
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const responseHeaders = control.changedServer ? { ...headers, "Zotero-Server-ID": "db-B" } : headers;
    const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: responseHeaders });
    const entry = (key: string, data: Record<string, unknown>): Record<string, unknown> => ({ key, version: data.version ?? 10, data });
    if (url.pathname === "/api/") return new Response("", { headers: responseHeaders });
    if (url.pathname === "/api/itemTypeFields") return json(["title", "date", "DOI", "ISBN", "publicationTitle", "publisher", "url", "extra", ...(control.nativeCitationKey ? ["citationKey"] : [])].map((field) => ({ field })));

    if (url.pathname === "/api/itemTypeCreatorTypes") return json([{ creatorType: "author" }, { creatorType: "editor" }]);
    if (url.pathname === "/better-bibtex/json-rpc" && control.bbtKeys) {
      const request = JSON.parse(String(init?.body));
      return json({ jsonrpc: "2.0", id: request.id, result: request.method === "api.ready"
        ? { betterbibtex: "8", zotero: "10" } : control.bbtKeys });
    }
    if (url.pathname === "/api/local/authorize") {
      authorizations++;
      if (control.denied) return json({ denied: true }, 403);
      await control.afterAuthorization?.();
      return json({ key: "A".repeat(32), remember: true });
    }
    if (url.pathname === `/api/users/0/collections/${collection}`) return json({ key: collection, data: { name: "Tests", parentCollection: false } });
    if (url.pathname === "/api/users/0/collections") return json([{ key: collection, data: { name: "Tests" } }]);
    if (url.pathname === "/api/users/0/groups") return json([]);
    if (init?.method === "POST" && url.pathname === "/api/users/0/items") {
      writes++;
      if (control.expire) { control.expire = false; return json({}, 401); }
      if (control.conflict) return json({}, 412);
      if (control.createStatus) return json({}, control.createStatus);
      const data = (JSON.parse(String(init.body)) as Record<string, unknown>[])[0]!;
      assert.equal(data.version, 0);
      assert.match(String(data.key), /^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$/);
      const key = String(data.key);
      if (control.failedCode) return json({ successful: {}, unchanged: {}, failed: { 0: { key, code: control.failedCode, message: "Rejected" } } });
      if (control.malformedCreate) return json({ successful: {}, failed: {}, unchanged: {} });
      data.version = ++version;
      data.creators = (data.creators as Record<string, unknown>[]).map((creator) => Object.fromEntries(Object.entries(creator).reverse()));
      items.set(key, data);
      if (control.droppedResponse) throw new TypeError("simulated lost response");
      return json({ successful: { "0": entry(key, data) }, failed: {}, unchanged: {} });
    }
    const key = url.pathname.split("/").at(-1)!;
    if (init?.method === "PATCH") {
      writes++;
      assert.equal(init.headers && (init.headers as Record<string, string>)["Zotero-Server-ID"], "db-A");
      if (control.conflict) return json({}, 412);
      const data = items.get(key)!;
      assert.equal((init.headers as Record<string, string>)["If-Unmodified-Since-Version"], String(data.version));
      const patch = JSON.parse(String(init.body));
      if (!control.badVerification) { Object.assign(data, patch); if (patch.deleted === 1) data.deleted = true; data.version = ++version; }
      return new Response(null, { status: 204, headers });
    }
    if (key === "trash") return json([...items].filter(([key, data]) => (!url.searchParams.has("itemKey") || key === url.searchParams.get("itemKey")) && !!data.deleted).map(([key, data]) => entry(key, data)));
    if (items.has(key)) return control.readStatus ? json({}, control.readStatus) : json(entry(key, items.get(key)!));
    if (url.pathname.endsWith("/top") || url.pathname === "/api/users/0/items") {
      return json([...items].filter(([, data]) => !data.deleted
        && (!url.pathname.includes("/collections/") || (data.collections as string[]).includes(collection)))
        .filter(([, data]) => !url.searchParams.get("q") || String(data.title).includes(url.searchParams.get("q")!))
        .map(([key, data]) => entry(key, data)));
    }
    return json({}, 404);
  };
  const service = new ZoteroProjectService(root, { fetch });
  const seed = (key = "ITEM2345", changes: Record<string, unknown> = {}): void => {
    items.set(key, { itemType: metadata.itemType, title: metadata.title, creators: metadata.creators,
      ...metadata.fields, DOI: "10.1234/mcp-test", collections: [collection], tags: [], relations: {}, version: 10, ...changes });
  };
  return { root, config, items, control, calls, service, seed, counts: () => ({ writes, authorizations }), fetch };
}

test("real source creation verifies stored key, version and selected collection; retries survive a new service", async (t) => {
  const f = await fixture(t);
  const created = await f.service.create(metadata, "request-001", false) as { status: string; item: { key: string }; version: number; data: Record<string, unknown> };
  assert.equal(created.status, "created"); assert.equal(created.version, 11);
  assert.deepEqual(created.data.collections, [collection]);
  assert.equal(created.data.DOI, "10.1234/mcp-test");
  const repeated = await new ZoteroProjectService(f.root, { fetch: f.fetch }).create(metadata, "request-001", false) as { status: string };
  assert.equal(repeated.status, "already-created"); assert.equal(f.counts().writes, 1);
  assert.equal((await f.service.search("scientific", 20, 0) as { total: number }).total, 1);
  assert(!JSON.stringify(created).includes("A".repeat(32)));
  await assert.rejects(f.service.create({ ...metadata, title: "Different source" }, "request-001", false), /already used/);
});

test("title-only sources remain creatable; fixed Extra keys survive retries and preserve unrelated metadata", async (t) => {
  const f = await fixture(t);
  const minimal = metadataSchema.parse({ itemType: "book", title: "Anonymous undated source", fields: { extra: "Original note" } });
  const result = await f.service.create(minimal, "minimal-request-1", false) as {
    item: { key: string }; citationKey: string; data: { extra: string; creators: unknown[] }; completeness: { complete: boolean; missingRecommended: string[] };
  };
  assert.equal(result.completeness.complete, true);
  assert(result.completeness.missingRecommended.includes("date"));
  assert(result.completeness.missingRecommended.includes("creators"));
  assert.deepEqual(result.data.creators, []);
  assert.equal(result.data.extra, `Original note\nCitation Key: ${result.citationKey}`);
  const retry = await new ZoteroProjectService(f.root, { fetch: f.fetch }).create(minimal, "minimal-request-1", false) as { citationKey: string };
  assert.equal(retry.citationKey, result.citationKey); assert.equal(f.counts().writes, 1);
  const updated = await f.service.update(library, result.item.key, 11, { title: "Corrected title" }) as { item: { citationKey: string } };
  assert.equal(updated.item.citationKey, result.citationKey);
});

test("native citation keys are stored directly and conflicts between supplied keys are rejected", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  const input = metadataSchema.parse({ itemType: "book", title: "A native key", citationKey: "custom2026", fields: { extra: "Note\nCitation Key: custom2026" } });
  const result = await f.service.create(input, "native-request-1", false) as { citationKey: string; data: { citationKey: string; extra: string } };
  assert.equal(result.citationKey, "custom2026"); assert.equal(result.data.citationKey, "custom2026"); assert.equal(result.data.extra, "Note");
  await assert.rejects(f.service.create({ ...input, fields: { extra: "Citation Key: different" } }, "native-request-2", false), /Conflicting/);
  await assert.rejects(f.service.create({ ...input, title: "A separate source", fields: {} }, "native-request-3", false), /already in use/);
  assert.equal(f.counts().writes, 1);
});

test("metadata guidance keeps existing oversized and incomplete library entries readable", async (t) => {
  const f = await fixture(t);
  f.seed("ITEM2345", { title: "A".repeat(1100), abstractNote: "B".repeat(51000), creators: [{ creatorType: "author", firstName: "", lastName: "" }] });
  const result = await f.service.metadata(library, "ITEM2345") as { data: { abstractNote: string }; completeness: { missingRecommended: string[] } };
  assert.equal(result.data.abstractNote.length, 51000);
  assert(result.completeness.missingRecommended.includes("creators"));
});

test("citation-key collision appearing during Zotero authorization prevents a write", async (t) => {
  const f = await fixture(t);
  f.control.afterAuthorization = async () => { f.seed("ITEM2345", { title: "Different source", DOI: "", extra: "Citation Key: chosenKey" }); };
  await assert.rejects(f.service.create(metadataSchema.parse({ itemType: "book", title: "Only a title", citationKey: "chosenKey" }), "collision-request", false), /already in use/);
  assert.equal(f.counts().writes, 0);
});

test("identifier imports freeze metadata for retries after an uncertain response and expose provenance", async (t) => {
  const f = await fixture(t); let lookups = 0;
  const external: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.crossref.org") {
      lookups++; assert.equal(lookups, 1, "retry must not contact provider again");
      return new Response(JSON.stringify({ message: { DOI: "10.1234/import", type: "journal-article", title: ["Imported source"],
        author: [{ family: "Müller" }], "container-title": ["Journal"], issued: { "date-parts": [[2024]] } } }));
    }
    return f.fetch(input, init);
  };
  const service = new ZoteroProjectService(f.root, { fetch: external });
  const preview = await service.lookupIdentifier("10.1234/import");
  assert.equal(preview.metadata.itemType, "journalArticle"); assert.equal(f.counts().writes, 0); lookups = 0;
  f.control.droppedResponse = true;
  await assert.rejects(service.importIdentifier("10.1234/import", "identifier-request-1", { fields: { date: "2025" } }, "import2025"));
  f.control.droppedResponse = false;
  const restartedFetch: typeof globalThis.fetch = (input, init) => external(input, init);
  const restarted = new ZoteroProjectService(f.root, { fetch: restartedFetch });
  const result = await restarted.importIdentifier("https://doi.org/10.1234/import", "identifier-request-1",
    { fields: { date: "2025" } }, "import2025") as { status: string; citationKey: string; data: { date: string }; provenance: { provider: string } };
  assert.equal(result.status, "already-created"); assert.equal(result.citationKey, "import2025"); assert.equal(result.data.date, "2025");
  assert.equal(result.provenance.provider, "crossref"); assert.equal(lookups, 1); assert.equal(f.counts().writes, 1);
  await assert.rejects(restarted.importIdentifier("10.1234/import", "identifier-request-1", { fields: { date: "2026" } }, "import2025"), /different input/);
});

test("ISBN import works with missing author/date/publisher; equivalent editions are blocked even with override", async (t) => {
  const f = await fixture(t);
  const external: typeof globalThis.fetch = async (input, init) => new URL(String(input)).hostname === "openlibrary.org"
    ? new Response(JSON.stringify({ "ISBN:9780306406157": { title: "Incomplete edition", identifiers: { isbn_10: ["0306406152"] } } })) : f.fetch(input, init);
  const service = new ZoteroProjectService(f.root, { fetch: external });
  const result = await service.importIdentifier("0306406152", "isbn-request-1") as { status: string; completeness: { complete: boolean; missingRecommended: string[] } };
  assert.equal(result.status, "created"); assert.equal(result.completeness.complete, true); assert(result.completeness.missingRecommended.includes("publisher"));
  const duplicate = await service.importIdentifier("9780306406157", "isbn-request-2", {}, undefined, true) as { status: string; matches: { reason: string }[] };
  assert.equal(duplicate.status, "duplicate-blocked"); assert.equal(duplicate.matches[0]?.reason, "isbn"); assert.equal(f.counts().writes, 1);
  await assert.rejects(service.importIdentifier("9780306406157", "isbn-request-3", { fields: { ISBN: "9780140328721" } }), /preserve/);
});

test("institutional DOI metadata and mapping guidance survive schema filtering, writes and frozen retries", async (t) => {
  for (const provider of ["crossref", "datacite"]) {
    for (const itemType of ["thesis", "report"]) {
      for (const supplied of provider === "crossref" ? [true, false] : [false]) {
        await t.test(`${provider} ${itemType}, institution ${supplied ? "supplied" : "missing"}`, async (t) => {
          const f = await fixture(t); const field = itemType === "thesis" ? "university" : "institution"; let lookups = 0;
          const fetch: typeof globalThis.fetch = async (input, init) => {
            const url = new URL(String(input));
            if (url.hostname === "api.crossref.org") {
              if (provider === "datacite") return new Response("{}", { status: 404 });
              lookups++;
              return new Response(JSON.stringify({ message: { DOI: "10.1234/institution", type: itemType === "thesis" ? "dissertation" : "report",
                title: ["Institutional source"], publisher: "Commercial Publisher", institution: supplied ? [{ name: "Actual Institution" }] : [],
                author: [{ family: "Researcher", affiliation: [{ name: "Author Institution" }] }] } }));
            }
            if (url.hostname === "api.datacite.org") {
              lookups++;
              return new Response(JSON.stringify({ data: { attributes: { doi: "10.1234/institution", types: { resourceTypeGeneral: itemType === "thesis" ? "Dissertation" : "Report" },
                titles: [{ title: "Institutional source" }], publisher: "External Repository", contributors: [{ name: "Hosting University", contributorType: "HostingInstitution" }] } } }));
            }
            if (url.pathname === "/api/itemTypeFields") return new Response(JSON.stringify(["title", "date", "url", "extra", field].map((field) => ({ field }))), { headers });
            return f.fetch(input, init);
          };
          const service = new ZoteroProjectService(f.root, { fetch });
          const preview = await service.lookupIdentifier("10.1234/institution");
          assert.equal(preview.metadata.fields[field], supplied ? "Actual Institution" : undefined);
          assert.equal(preview.warnings.length, supplied ? 0 : 1);
          assert.equal(preview.completeness.complete, true); assert.equal(f.counts().writes, 0);
          assert.match(preview.metadata.fields.extra!, /DOI: 10\.1234\/institution/);
          f.control.droppedResponse = true;
          await assert.rejects(service.importIdentifier("10.1234/institution", "institution-import"));
          f.control.droppedResponse = false;
          const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => fetch(input, init) })
            .importIdentifier("10.1234/institution", "institution-import") as { status: string; data: Record<string, unknown>; lookupWarnings: string[] };
          assert.equal(result.status, "already-created");
          assert.equal(result.data[field], supplied ? "Actual Institution" : undefined);
          assert.equal(result.data.publisher, undefined); assert.deepEqual(result.lookupWarnings, preview.warnings);
          assert.equal(lookups, 2); assert.equal(f.counts().writes, 1);
        });
      }
    }
  }
});

test("verified manual institution overrides remain possible when a DOI provider leaves the role unproven", async (t) => {
  const f = await fixture(t);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.crossref.org") return new Response(JSON.stringify({ message: { DOI: "10.1234/manual-institution", type: "dissertation",
      title: ["Reviewed thesis"], publisher: "External Repository" } }));
    if (url.pathname === "/api/itemTypeFields") return new Response(JSON.stringify(["title", "university", "extra", "url"].map((field) => ({ field }))), { headers });
    return f.fetch(input, init);
  };
  const result = await new ZoteroProjectService(f.root, { fetch }).importIdentifier("10.1234/manual-institution", "reviewed-university",
    { fields: { university: "Verified University" } }) as { status: string; data: { university: string; publisher?: string }; lookupWarnings: string[] };
  assert.equal(result.status, "created"); assert.equal(result.data.university, "Verified University"); assert.equal(result.data.publisher, undefined);
  assert.equal(result.lookupWarnings.length, 1);
});

test("DOI import into a type without native DOI preserves it in Extra and still detects duplicates", async (t) => {
  const f = await fixture(t);
  const external: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "api.crossref.org") return new Response(JSON.stringify({ message: { DOI: "10.1234/book", type: "book", title: ["Book with DOI"] } }));
    if (url.pathname === "/api/itemTypeFields") return new Response(JSON.stringify(["title", "date", "publisher", "extra", "url"].map((field) => ({ field }))), { headers });
    return f.fetch(input, init);
  };
  const service = new ZoteroProjectService(f.root, { fetch: external });
  const result = await service.importIdentifier("10.1234/book", "extra-doi-request1") as { data: { extra: string }; status: string };
  assert.equal(result.status, "created"); assert.match(result.data.extra, /DOI: 10\.1234\/book/);
  const duplicate = await service.importIdentifier("10.1234/book", "extra-doi-request2", {}, undefined, true) as { status: string; matches: { reason: string }[] };
  assert.equal(duplicate.status, "duplicate-blocked"); assert.equal(duplicate.matches[0]?.reason, "doi");
});

test("normalized DOI duplicates anywhere in library block even with override; probable matches require explicit override", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { collections: ["OTHER234"] });
  assert.equal((await f.service.create(metadata, "request-002", true) as { status: string }).status, "duplicate-blocked");
  assert.equal(f.counts().writes, 0);
  f.items.clear(); f.seed("ITEM2345", { DOI: "" });
  assert.equal((await f.service.create(metadata, "request-003", false) as { status: string }).status, "duplicate-blocked");
  assert.equal((await f.service.create(metadata, "request-003", true) as { status: string }).status, "created");
});

test("trash is conditional PATCH, verified in trash endpoint, repeatable, with collection/citation warnings and untouched project files", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { collections: [collection, "OTHER234"] });
  const config = { ...f.config, importedItemKeys: ["ITEM2345"], citationKeys: { ITEM2345: "ada2026" } };
  await saveProjectConfig(f.root, config, await readProjectText(f.root, CONFIG_FILE));
  await writeFile(path.join(f.root, "main.tex"), "Text \\autocite{ada2026}.");
  const before = await readProjectText(f.root, "main.tex");
  const preview = await f.service.metadata(library, "ITEM2345") as { warnings: { citationFiles: string[] } };
  assert.deepEqual(preview.warnings.citationFiles, ["main.tex"]);
  const result = await f.service.delete(library, "ITEM2345", 10) as { status: string; warnings: { otherCollectionKeys: string[]; importedInProject: boolean } };
  assert.equal(result.status, "trashed"); assert.deepEqual(result.warnings.otherCollectionKeys, ["OTHER234"]);
  assert(result.warnings.importedInProject);
  assert.equal(await readProjectText(f.root, "main.tex"), before);
  assert.equal((await f.service.delete(library, "ITEM2345", 10) as { status: string }).status, "already-trashed");
  assert.equal(f.counts().writes, 1); assert(!f.calls.some((call) => call.init?.method === "DELETE"));
});

test("existing bibliography presence resolves an external Extra citation key before trash warnings", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { extra: "Citation Key: external2026" });
  await saveProjectConfig(f.root, { ...f.config, bibFile: "refs.bib" }, await readProjectText(f.root, CONFIG_FILE));
  await writeFile(path.join(f.root, "refs.bib"), "@article{external2026,title={External source}}\n");
  await writeFile(path.join(f.root, "main.tex"), String.raw`Text \autocite{external2026}.`);
  const detail = await f.service.metadata(library, "ITEM2345") as { warnings: { citationKey: string; citationFiles: string[]; inProjectBibliography: boolean } };
  assert.equal(detail.warnings.citationKey, "external2026");
  assert.equal(detail.warnings.inProjectBibliography, true);
  assert.deepEqual(detail.warnings.citationFiles, ["main.tex"]);
});

test("writes require collection, saved server ID and configured library", async (t) => {
  const f = await fixture(t);
  for (const change of [{ collectionKey: "" }, { serverId: undefined }, { library: null, collectionKey: "", serverId: undefined }]) {
    await saveProjectConfig(f.root, parseProjectConfig({ ...f.config, ...change }), await readProjectText(f.root, CONFIG_FILE));
    await assert.rejects(f.service.create(metadata, "request-004", false));
  }
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
});

test("foreign library and collection sources are blocked before authorization", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { collections: ["OTHER234"] });
  await assert.rejects(f.service.delete({ type: "group", id: 42 }, "ITEM2345", 10), /outside/);
  await assert.rejects(f.service.delete(library, "ITEM2345", 10), /does not belong/);
  await assert.rejects(f.service.metadata(library, "ITEM2345"), /does not belong/);
  assert.equal(f.counts().authorizations, 0);
});

test("denied authorization makes no changes and does not expose credential data", async (t) => {
  const f = await fixture(t); f.control.denied = true; f.seed();
  await assert.rejects(f.service.create(metadataSchema.parse({ ...metadata, fields: {} }), "request-005", true), /denied/);
  await assert.rejects(f.service.delete(library, "ITEM2345", 10), /denied/);
  assert.equal(f.counts().writes, 0);
});

test("database change and reviewed-version conflict stop writes without automatic overwrites", async (t) => {
  const f = await fixture(t); f.seed();
  await assert.rejects(f.service.delete(library, "ITEM2345", 9), /version changed/);
  f.control.changedServer = true;
  await assert.rejects(f.service.delete(library, "ITEM2345", 10), (error: unknown) => error instanceof ZoteroError && error.code === "CONFLICT");
  assert.equal(f.counts().writes, 0);
});

test("membership, version, configuration and database changes during authorization are rechecked", async (t) => {
  for (const kind of ["membership", "version", "config", "server"] as const) {
    const f = await fixture(t); f.seed();
    f.control.afterAuthorization = async () => {
      if (kind === "membership") f.items.get("ITEM2345")!.collections = ["OTHER234"];
      if (kind === "version") f.items.get("ITEM2345")!.version = 11;
      if (kind === "config") await saveProjectConfig(f.root, { ...f.config, collectionKey: "OTHER234" }, await readProjectText(f.root, CONFIG_FILE));
      if (kind === "server") f.control.changedServer = true;
    };
    await assert.rejects(f.service.delete(library, "ITEM2345", 10));
    assert.equal(f.counts().writes, 0, kind);
  }
});

test("newly introduced DOI duplicate during authorization blocks create", async (t) => {
  const f = await fixture(t); f.control.afterAuthorization = async () => f.seed();
  await assert.rejects(f.service.create(metadata, "request-006", false), /duplicate appeared/);
  assert.equal(f.counts().writes, 0);
});

test("API version conflicts and failed trash verification are surfaced", async (t) => {
  const f = await fixture(t); f.seed(); f.control.conflict = true;
  await assert.rejects(f.service.delete(library, "ITEM2345", 10), (error: unknown) => error instanceof ZoteroError && error.code === "CONFLICT");
  assert.equal(f.counts().writes, 1);
  f.control.conflict = false; f.control.badVerification = true;
  await assert.rejects(f.service.delete(library, "ITEM2345", 10), /trash state could not be verified/);
});

test("expired remembered grant is reauthorized once", async (t) => {
  const f = await fixture(t); f.control.expire = true;
  await f.service.create(metadata, "request-007", false);
  assert.equal(f.counts().writes, 2); assert.equal(f.counts().authorizations, 2);
});

test("lost create response is reconciled by preallocated key without resubmission", async (t) => {
  const f = await fixture(t); f.control.droppedResponse = true;
  await assert.rejects(f.service.create(metadata, "request-008", false));
  // New transport models restarting the MCP process after a connection interruption.
  const fetch: typeof globalThis.fetch = (input, init) => f.fetch(input, init);
  const retried = await new ZoteroProjectService(f.root, { fetch }).create(metadata, "request-008", false) as { status: string };
  assert.equal(retried.status, "already-created"); assert.equal(f.counts().writes, 1);
});

test("an unresolved create with absent allocated key will never be resubmitted", async (t) => {
  const f = await fixture(t); f.control.droppedResponse = true;
  await assert.rejects(f.service.create(metadata, "request-009", false));
  f.items.clear();
  const fetch: typeof globalThis.fetch = (input, init) => f.fetch(input, init);
  await assert.rejects(new ZoteroProjectService(f.root, { fetch }).create(metadata, "request-009", false), /unresolved/);
  assert.equal(f.counts().writes, 1);
});

test("a definitively rejected source creation retries the same request and allocated key after restart", async (t) => {
  const f = await fixture(t); f.control.createStatus = 403;
  await assert.rejects(f.service.create(metadata, "rejected-request", false));
  assert.equal(f.items.size, 0);
  f.control.createStatus = undefined;
  const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) })
    .create(metadata, "rejected-request", false) as { status: string; item: { key: string } };
  assert.equal(result.status, "created"); assert.equal(f.counts().writes, 2); assert.equal(f.items.size, 1);
  const postedKeys = f.calls.filter(({ url, init }) => url.pathname === "/api/users/0/items" && init?.method === "POST")
    .map(({ init }) => JSON.parse(String(init!.body))[0].key);
  assert.deepEqual(postedKeys, [result.item.key, result.item.key]);
});

test("source journals distinguish explicit no-write HTTP and batch rejections from uncertain responses", async (t) => {
  for (const status of [400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 428, 429]) {
    await t.test(`HTTP ${status} permits a retry with the reserved key`, async (t) => {
      const f = await fixture(t); f.control.createStatus = status;
      await assert.rejects(f.service.create(metadata, "http-rejection", false), (error: unknown) => error instanceof ZoteroError && error.status === status);
      f.control.createStatus = undefined;
      const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) }).create(metadata, "http-rejection", false) as { item: { key: string } };
      const keys = f.calls.filter(({ url, init }) => url.pathname === "/api/users/0/items" && init?.method === "POST")
        .map(({ init }) => JSON.parse(String(init!.body))[0].key);
      assert.equal(keys.length, status === 401 ? 3 : 2);
      assert(keys.every((key) => key === result.item.key)); assert.equal(f.items.size, 1);
    });
  }
  for (const code of [400, 403, 412]) {
    await t.test(`batch row rejection ${code} permits a retry`, async (t) => {
      const f = await fixture(t); f.control.failedCode = code;
      await assert.rejects(f.service.create(metadata, "row-rejection", false));
      f.control.failedCode = undefined;
      const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) }).create(metadata, "row-rejection", false) as { status: string };
      assert.equal(result.status, "created"); assert.equal(f.counts().writes, 2);
    });
  }
  for (const scenario of [408, 500, 501, 503, "malformed", "failed-500"] as const) {
    await t.test(`${scenario} remains unresolved and is never resubmitted`, async (t) => {
      const f = await fixture(t);
      if (typeof scenario === "number") f.control.createStatus = scenario;
      if (scenario === "malformed") f.control.malformedCreate = true;
      if (scenario === "failed-500") f.control.failedCode = 500;
      await assert.rejects(f.service.create(metadata, "uncertain-request", false));
      const retry = new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) });
      await assert.rejects(retry.create(metadata, "uncertain-request", false), /unresolved/);
      assert.equal(f.counts().writes, 1);
    });
  }
});

test("revoked grant followed by denied renewal leaves source creation safely retryable", async (t) => {
  const f = await fixture(t); f.control.expire = true;
  f.control.afterAuthorization = async () => { f.control.denied = true; };
  await assert.rejects(f.service.create(metadata, "renewal-request", false), /denied/);
  assert.equal(f.counts().writes, 1); assert.equal(f.items.size, 0);
  f.control.denied = false; f.control.afterAuthorization = undefined;
  const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) }).create(metadata, "renewal-request", false) as { status: string };
  assert.equal(result.status, "created"); assert.equal(f.counts().writes, 2);
});

test("a lost source response after reauthorization restores the uncertain state", async (t) => {
  const f = await fixture(t); f.control.expire = true; f.control.droppedResponse = true;
  await assert.rejects(f.service.create(metadata, "renewal-timeout", false));
  assert.equal(f.counts().writes, 2); f.items.clear();
  await assert.rejects(new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) }).create(metadata, "renewal-timeout", false), /unresolved/);
  assert.equal(f.counts().writes, 2);
});

test("rejected source retries still enforce original metadata and citation-key availability", async (t) => {
  const f = await fixture(t); f.control.createStatus = 403;
  const input = { ...metadata, citationKey: "retryKey" };
  await assert.rejects(f.service.create(input, "guarded-retry", false));
  f.control.createStatus = undefined;
  await assert.rejects(f.service.create({ ...input, title: "Changed" }, "guarded-retry", false), /already used/);
  f.seed("OTHER234", { title: "Another source", DOI: "", extra: "Citation Key: retryKey" });
  await assert.rejects(f.service.create(input, "guarded-retry", false), /already in use/);
  assert.equal(f.counts().writes, 1);
});

test("HTTP rejection from the verification GET never marks a successful source POST as rejected", async (t) => {
  const f = await fixture(t); f.control.readStatus = 403;
  await assert.rejects(f.service.create(metadata, "verification-request", false));
  assert.equal(f.items.size, 1); f.items.clear(); f.control.readStatus = undefined;
  await assert.rejects(f.service.create(metadata, "verification-request", false), /unresolved/);
  assert.equal(f.counts().writes, 1);
});

test("identifier metadata remains frozen when retrying a definitively rejected creation", async (t) => {
  const f = await fixture(t); f.control.createStatus = 403; let lookups = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).hostname === "api.crossref.org") {
      lookups++;
      return new Response(JSON.stringify({ message: { DOI: "10.1234/retry", type: "book", title: ["Frozen source"] } }));
    }
    return f.fetch(input, init);
  };
  await assert.rejects(new ZoteroProjectService(f.root, { fetch }).importIdentifier("10.1234/retry", "identifier-retry"));
  f.control.createStatus = undefined;
  const result = await new ZoteroProjectService(f.root, { fetch: (input, init) => fetch(input, init) }).importIdentifier("10.1234/retry", "identifier-retry") as { status: string };
  assert.equal(result.status, "created"); assert.equal(lookups, 1); assert.equal(f.counts().writes, 2);
});

test("metadata field/type/creator validation rejects protected fields and non-bibliographic entries", async (t) => {
  const f = await fixture(t);
  for (const invalid of [{ ...metadata, fields: { deleted: "1" } }, { ...metadata, itemType: "attachment" },
    { ...metadata, fields: { DOI: "invalid" } }, { ...metadata, creators: [{ creatorType: "madeUp", name: "Person" }] }]) {
    await assert.rejects(f.service.create(invalid, "request-010", false));
  }
  assert.equal(f.counts().writes, 0);
});

test("cross-process project lock blocks concurrent writes", async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  f.control.afterAuthorization = async () => { ready(); await wait; };
  const first = f.service.create(metadata, "request-011", false);
  await started;
  await assert.rejects(new ZoteroProjectService(f.root, { fetch: f.fetch }).create(metadata, "request-011", false), /Another MCP write/);
  release(); await first;
  assert.equal(f.counts().writes, 1);
});

test("Codex, Claude and Cursor configuration preserve unrelated servers, escaping and explicit scope", async (t) => {
  const f = await fixture(t);
  const launch = mcpLaunch(f.root, path.join(f.root, 'server "quoted".cjs'), "node", "http://localhost:23119/api/", 5000);
  const before = '# preserve comment\n[mcp_servers.other]\ncommand = "other"\n';
  const next = codexConfig(before, launch);
  const parsed = parse(next);
  assert(next.includes("# preserve comment"));
  assert.equal(((parsed.mcp_servers as Record<string, unknown>).other as Record<string, unknown>).command, "other");
  assert.deepEqual(parse(codexConfig(next, launch)), parsed);
  const claude = JSON.parse(claudeConfig('{"mcpServers":{"other":{"command":"other"}},"extra":true}', launch));
  assert.equal(claude.mcpServers.other.command, "other"); assert.equal(claude.extra, true);
  assert.equal(claude.mcpServers.zotero_latex_assistant.args[2], f.root);
  assert.throws(() => codexConfig('[mcp_servers.zotero_latex_assistant]\ncommand="custom"', launch), /unmanaged/);
  assert.throws(() => claudeConfig('{"mcpServers":{"zotero_latex_assistant":{"command":"custom"}}}', launch), /unrelated/);
  assert.equal(await configureMcp(f.root, "codex", launch), ".codex/config.toml");
  assert.equal(await configureMcp(f.root, "claude", launch), ".mcp.json");
  const cursor = JSON.parse(cursorConfig('{"mcpServers":{"other":{"command":"other"}},"extra":true}', launch));
  assert.equal(cursor.mcpServers.other.command, "other"); assert.equal(cursor.extra, true);
  assert.equal(cursor.mcpServers.zotero_latex_assistant.args[0], launch.args[0]);
  assert.equal(cursor.mcpServers.zotero_latex_assistant.args[2], f.root);
  const variable = JSON.stringify({ mcpServers: { zotero_latex_assistant: { type: "stdio", command: "node", args: ["old.cjs", "--project", "${workspaceFolder}"], env: { EXTRA: "keep" } } } });
  const updated = JSON.parse(cursorConfig(variable, launch));
  assert.equal(updated.mcpServers.zotero_latex_assistant.args[0], launch.args[0]);
  assert.equal(updated.mcpServers.zotero_latex_assistant.env.EXTRA, "keep");
  const standalone = JSON.stringify({ mcpServers: { zotero_latex_assistant: { type: "stdio", command: "node", args: [launch.args[0]], env: { EXTRA: "keep" } } } });
  assert.equal(JSON.parse(cursorConfig(standalone, launch)).mcpServers.zotero_latex_assistant.args[2], f.root);
  assert.equal(await configureMcp(f.root, "cursor", launch), ".cursor/mcp.json");
  assert.deepEqual(JSON.parse((await readProjectText(f.root, ".cursor/mcp.json"))!), JSON.parse(cursorConfig(undefined, launch)));
  for (const entry of [
    { command: "other" }, { command: "node", args: [f.root, "--project", "/other/project"] },
    { type: "http", url: "https://example.com", args: ["--project", f.root] },
  ]) assert.throws(() => cursorConfig(JSON.stringify({ mcpServers: { zotero_latex_assistant: entry } }), launch), /unrelated/);
});


test("VS Code setup preserves JSONC, other servers and project scope; conflicts leave the file unchanged", async (t) => {
  const f = await fixture(t);
  const launch = mcpLaunch(f.root, path.join(f.root, 'server "quoted".cjs'), "/node with spaces/node", "http://localhost:23119/api/", 5000);
  const before = `{
  // Keep this comment and the other server.
  "inputs": [{ "id": "token", "type": "promptString" }],
  "servers": {
    "other": { "type": "http", "url": "https://example.com" },
  },
}\n`;
  const next = vscodeConfig(before, launch);
  const parsed = parseJsonc(next);
  assert(next.includes("// Keep this comment and the other server."));
  assert.deepEqual(parsed.inputs, parseJsonc(before).inputs);
  assert.deepEqual(parsed.servers.other, parseJsonc(before).servers.other);
  assert.deepEqual(parsed.servers.zotero_latex_assistant, { type: "stdio", ...launch });
  assert.equal(vscodeConfig(next, launch), next);
  assert.deepEqual(JSON.parse(vscodeConfig(undefined, launch)).servers.zotero_latex_assistant, { type: "stdio", ...launch });
  const variable = `{"servers":{"zotero_latex_assistant":{
    // Keep custom settings.
    "type":"stdio","command":"node","args":["old.cjs","--project","\${workspaceFolder}"],
    "env":{"EXTRA":"keep"},"sandboxEnabled":true
  }}}`;
  const updated = vscodeConfig(variable, launch);
  assert(updated.includes("// Keep custom settings."));
  assert.deepEqual(parseJsonc(updated).servers.zotero_latex_assistant.env, { EXTRA: "keep" });
  assert.equal(parseJsonc(updated).servers.zotero_latex_assistant.sandboxEnabled, true);
  assert.deepEqual(parseJsonc(updated).servers.zotero_latex_assistant.args, launch.args);
  const standalone = JSON.stringify({ servers: { zotero_latex_assistant: { command: "node", args: [launch.args[0]] } } });
  assert.deepEqual(parseJsonc(vscodeConfig(standalone, launch)).servers.zotero_latex_assistant.args, launch.args);
  const file = ".vscode/mcp.json";
  assert.equal(await configureMcp(f.root, "vscode", launch), file);
  for (const invalid of [
    '{"servers":', '{"servers":[]}', 'null', '{"servers":{}, broken}',
    ...[{ command: "other" }, { command: "node", args: [launch.args[0], "--project", "/other/project"] },
      { type: "http", url: "https://example.com", args: ["--project", f.root] }]
      .map((entry) => JSON.stringify({ servers: { zotero_latex_assistant: entry } })),
  ]) {
    await writeFile(path.join(f.root, file), invalid);
    await assert.rejects(configureMcp(f.root, "vscode", launch), /Invalid VS Code|unrelated/);
    assert.equal(await readProjectText(f.root, file), invalid);
  }
});

test("VS Code setup rejects duplicate JSON keys without changing the file", async (t) => {
  const f = await fixture(t);
  const launch = mcpLaunch(f.root, path.join(f.root, "selected.cjs"), "node", "http://localhost:23119/api/", 5000);
  const related = JSON.stringify({ type: "stdio", ...launch });
  const unrelated = JSON.stringify({ command: "custom", args: ["/other.cjs", "--project", "/other/project"] });
  const file = ".vscode/mcp.json";
  await configureMcp(f.root, "vscode", launch);
  for (const duplicate of [
    `{"servers":{"zotero_latex_assistant":${unrelated}},"servers":{"zotero_latex_assistant":${related}}}`,
    `{"servers":{"zotero_latex_assistant":${unrelated},"zotero_latex_assistant":${related}}}`,
    `{"servers":{"zotero_latex_assistant":{"command":"custom",${related.slice(1, -1)}}}}`,
  ]) {
    await writeFile(path.join(f.root, file), duplicate);
    await assert.rejects(configureMcp(f.root, "vscode", launch), /Duplicate property/);
    assert.equal(await readProjectText(f.root, file), duplicate);
  }
});

test("partial source updates preserve omitted fields, collections, relations and project citation keys", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { extra: "Citation Key: stable2026", collections: [collection, "OTHER234"], relations: { related: "keep" }, tags: [{ tag: "existing", type: 1 }] });
  const before = await readProjectText(f.root, CONFIG_FILE);
  const updated = await f.service.update(library, "ITEM2345", 10, { fields: { publicationTitle: "Corrected journal" } }) as { status: string; version: number; data: Record<string, unknown> };
  assert.equal(updated.status, "updated"); assert.equal(updated.version, 11);
  assert.equal(updated.data.title, metadata.title); assert.equal(updated.data.extra, "Citation Key: stable2026");
  assert.deepEqual(updated.data.collections, [collection, "OTHER234"]);
  assert.deepEqual(updated.data.relations, { related: "keep" });
  assert.deepEqual(updated.data.creators, metadata.creators);
  assert.deepEqual(updated.data.tags, [{ tag: "existing", type: 1 }]);
  assert.equal(await readProjectText(f.root, CONFIG_FILE), before);
  assert.deepEqual(JSON.parse(String(f.calls.find((call) => call.init?.method === "PATCH")!.init!.body)), { publicationTitle: "Corrected journal" });
  assert.equal((await f.service.update(library, "ITEM2345", 11, { fields: { publicationTitle: "Corrected journal" } }) as { status: string }).status, "unchanged");
  assert.equal(f.counts().writes, 1);
});

test("native citation-key updates reject library-wide collisions including case variants and duplicate overrides", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  f.seed("ITEM2345", { citationKey: "CurrentKey" });
  f.seed("OTHER234", { citationKey: "OccupiedKey", DOI: "10.1234/other", title: "Other source", collections: ["OTHER234"] });
  for (const citationKey of ["OccupiedKey", "occupiedkey"]) {
    await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey } }, true), /already in use/);
  }
  assert.equal(f.items.get("ITEM2345")!.citationKey, "CurrentKey");
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
});

test("Extra citation-key updates reject both native and Extra collisions across collections", async (t) => {
  for (const native of [false, true]) {
    const f = await fixture(t); f.control.nativeCitationKey = native;
    f.seed("ITEM2345", { extra: "Note\nCitation Key: CurrentKey", ...(native ? { citationKey: "" } : {}) });
    f.seed("OTHER234", { title: "Other source", DOI: "10.1234/other", collections: ["OTHER234"],
      ...(native ? { citationKey: "OccupiedKey" } : { extra: "Citation Key: OccupiedKey" }) });
    for (const extra of ["Note\nCitation Key: occupiedkey", "Note\nCitation Key:\nOccupiedKey"]) {
      await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { extra } }, true), /already in use/);
    }
    assert.equal(f.items.get("ITEM2345")!.extra, "Note\nCitation Key: CurrentKey");
    assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
  }
});

test("a source can adopt its own stored project/BBT key without changing the project bibliography or mapping", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  f.seed("ITEM2345", { citationKey: "PreviousNative", extra: "Preserved note" });
  f.control.bbtKeys = { ITEM2345: "OwnedProjectKey" };
  const config = { ...f.config, bibFile: "refs.bib", importedItemKeys: ["ITEM2345"], citationKeys: { ITEM2345: "OwnedProjectKey" } };
  await saveProjectConfig(f.root, config, await readProjectText(f.root, CONFIG_FILE));
  const bib = "@book{OwnedProjectKey,title={Own source}}\n"; await writeFile(path.join(f.root, "refs.bib"), bib);
  const snapshot = await readProjectText(f.root, CONFIG_FILE);
  const result = await f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "OwnedProjectKey" } }) as { status: string; data: Record<string, unknown> };
  assert.equal(result.status, "updated"); assert.equal(result.data.citationKey, "OwnedProjectKey"); assert.equal(result.data.extra, "Preserved note");
  assert.equal(await readProjectText(f.root, CONFIG_FILE), snapshot); assert.equal(await readProjectText(f.root, "refs.bib"), bib);
});

test("unique Extra key changes succeed and notes-only updates do not reinterpret an unchanged key", async (t) => {
  const f = await fixture(t); f.seed("ITEM2345", { extra: "Original note\nCitation Key: CurrentKey" });
  const extra = "Edited note\nCitation Key: UniqueKey";
  const updated = await f.service.update(library, "ITEM2345", 10, { fields: { extra } }) as { status: string; item: { citationKey: string }; data: Record<string, unknown> };
  assert.equal(updated.status, "updated"); assert.equal(updated.item.citationKey, "UniqueKey"); assert.equal(updated.data.extra, extra);
  const notes = await f.service.update(library, "ITEM2345", 11, { fields: { extra: "Another note\nCitation Key: UniqueKey" } }) as { item: { citationKey: string } };
  assert.equal(notes.item.citationKey, "UniqueKey"); assert.equal(f.counts().writes, 2);
});

test("citation-key collisions appearing during authorization abort native and Extra updates", async (t) => {
  for (const native of [false, true]) {
    const f = await fixture(t); f.control.nativeCitationKey = native;
    f.seed("ITEM2345", native ? { citationKey: "CurrentKey" } : { extra: "Citation Key: CurrentKey" });
    f.control.afterAuthorization = async () => { f.seed("OTHER234", { title: "Other source", DOI: "10.1234/other", collections: ["OTHER234"],
      ...(native ? { citationKey: "NewKey" } : { extra: "Citation Key: NewKey" }) }); };
    await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: native ? { citationKey: "NewKey" } : { extra: "Citation Key: NewKey" } }), /already in use/);
    assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 1);
  }
});

test("conflicting or malformed explicit key representations are rejected before authorization", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true; f.seed("ITEM2345", { citationKey: "CurrentKey", extra: "Note" });
  for (const fields of [
    { citationKey: "NewKey", extra: "Citation Key: DifferentKey" }, { extra: "Citation Key: DifferentKey" },
    { citationKey: "", extra: "Citation Key: OneKey\nCitation Key: TwoKey" }, { citationKey: "", extra: "Citation Key: invalid key" },
  ]) await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields }), /Conflicting|Invalid citation key/);
  const valid = await f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "NewKey", extra: "Note\nCitation Key: NewKey" } }) as { status: string };
  assert.equal(valid.status, "updated"); assert.equal(f.counts().writes, 1); assert.equal(f.counts().authorizations, 1);
});

test("updates reject keys used only by Better BibTeX and do not include their own source in that lookup", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  f.seed("ITEM2345", { citationKey: "CurrentKey" });
  f.seed("OTHER234", { citationKey: "", title: "Other source", DOI: "10.1234/other", collections: ["OTHER234"] });
  f.control.bbtKeys = { ITEM2345: "SelfBbtKey", OTHER234: "BbtOccupiedKey" };
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "bbtoccupiedkey" } }), /already in use/);
  const lookups = f.calls.filter((call) => call.url.pathname === "/better-bibtex/json-rpc")
    .map((call) => JSON.parse(String(call.init?.body))).filter((call) => call.method === "item.citationkey");
  assert(lookups.length > 0); assert(lookups.every((call) => !call.params[0].includes("ITEM2345")));
  assert.equal(f.counts().writes, 0);
});

test("Better BibTeX key availability is refreshed after the authorization dialog", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  f.seed("ITEM2345", { citationKey: "CurrentKey" });
  f.seed("OTHER234", { citationKey: "", title: "Other source", DOI: "10.1234/other" });
  f.control.bbtKeys = { OTHER234: "AvailableBefore" };
  f.control.afterAuthorization = async () => { f.control.bbtKeys = { OTHER234: "TakenDuringAuthorization" }; };
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "TakenDuringAuthorization" } }), /already in use/);
  assert.equal(f.items.get("ITEM2345")!.citationKey, "CurrentKey"); assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 1);
});

test("updates reject keys reserved by other project mappings or unmanaged bibliography entries", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true; f.seed("ITEM2345", { citationKey: "CurrentKey" });
  await saveProjectConfig(f.root, { ...f.config, bibFile: "refs.bib", importedItemKeys: ["ITEM2345", "OTHER234"],
    citationKeys: { ITEM2345: "CurrentKey", OTHER234: "MappedOccupiedKey" } }, await readProjectText(f.root, CONFIG_FILE));
  await writeFile(path.join(f.root, "refs.bib"), "@book{CurrentKey,title={Own}}\n@book{ManualOccupiedKey,title={External}}\n");
  for (const citationKey of ["mappedoccupiedkey", "manualoccupiedkey"]) {
    await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey } }), /already in use/);
  }
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
});

test("implicit legacy project keys remain reserved even without an explicit mapping or bibliography file", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true; f.seed("ITEM2345", { citationKey: "CurrentKey" });
  await saveProjectConfig(f.root, { ...f.config, importedItemKeys: ["OTHER234"] }, await readProjectText(f.root, CONFIG_FILE));
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "zotero-user-0-OTHER234" } }), /already in use/);
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
});

test("clearing a native key cannot activate an occupied Extra fallback; explicitly clearing both remains allowed", async (t) => {
  const f = await fixture(t); f.control.nativeCitationKey = true;
  f.seed("ITEM2345", { citationKey: "CurrentKey", extra: "Citation Key: HiddenKey" });
  f.seed("OTHER234", { citationKey: "HiddenKey", title: "Other source", DOI: "10.1234/other" });
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "" } }), /already in use/);
  const result = await f.service.update(library, "ITEM2345", 10, { fields: { citationKey: "", extra: "" } }) as { status: string; data: Record<string, unknown> };
  assert.equal(result.status, "updated"); assert.equal(result.data.citationKey, ""); assert.equal(result.data.extra, "");
  assert.equal(f.counts().writes, 1);
});

test("explicit arrays replace arrays and empty bibliographic strings clear fields", async (t) => {
  const f = await fixture(t); f.seed();
  const updated = await f.service.update(library, "ITEM2345", 10, { creators: [], tags: [], fields: { DOI: "" } }) as { data: Record<string, unknown> };
  assert.deepEqual(updated.data.creators, []); assert.deepEqual(updated.data.tags, []); assert.equal(updated.data.DOI, "");
});

test("source updates validate protected fields, type-specific fields and creator roles before authorization", async (t) => {
  const f = await fixture(t); f.seed();
  for (const fields of [{ itemType: "book" }, { collections: "OTHER234" }, { title: "Bypass" }, { unknown: "x" }, { url: "file:///secret" }, { DOI: "bad" }]) {
    await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields }));
  }
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { creators: [{ creatorType: "invented", name: "Name" }] }));
  assert(!metadataUpdateSchema.safeParse({}).success);
  assert(!metadataUpdateSchema.safeParse({ itemType: "book" }).success);
  assert(!metadataUpdateSchema.safeParse({ fields: {} }).success);
  assert.equal(f.counts().writes, 0); assert.equal(f.counts().authorizations, 0);
});

test("update version, scope and trash checks prevent stale writes; authorization changes are checked again", async (t) => {
  const f = await fixture(t); f.seed();
  await assert.rejects(f.service.update(library, "ITEM2345", 9, { title: "Changed" }), /version changed/);
  await assert.rejects(f.service.update({ type: "group", id: 42 }, "ITEM2345", 10, { title: "Changed" }), /outside/);
  f.items.get("ITEM2345")!.deleted = true;
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { title: "Changed" }), /trashed/);
  delete f.items.get("ITEM2345")!.deleted;
  f.control.afterAuthorization = async () => { f.items.get("ITEM2345")!.version = 12; };
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { title: "Changed" }), /changed before/);
  assert.equal(f.counts().writes, 0);
});

test("update duplicates exclude the source itself, block library-wide DOI matches and recheck after authorization", async (t) => {
  const f = await fixture(t); f.seed();
  f.seed("DUPL2345", { DOI: "10.1234/other", title: "Another publication", collections: ["OTHER234"] });
  const blocked = await f.service.update(library, "ITEM2345", 10, { fields: { DOI: "https://doi.org/10.1234/OTHER" } }, true) as { status: string };
  assert.equal(blocked.status, "duplicate-blocked"); assert.equal(f.counts().writes, 0);
  f.items.delete("DUPL2345");
  f.control.afterAuthorization = async () => { f.seed("DUPL2345", { DOI: "10.1234/new" }); };
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { fields: { DOI: "10.1234/new" } }), /duplicate appeared/);
  assert.equal(f.counts().writes, 0);
});

test("source updates fail on denied authorization, conditional HTTP conflicts and unverified writes", async (t) => {
  const f = await fixture(t); f.seed(); f.control.denied = true;
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { title: "Changed" }), /denied/);
  assert.equal(f.counts().writes, 0);
  f.control.denied = false; f.control.conflict = true;
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { title: "Changed" }), (e: unknown) => e instanceof ZoteroError && e.code === "CONFLICT");
  assert.equal(f.counts().writes, 1);
  f.control.conflict = false; f.control.badVerification = true;
  await assert.rejects(f.service.update(library, "ITEM2345", 10, { title: "Changed" }), /could not be verified/);
  assert.equal(f.counts().writes, 2);
});
