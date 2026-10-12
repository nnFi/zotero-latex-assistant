import assert from "node:assert/strict";
import { test } from "node:test";
import { planBiblatexResources } from "../src/biblatex/texResources";
import { planBiblatexStyle, type TexSource } from "../src/biblatex/texStyle";

const main = (body: string): string => `\\documentclass{article}\n${body}\n\\begin{document}\nText\\end{document}\n`;
const apply = (sources: readonly TexSource[], changes: readonly TexSource[]): TexSource[] => sources.map((source) => changes.find((change) => change.path === source.path) ?? source);

test("Resource switches preserve options, extra resources, citation keys, comments and literal examples", () => {
  const source = { path: "main.tex", text: main('\\usepackage[style=numeric]{biblatex}\n% \\addbibresource{old.bib}\n\\addbibresource[location=local,label=primary]{old.bib}\n\\addbibresource{extra.bib}\n\\verb|\\addbibresource{old.bib}|') };
  const changed = planBiblatexResources([source], "old.bib", "sources/new.bib");
  assert.equal(changed.length, 1);
  assert.match(changed[0]!.text, /label=primary\]\{sources\/new.bib\}/);
  assert.match(changed[0]!.text, /% \\addbibresource\{old.bib\}/);
  assert.match(changed[0]!.text, /\\verb\|\\addbibresource\{old.bib\}\|/);
  assert.match(changed[0]!.text, /\\addbibresource\{extra.bib\}/);
  assert.equal((changed[0]!.text.match(/new\.bib/g) ?? []).length, 1);
});

test("Nested roots resolve references from the main document and update included local packages", () => {
  const sources = [{ path: "paper/main.tex", text: main('\\usepackage{setup}') },
    { path: "paper/setup.sty", text: '\\RequirePackage[backend=biber]{biblatex}\n\\addbibresource{../old.bib}\n\\printbibliography\n' }];
  const changes = planBiblatexResources(sources, "old.bib", "sources/new.bib");
  assert.deepEqual(changes.map((change) => change.path), ["paper/setup.sty"]);
  assert.match(changes[0]!.text, /\\addbibresource\{\.\.\/sources\/new.bib\}/);
});

test("Legacy comma lists retain extensionless spelling and unrelated bibliography resources", () => {
  const sources = [{ path: "main.tex", text: '\\bibliography{ extra, old, other.bib }\n' }];
  assert.equal(planBiblatexResources(sources, "old.bib", "bib/new.bib")[0]!.text,
    '\\bibliography{ extra, bib/new, other.bib }\n');
});

test("Both setup orders yield a package, exactly one resource and bibliography output", () => {
  const sources = [{ path: "main.tex", text: main("") }];
  const bibFirst = apply(sources, planBiblatexResources(sources, "", "refs.bib"));
  const first = apply(bibFirst, planBiblatexStyle(bibFirst, "authoryear", "refs.bib"));
  const styleFirst = apply(sources, planBiblatexStyle(sources, "authoryear"));
  const second = apply(styleFirst, planBiblatexResources(styleFirst, "", "refs.bib"));
  assert.equal(first[0]!.text, second[0]!.text);
  assert.equal((second[0]!.text.match(/\\addbibresource/g) ?? []).length, 1);
  assert.match(second[0]!.text, /\\printbibliography/);
  assert.equal(planBiblatexResources(second, "refs.bib", "refs.bib").length, 0);
});

test("Existing package styles remain unchanged when only a resource is selected", () => {
  const sources = [{ path: "main.tex", text: main('\\usepackage[style=verbose,backend=biber]{biblatex}') }];
  const text = planBiblatexResources(sources, "", "refs.bib")[0]!.text;
  assert.match(text, /style=verbose,backend=biber/);
  assert.match(text, /\\addbibresource\{refs.bib\}/);
  assert.match(text, /\\printbibliography/);
});

test("Resources loaded through a local class are updated without duplicate setup", () => {
  const sources = [{ path: "main.tex", text: '\\documentclass{local}\n\\begin{document}Text\\end{document}' },
    { path: "local.cls", text: '\\LoadClass{base}\n' },
    { path: "base.cls", text: '\\RequirePackage{biblatex}\n\\addbibresource{old.bib}\n\\printbibliography' }];
  const changes = planBiblatexResources(sources, "old.bib", "new.bib");
  assert.deepEqual(changes.map((change) => change.path), ["base.cls"]);
  assert.match(changes[0]!.text, /\\addbibresource\{new.bib\}/);
});

test("Dynamic and ambiguous shared paths abort the entire plan before edits", () => {
  assert.throws(() => planBiblatexResources([{ path: "main.tex", text: main('\\addbibresource{\\jobname.bib}') }], "old.bib", "new.bib"), /dynamic/);
  const sources = [{ path: "main.tex", text: main('\\input{shared}') },
    { path: "nested/main.tex", text: main('\\input{../shared}') },
    { path: "shared.tex", text: '\\addbibresource{old.bib}' }];
  assert.throws(() => planBiblatexResources(sources, "old.bib", "new.bib"), /shared bibliography reference/);
  assert.throws(() => planBiblatexResources([], "", "bad%name.bib"), /cannot be inserted/);
});

test("Remote resources and escaped commands are never retargeted", () => {
  const text = '\\addbibresource[location=remote]{https://example.org/old.bib}\n\\\\addbibresource{old.bib}\n';
  assert.equal(planBiblatexResources([{ path: "main.tex", text }], "old.bib", "new.bib").length, 0);
});
