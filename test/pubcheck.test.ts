import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { PubcheckClient } from "../src/research/pubcheck";
import type { ZoteroItemDetail } from "../src/shared/types";
import { bibliographyRecords } from "../src/biblatex/fields";
import { ZoteroProjectService } from "../src/zotero/projectService";
import { newProjectConfig, saveProjectConfig, readProjectText, CONFIG_FILE } from "../src/config/project";
import { isbnFilterValues } from "../src/research/crossrefIsbn";
import { normalizeIsbn } from "../src/research/isbn";
import { metadataSchema } from "../src/zotero/metadata";

const library = { type: "user" as const, id: 0 };
const detail: ZoteroItemDetail = { version: 7, item: { library, key: "ITEM2345", itemType: "journalArticle", title: "A scientific publication", date: "2026-02-01",
  doi: "https://doi.org/10.1234/TEST", url: "", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace", name: "" }] },
data: { publicationTitle: "Test Journal", abstractNote: "PRIVATE ABSTRACT", extra: "PRIVATE NOTE", collections: ["COLL2345"] } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixture() {
  const control = { verdict: "VERIFIED", compared: ["title", "authors", "year", "journal", "doi"], uncompared: [] as string[], pubcheckError: false,
    pubcheckStatus: 200, crossrefStatus: 200, crossrefError: false, count: 42 as unknown, wrongDoi: false, wrongTitle: false, wrongCountDoi: false, malformed: false,
    isbnRecords: [] as Record<string, unknown>[], isbnResponse: undefined as unknown, isbn10Only: false,
    registeredIsbns: undefined as unknown, isbnOverridesDoi: false };
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    assert.equal(init?.redirect, "error"); assert(init?.signal);
    if (url.hostname === "pubcheck.net") {
      assert.equal(url.pathname, "/api/browser/lookup"); assert.equal(init?.method, "POST");
      if (control.pubcheckError) throw new Error("PubCheck offline");
      if (control.malformed) return json({ verification: { verdict: "NEW_STATUS" } });
      const query = JSON.parse(String(init.body)).query as string;
      assert(!query.includes("PRIVATE"));
      const fields = bibliographyRecords(query)[0]!.fields;
      const citation = { title: control.wrongTitle ? "Another source" : fields.get("title")?.value ?? null,
        doi: fields.get("doi")?.value ?? null, isbn: fields.get("isbn")?.value ?? null };
      return json({ citation_count: 1, verification: { citation, verdict: control.isbnOverridesDoi && fields.has("isbn") ? "NOT_FOUND" : control.verdict,
        compared_fields: control.compared, uncompared_fields: control.uncompared, reasons: ["provider evidence"],
        advisories: [{ code: "pubpeer_comments", count: 5, message: "review comments" }],
        resolved: { ...citation, doi: control.wrongDoi ? "10.1234/other" : citation.doi, source: "crossref" } },
        retraction_snapshot: { snapshot_id: "fixture", freshness: { status: "fresh" } }, warnings: [] }, control.pubcheckStatus);
    }
    assert.equal(url.hostname, "api.crossref.org");
    if (control.crossrefError) throw new Error("Crossref offline");
    if (url.searchParams.has("filter")) {
      assert.equal(url.pathname, "/works"); assert.equal(url.searchParams.get("rows"), "100");
      assert(url.searchParams.get("filter")!.startsWith("isbn:"));
      if (control.isbnResponse !== undefined) return json(control.isbnResponse, control.crossrefStatus);
      const records = control.isbn10Only && url.searchParams.get("filter") !== "isbn:0306406152" ? [] : control.isbnRecords;
      const offset = Number(url.searchParams.get("offset"));
      return json({ message: { "total-results": records.length, items: records.slice(offset, offset + 100) } }, control.crossrefStatus);
    }
    return json({ message: { DOI: control.wrongCountDoi ? "10.1234/other" : "10.1234/test", ISBN: control.registeredIsbns,
      "is-referenced-by-count": control.count, "references-count": 999 } }, control.crossrefStatus);
  };
  return { client: new PubcheckClient(fetch), control, calls, fetch };
}

test("PubCheck compares bibliographic metadata; citation counts use Crossref inbound citations and carry provenance", async () => {
  const f = fixture(); const result = await f.client.check(detail);
  assert.equal(result.itemKey, detail.item.key); assert.equal(result.version, 7);
  assert.equal(result.pubcheck.verdict, "VERIFIED"); assert.equal(result.pubcheck.metadataMatches, true);
  assert.equal(result.pubcheck.contentVerified, false);
  assert.equal(result.citations.count, 42); assert.equal(result.citations.status, "available");
  assert.equal(result.citations.provider, "crossref"); assert.equal(result.citations.doi, "10.1234/test");
  assert.equal(result.citations.matchedBy, "doi"); assert.equal(result.citations.isbn, null);
  assert(result.citations.sourceUrl?.startsWith("https://api.crossref.org/works/"));
  assert(Number.isFinite(Date.parse(result.citations.checkedAt!)));
  assert.equal(result.pubcheck.advisories.length, 1); assert.equal(result.pubcheck.retractionSnapshot?.snapshot_id, "fixture");
  assert.deepEqual(f.calls.map((c) => c.url.hostname).sort(), ["api.crossref.org", "pubcheck.net"]);
});

const book: ZoteroItemDetail = { ...detail, item: { ...detail.item, itemType: "book", doi: "", isbn: "0-306-40615-2" }, data: { ISBN: "0-306-40615-2" } };
const bookRecord = (): Record<string, unknown> => ({ DOI: "10.1234/book", type: "book", ISBN: ["0306406152"], title: [book.item.title],
  author: [{ given: "A.", family: "Lovelace" }], issued: { "date-parts": [[2026]] }, "is-referenced-by-count": 17 });
const isbnCalls = (f: ReturnType<typeof fixture>) => f.calls.filter((call) => call.url.hostname === "api.crossref.org");

const externalArticle = () => metadataSchema.parse({ itemType: detail.item.itemType, title: detail.item.title,
  creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
  fields: { date: detail.item.date, DOI: detail.item.doi, publicationTitle: "Test Journal", abstractNote: "PRIVATE ABSTRACT", extra: "PRIVATE NOTE" },
  tags: ["PRIVATE TAG"], citationKey: "PRIVATE_KEY" });

test("valid DOI remains primary when Zotero concatenates two ISBNs; both ISBN claims are validated and counted separately from PubPeer", async () => {
  const f = fixture(); f.control.isbnOverridesDoi = true; f.control.registeredIsbns = ["9783030854355", "9783030854362"]; f.control.count = 41;
  const source = { ...book, item: { ...book.item, doi: detail.item.doi, isbn: "97830308543559783030854362" } };
  const result = await f.client.check(source);
  assert.equal(result.pubcheck.verdict, "VERIFIED"); assert.equal(result.pubcheck.metadataMatches, true);
  assert.equal(result.pubcheck.isbnValidation?.status, "matched");
  assert.deepEqual(result.pubcheck.isbnValidation?.isbns, ["9783030854355", "9783030854362"]);
  assert.equal(result.citations.count, 41); assert.equal(result.citations.matchedBy, "doi");
  const query = JSON.parse(String(f.calls.find(({ url }) => url.hostname === "pubcheck.net")!.init?.body)).query as string;
  assert(!bibliographyRecords(query)[0]!.fields.has("isbn"));
  assert.equal(isbnCalls(f).length, 1); // Shared DOI metadata: no duplicate counter/ISBN GET.
  assert.equal(result.pubcheck.advisories[0]!.count, 5); assert.equal(result.pubcheck.advisories[0]!.code, "pubpeer_comments");
  assert.equal(source.item.isbn, "97830308543559783030854362");
});

test("DOI metadata does not falsely confirm invalid, unlisted or unavailable ISBN claims", async () => {
  for (const kind of ["invalid", "unlisted", "missing", "offline", "wrong-doi"] as const) {
    const f = fixture(); f.control.registeredIsbns = kind === "unlisted" ? ["9780140328721"] : kind === "missing" ? undefined : ["9783030854362"];
    f.control.crossrefError = kind === "offline"; f.control.wrongCountDoi = kind === "wrong-doi";
    const source = { ...book, item: { ...book.item, doi: detail.item.doi, isbn: kind === "invalid" ? "9783030854355;invalid" : "9783030854362" } };
    const result = await f.client.check(source, false);
    assert.equal(result.pubcheck.verdict, "VERIFIED"); assert.equal(result.pubcheck.metadataMatches, null);
    assert(result.pubcheck.uncomparedFields.includes("isbn")); assert(result.pubcheck.warnings.length > 0);
    assert.equal(result.citations.status, "not-requested");
    assert.equal(result.pubcheck.isbnValidation?.status, kind === "invalid" ? "invalid" : ["offline", "wrong-doi"].includes(kind) ? "unavailable" : "unconfirmed");
  }
});

test("without DOI multiple ISBNs are checked separately, preserve advisories, and leave edition selection unresolved", async () => {
  const f = fixture(); f.control.compared = ["title", "authors", "year", "isbn"];
  const source = { ...book, item: { ...book.item, isbn: "97830308543559783030854362" } };
  const result = await f.client.check(source, false);
  assert.equal(result.pubcheck.verdict, "UNVERIFIABLE"); assert.equal(result.pubcheck.metadataMatches, null);
  assert.deepEqual(result.pubcheck.isbnChecks?.map((check) => check.isbn), ["9783030854355", "9783030854362"]);
  assert(result.pubcheck.isbnChecks?.every((check) => check.verdict === "VERIFIED"));
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) assert.equal(bibliographyRecords(JSON.parse(String(call.init?.body)).query)[0]!.fields.get("isbn")?.value?.length, 13);
  assert.equal(result.pubcheck.advisories.length, 1); assert.equal(result.pubcheck.advisories[0]!.count, 5);
});

