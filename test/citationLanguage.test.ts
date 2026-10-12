import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { citationLanguage, languageDescription, localizedLocator } from "../src/biblatex/language";
import { citationText, insertPreparedCitation } from "../src/biblatex/citations";
import { newProjectConfig, parseProjectConfig } from "../src/config/project";
import { listInstalledStyles, parseStyle } from "../src/zotero/styles";
import type { ZoteroItem } from "../src/shared/types";

const library = { type: "user" as const, id: 0 };
const item: ZoteroItem = { library, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };

test("Style language comes from CSL metadata, not the style title or UI language", () => {
  assert.equal(parseStyle('<style default-locale="de-DE"><info><id>test</id><title>English title</title></info></style>')?.locale, "de-DE");
  assert.equal(parseStyle('<style><info><id>test</id><title>Deutsch</title></info></style>')?.locale, undefined);
  assert.equal(parseStyle("<style default-locale='en-us'><info><id>test</id><title>Deutsch</title></info></style>")?.locale, "en-US");
});

test("Dependent styles inherit hidden parents; own language overrides the parent's; unresolved parents use a visible fallback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-style-language-"));
  try {
    await mkdir(path.join(root, "hidden"));
    const xml = (id: string, locale = "", parent = "") => `<style ${locale ? `default-locale="${locale}"` : ""}><info><id>${id}</id><title>${id}</title>${parent ? `<link href="${parent}" rel="independent-parent"/>` : ""}</info></style>`;
    await writeFile(path.join(root, "hidden/parent.csl"), xml("parent", "de-DE"));
    await writeFile(path.join(root, "hidden/middle.csl"), xml("middle", "", "parent"));
    await writeFile(path.join(root, "inherited.csl"), xml("inherited", "", "middle"));
    await writeFile(path.join(root, "override.csl"), xml("override", "en-GB", "parent"));
    await writeFile(path.join(root, "neutral.csl"), xml("neutral"));
    await writeFile(path.join(root, "missing.csl"), xml("missing", "", "uninstalled"));
    await writeFile(path.join(root, "cycle.csl"), xml("cycle", "", "cycle"));
    const styles = await listInstalledStyles(root);
    assert.equal(styles.length, 5); // Hidden parents are never picker entries.
    assert.deepEqual(styles.find((style) => style.id === "inherited")?.language, citationLanguage("de-DE"));
    assert.deepEqual(styles.find((style) => style.id === "override")?.language, citationLanguage("en-GB"));
    for (const id of ["neutral", "missing", "cycle"]) {
      assert.deepEqual(styles.find((style) => style.id === id)?.language, citationLanguage("en-US", true));
    }
    assert.match(languageDescription(styles.find((style) => style.id === "neutral")!.language!), /English.*fallback/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Inline page terms use exact dialect before base language and unqualified defaults", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-custom-language-"));
  try {
    await writeFile(path.join(root, "custom.csl"), `<style default-locale="en-GB"><info><id>custom</id><title>Custom</title></info>
      <locale xml:lang="en-GB"><terms><term name="page" form="short"><single>leaf</single><multiple>leaves</multiple></term></terms></locale>
      <locale xml:lang="en"><terms><term name="page" form="short">base</term></terms></locale>
      <locale><terms><term name="page" form="short">default</term></terms></locale>
      <locale xml:lang="de-DE"><terms><term name="page" form="short">foreign</term></terms></locale></style>`);
    const language = (await listInstalledStyles(root))[0]!.language!;
    assert.equal(localizedLocator("14", language), "leaf 14");
    assert.equal(localizedLocator("14–16", language), "leaves 14–16");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Page labels support singular, ranges, lists and Roman numerals; explicit locations and prefixes are preserved", () => {
  assert.equal(localizedLocator("14", citationLanguage("de-DE")), "S. 14");
  assert.equal(localizedLocator("14–16", citationLanguage("de-DE")), "S. 14–16");
  assert.equal(localizedLocator("14", citationLanguage("en-GB")), "p. 14");
  for (const pages of ["14–16", "14--16", "14, 16", "14 & 16", "iv–vi"]) {
    assert.equal(localizedLocator(pages, citationLanguage("en-US")), `pp. ${pages}`);
  }
  assert.equal(localizedLocator("xii", citationLanguage("en-US")), "p. xii");
  for (const pages of ["", "Kap. 3", "S. 14", "p. 14", "Appendix A"]) {
    assert.equal(localizedLocator(pages, citationLanguage("de-DE")), pages);
  }
  assert.equal(citationText("parencite", library, [item.key], { language: citationLanguage("de-DE"), prenote: "vgl.", postnote: "14" }),
    "\\parencite[vgl.][S. 14]{zotero-user-0-ITEM0001}");
});

test("Bundled CSL dialects work offline; unknown languages explicitly fall back for locator terms", () => {
  assert.equal(citationLanguage("fr-CA").page, "p.");
  assert.equal(citationLanguage("de-AT").page, "S.");
  assert.equal(citationLanguage("de").page, "S.");
  assert.equal(citationLanguage("es-MX").pages, "pp.");
  assert.equal(citationLanguage("xx").fallback, true);
  assert.equal(citationLanguage("xx").page, "p.");
});

test("Saved language is canonical and optional for old project configurations", () => {
  assert.deepEqual(parseProjectConfig(newProjectConfig()), newProjectConfig());
  assert.equal(parseProjectConfig({ ...newProjectConfig(), citationLocale: "de-de" }).citationLocale, "de-DE");
  for (const citationLocale of [null, 42, "", "de_DE", "de\\input{x}"]) {
    assert.throws(() => parseProjectConfig({ ...newProjectConfig(), citationLocale }), /Invalid citation language/);
  }
});

test("Insertion uses the saved language and refuses a style change during the citation dialogs", async () => {
  const { citationStyleType: _type, ...legacy } = newProjectConfig();
  const config = { ...legacy, library, bibFile: "references.bib", citationStyle: "de-style",
    citationLocale: "de-DE", importedItemKeys: [item.key] };
  let inserted = "";
  const target = { isCurrent: () => true, insert: async (text: string) => { inserted = text; return true; } };
  await insertPreparedCitation([item], target, async () => config, { postnote: "14–16" });
  assert.equal(inserted, "\\autocite[S. 14–16]{zotero-user-0-ITEM0001}");
  inserted = "";
  await assert.rejects(insertPreparedCitation([item], target, async () => config,
    { postnote: "14", styleId: "en-style", language: citationLanguage("en-US") }), /citation style changed/);
  assert.equal(inserted, "");
});
