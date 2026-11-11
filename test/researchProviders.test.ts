import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BibliographyAudit } from "../src/research/bibliographyAudit";
import { getFulltext } from "../src/research/fulltext";
import { Literature } from "../src/research/literature";
import { ProviderRun } from "../src/research/providerRun";
import { getPublicDocument, isPublicAddress, type DocumentRequest } from "../src/research/publicDocuments";

const doi = "10.1234/fulltext";
const title = "A study of analytical engines";
const author = "Lovelace, Ada";
const reference = { doi, title, authors: [author, "Babbage, Charles"], year: 1843 };
const openAlex = { id: "https://openalex.org/W123", doi: `https://doi.org/${doi}`, title, publication_year: 1843,
  authorships: [{ author: { display_name: "Ada Lovelace" } }, { author: { display_name: "Charles Babbage" } }], cited_by_count: 17 };
const crossref = { DOI: doi, title: [title], author: [{ given: "Ada", family: "Lovelace" }, { given: "Charles", family: "Babbage" }],
  issued: { "date-parts": [[1843]] }, "is-referenced-by-count": 4 };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const pdf = Buffer.from("%PDF-1.7\nSimulated article\n%%EOF");
const none: DocumentRequest = async () => { throw new Error("Unexpected document request."); };

function mock(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>, key = "") {
  const calls: URL[] = [];
  const run = new ProviderRun((input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    return Promise.resolve(handler(url, init));
  }, key);
  return { calls, run, literature: new Literature(run) };
}

test("both indexes compare original fields in DOI-dependent order and keep disagreement visible", async () => {
  const withDoi = mock((url) => url.hostname === "api.crossref.org" ? json({ message: crossref })
    : json({ ...openAlex, title: "Another title", publication_year: 1844 }));
  const checked = await withDoi.literature.check(reference);
  assert.deepEqual(withDoi.calls.map((url) => url.hostname), ["api.crossref.org", "api.openalex.org"]);
  assert.equal(checked.results[0]?.status, "ok");
  assert.deepEqual(checked.results[1]?.fields, { doi: "match", title: "mismatch", authors: "match", year: "mismatch" });

  const noDoi = mock((url) => url.hostname === "api.crossref.org" ? json({ message: { items: [crossref] } })
    : json({ results: [openAlex, { ...openAlex, id: "https://openalex.org/W124", doi: "https://doi.org/10.1234/other" }] }));
  const searched = await noDoi.literature.check({ ...reference, doi: undefined });
  assert.deepEqual(noDoi.calls.map((url) => url.hostname), ["api.openalex.org", "api.crossref.org"]);
  assert.equal(noDoi.calls[1]?.searchParams.get("query.author"), author);
  assert.equal(searched.results[0]?.status, "ambiguous");
  assert.equal(searched.results[1]?.status, "ok");
});

test("misses do not trip provider state and a long Retry-After skips the remaining run", async () => {
  let mode = 404;
  const f = mock(() => new Response(null, { status: mode, headers: { "Retry-After": "60" } }));
  assert.equal((await f.literature.lookup("crossref", doi)).evidence.status, "not-found");
  assert.equal((await f.literature.lookup("crossref", doi)).evidence.status, "not-found");
  mode = 429;
  assert.equal((await f.literature.lookup("crossref", doi)).evidence.status, "unavailable");
  assert.equal((await f.literature.lookup("crossref", doi)).evidence.status, "skipped");
  assert.equal(f.calls.length, 3);

  let attempts = 0;
  const recovered = mock(() => ++attempts === 1 ? json({}, 408) : json({ message: crossref }));
  assert.equal((await recovered.literature.lookup("crossref", doi)).value?.doi, doi);
  assert.equal(attempts, 2);
});

test("citations page by OpenAlex work id and preserve a Crossref fallback count with its provenance", async () => {
  const f = mock((url) => url.searchParams.has("filter") ? json({ meta: { count: 17 }, results: [openAlex] }) : json(openAlex));
  const first = await f.literature.citations(reference, 2, 3);
  assert.equal(first.count?.provider, "openalex");
  assert.equal(first.count?.value, 17);
  assert.equal(first.nextPage, 3);
  assert.equal(f.calls[1]?.searchParams.get("filter"), "cites:W123");
  assert.equal(f.calls[1]?.searchParams.get("page"), "2");

  const fallback = mock((url) => url.hostname === "api.openalex.org" ? json({}, 503)
    : json({ message: { ...crossref, "is-referenced-by-count": 0 } }));
  const count = await fallback.literature.citations(reference, 1, 20);
  assert.equal(count.count?.provider, "crossref");
  assert.equal(count.count?.value, 0);
  assert.match(count.count?.sourceUrl ?? "", /api\.crossref\.org/);
  assert.ok(Date.parse(count.count?.checkedAt ?? ""));
  assert.equal(count.citing, null);
  assert.deepEqual(count.evidence.map(({ status }) => status), ["unavailable", "ok"]);
  assert.deepEqual(fallback.calls.map(({ hostname }) => hostname), ["api.openalex.org", "api.openalex.org", "api.crossref.org"]);

  const partial = mock((url) => url.hostname === "api.crossref.org" ? json({ message: crossref })
    : url.searchParams.has("filter") ? json({}, 429) : json(openAlex));
  const partialResult = await partial.literature.citations(reference, 1, 20);
  assert.deepEqual(partialResult.counts.map(({ provider, value }) => [provider, value]), [["openalex", 17], ["crossref", 4]]);
  assert.equal(partialResult.citingSource?.status, "unavailable");
});