test("candidate checks retain raw metadata while using DOI-first verification and normalized ISBN evidence", async () => {
  const f = fixture(); f.control.registeredIsbns = ["9783030854355", "9783030854362"]; f.control.isbnOverridesDoi = true;
  const metadata = externalArticle(); metadata.itemType = "book"; metadata.fields.ISBN = "97830308543559783030854362";
  const result = await f.client.checkCandidate(metadata);
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.pubcheck.isbnValidation?.status, "matched");
  assert.equal(result.metadata.fields.ISBN, metadata.fields.ISBN); assert.equal(result.zoteroChanged, false);
});

test("external candidates return the same evidence as Zotero sources without artificial keys or library bindings", async () => {
  const f = fixture();
  const candidate = await f.client.checkCandidate(externalArticle());
  const saved = await f.client.check(detail);
  assert.equal(candidate.pubcheck.verdict, saved.pubcheck.verdict);
  assert.equal(candidate.pubcheck.metadataMatches, saved.pubcheck.metadataMatches);
  assert.deepEqual(candidate.pubcheck.comparedFields, saved.pubcheck.comparedFields);
  assert.equal(candidate.citations.count, saved.citations.count); assert.equal(candidate.citations.matchedBy, "doi");
  assert.equal(candidate.contentVerified, false); assert.equal(candidate.zoteroChanged, false); assert.equal(candidate.projectFilesChanged, false);
  assert(!Object.hasOwn(candidate, "itemKey")); assert(!Object.hasOwn(candidate, "version")); assert(!Object.hasOwn(candidate, "library"));
  for (const call of f.calls) {
    assert(["api.crossref.org", "pubcheck.net"].includes(call.url.hostname));
    assert(!String(call.init?.body).includes("PRIVATE"));
  }
});

