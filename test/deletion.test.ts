import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteTexCitations, planCitationDeletion, citationDeletionPreview } from "../src/biblatex/deletion";
import { newProjectConfig, withProjectLibrary } from "../src/config/project";
import { bibEntries, mergeBibliography } from "../src/biblatex/importer";
import { bibliographyRecords } from "../src/biblatex/fields";
import type { ProjectConfig } from "../src/shared/types";

const config: ProjectConfig = { ...newProjectConfig("parencite"), library: { type: "user", id: 0 }, collectionKey: "ROOT0001", serverId: "old-database",
  bibFile: "refs.bib", citationStyle: "authoryear", importedItemKeys: ["ITEM0001", "ITEM0002"], citationKeys: { ITEM0001: "Parent2024", ITEM0002: "Missing2024" } };

test("Deletion removes full citation commands with notes, stars, comma keys and dynamic arguments", () => {
  const source = 'Before \\autocite[see][12]{Parent2024} middle \\parencite*{A,B} \\textcite{\\keyMacro} \\citeauthor{#1} after.';
  const result = deleteTexCitations(source);
  assert.equal(result.text, 'Before  middle    after.');
  assert.equal(result.count, 4);
});

test("Plural and volume citations consume only their own complete arguments", () => {
  const result = deleteTexCitations('A \\autocites(see)(together)[12]{A}[14]{B} B \\pvolcite[pre]{2}[16]{C} C \\volcites{1}{A}{2}[20]{B} D');
  assert.equal(result.text, 'A  B  C  D');
  assert.equal(result.count, 5);
});

test("Comments, escaped commands, literal examples, resource paths and surrounding text remain intact", () => {
  const original = '% \\cite{Old}\n\\verb|\\cite{Old}|\n\\begin{verbatim}\\cite{Old}\\end{verbatim}\n\\\\cite{Old}\n\\addbibresource{refs.bib}\n\\usepackage[style=authoryear]{biblatex}\nText \\cite{Old} end.';
  assert.equal(deleteTexCitations(original).text, original.replace('Text \\cite{Old} end.', 'Text  end.'));
});

test("Quoted prose and punctuation survive deleting integrated text, block and foreign citations", () => {
  const source = '\\textcquote[see][12]{A}[.]{Quoted \\autocite{B} words} \\foreignblockcquote{german}[4]{C}{Zitat}';
  const result = deleteTexCitations(source);
  assert.equal(result.text, '\\textquote[][.]{Quoted  words} \\foreignblockquote{german}[]{Zitat}');
  assert.equal(result.count, 3);
  assert.equal(deleteTexCitations('\\begin{displaycquote}[14]{A}[.]Quoted words\\end{displaycquote}').text,
    '\\begin{displayquote}[][.]Quoted words\\end{displayquote}');
});

test("Citation metadata commands consume their extra arguments without leaving code fragments", () => {
  assert.equal(deleteTexCitations('A \\citefield{Key}{title} B \\entrydata{Key}{\\printfield{title}} C \\defcitealias{Key}{Alias} \\defbibentryset{Set}{A,B} D').text,
    'A  B  C   D');
});

test("Locally declared citation commands are recognized across project files", () => {
  const definition = '\\DeclareCiteCommand{\\mycite}{pre}{loop}{sep}{post}\n\\DeclareMultiCiteCommand{\\mycites}{\\mycite}{sep}\n';
  const plan = planCitationDeletion(config, [], [{ path: "style.sty", text: definition }, { path: "main.tex", text: 'Text \\mycite{A} and \\mycites{B}{C}.' }]);
  assert.equal(plan.changes.find((change) => change.path === "main.tex")?.text, 'Text  and .');
  assert.equal(plan.changes.some((change) => change.path === "style.sty"), false);
  assert.equal(plan.citationCount, 3);
});

test("Reset clears every managed entry and mapping while preserving unrelated bibliography fields and macros", () => {
  const old = mergeBibliography('@string{pub={Keep Press}}\n@book{manual,title={Keep},publisher=pub}\n', [
    '@book{Parent2024,title={Delete}}', '@article{StaleManaged,title={No longer mapped}}',
  ]);
  const plan = planCitationDeletion(config, [{ path: "refs.bib", text: old }], [{ path: "main.tex", text: 'Text \\autocite{Parent2024}.' }]);
  const bib = plan.changes.find((change) => change.path === "refs.bib")!.text;
  assert.deepEqual(bibEntries(bib).map((entry) => entry.key), ["manual"]);
  assert.match(bib, /@string\{pub=\{Keep Press\}\}/);
  assert.equal(plan.bibliographyCount, 2);
  assert.equal(plan.config.library, null);
  assert.equal(plan.config.collectionKey, "");
  assert.equal(plan.config.serverId, undefined);
  assert.deepEqual(plan.config.importedItemKeys, []);
  assert.deepEqual(plan.config.citationKeys, {});
  assert.equal(plan.config.bibFile, config.bibFile);
  assert.equal(plan.config.citationStyle, config.citationStyle);
  assert.equal(plan.config.citationCommand, config.citationCommand);
  assert.equal(withProjectLibrary(plan.config, { type: "group", id: 42 }, "NEWCOL01", "new-database").library?.id, 42);
});

