import assert from "node:assert/strict";
import { test } from "node:test";
import { doiResultHtml, escapeHtml } from "../src/views/webviewHtml";

const hostile = '</textarea><script>alert("evil")</script>';

test("Crossref-Metadaten können keinen ausführbaren Code in die Vorschau einschleusen", () => {
  const html = doiResultHtml({ doi: "10.1234/example", title: hostile, authors: hostile, publisher: "Publisher", data: { title: hostile } });
  assert.ok(!html.includes(hostile));
  assert.ok(html.includes(escapeHtml(hostile)));
  assert.match(html, /default-src 'none'/);
  assert.equal((html.match(/<script /g) ?? []).length, 1);
});

test("Crossref-Ansichten bleiben reine Vorschauen ohne Metadatenformular", () => {
  const doi = doiResultHtml({ doi: "10.1234/example", title: hostile, authors: hostile, publisher: "Publisher", data: { title: hostile } });
  assert.ok(!doi.includes(hostile));
  assert.match(doi, /Copy DOI/);
  assert.doesNotMatch(doi, /type:'save'/);
  assert.doesNotMatch(doi, /<form/);
});
