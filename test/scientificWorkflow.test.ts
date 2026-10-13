import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, readProjectText, saveProjectConfig } from "../src/config/project";
import { ZoteroProjectService } from "../src/zotero/projectService";
import { referencedCitationKeys } from "../src/biblatex/deletion";

const library = { type: "user" as const, id: 0 };
const collection = "COLL2345";
const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "db-A" };

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-scientific-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveProjectConfig(root, { ...newProjectConfig(), library, collectionKey: collection, serverId: "db-A", bibFile: "refs.bib" });
  const items = new Map<string, { key: string; version: number; data: Record<string, unknown> }>();
  const seed = (key = "ITEM2345", data: Record<string, unknown> = {}) => items.set(key, { key, version: 10,
    data: { itemType: "book", title: "Existing publication", creators: [], date: "2026", citationKey: "existing2026", collections: [collection], ...data } });
  seed();
  const controls = { afterAuthorization: undefined as (() => Promise<void>) | undefined,
    afterExport: undefined as (() => Promise<void>) | undefined, lostCreate: false, rejectCreate: false,
    wrongNoteParent: false, failedVerify: false, wrongIdentifier: false, dependency: false, changedServer: false,
    bbt: false, exportDoi: "" };
  const calls: { url: URL; method: string; body?: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? "GET", ...(init?.body ? { body: String(init.body) } : {}) });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,
      headers: controls.changedServer ? { ...headers, "Zotero-Server-ID": "db-B" } : headers });
    const key = url.pathname.split("/").at(-1)!;
    if (url.hostname === "api.crossref.org") {
      const message = { DOI: controls.wrongIdentifier ? "10.1234/wrong" : "10.1234/new", type: "journal-article", title: ["New publication"] };
      return json(url.pathname === "/works" ? { message: { items: [message] } } : { message });
    }
    if (url.pathname === "/api/") return new Response("", { headers: controls.changedServer ? { ...headers, "Zotero-Server-ID": "db-B" } : headers });
    if (url.pathname === `/api/users/0/collections/${collection}`) return json({ key: collection, version: 1, data: { name: "Project" } });
    if (url.pathname === "/api/users/0/collections") return json([{ key: collection, version: 1, data: { name: "Project" } }]);
    if (url.pathname === "/api/users/0/groups") return json([]);
    if (url.pathname === "/api/itemTypeFields") return json(["title", "DOI", "date", "extra", "url"].map((field) => ({ field })));
    if (url.pathname === "/api/itemTypeCreatorTypes") return json([{ creatorType: "author" }]);
    if (url.pathname === "/api/local/authorize") {
      await controls.afterAuthorization?.();
      return json({ key: "A".repeat(32), remember: true });
    }
    if (url.pathname === "/better-bibtex/json-rpc") {
      if (!controls.bbt) return json({}, 404);
      const rpc = JSON.parse(String(init?.body));
      const mapping = Object.fromEntries([...items.values()].filter((entry) => entry.data.citationKey).map((entry) => [entry.key, entry.data.citationKey]));
      return json({ jsonrpc: "2.0", id: rpc.id, result: rpc.method === "api.ready" ? { zotero: "10", betterbibtex: "8" }
        : rpc.method === "item.export" ? `@book{${rpc.params[0][0]},title={Exported source}}` : mapping });
    }
    if (init?.method === "POST" && url.pathname === "/api/users/0/items") {
      if (controls.rejectCreate) return json({}, 403);
      const data = (JSON.parse(String(init.body)) as Record<string, unknown>[])[0]!;
      assert.equal(data.itemType, "note");
      const entry = { key: String(data.key), version: 1, data: { ...data, ...(controls.wrongNoteParent ? { parentItem: "ITEM9999" } : {}) } };
      items.set(entry.key, entry);
      if (controls.lostCreate) throw new TypeError("Lost note response");
      return json({ successful: { 0: entry }, failed: {}, unchanged: {} });
    }
    const entry = items.get(key);
    if (init?.method === "PATCH" && entry) {
      assert.equal((init.headers as Record<string, string>)["If-Unmodified-Since-Version"], String(entry.version));
      if (!controls.failedVerify) { Object.assign(entry.data, JSON.parse(String(init.body))); entry.version++; }
      return new Response(null, { status: 204, headers });
    }
    if (key === "children") return json([...items.values()].filter((entry) => entry.data.itemType === "note"
      && entry.data.parentItem === url.pathname.split("/").at(-2) && !entry.data.deleted));
    if (key === "trash") return json([...items.values()].filter((entry) => !!entry.data.deleted));
    if (entry) {
      if (url.searchParams.get("format") === "biblatex") {
        await controls.afterExport?.();
        return new Response(`@book{provider,title={Exported source}${controls.dependency ? ",crossref={uncitedParent}" : ""}${controls.exportDoi ? `,doi={${controls.exportDoi}}` : ""}}`, { headers });
      }
      return json(entry);
    }
    if (key === "top" || url.pathname === "/api/users/0/items") return json([...items.values()].filter((entry) => !entry.data.deleted && !entry.data.parentItem
      && (!url.pathname.includes("/collections/") || (entry.data.collections as string[]).includes(collection))
      && (!url.searchParams.has("q") || `${entry.data.title} ${entry.data.DOI ?? ""}`.includes(url.searchParams.get("q")!))));
    return json({}, 404);
  };
  const service = new ZoteroProjectService(root, { fetch });
  const writes = () => calls.filter((call) => ["PATCH", "POST"].includes(call.method) && call.url.pathname.startsWith("/api/users/0/items"));
  return { root, items, seed, service, controls, fetch, calls, writes };
}

