import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeBibliography } from "../src/biblatex/importer";
import { bibliographyRecords } from "../src/biblatex/fields";
import { migrateTexReferences, migrationPreview, planCitationKeyMigration } from "../src/biblatex/migration";
import type { ProjectConfig } from "../src/shared/types";

const config: ProjectConfig = { version: 1, library: { type: "user", id: 0 }, collectionKey: "", bibFile: "refs.bib",
  citationStyle: "authoryear", citationCommand: "autocite", importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Old2024" } };
const targets = { ITEM0001: "New2025" };

test("Migration changes entry keys, project mapping, literal citations and bibliography references together", () => {
  const bib = mergeBibliography('@book{manual,title={Old2024},crossref={Old2024}}\n', ['@book{Old2024,title={Keep metadata},year=2024}']);
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text: bib }],
    [{ path: "main.tex", text: "\\autocite[Old2024][12]{Old2024}\n\\nocite{Old2024,manual}" }], targets);
  assert.deepEqual(plan.config.citationKeys, targets);
  assert.equal(plan.referenceCount, 3);
  const changed = plan.changes.find((change) => change.path === "refs.bib")!.text;
  assert.deepEqual(bibliographyRecords(changed).map((record) => record.key), ["manual", "New2025"]);
  assert.match(changed, /title=\{Old2024\},crossref=\{New2025\}/);
  assert.doesNotThrow(() => mergeBibliography(changed, ['@book{New2025,title={Next update}}']));
  assert.equal(plan.changes.find((change) => change.path === "main.tex")?.text,
    "\\autocite[Old2024][12]{New2025}\n\\nocite{New2025,manual}");
});

test("Alias definitions and both alias citation commands migrate with the bibliography and project mapping", () => {
  const tex = "\\defcitealias{Old2024}{Study I}\n\\citetalias{Old2024} and \\citepalias{Old2024}\n";
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text: "@book{Old2024,title={Keep metadata}}" }],
    [{ path: "main.tex", text: tex }], targets);
  assert.deepEqual(plan.config.citationKeys, targets);
  assert.deepEqual(bibliographyRecords(plan.changes.find((change) => change.path === "refs.bib")!.text).map((record) => record.key), ["New2025"]);
  assert.equal(plan.changes.find((change) => change.path === "main.tex")!.text,
    "\\defcitealias{New2025}{Study I}\n\\citetalias{New2025} and \\citepalias{New2025}\n");
  assert.equal(plan.referenceCount, 3);
  assert.match(migrationPreview(plan), /3 citation\/bibliography reference\(s\)/);
});

test("Alias commands are single citations: formatted labels, matching caption text and notes stay unchanged", () => {
  const tex = "\\defcitealias{Old2024}{Study~\\emph{Old2024}}\n\\citetalias[Old2024]{Old2024}{Old2024}\n\\citepalias{Old2024}{\\emph{Old2024}}\n";
  const result = migrateTexReferences(tex, new Map([["Old2024", "New2025"]]));
  assert.equal(result.count, 3);
  assert.equal(result.text,
    "\\defcitealias{New2025}{Study~\\emph{Old2024}}\n\\citetalias[Old2024]{New2025}{Old2024}\n\\citepalias{New2025}{\\emph{Old2024}}\n");
});

test("Alias references in comments, literal examples and escaped commands are preserved", () => {
  const before = "% \\citetalias{Old2024}\n\\verb|\\citepalias{Old2024}|\n\\begin{verbatim}\n\\defcitealias{Old2024}{Example}\n\\end{verbatim}\n\\\\citetalias{Old2024}\n";
  const active = "\\citetalias{Old2024}\n\\citepalias{Old2024}\n";
  const result = migrateTexReferences(before + active, new Map([["Old2024", "New2025"]]));
  assert.equal(result.count, 2);
  assert.equal(result.text, before + "\\citetalias{New2025}\n\\citepalias{New2025}\n");
});

test("Starred commands, multicites, global notes, volume references and comma lists migrate without changing notes", () => {
  const text = "\\cite*{Old2024,other}\n\\autocites(Old2024)(global)[Old2024][12]{Old2024}[prefix][14]{other,Old2024}\n\\volcite{2}[Old2024]{Old2024}";
  const migrated = migrateTexReferences(text, new Map([["Old2024", "New2025"]]));
  assert.equal(migrated.count, 4);
  assert.equal(migrated.text, "\\cite*{New2025,other}\n\\autocites(Old2024)(global)[Old2024][12]{New2025}[prefix][14]{other,New2025}\n\\volcite{2}[Old2024]{New2025}");
});

test("Comments, literal examples, escaped commands and unrelated arguments are preserved", () => {
  const text = "% \\begin{verbatim} \\cite{Old2024}\n\\cite{Old2024}\n\\verb|% \\cite{Old2024}|\n\\begin{minted}{tex}\n\\cite{Old2024}\n\\end{minted}\n\\label{Old2024}\n\\\\cite{Old2024}\n";
  const migrated = migrateTexReferences(text, new Map([["Old2024", "New2025"]]));
  assert.equal(migrated.count, 1);
  assert.equal(migrated.text, text.replace("\n\\cite{Old2024}\n", "\n\\cite{New2025}\n"));
});

test("Migration offsets remain correct with Unicode, CRLF and comments inside a citation list", () => {
  const text = "😀 \\cite{Old2024,% comment Old2024\r\n other,Old2024}\r\n\\% \\cite{Old2024}";
  const migrated = migrateTexReferences(text, new Map([["Old2024", "新Key2025"]]));
  assert.equal(migrated.count, 3);
  assert.equal(migrated.text, "😀 \\cite{新Key2025,% comment Old2024\r\n other,新Key2025}\r\n\\% \\cite{新Key2025}");
});