test("OpenAlex outage without DOI searches Crossref by title and first author and retrieves a publisher PDF", async () => {
  const f = mock((url) => url.hostname === "api.openalex.org" ? json({}, 503) : json({ message: { items: [crossref] } }));
  const pages: string[] = [];
  const download: DocumentRequest = async (url) => {
    pages.push(url.href);
    if (url.hostname === "doi.org") return { url: new URL("https://publisher.org/articles/analytical"),
      response: new Response('<meta name="citation_doi" content="10.1234/fulltext"><meta name="citation_pdf_url" content="../pdf/analytical">', { headers: { "Content-Type": "text/html" } }) };
    return { url, response: new Response(pdf, { headers: { "Content-Type": "application/pdf" } }) };
  };
  const found = await getFulltext(f.literature, { title, authors: [author], year: 1843 }, download);
  assert.deepEqual(f.calls.map((url) => url.hostname), ["api.openalex.org", "api.openalex.org", "api.crossref.org"]);
  assert.equal(f.calls[2]?.searchParams.get("query.bibliographic"), title);
  assert.equal(f.calls[2]?.searchParams.get("query.author"), author);
  assert.deepEqual(pages, [`https://doi.org/${doi}`, "https://publisher.org/pdf/analytical"]);
  assert.equal(found.status, "available");
  assert.equal(found.doi, doi);
  assert.equal(found.publicationUrl, "https://publisher.org/articles/analytical");
  assert.equal(found.document?.format, "pdf");
  assert.equal(found.pdfBase64, pdf.toString("base64"));
  assert.equal(found.contentVerified, false);
});

test("OpenAlex TEI exposes named sections and supplies its key only to OpenAlex calls", async () => {
  const f = mock((_url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sample-key");
    return json({ ...openAlex, has_content: { grobid_xml: true, pdf: true } });
  }, "sample-key");
  const fetched = await getFulltext(f.literature, reference, async (url, _signal, key) => {
    assert.equal(url.href, "https://content.openalex.org/works/W123.grobid-xml");
    assert.equal(key, "sample-key");
    return { url, response: new Response('<?xml version="1.0"?><TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><abstract><p>Abstract only</p></abstract></teiHeader><text><body><div><head>Analysis</head><p>The engine is programmable.</p></div></body></text></TEI>',
      { headers: { "Content-Type": "application/xml" } }) };
  });
  assert.equal(fetched.document?.format, "xml");
  assert.deepEqual(fetched.document?.sections, [{ heading: "Analysis", text: "The engine is programmable." }]);
  assert.equal(f.calls.length, 1);
});

test("known DOI bypasses Crossref for full text, and abstract pages fall through to DBLP or Zenodo", async () => {
  for (const archive of ["dblp", "zenodo"] as const) {
    const file = `https://${archive}.org/publication.pdf`;
    const f = mock((url) => {
      if (url.hostname === "api.openalex.org") return json({}, 404);
      if (url.hostname === "dblp.org") return json({ result: { hits: { hit: archive === "dblp" ? [{ info: { doi, title, ee: file } }] : [] } } });
      return json({ hits: { hits: [{ metadata: { title, access_right: "open", related_identifiers: [{ identifier: doi, relation: "isVersionOf" }] },
        files: [{ key: "publication.pdf", links: { self: file } }] }] } });
    });
    const pages: URL[] = [];
    const retrieved = await getFulltext(f.literature, reference, async (url) => {
      pages.push(url);
      const response = url.hostname === "doi.org"
        ? new Response("<article><h2>Abstract</h2><p>Short description.</p><h2>Access options</h2><p>Purchase article.</p></article>",
          { headers: { "Content-Type": "text/html" } })
        : new Response(pdf);
      return { url, response };
    });
    assert.deepEqual(pages.map(({ href }) => href), [`https://doi.org/${doi}`, file]);
    assert.equal(retrieved.document?.sourceUrl, file);
    assert.equal(retrieved.evidence.find(({ provider }) => provider === "publisher")?.status, "not-found");
    assert.equal(f.calls.some(({ hostname }) => hostname === "api.crossref.org"), false);
  }
});

