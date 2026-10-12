import assert from "node:assert/strict";
import { test } from "node:test";
import { IdentifierClient, normalizeIdentifier } from "../src/research/identifiers";
import { normalizeIsbn } from "../src/research/isbn";
import { metadataSchema, sourceDuplicates } from "../src/zotero/metadata";
import { metadataCompleteness } from "../src/zotero/completeness";
import { parseItem } from "../src/zotero/items";

const doi = "10.1234/example";
const work = { DOI: doi, type: "journal-article", title: ["A real source"], author: [{ given: "Anna", family: "Müller" }],
  "container-title": ["Example Journal"], publisher: "Publisher", "published-print": { "date-parts": [[2024, 2, 10]] },
  volume: "2", issue: "3", page: "10-20", ISSN: ["1234-5678"], abstract: "<jats:p>Example abstract</jats:p>" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("ISBN checksum validation and equivalent edition identity; malformed identifiers never reach the network", async () => {
  assert.equal(normalizeIsbn("ISBN-10: 0-306-40615-2"), "9780306406157");
  assert.equal(normalizeIsbn("978-0-306-40615-7"), "9780306406157");
  assert.equal(normalizeIsbn("080442957X"), "9780804429573");
  assert.deepEqual(normalizeIdentifier(`https://doi.org/10.1234%2FEXAMPLE`), { kind: "doi", value: doi });
  let calls = 0;
  const client = new IdentifierClient(async () => { calls++; throw new Error("should not fetch"); });
  for (const input of ["9780306406158", "0306406153", "1234567890", "9790306406157", "https://evil.example/a", "10.1234/%ZZ"]) {
    await assert.rejects(client.lookup(input));
  }
  assert.equal(calls, 0);
});

test("Crossref maps article metadata without using ingestion dates as publication dates", async () => {
  const client = new IdentifierClient(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.crossref.org");
    assert.equal(url.pathname, "/works/10.1234%2Fexample");
    assert.equal(init?.redirect, "error");
    assert(!Object.keys(init?.headers ?? {}).some((v) => /zotero|authorization/i.test(v)));
    return json({ message: work });
  });
  const result = await client.lookup(doi);
  assert.equal(result.provider, "crossref");
  assert.equal(result.metadata.itemType, "journalArticle");
  assert.equal(result.metadata.fields.publicationTitle, "Example Journal");
  assert.equal(result.metadata.fields.date, "2024-02-10");
  assert.equal(result.metadata.fields.abstractNote, "Example abstract");
  assert.deepEqual(result.metadata.creators, [{ creatorType: "author", firstName: "Anna", lastName: "Müller" }]);
  const minimal = await new IdentifierClient(async () => json({ message: { DOI: doi, type: "book", title: ["Undated book"],
    created: { "date-parts": [[2025]] } } })).lookup(doi);
  assert.equal(minimal.metadata.fields.date, "");
  assert.deepEqual(minimal.metadata.creators, []);
});

test("DOI source types map to Zotero book, chapter, thesis, report and conference fields", async () => {
  for (const [type, itemType, containerField, publisherField] of [
    ["book", "book", "publicationTitle", "publisher"], ["book-chapter", "bookSection", "bookTitle", "publisher"],
    ["dissertation", "thesis", "publicationTitle", "university"], ["report", "report", "publicationTitle", "institution"],
    ["proceedings-article", "conferencePaper", "proceedingsTitle", "publisher"], ["posted-content", "preprint", "repository", "publisher"],
  ]) {
    const result = await new IdentifierClient(async () => json({ message: { ...work, type, institution: [{ name: "Actual Institution" }] } })).lookup(doi);
    assert.equal(result.metadata.itemType, itemType);
    assert.equal(result.metadata.fields[containerField!], "Example Journal");
    assert.equal(result.metadata.fields[publisherField!], itemType === "thesis" || itemType === "report" ? "Actual Institution" : "Publisher");
    assert.deepEqual(result.warnings, []);
  }
  await assert.rejects(new IdentifierClient(async () => json({ message: { ...work, type: "unknown" } })).lookup(doi), /Unsupported/);
});

test("Crossref thesis/report imports use explicit institutions rather than their publisher", async () => {
  for (const [type, field] of [["dissertation", "university"], ["report", "institution"]]) {
    const result = await new IdentifierClient(async () => json({ message: { ...work, type,
      publisher: "Commercial Publishing Service", institution: [{ name: "Actual University" }] } })).lookup(doi);
    assert.equal(result.metadata.fields[field!], "Actual University");
    assert.deepEqual(result.warnings, []);
    assert(!Object.hasOwn(result.metadata.fields, "publisher"));
  }
});