test("research reuses Zotero and bibliography matches before any external request", async (t) => {
  const f = await fixture(t);
  const existing = await f.service.research("Existing");
  assert.equal(existing.existingTotal, 1); assert.equal(existing.externalSearched, false);
  await writeFile(path.join(f.root, "refs.bib"), "@book{manual,title={Manual publication},author={Someone}}\n");
  const manual = await f.service.research("Manual");
  assert.equal(manual.externalSearched, false); assert.equal(manual.bibliographyMatches[0]!.citationKey, "manual");
  assert(!f.calls.some((call) => call.url.hostname === "api.crossref.org")); assert.equal(f.writes().length, 0);
});

test("standalone Zotero reads need no project, settings, bibliography or state directory", async (t) => {
  const f = await fixture(t);
  const state = path.join(f.root, "private-state");
  const service = new ZoteroProjectService(null, { fetch: f.fetch }, state);
  const context = await service.context();
  assert.equal(context.mode, "standalone"); assert.equal(context.project, null);
  assert.equal(context.configured, false); assert.equal(context.bibliography.status, "disabled");
  assert.deepEqual(context.library, library); assert.equal(f.calls.length, 0);
  assert.equal((await service.search("Existing", 20, 0) as { total: number }).total, 1);
  const scope = await service.selectedCollection() as { project: null; writeReady: boolean };
  assert.equal(scope.project, null); assert.equal(scope.writeReady, false);
  const detail = await service.metadata(library, "ITEM2345") as { warnings: { citationFiles: string[] } };
  assert.deepEqual(detail.warnings.citationFiles, []);
  assert.deepEqual((await service.listLibraries() as { libraries: { id: number }[] }).libraries.map((entry) => entry.id), [0]);
  await assert.rejects(stat(state), { code: "ENOENT" });
  await assert.rejects(service.setBibFile(), /No project is attached/);
  await assert.rejects(service.addToBibliography(["ITEM2345"], "native"), /No project is attached/);
  await assert.rejects(service.syncBibliography("native"), /No project is attached/);
  await assert.rejects(stat(state), { code: "ENOENT" });
  assert.equal(f.writes().length, 0);
});

