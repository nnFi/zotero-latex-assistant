import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { prepareTikz, tikzInputSchema } from "../src/tikz/document";
import { localTikzRunner, renderTikz, type TikzRunner } from "../src/tikz/renderer";

const code = String.raw`\begin{tikzpicture}\node[draw] {Start};\end{tikzpicture}`;
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNcYAAAAASUVORK5CYII=", "base64");

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "tikz-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: { executable: string; args: readonly string[]; cwd: string }[] = [];
  const runner: TikzRunner = async (executable, args, cwd) => {
    calls.push({ executable, args, cwd });
    if (executable !== "pdftoppm") {
      assert(args.includes("-no-shell-escape"));
      assert(args.includes("-halt-on-error"));
      assert(args.includes("-no-parse-first-line"));
      await writeFile(path.join(cwd, "figure.pdf"), "%PDF-1.7\nfixture\n%%EOF");
      return "LaTeX Warning: Example warning\n";
    }
    assert.equal(executable, "pdftoppm");
    assert(args.includes("-scale-to") && args.includes("1600"));
    await writeFile(path.join(cwd, "preview.png"), png);
    return "";
  };
  return { root, calls, runner, input: tikzInputSchema.parse({ name: "ablauf", code, libraries: ["positioning", "arrows.meta"] }) };
}

test("TikZ creates figures/ with source and caches PDF/PNG separately", async (t) => {
  const f = await fixture(t);
  const result = await renderTikz(f.root, f.input, f.runner);
  assert.equal(result.status, "created");
  assert.equal(result.engine, "pdflatex");
  assert.equal(result.font, null);
  assert.equal(result.relativePath, "figures/ablauf.tikz");
  assert.equal(result.input, String.raw`\input{figures/ablauf.tikz}`);
  const source = await readFile(result.sourcePath, "utf8");
  assert(source.endsWith(code + "\n"));
  assert.equal(result.sha256, hash(source));
  assert(result.preamble.includes(String.raw`\usetikzlibrary{arrows.meta,positioning}`));
  assert.deepEqual(await readdir(path.join(f.root, "figures")), ["ablauf.tikz"]);
  assert.deepEqual((await readdir(f.root)).sort(), [".cache", "figures"]);
  assert.match(result.pdfPath, /\.cache/);
  assert.equal((await readFile(result.pdfPath, "utf8")).startsWith("%PDF-"), true);
  assert.deepEqual(await readFile(result.previewPath), png);
  assert.deepEqual(Buffer.from(result.previewBase64, "base64"), png);
  assert.deepEqual(result.warnings, ["LaTeX Warning: Example warning"]);
  assert.deepEqual(f.calls.map((call) => call.executable), ["pdflatex", "pdftoppm"]);
  await assert.rejects(readFile(path.join(f.calls[0]!.cwd, "figure.tex")), { code: "ENOENT" });
});

test("TikZ refuses accidental overwrites and stale hashes; explicit updates and identical retries work", async (t) => {
  const f = await fixture(t);
  const first = await renderTikz(f.root, f.input, f.runner);
  const different = { ...f.input, code: code.replace("Start", "Ende") };
  await assert.rejects(renderTikz(f.root, different, f.runner), /expectedSha256/);
  await assert.rejects(renderTikz(f.root, { ...different, expectedSha256: "0".repeat(64) }, f.runner), /changed/);
  assert.equal(f.calls.length, 2);
  assert.equal((await renderTikz(f.root, f.input, f.runner)).status, "unchanged");
  const updated = await renderTikz(f.root, { ...different, expectedSha256: first.sha256 }, f.runner);
  assert.equal(updated.status, "updated");
  assert((await readFile(first.sourcePath, "utf8")).includes("Ende"));
  await assert.rejects(renderTikz(f.root, { ...f.input, expectedSha256: first.sha256 }, f.runner), /changed/);
  await assert.rejects(renderTikz(f.root, { ...f.input, name: "missing", expectedSha256: first.sha256 }, f.runner), /changed/);
});

