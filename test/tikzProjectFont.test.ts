import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { readProjectFont } from "../src/tikz/projectFont";
import { prepareTikz, tikzInputSchema } from "../src/tikz/document";
import { renderTikz, type TikzRunner } from "../src/tikz/renderer";

const code = String.raw`\begin{tikzpicture}\node {Font};\end{tikzpicture}`;
const document = (preamble: string): string => `\\documentclass{article}\n${preamble}\n\\begin{document}\nText\n\\end{document}\n`;

async function project(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "tikz-font-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (file: string, text: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  };
  return { root, write };
}

test("Without an explicit font, main.tex supplies the font and compiler", async (t) => {
  const f = await project(t);
  await f.write("main.tex", "% !TeX program = xelatex\n" + document(String.raw`\usepackage{fontspec}\setmainfont{Times New Roman}`));
  const inherited = await readProjectFont(f.root);
  assert.equal(inherited.texFile, "main.tex");
  assert.equal(inherited.settings.font, "Times New Roman");
  const prepared = prepareTikz(tikzInputSchema.parse({ name: "figure", code }), inherited.settings);
  assert.equal(prepared.font, "Times New Roman");
  assert.equal(prepared.engine, "xelatex");
  assert(prepared.source.includes(String.raw`\fontspec{Times New Roman}`));
  const explicit = prepareTikz(tikzInputSchema.parse({ name: "figure", code, font: "Arial" }), inherited.settings);
  assert.equal(explicit.font, "Arial");
  assert.equal(explicit.engine, "lualatex");
});

test("Font detection follows local preamble dependencies in order and ignores comments and document text", async (t) => {
  const f = await project(t);
  await f.write("config/fonts.tex", String.raw`\setmainfont{Arial}`);
  await f.write("localstyle.sty", String.raw`\setmainfont[Ligatures=TeX]{Times New Roman}[Numbers={Lining,Proportional}]`);
  await f.write("main.tex", document(String.raw`% \setmainfont{Wrong}
\input{config/fonts}
\usepackage{localstyle}
\newcommand{\unused}{Text}
`) + String.raw`\setmainfont{Wrong}`);
  const result = await readProjectFont(f.root);
  assert.equal(result.settings.font, "Times New Roman");
  assert.equal(result.settings.fontOptions, "Ligatures=TeX,Numbers={Lining,Proportional}");
  assert.deepEqual([...result.files.keys()], ["main.tex", "config/fonts.tex", "localstyle.sty"]);
});

test("Repeated usepackage does not reload a local font package", async (t) => {
  const f = await project(t);
  await f.write("fonts.sty", String.raw`\setmainfont{Arial}`);
  await f.write("main.tex", document(String.raw`\usepackage{fonts}\setmainfont{Times New Roman}\usepackage{fonts}`));
  assert.equal((await readProjectFont(f.root)).settings.font, "Times New Roman");
  await f.write("fonts.tex", String.raw`\setmainfont{Arial}`);
  await f.write("main.tex", document(String.raw`\input{fonts}\setmainfont{Times New Roman}\input{fonts}`));
  assert.equal((await readProjectFont(f.root)).settings.font, "Arial");
});

test("Preamble inputs resolve from the project working directory", async (t) => {
  const f = await project(t);
  await f.write("fonts.tex", String.raw`\setmainfont{Arial}`);
  await f.write("config/fonts.tex", String.raw`\setmainfont{Times New Roman}`);
  await f.write("config/preamble.tex", String.raw`\input{fonts}`);
  await f.write("main.tex", document(String.raw`\input{config/preamble}`));
  const result = await readProjectFont(f.root);
  assert.equal(result.settings.font, "Arial");
  assert(!result.files.has("config/fonts.tex"));
  await rm(path.join(f.root, "fonts.tex"));
  await assert.rejects(readProjectFont(f.root), /cannot read preamble dependency fonts/);
});

test("Repeated font packages retain their first options and reject option clashes", async (t) => {
  const f = await project(t);
  await f.write("main.tex", document(String.raw`\usepackage[scaled=0.95]{helvet}\usepackage{helvet}`));
  assert.deepEqual((await readProjectFont(f.root)).settings.preamble, [String.raw`\usepackage[scaled=0.95]{helvet}`]);
  await f.write("main.tex", document(String.raw`\usepackage[scaled=0.95]{helvet}\usepackage[scaled=0.9]{helvet}`));
  await assert.rejects(readProjectFont(f.root), /conflicting options/);
});

