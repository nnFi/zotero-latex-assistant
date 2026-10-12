import assert from "node:assert/strict";
import { test } from "node:test";
import { CrossrefClient, normalizeDoi } from "../src/research/crossref";

const work = { DOI: "10.1234/example", title: ["Eine Publikation"], author: [{ given: "Anna", family: "Müller" }], publisher: "Verlag" };

test("DOI, DOI-URL und DOI-Präfix werden normalisiert; ungültige Eingaben abgewiesen", () => {
  assert.equal(normalizeDoi(" https://doi.org/10.1234%2Fexample "), work.DOI);
  assert.equal(normalizeDoi("doi: 10.1234/example"), work.DOI);
  for (const input of ["", "https://example.org", "10.12/test", "10.1234/a b", "10.1234/%ZZ"]) assert.throws(() => normalizeDoi(input));
});

test("DOI-Metadaten werden nur über den festen Crossref-Endpunkt abgerufen und der DOI zugeordnet", async () => {
  const client = new CrossrefClient(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.crossref.org");
    assert.equal(url.pathname, "/works/10.1234%2Fexample");
    return new Response(JSON.stringify({ message: work }));
  });
  const results = await client.search("https://doi.org/10.1234/example");
  assert.equal(results[0]?.title, "Eine Publikation");
  assert.equal(results[0]?.authors, "Anna Müller");
});

test("Titelsuche liefert Kandidaten statt eine geratene DOI", async () => {
  const client = new CrossrefClient(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("query.bibliographic"), "Eine Publikation");
    assert.equal(url.searchParams.get("rows"), "10");
    return new Response(JSON.stringify({ message: { items: [work, { ...work, DOI: "10.1234/another", title: ["Weitere Publikation"] }] } }));
  });
  assert.equal((await client.search("Eine Publikation")).length, 2);
});

test("Fehlende Crossref-DOIs, Rate-Limits, Netzwerkfehler und falsche Metadaten werden verständlich behandelt", async () => {
  for (const [status, message] of [[404, /another registration agency/], [429, /limiting/], [500, /failed/]] as const) {
    await assert.rejects(new CrossrefClient(async () => new Response("", { status })).search(work.DOI), message);
  }
  await assert.rejects(new CrossrefClient(async () => { throw new Error("offline"); }).search(work.DOI), /unavailable/);
  await assert.rejects(new CrossrefClient(async () => new Response(JSON.stringify({ message: { ...work, DOI: "10.1234/wrong" } }))).search(work.DOI), /does not match/);
  await assert.rejects(new CrossrefClient(async () => new Response("{}")).search(work.DOI), /Invalid/);
});