test("TikZ rejects traversal and malformed document arguments before rendering or writing", async (t) => {
  const f = await fixture(t);
  for (const name of ["../escape", "/tmp/escape", "figures/nested", "back\\slash", "x.tikz", "x%comment", "x\n", "", "CON", "nul", "COM1", "Lpt9"]) {
    await assert.rejects(renderTikz(f.root, { ...f.input, name }, f.runner));
  }
  for (const invalid of ["\\documentclass{article}" + code, "% " + code, code + "\\end{document}", "\\draw (0,0)--(1,1);", code + code]) {
    await assert.rejects(renderTikz(f.root, { ...f.input, code: invalid }, f.runner), /tikzpicture/);
  }
  assert.equal(tikzInputSchema.safeParse({ ...f.input, libraries: ["x}\\input{secret"] }).success, false);
  assert.equal(tikzInputSchema.safeParse({ ...f.input, packages: ["shellesc"] }).success, false);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("TikZ errors and missing tools preserve source, leave no figures for a new project, and clean temporary files", async (t) => {
  const f = await fixture(t);
  let directory = "";
  const broken: TikzRunner = async (_executable, _args, cwd) => {
    directory = cwd;
    throw Object.assign(new Error("compile error"), { stdout: "packages loaded\n! Undefined control sequence.\nl.7 \\broken\n", code: 1 });
  };
  await assert.rejects(renderTikz(f.root, f.input, broken), /Undefined control sequence/);
  assert.deepEqual(await readdir(f.root), []);
  await assert.rejects(readdir(directory), { code: "ENOENT" });
  const created = await renderTikz(f.root, f.input, f.runner);
  const original = await readFile(created.sourcePath, "utf8");
  await assert.rejects(renderTikz(f.root, { ...f.input, code: code.replace("Start", "Broken"), expectedSha256: created.sha256 }, broken));
  assert.equal(await readFile(created.sourcePath, "utf8"), original);
  const missing: TikzRunner = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
  await assert.rejects(renderTikz(f.root, f.input, missing), /TeX Live/);
  const timeout: TikzRunner = async () => { throw Object.assign(new Error("timeout"), { killed: true }); };
  await assert.rejects(renderTikz(f.root, f.input, timeout), /20 second/);
});

test("TikZ blocks symlink escapes for source and cache and detects edits made during rendering", async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(tmpdir(), "tikz-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(f.root, "figures"), "dir");
  await assert.rejects(renderTikz(f.root, f.input, f.runner), /outside/);
  assert.equal(f.calls.length, 0);
  await rm(path.join(f.root, "figures"));
  await symlink(outside, path.join(f.root, ".cache"), "dir");
  await assert.rejects(renderTikz(f.root, f.input, f.runner), /outside/);
  assert.deepEqual(await readdir(outside), []);
  await rm(path.join(f.root, ".cache"));
  const editDuringRender: TikzRunner = async (executable, args, cwd) => {
    const result = await f.runner(executable, args, cwd);
    if (executable === "pdftoppm") {
      await mkdir(path.join(f.root, "figures"));
      await writeFile(path.join(f.root, "figures/ablauf.tikz"), "manual edit");
    }
    return result;
  };
  await assert.rejects(renderTikz(f.root, f.input, editDuringRender), /changed/);
  assert.equal(await readFile(path.join(f.root, "figures/ablauf.tikz"), "utf8"), "manual edit");
  assert.deepEqual(await readdir(path.join(f.root, ".cache/zotero-latex-assistant/tikz")), []);
});

test("TikZ preview failures and invalid output bytes never publish source", async (t) => {
  const f = await fixture(t);
  const previewFailure: TikzRunner = async (executable, args, cwd) => {
    if (executable === "pdftoppm") throw new Error("preview failed");
    return f.runner(executable, args, cwd);
  };
  await assert.rejects(renderTikz(f.root, f.input, previewFailure), /preview failed/);
  const corrupt: TikzRunner = async (executable, args, cwd) => {
    await f.runner(executable, args, cwd);
    if (executable === "pdflatex") await writeFile(path.join(cwd, "figure.pdf"), "invalid");
    return "";
  };
  await assert.rejects(renderTikz(f.root, f.input, corrupt), /valid figure.pdf/);
  assert.deepEqual(await readdir(f.root), []);
});

test("Concurrent TikZ renders cannot overwrite another successful creation of the same figure", async (t) => {
  const f = await fixture(t);
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const concurrent: TikzRunner = async (executable, args, cwd) => {
    const result = await f.runner(executable, args, cwd);
    if (executable === "pdftoppm") {
      if (++arrived === 2) release();
      await barrier;
    }
    return result;
  };
  const results = await Promise.allSettled([
    renderTikz(f.root, f.input, concurrent),
    renderTikz(f.root, { ...f.input, code: code.replace("Start", "Different") }, concurrent),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const winner = results.find((result) => result.status === "fulfilled");
  assert(winner?.status === "fulfilled");
  assert.equal(hash(await readFile(winner.value.sourcePath, "utf8")), winner.value.sha256);
  assert.equal((await readdir(path.join(f.root, ".cache/zotero-latex-assistant/tikz"))).length, 1);
});

test("TikZ validation ignores comments and escaped command examples", () => {
  const literal = String.raw`\begin{tikzpicture}\node {\\usepackage};\end{tikzpicture}`;
  const input = tikzInputSchema.parse({ name: "example", code: "% example\n" + literal + "\n% end" });
  assert(prepareTikz(input).source.includes(literal));
  const nested = String.raw`\begin{tikzpicture}\node {\begin{tikzpicture}\node {Inset};\end{tikzpicture}};\end{tikzpicture}`;
  assert(prepareTikz({ ...input, code: nested }).source.includes(nested));
});

test("The local runner applies process limits and MacTeX fallback for each missing TeX engine", async () => {
  const calls: string[] = [];
  const run = localTikzRunner({ platform: "darwin", execute: async (executable, args, options) => {
    calls.push(executable);
    assert.equal(options.cwd, tmpdir());
    assert.equal(options.timeout, 20000);
    assert.equal(options.killSignal, "SIGKILL");
    assert.equal(options.env?.shell_escape, "f");
    assert.equal(options.env?.TEXMF_OUTPUT_DIRECTORY, tmpdir());
    assert.deepEqual(args, ["figure.tex"]);
    if (!executable.startsWith("/Library/TeX/texbin/")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { stdout: "compiled", stderr: "" };
  } });
  assert.equal(await run("pdflatex", ["figure.tex"], tmpdir()), "compiled");
  assert.equal(await run("lualatex", ["figure.tex"], tmpdir()), "compiled");
  assert.equal(await run("xelatex", ["figure.tex"], tmpdir()), "compiled");
  await assert.rejects(run("pdftoppm", ["figure.tex"], tmpdir()), { code: "ENOENT" });
  assert.deepEqual(calls, ["pdflatex", "/Library/TeX/texbin/pdflatex", "lualatex", "/Library/TeX/texbin/lualatex", "xelatex", "/Library/TeX/texbin/xelatex", "pdftoppm"]);
  const broken = localTikzRunner({ platform: "darwin", execute: async () => { throw Object.assign(new Error("compile failed"), { code: 1 }); } });
  await assert.rejects(broken("pdflatex", [], tmpdir()), /compile failed/);
});

test("An occupied TikZ write lock returns BUSY without saving the source or leaking output", async (t) => {
  const f = await fixture(t);
  const cache = path.join(f.root, ".cache/zotero-latex-assistant/tikz");
  await mkdir(path.join(cache, "write.lock"), { recursive: true });
  await assert.rejects(renderTikz(f.root, f.input, f.runner), (error: Error & { code?: string }) => error.code === "BUSY");
  assert.deepEqual(await readdir(cache), ["write.lock"]);
  await assert.rejects(readFile(path.join(f.root, "figures/ablauf.tikz")), { code: "ENOENT" });
});

test("Missing Poppler and oversized output preserve the project", async (t) => {
  const f = await fixture(t);
  const missingPreview: TikzRunner = async (executable, args, cwd) => {
    if (executable === "pdftoppm") throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return f.runner(executable, args, cwd);
  };
  await assert.rejects(renderTikz(f.root, f.input, missingPreview), /Poppler/);
  const oversized: TikzRunner = async (executable, args, cwd) => {
    await f.runner(executable, args, cwd);
    if (executable === "pdflatex") await writeFile(path.join(cwd, "figure.pdf"), Buffer.alloc(10 * 1024 * 1024 + 1));
    return "";
  };
  await assert.rejects(renderTikz(f.root, f.input, oversized), /size limit/);
  assert.deepEqual(await readdir(f.root), []);
});

test("Named fonts select LuaLaTeX and persist a local font selection for inclusion", async (t) => {
  const f = await fixture(t);
  const result = await renderTikz(f.root, { ...f.input, font: "Times New Roman" }, f.runner);
  assert.equal(result.engine, "lualatex");
  assert.equal(result.font, "Times New Roman");
  assert.deepEqual(f.calls.map((call) => call.executable), ["lualatex", "pdftoppm"]);
  assert(result.preamble.includes(String.raw`\usepackage{fontspec}`));
  const source = await readFile(result.sourcePath, "utf8");
  assert(source.includes(String.raw`\begingroup` + "\n" + String.raw`\fontspec{Times New Roman}`));
  assert(source.endsWith("\\endgroup\n"));
  assert(!result.preamble.includes("\\setmainfont"));
  await assert.rejects(renderTikz(f.root, { ...f.input, font: "Arial" }, f.runner), /expectedSha256/);
  const updated = await renderTikz(f.root, { ...f.input, font: "Arial", expectedSha256: result.sha256 }, f.runner);
  assert.equal(updated.status, "updated");
  assert.equal(updated.font, "Arial");
});

test("Explicit engines are respected and named fonts are rejected for pdfLaTeX before writing", async (t) => {
  const f = await fixture(t);
  await assert.rejects(renderTikz(f.root, { ...f.input, font: "Arial", engine: "pdflatex" }, f.runner), /require lualatex or xelatex/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.root), []);
  for (const engine of ["lualatex", "xelatex"] as const) {
    const result = await renderTikz(f.root, { ...f.input, name: engine, engine, font: "Arial" }, f.runner);
    assert.equal(result.engine, engine);
    assert.equal(f.calls.at(-2)?.executable, engine);
    assert((await readFile(result.sourcePath, "utf8")).includes(`% Required engine: ${engine}`));
    const unstyled = await renderTikz(f.root, { ...f.input, name: `${engine}-default`, engine }, f.runner);
    assert.equal(unstyled.engine, engine);
    assert.equal(unstyled.font, null);
  }
});

test("Font names cannot insert TeX commands or file paths", () => {
  for (const font of ["Arial", "Times New Roman", "TeX Gyre Termes", "Noto Sans (Regular)", "Écriture"]) {
    assert(tikzInputSchema.safeParse({ name: "font", code, font }).success);
  }
  for (const font of ["", "   ", "Arial}\\input{secret", "Arial%", "Arial\nOther", "/tmp/font.otf", "../font.ttf", "C:\\fonts\\font.ttf", "[font.otf]"]) {
    assert.equal(tikzInputSchema.safeParse({ name: "font", code, font }).success, false, font);
  }
  assert.equal(tikzInputSchema.safeParse({ name: "font", code, engine: "arbitrary-command" }).success, false);
});

test("Missing engines and fonts preserve existing figures", async (t) => {
  const f = await fixture(t);
  const original = await renderTikz(f.root, f.input, f.runner);
  const previous = await readFile(original.sourcePath, "utf8");
  const request = { ...f.input, font: "Missing Font", expectedSha256: original.sha256 };
  const missingEngine: TikzRunner = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
  await assert.rejects(renderTikz(f.root, request, missingEngine), /lualatex not found/);
  const missingFont: TikzRunner = async () => { throw Object.assign(new Error("font error"), { stdout: '! Package fontspec Error: The font "Missing Font" cannot be found.' }); };
  await assert.rejects(renderTikz(f.root, request, missingFont), /Missing Font.*cannot be found/);
  assert.equal(await readFile(original.sourcePath, "utf8"), previous);
});