test("Missing bibliography and stale imports still allow citations and the old library binding to be cleared", () => {
  const plan = planCitationDeletion(config, [], [{ path: "main.ltx", text: 'Text \\parencite{Missing2024}.' }]);
  assert.equal(plan.changes[0]?.text, 'Text .');
  assert.equal(plan.config.library, null);
  assert.equal(plan.bibliographyCount, 0);
  assert.deepEqual(plan.config.importedItemKeys, []);
  assert.equal(planCitationDeletion(newProjectConfig(), [], []).config.library, null);
});

test("References from retained bibliography entries stop pointing at removed imported sources", () => {
  const sources = [{ path: "refs.bib", text: '@book{Parent2024,title={Delete}}\n@inbook{ManualChapter,crossref={Parent2024},title={Keep chapter}}' },
    { path: "other.bib", text: '@book{Other,related={Parent2024,Retained},title={Keep}}' }];
  const plan = planCitationDeletion(config, sources, []);
  assert.equal(bibliographyRecords(plan.changes.find((change) => change.path === "refs.bib")!.text)[0]?.fields.get("crossref")?.value, "");
  assert.equal(bibliographyRecords(plan.changes.find((change) => change.path === "other.bib")!.text)[0]?.fields.get("related")?.value, "Retained");
});

test("Malformed quotes, citation arguments and damaged bibliography abort before a reset plan", () => {
  assert.throws(() => deleteTexCitations('\\autocite{Unclosed'), /Unbalanced/);
  assert.throws(() => deleteTexCitations('\\textcquote{A}'), /Incomplete/);
  assert.throws(() => deleteTexCitations('\\begin{displaycquote}{A}Text'), /Unclosed/);
  assert.throws(() => planCitationDeletion(config, [{ path: "refs.bib", text: '@book{Parent2024,title={Broken}' }], []), /Incomplete/);
  assert.throws(() => planCitationDeletion(config, [{ path: "refs.bib", text: '@book{Manual,crossref=unknown}' }], []), /cannot resolve/);
});

test("Deletion preview shows the complete changes and safe code fences", () => {
  const plan = planCitationDeletion(config, [], [{ path: "main.tex", text: '``` \\cite{Key} end' }]);
  const preview = citationDeletionPreview(plan);
  assert.match(preview, /Delete all citations/);
  assert.match(preview, /library, collection, database binding/);
  assert.match(preview, /````\n``` \\cite\{Key\}/);
});

test("Selective deletion removes only matching sources and preserves mixed citation notes and other keys", () => {
  const source = 'A \\autocite[see][12]{Parent2024} B \\parencite[Parent2024][14]{Other,Parent2024,Another} C \\cite{Parent2024Extra} D.';
  const result = deleteTexCitations(source, new Map(), new Set(["Parent2024"]));
  assert.equal(result.text, 'A  B \\parencite[Parent2024][14]{Other,Another} C \\cite{Parent2024Extra} D.');
  assert.equal(result.count, 2);
});

test("Selective plural and volume deletion retains common notes and complete surviving groups", () => {
  const source = '\\autocites(see)(together)[12]{Remove}[14]{Keep}[16]{Remove,Another} and \\volcites{1}[12]{Remove}{2}[24]{Keep}';
  assert.equal(deleteTexCitations(source, new Map(), new Set(["Remove"])).text,
    '\\autocites(see)(together)[14]{Keep}[16]{Another} and \\volcites{2}[24]{Keep}');
  assert.equal(deleteTexCitations('Text \\autocites(see)(together)[12]{Remove}[14]{Remove}.', new Map(), new Set(["Remove"])).text, 'Text .');
});

test("Selective quote removal preserves prose and converts only affected quotation environments", () => {
  const source = '\\textcquote{Remove}{Preserved words} \\textcquote[12]{Remove,Keep}{Mixed quote}\n'
    + '\\begin{displaycquote}{Keep}Unchanged\\end{displaycquote}\n\\begin{displaycquote}{Remove}Preserved\\end{displaycquote}';
  assert.equal(deleteTexCitations(source, new Map(), new Set(["Remove"])).text,
    '\\textquote[]{Preserved words} \\textcquote[12]{Keep}{Mixed quote}\n'
    + '\\begin{displaycquote}{Keep}Unchanged\\end{displaycquote}\n\\begin{displayquote}[]Preserved\\end{displayquote}');
});

test("Selective key lists retain comments and wildcard nocite; unrelated source text is unchanged", () => {
  const source = '% \\cite{Remove}\n\\verb|\\cite{Remove}|\n\\cite{Remove,% keep comment\nKeep}\n\\nocite{*}\n';
  assert.equal(deleteTexCitations(source, new Map(), new Set(["Remove"])).text,
    '% \\cite{Remove}\n\\verb|\\cite{Remove}|\n\\cite{Keep % keep comment\n}\n\\nocite{*}\n');
});

test("Selective deletion refuses unresolved key macros before producing a partial update", () => {
  assert.throws(() => deleteTexCitations('\\cite{Remove} \\cite{\\dynamicKey}', new Map(), new Set(["Remove"])), /Dynamic LaTeX citation keys/);
  assert.equal(deleteTexCitations('\\cite{\\dynamicKey}', new Map(), new Set()).text, '\\cite{\\dynamicKey}');
});