test("Simultaneous key swaps are allowed without double-replacing references", () => {
  const tracked = { ...config, importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "A", ITEM0002: "B" } };
  const plan = planCitationKeyMigration(tracked, [{ path: "refs.bib", text: "@book{A,title={First}}@book{B,title={Second}}" }],
    [{ path: "main.tex", text: "\\cite{A,B}" }], { ITEM0001: "B", ITEM0002: "A" });
  assert.equal(plan.changes.find((change) => change.path === "main.tex")?.text, "\\cite{B,A}");
  assert.deepEqual(plan.config.citationKeys, { ITEM0001: "B", ITEM0002: "A" });
});

test("Existing target keys, aliases, missing sources and duplicate keys in other resources abort planning", () => {
  for (const bib of ["@book{Old2024,title={Original}}@book{New2025,title={Manual}}",
    "@book{Old2024,ids={New2025},title={Original}}", "@book{Old2024,ids=unknown,title={Original}}", "@book{Different,title={Missing}}"] ) {
    assert.throws(() => planCitationKeyMigration(config, [{ path: "refs.bib", text: bib }], [], targets));
  }
  assert.throws(() => planCitationKeyMigration(config, [{ path: "refs.bib", text: "@book{Old2024,title={Original}}" },
    { path: "other.bib", text: "@book{Old2024,title={Ambiguous}}" }], [], targets), /ambiguous bibliography/);
  assert.throws(() => planCitationKeyMigration(config, [{ path: "refs.bib", text: "@book{Old2024,title={Original}}" }], [], { ITEM0001: "x}\\input{evil}" }), /Invalid citation key/);
});

test("String-based crossrefs and references from another .bib file migrate without changing its entries", () => {
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text: "@book{Old2024,title={Original}}" },
    { path: "other.bib", text: "@string{parent={Old2024}}\n@inbook{chapter,crossref=parent,related={Old2024,another},title={Keep}}" }], [], targets);
  const text = plan.changes.find((change) => change.path === "other.bib")!.text;
  assert.match(text, /@inbook\{chapter,crossref=\{New2025\},related=\{New2025,another\}/);
  assert.match(text, /@string\{parent=\{Old2024\}\}/);
});

test("Comments outside bibliography values survive without migrating words inside the comments", () => {
  const text = '@book{Old2024,title={100% Original}}\n@book{related,\n % Old2024 } is only a comment\n related={Old2024,another}}';
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text }], [], targets);
  assert.equal(plan.referenceCount, 1);
  assert.match(plan.changes[0]!.text, /% Old2024 \} is only a comment\n related=\{New2025,another\}/);
  assert.match(plan.changes[0]!.text, /title=\{100% Original\}/);
});

test("Migration preserves literal percent signs in reference expressions and refuses to discard real comments", () => {
  const prefix = '@book{Old2024,title={100% Original}}\n@book{related,related=';
  const literal = `${prefix}{Old2024,} # {another%20key}}`;
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text: literal }], [], targets);
  assert.match(plan.changes[0]!.text, /related=\{New2025,another%20key\}/);
  const commented = `${prefix}{Old2024,} % keep this comment\n # {another}}`;
  assert.throws(() => planCitationKeyMigration(config, [{ path: "refs.bib", text: commented }], [], targets), /commented bibliography reference/);
});

test("Legacy imported keys and manually edited fields are preserved through a reviewed migration", () => {
  const { citationKeys: _mapping, ...legacy } = config;
  const old = mergeBibliography("", ["@book{zotero-user-0-ITEM0001,title={Original}}"]);
  const edited = old.replace("Original", "Manual edits");
  const plan = planCitationKeyMigration(legacy, [{ path: "refs.bib", text: edited }], [], targets);
  assert.match(plan.changes[0]!.text, /@book\{New2025,title=\{Manual edits\}\}/);
  assert.doesNotThrow(() => mergeBibliography(plan.changes[0]!.text, ["@book{New2025,title={Later update}}"]));
  assert.match(migrationPreview(plan), /zotero-user-0-ITEM0001 → New2025/);
  assert.match(migrationPreview(plan), /Manual edits/);
});

test("Locally declared citation commands migrate while unresolved citation macros are rejected", () => {
  const plan = planCitationKeyMigration(config, [{ path: "refs.bib", text: "@book{Old2024,title={Original}}" }],
    [{ path: "commands.sty", text: "\\DeclareCiteCommand{\\source}{}{\\printnames{author}}{}{}" },
      { path: "main.tex", text: "\\source[12]{Old2024}" }], targets);
  assert.equal(plan.changes.find((change) => change.path === "main.tex")?.text, "\\source[12]{New2025}");
  assert.throws(() => migrateTexReferences("\\cite{\\savedKey}", new Map([["Old2024", "New2025"]])), /Dynamic LaTeX citation arguments/);
  assert.throws(() => migrateTexReferences("\\newcommand{\\custom}[1]{\\cite{#1}}", new Map([["Old2024", "New2025"]])), /Dynamic LaTeX citation arguments/);
  for (const command of ["defcitealias", "citetalias", "citepalias"]) {
    assert.throws(() => migrateTexReferences(`\\${command}{\\savedKey}{Label}`, new Map([["Old2024", "New2025"]])), /Dynamic LaTeX citation arguments/);
  }
});