test("DataCite thesis/report imports never treat repositories or affiliations as their university/institution", async () => {
  for (const [resourceTypeGeneral, field] of [["Dissertation", "university"], ["Report", "institution"]]) {
    const attributes = { doi, types: { resourceTypeGeneral }, titles: [{ title: "Institutional source" }],
      publisher: { name: "External Repository" }, creators: [{ name: "Researcher", affiliation: [{ name: "Author University" }] }],
      contributors: [{ name: "Hosting University", nameType: "Organizational", contributorType: "HostingInstitution" },
        { name: "Media Producer", nameType: "Organizational", contributorType: "Producer" }] };
    const result = await new IdentifierClient(async (input) => new URL(String(input)).hostname === "api.crossref.org" ? json({}, 404)
      : json({ data: { attributes } })).lookup(doi);
    assert(!result.metadata.fields[field!]);
    assert.equal(result.warnings.length, 1); assert(result.warnings[0]!.includes(field!));
    assert(!Object.hasOwn(result.metadata.fields, "publisher"));
  }
});

test("missing or malformed Crossref institutions leave optional fields empty with guidance", async (t) => {
  for (const type of ["dissertation", "report"]) {
    for (const [label, institution] of Object.entries({ missing: undefined, empty: [], blank: [{ name: "  " }],
      malformed: [{ name: 123 }, null, "Fake University"], wrongShape: { name: "Unverified University" } })) {
      await t.test(`${type}: ${label}`, async () => {
        const result = await new IdentifierClient(async () => json({ message: { ...work, type, institution,
          author: [{ family: "Researcher", affiliation: [{ name: "Author University" }] }] } })).lookup(doi);
        const field = type === "dissertation" ? "university" : "institution";
        assert(!Object.hasOwn(result.metadata.fields, field)); assert.equal(result.warnings.length, 1);
        assert(result.warnings[0]!.includes(field));
        assert.equal(metadataCompleteness(result.metadata).complete, true);
      });
    }
  }
});

test("Crossref institution names are trimmed and combined without inventing publisher or affiliation roles", async () => {
  const result = await new IdentifierClient(async () => json({ message: { ...work, type: "dissertation",
    institution: [{ name: " First University " }, { name: "Second University" }, { name: " " }, { acronym: "GUESS" }, null] } })).lookup(doi);
  assert.equal(result.metadata.fields.university, "First University; Second University");
  assert.deepEqual(result.warnings, []);
  const article = await new IdentifierClient(async () => json({ message: { ...work, institution: [{ name: "Unrelated Institution" }] } })).lookup(doi);
  assert.equal(article.metadata.fields.publisher, "Publisher");
  assert(!Object.hasOwn(article.metadata.fields, "university")); assert(!Object.hasOwn(article.metadata.fields, "institution"));
});

test("DataCite supports string/object publishers while institutional roles remain unproven", async () => {
  for (const publisher of ["Repository", { name: " Repository " }]) {
    for (const [resourceType, resourceTypeGeneral, field] of [["Dissertation", "Text", "university"], ["Report", "Text", "institution"],
      ["Book", "Book", "publisher"], ["Dataset", "Dataset", "publisher"], ["Software", "Software", "publisher"]]) {
      const result = await new IdentifierClient(async (input) => new URL(String(input)).hostname === "api.crossref.org" ? json({}, 404)
        : json({ data: { attributes: { doi, types: { resourceType, resourceTypeGeneral }, titles: [{ title: "DataCite source" }], publisher } } })).lookup(doi);
      if (field === "publisher") { assert.equal(result.metadata.fields.publisher, "Repository"); assert.deepEqual(result.warnings, []); }
      else { assert(!Object.hasOwn(result.metadata.fields, field!)); assert.equal(result.warnings.length, 1); }
    }
  }
});

test("DataCite fallback is used only after Crossref 404, and checks the returned DOI", async () => {
  const calls: string[] = [];
  const client = new IdentifierClient(async (input) => {
    const url = new URL(String(input)); calls.push(url.origin);
    if (url.hostname === "api.crossref.org") return json({}, 404);
    return json({ data: { attributes: { doi, types: { resourceTypeGeneral: "Dataset" }, titles: [{ title: "Dataset title" }],
      creators: [{ name: "Research Institute", nameType: "Organizational" }], publisher: "Repository", publicationYear: 2023 } } });
  });
  const result = await client.lookup(doi);
  assert.deepEqual(calls, ["https://api.crossref.org", "https://api.datacite.org"]);
  assert.equal(result.metadata.itemType, "dataset"); assert.equal(result.provider, "datacite");
  assert.equal(result.metadata.fields.date, "2023");
  assert.deepEqual(result.metadata.creators, [{ creatorType: "author", name: "Research Institute" }]);
  const wrong = new IdentifierClient(async (input) => new URL(String(input)).hostname === "api.crossref.org" ? json({}, 404)
    : json({ data: { attributes: { doi: "10.1234/other", types: { resourceTypeGeneral: "Book" }, titles: [{ title: "Wrong" }] } } }));
  await assert.rejects(wrong.lookup(doi), /does not match/);
  for (const status of [429, 500]) {
    let count = 0;
    await assert.rejects(new IdentifierClient(async () => { count++; return json({}, status); }).lookup(doi), new RegExp(String(status)));
    assert.equal(count, 1);
  }
});