test("external candidates can be checked without Zotero, a project, selection or any filesystem writes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "candidate-no-zotero-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = path.join(root, "state-does-not-exist");
  const f = fixture();
  const service = new ZoteroProjectService(null, { fetch: async (input, init) => {
    assert.notEqual(new URL(String(input)).hostname, "localhost");
    return f.fetch(input, init);
  } }, state);
  const input = externalArticle();
  const before = structuredClone(input);
  const result = await service.checkCandidate(input, false);
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.status, "not-requested");
  assert.deepEqual(input, before); assert.equal(f.calls.length, 1);
  await assert.rejects(stat(state), { code: "ENOENT" });
  assert.equal(await readProjectText(root, CONFIG_FILE), undefined);
  const unconfiguredProject = new ZoteroProjectService(root, { fetch: f.fetch });
  assert.equal((await unconfiguredProject.checkCandidate(input, false)).pubcheck.verdict, "VERIFIED");
  assert.equal(await readProjectText(root, CONFIG_FILE), undefined);
});

test("candidate checks preserve supplied mismatches, report retractions, and do not turn unknown evidence into verification", async () => {
  const f = fixture();
  const candidate = externalArticle();
  candidate.title = "A different claimed title";
  for (const verdict of ["METADATA_MISMATCH", "RETRACTED", "NOT_FOUND", "UNVERIFIABLE", "INVALID_IDENTIFIER", "ERROR"]) {
    f.control.verdict = verdict;
    const result = await f.client.checkCandidate(candidate, false);
    assert.equal(result.pubcheck.verdict, verdict); assert.equal(result.pubcheck.metadataMatches, verdict === "METADATA_MISMATCH" ? false : null);
    assert.equal(result.metadata.title, candidate.title); assert.equal(result.zoteroChanged, false);
    assert.equal(JSON.parse(String(f.calls.at(-1)!.init?.body)).query.includes(candidate.title), true);
  }
  f.control.verdict = "VERIFIED"; f.control.compared = ["doi"];
  assert.equal((await f.client.checkCandidate(candidate, false)).pubcheck.metadataMatches, null);
});

