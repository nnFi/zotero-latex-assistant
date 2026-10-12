import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { listInstalledBiblatexStyles, localTexLookup, type TexLookup } from "../src/biblatex/styles";
import { planBiblatexStyle } from "../src/biblatex/texStyle";
import { newProjectConfig, parseProjectConfig, writeProjectChanges } from "../src/config/project";
import { insertPreparedCitation } from "../src/biblatex/citations";

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "biblatex-styles-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("Discovery uses local TeX search precedence and lists complete style pairs only", async () => {
  await inProject(async (root) => {
    await mkdir(path.join(root, "first"));
    await mkdir(path.join(root, "second"));
    for (const name of ["first/custom.bbx", "second/custom.bbx", "second/custom.cbx", "first/internal.bbx", "first/numeric.bbx", "first/numeric.cbx"]) {
      await writeFile(path.join(root, name), "local style");
    }
    const lookup: TexLookup = async (args, cwd) => {
      assert.equal(cwd, root);
      if (args[0] === "biblatex.sty") return path.join(root, "biblatex.sty");
      if (args[0] === "--expand-path=$TEXINPUTS") return [path.join(root, "first"), path.join(root, "second")].join(path.delimiter);
      return args.map((file) => file === "internal.cbx" ? "" : path.join(root, file === "custom.cbx" ? "second" : "first", file)).join("\n") + "\n";
    };
    const styles = await listInstalledBiblatexStyles(root, lookup);
    assert.deepEqual(styles.map((style) => style.id), ["custom", "numeric"]);
    assert.equal(styles[0]?.bibliographyFile, path.join(root, "first/custom.bbx"));
    assert.equal(styles[0]?.citationFile, path.join(root, "second/custom.cbx"));
  });
});

test("Missing local TeX/BibLaTeX reports a useful error without a download fallback", async () => {
  await assert.rejects(listInstalledBiblatexStyles(tmpdir(), async () => ""), /not installed/);
  await assert.rejects(localTexLookup(path.join(tmpdir(), "nonexistent-kpsewhich"))(["biblatex.sty"], tmpdir()), /kpsewhichPath/);
});

test("Style changes update every declaration and remove conflicting split style options", () => {
  const original = "\\usepackage[backend=biber,bibstyle=numeric,citestyle=verbose,sorting={nyt},style=old]{biblatex}\n\\addbibresource{refs.bib}\n\\autocite[14]{original}\n\\printbibliography\n";
  const changes = planBiblatexStyle([{ path: "main.tex", text: original },
    { path: "preamble.tex", text: "\\RequirePackage{biblatex}" }], "authoryear");
  assert.equal(changes[0]?.text, original.replace(/\[.*?\]/, "[backend=biber,sorting={nyt},style=authoryear]"));
  assert.equal(changes[1]?.text, "\\RequirePackage[style=authoryear]{biblatex}");
  assert.equal(planBiblatexStyle(changes, "authoryear").length, 0);
});

test("Comments, literal examples, braces in options and line endings survive a style change", () => {
  const original = "% \\usepackage[style=comment]{biblatex}\r\n\\begin{verbatim}\n\\usepackage[style=example]{biblatex}\n\\end{verbatim}\n\\verb|\\usepackage[style=literal]{biblatex}|\n\\usepackage[sorting={a,b},foo={x]y},style=old]{biblatex}\r\n";
  assert.equal(planBiblatexStyle([{ path: "main.tex", text: original }], "numeric")[0]?.text,
    original.replace("sorting={a,b},foo={x]y},style=old", "sorting={a,b},foo={x]y},style=numeric"));
});

test("PassOptionsToPackage cannot override the newly selected package style", () => {
  const sources = [{ path: "main.tex", text: "\\PassOptionsToPackage{style=old,backend=biber,citestyle=old}{biblatex}\n\\input{preamble}\n" },
    { path: "preamble.tex", text: "\\usepackage[sorting=nyt]{biblatex}" }];
  const changed = planBiblatexStyle(sources, "numeric");
  assert.equal(changed[0]?.text, "\\PassOptionsToPackage{backend=biber}{biblatex}\n\\input{preamble}\n");
  assert.equal(changed[1]?.text, "\\usepackage[sorting=nyt,style=numeric]{biblatex}");
});

test("Document roots receive a package only when their own dependencies do not load it", () => {
  const sources = [{ path: "main.tex", text: "\\documentclass{article}\n\\input{preamble}\n\\begin{document}" },
    { path: "preamble.tex", text: "\\usepackage[style=old]{biblatex}" },
    { path: "other.tex", text: "\\documentclass{article} % retained\r\n\\begin{document}" }];
  const changed = planBiblatexStyle(sources, "numeric");
  assert.deepEqual(changed.map((source) => source.path), ["preamble.tex", "other.tex"]);
  assert.equal(changed[1]?.text, "\\documentclass{article} % retained\r\n\\usepackage[style=numeric]{biblatex}\r\n\\begin{document}");
});

