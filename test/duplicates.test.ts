import assert from "node:assert/strict";
import { test } from "node:test";
import { bibliographyRecords } from "../src/biblatex/fields";
import { findBibliographyDuplicates, newBibliographyDuplicates, normalizedDoi } from "../src/biblatex/duplicates";

test("DOI normalization matches URL, prefix, case, escaped characters and percent encoding", () => {
  for (const value of ["10.1234/Example/Part", "DOI: 10.1234/EXAMPLE/part", "https://doi.org/10.1234/Example%2FPart", "http://dx.doi.org/10.1234/example/part"]) {
    assert.equal(normalizedDoi(value), "10.1234/example/part");
  }
  assert.equal(normalizedDoi("10.1234/a\\_b"), "10.1234/a_b");
  assert.equal(normalizedDoi("not a DOI"), undefined);
});

test("Bib fields resolve string concatenation while comments, abstracts and special entries cannot fake DOI matches", () => {
  const text = '% @string{fake={wrong}}\n@comment{@book{fake,doi={10.1234/real}}}\n@string{prefix="https://doi.org/"}\n@string{suffix={10.1234/real}}\n@book{first,doi=prefix # suffix,title={Nested {title}},year=2024}\n@article(second, DOI="10.1234/REAL",abstract={doi={10.9999/fake}})';
  const records = bibliographyRecords(text);
  assert.equal(records[0]?.fields.get("doi")?.value, "https://doi.org/10.1234/real");
  assert.equal(records[0]?.fields.get("year")?.value, "2024");
  assert.deepEqual(findBibliographyDuplicates(text), [{ first: "first", second: "second", reason: "doi" }]);
  assert.deepEqual(findBibliographyDuplicates('@book{a,abstract={doi={10.1234/test}}}\n@book{b,doi={10.1234/test}}'), []);
});

test("Matching title, author names and publication year produce a possible duplicate", () => {
  const first = '@article{a,title={A {Detailed} Scientific Study},author={Müller, Anna and Smith, John},date={2024-03-12}}';
  const second = '@book{b,title="A detailed scientific study",author={John Smith and Anna M{\\"u}ller},year=2024}';
  assert.deepEqual(findBibliographyDuplicates(first + second), [{ first: "a", second: "b", reason: "title-author-year" }]);
  assert.deepEqual(findBibliographyDuplicates(first + second.replace("year=2024", "year=2025")), []);
});

test("Different explicit DOIs prevent a title-based warning; incomplete metadata is not guessed", () => {
  const first = '@article{a,title={A Detailed Scientific Study},author={Smith, John},year=2024,doi={10.1234/one}}';
  const second = '@article{b,title={A Detailed Scientific Study},author={Smith, John},year=2024,doi={10.1234/two}}';
  assert.deepEqual(findBibliographyDuplicates(first + second), []);
  assert.deepEqual(findBibliographyDuplicates('@book{a,title={A Detailed Scientific Study}}@book{b,title={A Detailed Scientific Study}}'), []);
});

test("Only newly introduced duplicate pairs are reported during an import", () => {
  const existing = '@book{a,doi={10.1234/same}}@book{b,doi={10.1234/same}}';
  assert.deepEqual(newBibliographyDuplicates(existing, existing + '@book{new,doi={10.5678/different}}'), []);
  assert.equal(newBibliographyDuplicates(existing, existing + '@book{new,doi={10.1234/SAME}}').length, 2);
  assert.deepEqual(newBibliographyDuplicates('@book{removed,doi={10.1234/same}}', '@book{replacement,doi={10.1234/same}}'), []);
});

test("Unknown or cyclic strings stay unresolved; malformed field syntax cannot bypass validation", () => {
  assert.equal(bibliographyRecords('@string{one=two}@string{two=one}@book{a,doi=one}')[0]?.fields.get("doi")?.value, undefined);
  assert.equal(bibliographyRecords('@book{a,doi=unknown}')[0]?.fields.get("doi")?.value, undefined);
  assert.throws(() => bibliographyRecords('@book{a,title={A} author={B}}'), /separator/);
  assert.throws(() => bibliographyRecords('@book{a,doi={10.1234/a},DOI={10.1234/b}}'), /Duplicate bibliography field/);
});

test("Field comments and text formatting do not hide duplicates; xdata records are not independent publications", () => {
  const first = '@book{a,title % field comment\n = {A \\emph{Detailed} Scientific Study},author={Smith, John},year=2024}';
  const second = '@book{b,title={A Detailed Scientific Study},author={John Smith},year=2024}';
  assert.equal(findBibliographyDuplicates(first + second).length, 1);
  assert.deepEqual(findBibliographyDuplicates('@xdata{metadata,doi={10.1234/same}}@book{a,doi={10.1234/same},xdata={metadata}}'), []);
});