test("candidate PubCheck errors and Crossref errors remain independent with DOI and ISBN inputs", async () => {
  const f = fixture(); f.control.pubcheckError = true;
  let result = await f.client.checkCandidate(externalArticle());
  assert.equal(result.pubcheck.verdict, "ERROR"); assert.equal(result.citations.count, 42);
  f.control.pubcheckError = false; f.control.crossrefStatus = 429;
  result = await f.client.checkCandidate(externalArticle());
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.status, "unavailable");
  const isbn = fixture(); isbn.control.isbnRecords = [bookRecord()]; isbn.control.compared = ["title", "authors", "year", "isbn"];
  const candidate = metadataSchema.parse({ itemType: "book", title: book.item.title,
    creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }], fields: { date: "2026", ISBN: "0306406152" } });
  result = await isbn.client.checkCandidate(candidate);
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.matchedBy, "isbn"); assert.equal(result.citations.count, 17);
  assert.equal(result.metadata.fields.DOI, undefined);
});

test("invalid candidate structures and non-bibliographic types fail before provider requests; title-only candidates remain explicit", async () => {
  const f = fixture();
  for (const change of [{ title: "" }, { itemType: "note" }, { itemType: "annotation" }, { itemType: "attachment" }, { title: "x".repeat(1001) }]) {
    await assert.rejects(f.client.checkCandidate({ ...externalArticle(), ...change }));
  }
  assert.equal(f.calls.length, 0);
  f.control.compared = ["title"];
  const candidate = metadataSchema.parse({ itemType: "book", title: "A title-only candidate" });
  const result = await f.client.checkCandidate(candidate);
  assert.equal(result.citations.status, "no-doi"); assert.equal(result.citations.count, null);
  assert.equal(result.contentVerified, false); assert.deepEqual(result.metadata.creators, []);
  assert.deepEqual(result.metadata.fields, {});
});