test("Malformed declarations, unsafe style names and classic BibTeX abort before editing", () => {
  assert.throws(() => planBiblatexStyle([{ path: "main.tex", text: "\\usepackage[style=old{biblatex}" }], "numeric"), /Unbalanced/);
  assert.throws(() => planBiblatexStyle([], "numeric]\\input{evil}"), /Invalid/);
  assert.throws(() => planBiblatexStyle([{ path: "main.tex", text: "\\bibliographystyle{plain}" }], "numeric"), /classic BibTeX/);
});

test("Missing package, resource and bibliography output are added in valid LaTeX order", () => {
  const source = { path: "main.tex", text: "\\documentclass{article}\n\\begin{document}\nText\n\\end{document}\n" };
  const changed = planBiblatexStyle([source], "numeric", "sources/refs.bib");
  assert.equal(changed[0]?.text, "\\documentclass{article}\n\\usepackage[style=numeric]{biblatex}\n\\addbibresource{sources/refs.bib}\n\\begin{document}\nText\n\\printbibliography\n\\end{document}\n");
  assert.equal(planBiblatexStyle(changed, "numeric", "sources/refs.bib").length, 0);
});

test("Resources and bibliography output in included files are retained without duplicates", () => {
  const sources = [{ path: "main.tex", text: "\\documentclass{article}\n\\input{preamble}\n\\begin{document}\n\\input{refs}\n\\end{document}" },
    { path: "preamble.tex", text: "\\usepackage[style=old]{biblatex}\n\\addbibresource{refs.bib}" },
    { path: "refs.tex", text: "\\printbibliography[title={References}]" }];
  const changed = planBiblatexStyle(sources, "authoryear", "refs.bib");
  assert.deepEqual(changed.map((source) => source.path), ["preamble.tex"]);
});

test("Project configuration and all changed files are saved with original-file backups", async () => {
  await inProject(async (root) => {
    await writeFile(path.join(root, "main.tex"), "old");
    const text = JSON.stringify({ ...newProjectConfig(), citationStyle: "numeric" });
    const backup = await writeProjectChanges(root, [{ path: "main.tex", previous: "old", text: "new" },
      { path: ".zotero/config.json", previous: undefined, text }]);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "new");
    assert.equal(await readFile(path.join(root, backup!, "main.tex"), "utf8"), "old");
    assert.equal(await readFile(path.join(root, ".zotero/config.json"), "utf8"), text);
  });
});

test("One changed or escaping file prevents writing every other project file", async () => {
  await inProject(async (root) => inProject(async (outside) => {
    await writeFile(path.join(root, "main.tex"), "old");
    await writeFile(path.join(root, "preamble.tex"), "changed elsewhere");
    await assert.rejects(writeProjectChanges(root, [{ path: "main.tex", previous: "old", text: "new" },
      { path: "preamble.tex", previous: "old", text: "new" }]), /in the meantime/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "old");
    await symlink(outside, path.join(root, "escape"), "dir");
    await assert.rejects(writeProjectChanges(root, [{ path: "main.tex", previous: "old", text: "new" },
      { path: "escape/main.tex", previous: undefined, text: "new" }]), /symlink/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "old");
  }));
});

test("A write conflict after the first write restores the already changed document", async () => {
  await inProject(async (root) => {
    await writeFile(path.join(root, "main.tex"), "old");
    await symlink("main.tex", path.join(root, "alias.tex"));
    // The second write sees the first through the alias and must trigger rollback.
    await assert.rejects(writeProjectChanges(root, [{ path: "main.tex", previous: "old", text: "new" },
      { path: "alias.tex", previous: "old", text: "other" }]), /in the meantime/);
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "old");
    assert.equal(await readFile(path.join(root, "alias.tex"), "utf8"), "old");
  });
});

test("BibLaTeX formats numeric locators itself even if legacy CSL language was saved", async () => {
  const item = { library: { type: "user" as const, id: 0 }, key: "ITEM0001", itemType: "book", title: "Quelle", creators: [], date: "", doi: "", url: "" };
  const config = { ...newProjectConfig(), library: item.library, bibFile: "refs.bib", citationStyle: "authoryear", citationLocale: "de-DE", importedItemKeys: [item.key] };
  let inserted = "";
  await insertPreparedCitation([item], { isCurrent: () => true, insert: async (text) => { inserted = text; return true; } }, async () => config, { postnote: "14–16" });
  assert.equal(inserted, "\\autocite[14–16]{zotero-user-0-ITEM0001}");
  assert.throws(() => parseProjectConfig({ ...config, citationStyle: "http://www.zotero.org/styles/apa" }), /Invalid BibLaTeX/);
});