test("Open Library verifies the requested edition and preserves literal author names", async () => {
  const isbn = "9780306406157";
  const data = { title: "Book title", authors: [{ name: "Ludwig van Beethoven" }], identifiers: { isbn_10: ["0306406152"] },
    publishers: [{ name: "Publisher" }], publish_places: [{ name: "Berlin" }], publish_date: "1980", number_of_pages: 200 };
  const result = await new IdentifierClient(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://openlibrary.org"); assert.equal(url.searchParams.get("bibkeys"), `ISBN:${isbn}`);
    return json({ [`ISBN:${isbn}`]: data });
  }).lookup("0-306-40615-2");
  assert.equal(result.metadata.fields.ISBN, isbn); assert.equal(result.metadata.fields.publisher, "Publisher");
  assert.equal(result.metadata.fields.numPages, "200");
  assert.deepEqual(result.metadata.creators, [{ creatorType: "author", name: "Ludwig van Beethoven" }]);
  await assert.rejects(new IdentifierClient(async () => json({ [`ISBN:${isbn}`]: { ...data, identifiers: { isbn_13: ["9780140328721"] } } })).lookup(isbn), /does not match/);
  await assert.rejects(new IdentifierClient(async () => json({})).lookup(isbn), /not found/);
});

test("Metadata recommendations never require all fields, an author, publication date, DOI or ISBN", () => {
  for (const itemType of ["book", "journalArticle", "bookSection", "report", "thesis", "webpage", "conferencePaper", "preprint", "dataset", "letter"]) {
    const source = metadataSchema.parse({ itemType, title: "An incomplete source" });
    const result = metadataCompleteness(source);
    assert.equal(result.complete, true);
    assert.deepEqual(result.required, ["itemType", "title"]);
    assert.deepEqual(result.missingRequired, []);
    assert(result.missingRecommended.length > 0);
  }
  const webpage = metadataCompleteness(metadataSchema.parse({ itemType: "webpage", title: "Anonymous page", fields: { url: "https://example.org", websiteTitle: "Example" } }));
  assert(webpage.missingRecommended.includes("creators"));
  assert.deepEqual(metadataCompleteness(metadataSchema.parse({ itemType: "book", title: "Edited book", creators: [{ creatorType: "editor", name: "Editorial board" }] })).missingRecommended.includes("creators"), false);
});

test("ISBN-10/13 duplicate books are blocked, while different editions and chapters stay distinct; native citation keys and Extra DOI are read", () => {
  const library = { type: "user" as const, id: 0 };
  const book = parseItem({ key: "BOOK2345", data: { itemType: "book", title: "Book", ISBN: "0306406152",
    citationKey: "native2026", extra: "Citation Key: obsolete\nDOI: 10.1234/book" } }, library);
  assert.equal(book.citationKey, "native2026"); assert.equal(book.doi, "10.1234/book");
  const input = metadataSchema.parse({ itemType: "book", title: "Another title", fields: { ISBN: "9780306406157" } });
  assert.equal(sourceDuplicates(input, [book])[0]?.reason, "isbn");
  assert.deepEqual(sourceDuplicates({ ...input, itemType: "bookSection" }, [book]), []);
  assert.deepEqual(sourceDuplicates({ ...input, fields: { ISBN: "9780140328721" } }, [book]), []);
  assert.equal(sourceDuplicates({ ...input, fields: { extra: "DOI: 10.1234/book" } }, [book])[0]?.reason, "doi");
});

test("Malformed, excessive and unavailable provider responses fail without returning invented metadata", async () => {
  await assert.rejects(new IdentifierClient(async () => { throw new TypeError("offline"); }).lookup(doi), /lookup failed/);
  for (const response of ["null", "{}", "not json", JSON.stringify({ message: { ...work, DOI: "10.1234/wrong" } }), " ".repeat(2 * 1024 * 1024 + 1)]) {
    await assert.rejects(new IdentifierClient(async () => new Response(response)).lookup(doi));
  }
});