test("ISBN citation fallback validates ISBN-10/13 and carries exact DOI and lookup provenance without changing Zotero", async () => {
  assert.deepEqual(isbnFilterValues(normalizeIsbn("080442957X")), ["9780804429573", "080442957X"]);
  const f = fixture(); f.control.isbnRecords = [bookRecord()]; f.control.compared = ["title", "authors", "year", "isbn"];
  const result = await f.client.check(book);
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.status, "available");
  assert.equal(result.citations.count, 17); assert.equal(result.citations.doi, "10.1234/book");
  assert.equal(result.citations.isbn, "9780306406157"); assert.equal(result.citations.matchedBy, "isbn");
  assert.equal(book.item.doi, "");
  assert(result.citations.sourceUrl?.includes("filter=isbn%3A"));
  assert.deepEqual(isbnCalls(f).map(({ url }) => url.searchParams.get("filter")), ["isbn:9780306406157", "isbn:0306406152"]);
  f.control.isbn10Only = true;
  assert.equal((await f.client.check(book)).citations.count, 17);
});

test("DOI stays authoritative and invalid or skipped DOI checks do not silently fall back to ISBN", async () => {
  const f = fixture(); f.control.isbnRecords = [bookRecord()];
  const result = await f.client.check({ ...book, item: { ...book.item, doi: detail.item.doi } });
  assert.equal(result.citations.matchedBy, "doi"); assert.equal(result.citations.count, 42);
  assert(isbnCalls(f).every(({ url }) => !url.searchParams.has("filter")));
  const invalid = fixture();
  assert.equal((await invalid.client.check({ ...book, item: { ...book.item, doi: "invalid" } })).citations.status, "invalid-doi");
  assert.equal(isbnCalls(invalid).length, 0);
  assert.equal((await invalid.client.check(book, false)).citations.status, "not-requested");
  assert.equal(isbnCalls(invalid).length, 0);
});

test("ISBN matching separates whole books from chapters and validates chapter container and pages", async () => {
  const f = fixture();
  f.control.isbnRecords = [{ ...bookRecord(), type: "book-chapter", "is-referenced-by-count": 999 }];
  assert.equal((await f.client.check(book)).citations.status, "not-found");
  const chapter: ZoteroItemDetail = { ...book, item: { ...book.item, itemType: "bookSection", title: "A specific chapter" },
    data: { ...book.data, bookTitle: book.item.title, pages: "10–20" } };
  const record = { ...bookRecord(), type: "book-chapter", title: [chapter.item.title], "container-title": [book.item.title], page: "10-20", "is-referenced-by-count": 0 };
  f.control.isbnRecords = [bookRecord(), record];
  const matched = await f.client.check(chapter);
  assert.equal(matched.citations.status, "available"); assert.equal(matched.citations.count, 0);
  assert.equal(matched.citations.matchedBy, "isbn");
  for (const change of [{ type: "book" }, { "container-title": ["Another book"] }, { page: "30-40" }, { page: undefined }]) {
    f.control.isbnRecords = [{ ...record, ...change }];
    assert.equal((await f.client.check(chapter)).citations.status, change.page === undefined && Object.hasOwn(change, "page") ? "unavailable" : "not-found");
  }
});

test("ISBN alone never substitutes for mismatching or missing supplied publication metadata", async () => {
  const f = fixture();
  for (const change of [
    { ISBN: ["9780140328721"] }, { ISBN: undefined }, { title: ["Another publication"] }, { title: undefined },
    { author: [{ family: "Other", given: "A" }] }, { author: [] }, { author: [{ family: "Lovelace", given: "B" }] },
    { author: [{ family: "Lovelace", given: "Aaron" }] },
    { issued: { "date-parts": [[2025]] } }, { issued: undefined }, { type: "journal-article" },
  ]) {
    f.control.isbnRecords = [{ ...bookRecord(), ...change }];
    const result = await f.client.check(book);
    assert.notEqual(result.citations.status, "available", JSON.stringify(change)); assert.equal(result.citations.count, null);
  }
  const edition = { ...book, data: { ...book.data, edition: "2" } };
  f.control.isbnRecords = [bookRecord()];
  assert.equal((await f.client.check(edition)).citations.status, "unavailable");
  f.control.isbnRecords = [{ ...bookRecord(), "edition-number": "2" }];
  assert.equal((await f.client.check(edition)).citations.status, "available");
  const editor = { ...book, item: { ...book.item, creators: book.item.creators.map((creator) => ({ ...creator, creatorType: "editor" })) } };
  assert.equal((await f.client.check(editor)).citations.status, "unavailable");
  f.control.isbnRecords = [{ ...bookRecord(), editor: [{ family: "Lovelace", given: "Ada" }] }];
  assert.equal((await f.client.check(editor)).citations.status, "available");
});