test("standalone selection persists across restart and enables Zotero writes without a writing project", async (t) => {
  const f = await fixture(t);
  const state = path.join(f.root, "private-state");
  const service = new ZoteroProjectService(null, { fetch: f.fetch }, state);
  await assert.rejects(service.createNote(library, "ITEM2345", "Not selected", "text", "standalone-note-001", 10), /explicitly selected collection/);
  assert.equal(f.writes().length, 0);
  const selected = await service.setCollection(library, collection);
  assert.equal(selected.settingsChanged, true); assert.equal(selected.projectFilesChanged, false);
  assert.equal((await readProjectConfig(state))!.bibFile, "");
  const restarted = new ZoteroProjectService(null, { fetch: f.fetch }, state);
  assert.equal((await restarted.context()).collectionKey, collection);
  assert.equal((await restarted.selectedCollection() as { writeReady: boolean }).writeReady, true);
  const created = await restarted.createNote(library, "ITEM2345", "Standalone summary", "text", "standalone-note-001", 10);
  assert.equal(created.status, "created");
  const retried = await new ZoteroProjectService(null, { fetch: f.fetch }, state).createNote(library, "ITEM2345", "Standalone summary", "text", "standalone-note-001", 10);
  assert.equal(retried.status, "already-created"); assert.equal(f.writes().length, 1);
});

test("project context inspects missing settings and a bibliography; MCP creates its own config without TeX", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.root, CONFIG_FILE));
  await writeFile(path.join(f.root, "refs.bib"), "");
  const context = await f.service.context();
  assert.equal(context.configured, false); assert.equal(context.library, null);
  assert.equal(context.bibliography.status, "available"); assert.equal(context.bibliography.bibFile, "refs.bib");
  assert.equal(await readProjectConfig(f.root), undefined); assert.equal(f.calls.length, 0);
  assert.equal((await f.service.setCollection(library, null)).status, "assigned");
  const imported = await f.service.addToBibliography(["ITEM2345"], "native");
  assert.equal(imported.status, "imported"); assert.equal(imported.bibFile, "refs.bib");
  assert.equal((await readProjectConfig(f.root))!.bibFile, "refs.bib");
  assert.match((await readProjectText(f.root, "refs.bib"))!, /@book\{existing2026/);
  assert.equal(await readProjectText(f.root, "main.tex"), undefined); assert.equal(f.writes().length, 0);
});