test("Legacy font packages and sans-serif defaults are inherited", async (t) => {
  const f = await project(t);
  await f.write("main.tex", document(String.raw`\usepackage[T1]{fontenc}\usepackage[scaled=0.95]{helvet}\renewcommand{\familydefault}{\sfdefault}`));
  let result = await readProjectFont(f.root);
  const input = tikzInputSchema.parse({ name: "legacy", code });
  let prepared = prepareTikz(input, result.settings);
  assert.equal(prepared.engine, "pdflatex");
  assert(prepared.preamble.includes(String.raw`\usepackage[scaled=0.95]{helvet}`));
  assert(prepared.source.includes("\\sffamily\n"));
  await f.write("main.tex", document(String.raw`\usepackage{fontspec}\setmainfont{Times New Roman}\setsansfont{Arial}\renewcommand\familydefault{\sfdefault}`));
  result = await readProjectFont(f.root);
  prepared = prepareTikz(input, result.settings);
  assert.equal(prepared.font, "Arial");
  assert.equal(prepared.engine, "lualatex");
});

test("Main-file discovery requires a choice when ambiguous and permits projects without TeX", async (t) => {
  const f = await project(t);
  assert.equal((await readProjectFont(f.root)).texFile, null);
  await f.write("chapter.tex", "Text without documentclass");
  await f.write("thesis/paper.tex", document(String.raw`\setmainfont{Arial}`));
  assert.equal((await readProjectFont(f.root)).texFile, "thesis/paper.tex");
  await f.write("slides.tex", document(String.raw`\setmainfont{Times New Roman}`));
  await assert.rejects(readProjectFont(f.root), /Multiple main/);
  assert.equal((await readProjectFont(f.root, "slides.tex")).settings.font, "Times New Roman");
  await assert.rejects(readProjectFont(f.root, "chapter.tex"), /main .tex/);
  await f.write("main.tex", document(""));
  assert.equal((await readProjectFont(f.root)).texFile, "main.tex");
});

test("Dynamic fonts, unresolved includes and escaping paths do not silently select a different font", async (t) => {
  const f = await project(t);
  for (const preamble of [String.raw`\setmainfont{\myfont}`, String.raw`\iftrue\setmainfont{Arial}\fi`, String.raw`\input{missing}`, String.raw`\input{../outside}`,
    String.raw`\newcommand{\fonts}{\setmainfont{Arial}}\fonts`, String.raw`\renewcommand{\familydefault}{\myfamily}`]) {
    await f.write("main.tex", document(preamble));
    await assert.rejects(readProjectFont(f.root));
  }
  const outside = await project(t);
  await outside.write("fonts.tex", String.raw`\setmainfont{Arial}`);
  await symlink(path.join(outside.root, "fonts.tex"), path.join(f.root, "fonts.tex"));
  await f.write("main.tex", document(String.raw`\input{fonts}`));
  await assert.rejects(readProjectFont(f.root), /outside/);
  await f.write("main.tex", document(String.raw`\input{cycle}`));
  await f.write("cycle.tex", String.raw`\input{main}`);
  await assert.rejects(readProjectFont(f.root), /Circular/);
  assert.equal(tikzInputSchema.safeParse({ name: "font", code, texFile: "../main.tex" }).success, false);
});

test("A changed font preamble prevents publication of the rendered figure", async (t) => {
  const f = await project(t);
  await f.write("main.tex", document(String.raw`\setmainfont{Arial}`));
  const run: TikzRunner = async (executable, _args, cwd) => {
    if (executable === "lualatex") await writeFile(path.join(cwd, "figure.pdf"), "%PDF-1.7\nfixture");
    else {
      await writeFile(path.join(cwd, "preview.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      await f.write("main.tex", document(String.raw`\setmainfont{Times New Roman}`));
    }
    return "";
  };
  await assert.rejects(renderTikz(f.root, tikzInputSchema.parse({ name: "changed", code }), run), /changed during font/);
  assert.deepEqual(await readdir(f.root), ["main.tex"]);
  assert((await readFile(path.join(f.root, "main.tex"), "utf8")).includes("Times New Roman"));
});