test("distinct matching ISBN DOI records stay ambiguous; duplicate DOI results are not summed", async () => {
  const f = fixture(); f.control.isbnRecords = [bookRecord(), { ...bookRecord(), DOI: "10.1234/BOOK" }];
  assert.equal((await f.client.check(book)).citations.count, 17);
  f.control.isbnRecords.push({ ...bookRecord(), DOI: "10.1234/another", "is-referenced-by-count": 23 });
  let result = await f.client.check(book);
  assert.equal(result.citations.status, "ambiguous"); assert.equal(result.citations.count, null); assert.equal(result.citations.matchedBy, null);
  f.control.isbnRecords = [bookRecord(), { ...bookRecord(), "is-referenced-by-count": 18 }];
  result = await f.client.check(book);
  assert.equal(result.citations.status, "unavailable"); assert.equal(result.citations.count, null);
  f.control.isbnRecords = [bookRecord(), { ...bookRecord(), DOI: "10.1234/incomplete", author: undefined }];
  result = await f.client.check(book);
  assert.equal(result.citations.status, "unavailable"); assert.equal(result.citations.count, null);
});

test("multiple valid ISBNs are searched and never collapsed across editions or matching DOI records", async () => {
  const f = fixture();
  f.control.isbnRecords = [bookRecord(), { ...bookRecord(), DOI: "10.1234/edition", ISBN: ["9780140328721"] }];
  const editions = { ...book, item: { ...book.item, isbn: "0306406152; 9780140328721" } };
  const result = await f.client.check(editions);
  assert.equal(result.citations.status, "ambiguous"); assert.equal(result.citations.count, null);
});

test("ISBN searches complete pagination before accepting uniqueness, and incomplete or excessive results remain unknown", async () => {
  const f = fixture();
  f.control.isbnRecords = [...Array.from({ length: 100 }, (_, index) => ({ ...bookRecord(), DOI: `10.1234/other${index}`, title: ["Another publication"] })), bookRecord()];
  assert.equal((await f.client.check(book)).citations.count, 17);
  assert(isbnCalls(f).some(({ url }) => url.searchParams.get("offset") === "100"));
  f.control.isbnResponse = { message: { "total-results": 101, items: [bookRecord()] } };
  assert.equal((await f.client.check(book)).citations.status, "unavailable");
  f.control.isbnResponse = undefined;
  f.control.isbnRecords = [bookRecord(), ...Array.from({ length: 500 }, () => ({ ...bookRecord(), title: ["Unrelated"] }))];
  const incomplete = await f.client.check(book);
  assert.equal(incomplete.citations.status, "unavailable"); assert.equal(incomplete.citations.count, null);
});

test("ISBN schema errors, invalid matching DOIs, bad counts and provider errors cannot produce a citation number", async () => {
  const f = fixture();
  for (const response of [{}, { message: { items: [] } }, { message: { items: [null], "total-results": 1 } }, { message: { items: [], "total-results": -1 } }]) {
    f.control.isbnResponse = response;
    assert.equal((await f.client.check(book)).citations.status, "unavailable");
  }
  f.control.isbnResponse = undefined;
  for (const change of [{ DOI: "invalid" }, ...[undefined, -1, "17", 2.5].map((count) => ({ "is-referenced-by-count": count }))]) {
    f.control.isbnRecords = [{ ...bookRecord(), ...change }];
    const result = await f.client.check(book);
    assert.equal(result.citations.status, "unavailable"); assert.equal(result.citations.count, null);
  }
  f.control.crossrefStatus = 429;
  assert.equal((await f.client.check(book)).citations.status, "unavailable");
  f.control.crossrefStatus = 404;
  assert.equal((await f.client.check(book)).citations.status, "not-found");
});