test("publisher HTML returns article sections and keeps marked access restrictions open", async () => {
  for (const restricted of [false, true]) {
    const f = mock((url) => url.hostname === "api.openalex.org" ? json({}, 404)
      : url.hostname === "dblp.org" ? json({ result: { hits: {} } }) : json({ hits: { hits: [] } }));
    const result = await getFulltext(f.literature, reference, async (url) => ({ url,
      response: new Response(`<meta name="citation_fulltext_world_readable" content="${!restricted}">
        <article><section class="abstract"><p>Abstract.</p></section>
          <section itemprop="articleBody"><h2>Methods</h2><p>We simulated the engine.</p></section>
        </article>`, { headers: { "Content-Type": "text/html" } }) }));
    if (restricted) {
      assert.equal(result.status, "unresolved");
      assert.equal(result.evidence.find(({ provider }) => provider === "publisher")?.status, "restricted");
    } else {
      assert.equal(result.document?.format, "html");
      assert.deepEqual(result.document?.sections, [{ heading: "Methods", text: "We simulated the engine." }]);
    }
  }
});

test("ambiguous Crossref candidates do not open an unrelated DOI", async () => {
  const f = mock((url) => url.hostname === "api.openalex.org" ? json({ results: [] })
    : url.hostname === "api.crossref.org" ? json({ message: { items: [crossref, { ...crossref, DOI: "10.1234/other" }] } })
    : url.hostname === "dblp.org" ? json({ result: { hits: {} } }) : json({ hits: { hits: [] } }));
  let downloads = 0;
  const result = await getFulltext(f.literature, { title, authors: [author] }, (...args) => { downloads++; return none(...args); });
  assert.equal(downloads, 0);
  assert.equal(result.status, "unresolved");
  assert.equal(result.evidence.find(({ provider }) => provider === "crossref")?.status, "ambiguous");
});

test("public downloads reject non-public addresses and unsafe URL forms before connecting", async () => {
  for (const address of ["0.0.0.0", "127.0.0.1", "169.254.169.254", "100.127.0.1", "192.168.1.2", "239.1.1.1", "::1",
    "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false);
  for (const address of ["1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true);
  for (const url of ["https://127.1/", "https://[::1]/", "https://machine.local/", "https://user@example.org/", "http://example.org/"]) {
    await assert.rejects(getPublicDocument(new URL(url), AbortSignal.timeout(100)), /public HTTPS/);
  }
});

test("bibliography keeps its inputs and provider outage across pages and compares local TeX keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "bibliography-audit-"));
  try {
    const bib = Array.from({ length: 6 }, (_, index) => `@article{entry${index}, title={${title}}, author={${author} and Babbage, Charles}, year={1843}, doi={${doi}}}`).join("\n");
    await writeFile(join(root, "refs.bib"), bib);
    await writeFile(join(root, "main.tex"), String.raw`\cite{entry0,Missing} % \cite{Comment}`);
    const f = mock((url, init) => {
      if (url.hostname === "pubcheck.net") {
        assert(!String(init?.body).includes("Missing"));
        return json({}, 503);
      }
      return url.hostname === "api.crossref.org" ? json({ message: crossref }) : json(openAlex);
    });
    const audit = new BibliographyAudit(() => f.run);
    const first = await audit.start({ project: root });
    assert.equal(first.bibFile, "refs.bib");
    assert.equal(first.results.length, 5);
    assert.equal(first.results[0]?.pubcheck.evidence.status, "unavailable");
    assert.equal(first.results[1]?.pubcheck.evidence.status, "skipped");
    assert.deepEqual(f.calls.slice(0, 4).map(({ hostname }) => hostname), ["pubcheck.net", "pubcheck.net", "api.crossref.org", "api.openalex.org"]);
    assert.deepEqual(first.citationComparison?.missingFromBibliography, ["Missing"]);
    assert.deepEqual(first.citationComparison?.notCited, ["entry1", "entry2", "entry3", "entry4", "entry5"]);
    await writeFile(join(root, "refs.bib"), "");
    const second = await audit.continue(first.nextToken!);
    assert.equal(second.results[0]?.citationKey, "entry5");
    assert.equal(second.results[0]?.pubcheck.evidence.status, "skipped");
    assert.equal(second.nextToken, null);
    assert.equal(f.calls.filter(({ hostname }) => hostname === "pubcheck.net").length, 2);
    const totalCalls = f.calls.length;
    assert.deepEqual(await audit.continue(first.nextToken!), second);
    assert.equal(f.calls.length, totalCalls);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ambiguous saved bibliographies require a choice and dynamic inline citations stay unresolved", async () => {
  const root = await mkdtemp(join(tmpdir(), "bibliography-choice-"));
  try {
    await writeFile(join(root, "one.bib"), "");
    await writeFile(join(root, "two.bib"), "");
    const f = mock((url) => json({}, url.hostname === "pubcheck.net" ? 404 : 200));
    const audit = new BibliographyAudit(() => f.run);
    const ambiguous = await audit.start({ project: root });
    assert.equal(ambiguous.status, "ambiguous");
    assert.deepEqual(ambiguous.candidates, ["one.bib", "two.bib"]);
    assert.equal(f.calls.length, 0);
    const inline = await audit.start({ bibtex: "@book{source,title={One book}}", latex: String.raw`\nocite{*}` });
    assert.equal(inline.citationComparison?.status, "incomplete");
    assert.match(inline.citationComparison?.reason ?? "", /nocite/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