test("direct bibliography import previews, preserves manual entries and chosen metadata, and is idempotent", async (t) => {
  const f = await fixture(t);
  f.seed("ITEM9999", { title: "Other source", citationKey: "other2026" });
  const manual = "% Keep comment\n@string{pub={Manual macro}}\n@book{Manual,title={Manual source},publisher=pub}\n";
  await writeFile(path.join(f.root, "refs.bib"), manual);
  const config = await readProjectText(f.root, CONFIG_FILE);
  const preview = await f.service.addToBibliography(["ITEM2345"], "native", undefined, true);
  assert.equal(preview.status, "preview"); assert.equal(preview.projectFilesChanged, false);
  assert.equal(preview.citationKeys.ITEM2345, "existing2026");
  assert.equal(await readProjectText(f.root, "refs.bib"), manual); assert.equal(await readProjectText(f.root, CONFIG_FILE), config);
  const imported = await f.service.addToBibliography(["ITEM2345"], "native");
  assert.equal(imported.status, "imported"); assert(imported.backup);
  assert.deepEqual(imported.importedItemKeys, ["ITEM2345"]);
  const bib = (await readProjectText(f.root, "refs.bib"))!;
  assert(bib.includes(manual)); assert.match(bib, /@book\{existing2026/); assert(!bib.includes("other2026"));
  assert.equal(await readProjectText(f.root, `${imported.backup}/refs.bib`), manual);
  assert.equal((await f.service.addToBibliography(["ITEM2345"], "native")).status, "unchanged");
  const edited = bib.replace("Exported source", "Manually enriched title");
  await writeFile(path.join(f.root, "refs.bib"), edited);
  await f.service.addToBibliography(["ITEM2345", "ITEM9999"], "native");
  const next = (await readProjectText(f.root, "refs.bib"))!;
  assert(next.includes("Manually enriched title")); assert(next.includes(manual)); assert.match(next, /@book\{other2026/);
  assert.equal(f.writes().length, 0);
});

test("direct bibliography import leaves absent and ambiguous files for the user to resolve", async (t) => {
  const f = await fixture(t);
  const config = await readProjectText(f.root, CONFIG_FILE);
  assert.equal((await f.service.addToBibliography(["ITEM2345"], "native")).status, "not-found");
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined);
  await writeFile(path.join(f.root, "one.bib"), ""); await writeFile(path.join(f.root, "two.bib"), "");
  const ambiguous = await f.service.addToBibliography(["ITEM2345"], "native");
  assert.equal(ambiguous.status, "ambiguous"); assert.deepEqual(ambiguous.candidates, ["one.bib", "two.bib"]);
  assert.equal(await readProjectText(f.root, CONFIG_FILE), config);
  assert.equal((await f.service.addToBibliography(["ITEM2345"], "native", "two.bib")).status, "imported");
  assert.equal(await readProjectText(f.root, "one.bib"), "");
});

test("direct bibliography import supports Better BibLaTeX and rejects new DOI duplicates", async (t) => {
  const f = await fixture(t);
  f.controls.bbt = true;
  await writeFile(path.join(f.root, "refs.bib"), "");
  assert.equal((await f.service.addToBibliography(["ITEM2345"])).status, "imported");
  assert(f.calls.some((call) => call.url.pathname === "/better-bibtex/json-rpc" && JSON.parse(call.body!).method === "item.export"));
  assert.equal((await f.service.addToBibliography(["ITEM2345"])).status, "unchanged");
  const duplicate = await fixture(t);
  duplicate.controls.exportDoi = "10.1234/duplicate";
  const existing = "@book{Manual,title={Manual source},doi={10.1234/duplicate}}\n";
  await writeFile(path.join(duplicate.root, "refs.bib"), existing);
  await assert.rejects(duplicate.service.addToBibliography(["ITEM2345"], "native"), /Duplicate DOI/);
  assert.equal(await readProjectText(duplicate.root, "refs.bib"), existing);
});

test("direct bibliography import never changes TeX or client configuration and ignores private client directories", async (t) => {
  const f = await fixture(t);
  const config = (await readProjectConfig(f.root))!;
  await saveProjectConfig(f.root, { ...config, bibFile: "", citationStyle: "uninstalledstyle" }, await readProjectText(f.root, CONFIG_FILE));
  const tex = "\\addbibresource{\\dynamicresource}\n";
  await writeFile(path.join(f.root, "main.tex"), tex);
  await writeFile(path.join(f.root, "refs.bib"), "");
  await mkdir(path.join(f.root, ".cursor"));
  await writeFile(path.join(f.root, ".cursor/mcp.json"), '{"custom":"keep"}');
  await writeFile(path.join(f.root, ".cursor/ignored.bib"), "");
  const imported = await f.service.addToBibliography(["ITEM2345"], "native");
  assert.equal(imported.status, "imported"); assert.deepEqual(imported.candidates, ["refs.bib"]);
  assert.equal(await readProjectText(f.root, "main.tex"), tex);
  assert.equal(await readProjectText(f.root, ".cursor/mcp.json"), '{"custom":"keep"}');
});

test("direct bibliography import rejects invalid sources, malformed files, paths and dependencies without writing", async (t) => {
  const f = await fixture(t);
  const config = await readProjectText(f.root, CONFIG_FILE);
  await writeFile(path.join(f.root, "refs.bib"), "");
  await assert.rejects(f.service.addToBibliography(["ITEM0000"], "native"), /outside/);
  await assert.rejects(f.service.addToBibliography(["ITEM2345", "ITEM2345"], "native"), /unique/);
  await assert.rejects(f.service.addToBibliography(["ITEM2345"], "native", "../outside.bib"));
  const outside = await mkdtemp(path.join(tmpdir(), "bib-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, "private.bib"), "");
  await symlink(path.join(outside, "private.bib"), path.join(f.root, "linked.bib"));
  await assert.rejects(f.service.addToBibliography(["ITEM2345"], "native", "linked.bib"), /outside/);
  f.controls.dependency = true;
  await assert.rejects(f.service.addToBibliography(["ITEM2345"], "native"), /dependencies/);
  assert.equal(await readProjectText(f.root, "refs.bib"), "");
  await writeFile(path.join(f.root, "refs.bib"), "@book{Broken,title={Oops}");
  await assert.rejects(f.service.addToBibliography(["ITEM2345"], "native"), /Incomplete/);
  assert.equal(await readProjectText(f.root, CONFIG_FILE), config); assert.equal(f.writes().length, 0);
});

test("direct bibliography import aborts concurrent file, selection and Zotero changes", async (t) => {
  for (const scenario of ["bibliography", "removed-file", "config", "version", "membership", "database"] as const) {
    await t.test(scenario, async (t) => {
      const f = await fixture(t);
      const original = "@book{Manual,title={Manual source}}\n";
      await writeFile(path.join(f.root, "refs.bib"), original);
      f.controls.afterExport = async () => {
        if (scenario === "bibliography") await writeFile(path.join(f.root, "refs.bib"), "% User edit\n" + original);
        if (scenario === "removed-file") await rm(path.join(f.root, "refs.bib"));
        if (scenario === "config") await saveProjectConfig(f.root, { ...(await readProjectConfig(f.root))!, citationCommand: "textcite" }, await readProjectText(f.root, CONFIG_FILE));
        if (scenario === "version") f.items.get("ITEM2345")!.version++;
        if (scenario === "membership") f.items.get("ITEM2345")!.data.collections = [];
        if (scenario === "database") f.controls.changedServer = true;
      };
      await assert.rejects(f.service.addToBibliography(["ITEM2345"], "native"));
      const text = await readProjectText(f.root, "refs.bib");
      assert.equal(text, scenario === "removed-file" ? undefined : scenario === "bibliography" ? "% User edit\n" + original : original);
      assert.deepEqual((await readProjectConfig(f.root))!.importedItemKeys, []); assert.equal(f.writes().length, 0);
    });
  }
});

test("external title candidates are independently resolved; mismatched identifiers fail verification", async (t) => {
  const f = await fixture(t);
  const result = await f.service.research("New publication");
  assert.equal(result.candidates[0]!.identifier.value, "10.1234/new"); assert.equal(result.candidates[0]!.metadata.title, "New publication");
  assert.equal(result.contentVerified, false); assert.equal(result.verification, "identifier-metadata");
  assert.equal(f.calls.filter((call) => call.url.hostname === "api.crossref.org").length, 2);
  f.controls.wrongIdentifier = true;
  const failed = await f.service.research("10.1234/new");
  assert.equal(failed.candidates.length, 0); assert.equal(failed.failures.length, 1);
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined); assert.equal(f.writes().length, 0);
});

test("explicit research modes preserve local-first order and allow further external research", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.service.research("Unknown", "never")).externalSearched, false);
  assert.equal((await f.service.research("Existing", "always")).externalSearched, true);
  const firstExternal = f.calls.findIndex((call) => call.url.hostname === "api.crossref.org");
  assert(f.calls.slice(0, firstExternal).some((call) => call.url.pathname.endsWith("/top")));
});