test("invalid ISBNs and unsupported item types do not query Crossref", async () => {
  const f = fixture();
  for (const isbn of ["not-an-isbn", "9780306406158"]) {
    const result = await f.client.check({ ...book, item: { ...book.item, isbn }, data: {} });
    assert.equal(result.citations.status, "invalid-isbn"); assert.equal(result.citations.count, null);
  }
  const unsupported = await f.client.check({ ...book, item: { ...book.item, itemType: "conferencePaper" } });
  assert.equal(unsupported.citations.status, "unsupported-type"); assert.equal(isbnCalls(f).length, 0);
});

test("mismatches and retractions remain visible; a confirmed zero count is distinct from unknown", async () => {
  const f = fixture(); f.control.verdict = "METADATA_MISMATCH";
  assert.equal((await f.client.check(detail)).pubcheck.metadataMatches, false);
  f.control.verdict = "RETRACTED"; f.control.count = 0;
  const result = await f.client.check(detail);
  assert.equal(result.pubcheck.verdict, "RETRACTED"); assert.equal(result.pubcheck.metadataMatches, null);
  assert.equal(result.citations.count, 0); assert.equal(result.citations.status, "available");
});

test("identifier-only, incomplete and failed comparisons never report complete metadata agreement", async () => {
  const f = fixture(); f.control.compared = ["doi"];
  assert.equal((await f.client.check(detail)).pubcheck.metadataMatches, null);
  f.control.compared = ["title", "authors", "year", "journal", "doi"]; f.control.uncompared = ["authors"];
  assert.equal((await f.client.check(detail)).pubcheck.metadataMatches, null);
  for (const verdict of ["ERROR", "NOT_FOUND", "UNVERIFIABLE", "INVALID_IDENTIFIER"]) {
    f.control.verdict = verdict; assert.equal((await f.client.check(detail)).pubcheck.metadataMatches, null);
  }
});

test("provider failures are independent and preserve one result per source", async () => {
  const f = fixture(); f.control.pubcheckError = true;
  let result = await f.client.check(detail);
  assert.equal(result.pubcheck.verdict, "ERROR"); assert.equal(result.citations.count, 42);
  f.control.pubcheckError = false; f.control.crossrefStatus = 429;
  result = await f.client.check(detail);
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.count, null); assert.equal(result.citations.status, "unavailable");
  f.control.crossrefStatus = 404;
  assert.equal((await f.client.check(detail)).citations.status, "not-found");
  f.control.pubcheckStatus = 404;
  assert.equal((await f.client.check(detail)).pubcheck.verdict, "ERROR");
});

test("missing, invalid and skipped citation counts never become zero or use title matching", async () => {
  const f = fixture();
  for (const [doi, status] of [["", "no-doi"], ["invalid", "invalid-doi"]]) {
    const result = await f.client.check({ ...detail, item: { ...detail.item, doi: doi! } });
    assert.equal(result.citations.status, status); assert.equal(result.citations.count, null);
  }
  assert.equal((await f.client.check(detail, false)).citations.status, "not-requested");
  assert(f.calls.every((c) => c.url.hostname === "pubcheck.net"));
  for (const count of [undefined, -1, 2.5, "42", Number.MAX_SAFE_INTEGER + 1]) {
    f.control.count = count; const result = await f.client.check(detail);
    assert.equal(result.citations.status, "unavailable"); assert.equal(result.citations.count, null);
  }
});

test("different citation identities and schema changes fail visibly", async () => {
  for (const changed of ["wrongDoi", "wrongTitle", "malformed"] as const) {
    const f = fixture(); f.control[changed] = true;
    const result = await f.client.check(detail); assert.equal(result.pubcheck.verdict, "ERROR"); assert.equal(result.pubcheck.metadataMatches, null);
  }
  const f = fixture(); f.control.wrongCountDoi = true;
  assert.equal((await f.client.check(detail)).citations.status, "unavailable");
});