test("citation scanner ignores examples and definitions while recognizing aliases, custom multicites and csquotes", () => {
  const sources = [{ path: "main.tex", text: String.raw`
% \cite{comment}
\verb|\cite{literal}|
\\cite{escaped}
\defcitealias{definedOnly}{A label}
\defbibentryset{set}{definedMember}
\DeclareMultiCiteCommand{\mycites}{\cite}{;}
\mycites(vgl.)(7)[see][14]{first}{second}
\citetalias{aliased}
\textcquote[4]{quoted}{body}
\begin{displaycquote}{environment}Body\end{displaycquote}
\volcite{2}[3]{volume}
` }];
  assert.deepEqual(referencedCitationKeys(sources), ["first", "second", "aliased", "quoted", "environment", "volume"]);
  for (const text of [String.raw`\cite{\key}`, String.raw`\nocite{*}`, String.raw`\cite{broken`, String.raw`\newcommand{\unused}{\cite{notUsed}}`, String.raw`\def\unused{\cite{notUsed}}`]) {
    assert.throws(() => referencedCitationKeys([{ path: "main.tex", text }]));
  }
});

test("automatic bibliography import uses the complete Better BibLaTeX exporter by default", async (t) => {
  const f = await fixture(t); f.controls.bbt = true;
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{existing2026}`);
  assert.equal((await f.service.syncBibliography()).status, "imported");
  assert(f.calls.some((call) => call.url.pathname === "/better-bibtex/json-rpc" && call.body?.includes("item.export")));
  assert(!f.calls.some((call) => call.url.searchParams.get("format") === "biblatex"));
});

test("exact DOI duplicates block automatic imports while preserving the original bibliography", async (t) => {
  const f = await fixture(t); f.controls.exportDoi = "10.1234/duplicate";
  const manual = "@book{manual,title={Another title},doi={10.1234/duplicate}}\n";
  await writeFile(path.join(f.root, "refs.bib"), manual);
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{existing2026}`);
  await assert.rejects(f.service.syncBibliography("native"), /Duplicate DOI/);
  assert.equal(await readProjectText(f.root, "refs.bib"), manual);
});