test("unsafe bibliography delimiters cannot create extra entries or leak unrelated fields", async () => {
  const f = fixture();
  const result = await f.client.check({ ...detail, item: { ...detail.item, title: 'A {title}\n}, @article{injected,title={evil} <i>text</i>' } });
  assert.equal(result.pubcheck.verdict, "VERIFIED");
  const query = JSON.parse(String(f.calls[0]!.init?.body)).query as string;
  assert.equal(bibliographyRecords(query).length, 1); assert(!query.includes("PRIVATE"));
  const unsafe = fixture();
  const blocked = await unsafe.client.check({ ...detail, item: { ...detail.item, doi: "10.1234/x},title={injected}" } }, false);
  assert.equal(blocked.pubcheck.verdict, "ERROR"); assert.equal(unsafe.calls.length, 0);
});

test("oversized responses are bounded and malformed JSON cannot produce a positive result", async () => {
  for (const body of ["x".repeat(2 * 1024 * 1024 + 1), "invalid json"]) {
    const fetch: typeof globalThis.fetch = async () => new Response(body);
    const result = await new PubcheckClient(fetch).check(detail);
    assert.equal(result.pubcheck.verdict, "ERROR"); assert.equal(result.pubcheck.metadataMatches, null);
    assert.equal(result.citations.count, null); assert.equal(result.citations.status, "unavailable");
  }
});

test("project source checks paginate all scoped sources, reject out-of-scope selections before external calls and never write", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "zla-check-sources-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveProjectConfig(root, { ...newProjectConfig(), library, collectionKey: "COLL2345", serverId: "db-A" });
  const before = await readProjectText(root, CONFIG_FILE); const f = fixture();
  const items = ["ITEM2345", "ITEM2346", "ITEM2347"].map((key) => ({ key, version: 7, data: { ...detail.data, itemType: "journalArticle", title: detail.item.title,
    DOI: detail.item.doi, date: detail.item.date, creators: detail.item.creators } }));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "localhost") return f.fetch(input, init);
    assert(!init?.method || init.method === "GET");
    const headers = { "Zotero-API-Version": "3", "Zotero-Server-ID": "db-A" };
    let body: unknown;
    if (url.pathname === "/api/") return new Response("", { headers });
    if (url.pathname === "/api/users/0/collections/COLL2345") body = { key: "COLL2345", data: { name: "Tests" } };
    else if (url.pathname.endsWith("/top")) body = [...items, { key: "NOTE2345", version: 1, data: { itemType: "note" } }];
    else if (url.pathname.endsWith("/OTHER234")) body = { ...items[0], key: "OTHER234", data: { ...items[0]!.data, collections: ["OTHER234"] } };
    else body = items.find((item) => url.pathname.endsWith(`/${item.key}`));
    return new Response(JSON.stringify(body ?? {}), { headers, status: body ? 200 : 404 });
  };
  const service = new ZoteroProjectService(root, { fetch });
  const page = await service.checkSources(undefined, 2);
  assert.equal(page.total, 3); assert.equal(page.nextOffset, 2); assert.equal(page.results.length, 2);
  const last = await service.checkSources(undefined, 2, page.nextOffset!);
  assert.equal(last.results[0]!.itemKey, "ITEM2347"); assert.equal(last.nextOffset, null);
  assert.equal((await service.checkSources(undefined, 2, 3)).results.length, 0);
  const externalCalls = f.calls.length;
  await assert.rejects(service.checkSources(["ITEM2345", "OTHER234"]), /selected project collection/);
  assert.equal(f.calls.length, externalCalls);
  await assert.rejects(service.checkSources(["ITEM2345", "ITEM2345"]), /unique/);
  await assert.rejects(service.checkSources(["ITEM2345"], 5, 1), /offset/);
  assert.equal(await readProjectText(root, CONFIG_FILE), before);
});