test("automatic bibliography import adds only cited sources, preserves manual fields and retries unchanged", async (t) => {
  const f = await fixture(t);
  f.seed("ITEM9999", { title: "Uncited", citationKey: "uncited2026" });
  const manual = "@book{manual,title={Manually edited fields},note={Keep this}}\n";
  await writeFile(path.join(f.root, "refs.bib"), manual);
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite[4]{existing2026} % \cite{uncited2026}`);
  const preview = await f.service.syncBibliography("native", true);
  assert.equal(preview.status, "preview"); assert.equal(await readProjectText(f.root, "refs.bib"), manual);
  const result = await f.service.syncBibliography("native");
  assert.deepEqual(result.importedItemKeys, ["ITEM2345"]); assert.equal(result.status, "imported");
  const bib = (await readProjectText(f.root, "refs.bib"))!;
  assert(bib.includes(manual.trim())); assert.match(bib, /@book\{existing2026/); assert(!bib.includes("uncited2026"));
  assert.match(result.backup!, /backups\/bibliography-/); assert.equal(await readProjectText(f.root, `${result.backup}/refs.bib`), manual);
  assert.equal((await readProjectConfig(f.root))!.citationKeys!.ITEM2345, "existing2026");
  assert.equal((await f.service.syncBibliography("native")).status, "unchanged"); assert.equal(f.writes().length, 0);
});

test("unknown and ambiguous cited keys stop the entire bibliography write", async (t) => {
  const f = await fixture(t); const config = await readProjectText(f.root, CONFIG_FILE);
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{existing2026,missing}`);
  await assert.rejects(f.service.syncBibliography("native"), /0 matching sources/);
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined); assert.equal(await readProjectText(f.root, CONFIG_FILE), config);
  f.seed("ITEM9999", { title: "Another source", citationKey: "existing2026" });
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{existing2026}`);
  await assert.rejects(f.service.syncBibliography("native"), /2 matching sources/);
});

test("bibliography export failures and unsupported dependencies leave project files untouched", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "main.tex"), String.raw`\cite{existing2026}`);
  await assert.rejects(f.service.syncBibliography(), /Better BibLaTeX/);
  f.controls.dependency = true;
  await assert.rejects(f.service.syncBibliography("native"), /dependencies/);
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined);
});

test("LaTeX, bibliography, project and membership races prevent automatic import", async (t) => {
  for (const change of ["tex", "bib", "config", "membership", "sourceVersion"]) {
    const f = await fixture(t);
    const original = String.raw`\cite{existing2026}`;
    await writeFile(path.join(f.root, "main.tex"), original);
    f.controls.afterExport = async () => {
      if (change === "tex") await writeFile(path.join(f.root, "main.tex"), original + "\nNew text");
      if (change === "bib") await writeFile(path.join(f.root, "refs.bib"), "@book{concurrent,title={Changed}}\n");
      if (change === "config") await saveProjectConfig(f.root, { ...(await readProjectConfig(f.root))!, citationCommand: "textcite" }, await readProjectText(f.root, CONFIG_FILE));
      if (change === "membership") f.items.get("ITEM2345")!.data.collections = [];
      if (change === "sourceVersion") f.items.get("ITEM2345")!.version++;
    };
    await assert.rejects(f.service.syncBibliography("native"), /changed|left/);
    const bib = await readProjectText(f.root, "refs.bib");
    assert.equal(bib, change === "bib" ? "@book{concurrent,title={Changed}}\n" : undefined);
  }
});

test("source note creation escapes text, lists metadata, reads HTML and updates only its own content", async (t) => {
  const f = await fixture(t);
  const created = await f.service.createNote(library, "ITEM2345", "Summary <script> & thoughts\nNext line", "text", "note-request-001", 10);
  assert.equal(created.note, "<p>Summary &lt;script&gt; &amp; thoughts</p>\n<p>Next line</p>");
  assert.equal((await f.service.listNotes(library, "ITEM2345")).notes[0]!.key, created.key);
  assert(!("note" in (await f.service.listNotes(library, "ITEM2345")).notes[0]!));
  assert.equal((await f.service.getNote(library, "ITEM2345", created.key)).version, 1);
  const updated = await f.service.updateNote(library, "ITEM2345", created.key, 1, "<p>Updated <strong>summary</strong></p>", "html");
  assert.equal(updated.status, "updated"); assert.equal(updated.version, 2);
  assert.equal(f.items.get("ITEM2345")!.version, 10);
  assert.equal((await f.service.updateNote(library, "ITEM2345", created.key, 2, updated.note, "html")).status, "unchanged");
  assert.equal(await readProjectText(f.root, "refs.bib"), undefined);
});

test("lost note responses reconcile the same child across process restarts without a second create", async (t) => {
  const f = await fixture(t); f.controls.lostCreate = true;
  await assert.rejects(f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10));
  f.controls.lostCreate = false;
  const restarted = new ZoteroProjectService(f.root, { fetch: (input, init) => f.fetch(input, init) });
  const result = await restarted.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10);
  assert.equal(result.status, "already-created"); assert.equal(f.writes().length, 1);
  await assert.rejects(restarted.createNote(library, "ITEM2345", "Different", "text", "note-request-001", 10), /different input/);
});

test("explicitly rejected notes reuse their reserved key, uncertain absent notes are not recreated", async (t) => {
  const f = await fixture(t); f.controls.rejectCreate = true;
  await assert.rejects(f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10));
  f.controls.rejectCreate = false;
  await f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10);
  const postBodies = f.writes().map((call) => JSON.parse(call.body!)[0].key);
  assert.equal(postBodies[0], postBodies[1]);
  const g = await fixture(t); g.controls.lostCreate = true;
  await assert.rejects(g.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-002", 10));
  for (const [key, entry] of g.items) if (entry.data.itemType === "note") g.items.delete(key);
  await assert.rejects(new ZoteroProjectService(g.root, { fetch: (input, init) => g.fetch(input, init) }).createNote(library, "ITEM2345", "Summary", "text", "note-request-002", 10), /unresolved/);
  assert.equal(g.writes().length, 1);
});

test("source and note versions, parent identity, scope and trash are checked before writes", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 9), /changed/);
  f.controls.afterAuthorization = async () => { f.items.get("ITEM2345")!.version++; };
  await assert.rejects(f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10), /changed/);
  assert.equal(f.writes().length, 0);
  f.controls.afterAuthorization = undefined;
  const created = await f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-002", 11);
  await assert.rejects(f.service.updateNote(library, "ITEM2345", created.key, 11, "Revised", "text"), /note changed/);
  f.seed("ITEM9999", { collections: ["OTHER234"] });
  await assert.rejects(f.service.getNote(library, "ITEM9999", created.key), /collection/);
  await assert.rejects(f.service.getNote({ type: "group", id: 42 }, "ITEM2345", created.key), /scope/);
  f.items.get(created.key)!.data.parentItem = "ITEM9999";
  await assert.rejects(f.service.getNote(library, "ITEM2345", created.key), /belong/);
  f.items.get("ITEM2345")!.data.deleted = 1;
  await assert.rejects(f.service.listNotes(library, "ITEM2345"), /trash/);
});

test("note update conflicts after authorization and failed readback cannot report success", async (t) => {
  const f = await fixture(t);
  const created = await f.service.createNote(library, "ITEM2345", "Summary", "text", "note-request-001", 10);
  // A fresh process has no stored grant and exercises the post-authorization preflight.
  const restarted = new ZoteroProjectService(f.root, { fetch: f.fetch });
  f.controls.afterAuthorization = async () => { f.items.get(created.key)!.version++; };
  await assert.rejects(restarted.updateNote(library, "ITEM2345", created.key, 1, "Revised", "text"), /changed/);
  assert.equal(f.writes().length, 1);
  f.controls.afterAuthorization = undefined; f.controls.failedVerify = true;
  await assert.rejects(f.service.updateNote(library, "ITEM2345", created.key, 2, "Revised", "text"), /verified/);
});

test("trash listing restricts collection and type; exact restore preserves memberships and is retryable", async (t) => {
  const f = await fixture(t);
  f.items.get("ITEM2345")!.data.deleted = true;
  f.items.get("ITEM2345")!.data.collections = [collection, "OTHER234"];
  f.seed("ITEM9999", { collections: ["OTHER234"], deleted: 1 });
  f.seed("NOTE2345", { itemType: "note", parentItem: "ITEM2345", deleted: 1 });
  const trash = await f.service.listTrash(20, 0);
  assert.equal(trash.total, 1); assert.deepEqual(trash.items[0]!.collectionKeys, [collection, "OTHER234"]);
  const restored = await f.service.restore(library, "ITEM2345", 10);
  assert.equal(restored.status, "restored"); assert.deepEqual(restored.data.collections, [collection, "OTHER234"]);
  assert.equal((await f.service.restore(library, "ITEM2345", 10)).status, "already-restored");
  assert.equal((await f.service.listTrash(20, 0)).total, 0);
  assert.deepEqual(JSON.parse(f.writes()[0]!.body!), { deleted: 0 }); assert.equal(await readProjectText(f.root, "refs.bib"), undefined);
});

test("restore checks versions and membership after authorization, and verifies actual trash state", async (t) => {
  const f = await fixture(t); f.items.get("ITEM2345")!.data.deleted = 1;
  await assert.rejects(f.service.restore(library, "ITEM2345", 9), /version changed/);
  f.controls.afterAuthorization = async () => { f.items.get("ITEM2345")!.data.collections = []; };
  await assert.rejects(f.service.restore(library, "ITEM2345", 10), /collection/);
  assert.equal(f.writes().length, 0);
  f.controls.afterAuthorization = undefined; f.items.get("ITEM2345")!.data.collections = [collection];
  f.controls.failedVerify = true;
  await assert.rejects(f.service.restore(library, "ITEM2345", 10), /verified/);
});
