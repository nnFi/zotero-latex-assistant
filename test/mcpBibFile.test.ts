import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CONFIG_FILE, newProjectConfig, readProjectConfig, readProjectText, saveProjectConfig } from "../src/config/project";
import { withProjectWriteLock } from "../src/config/projectLock";
import { ZoteroProjectService } from "../src/zotero/projectService";

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-bib-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new ZoteroProjectService(root, { fetch: async () => { throw new Error(".bib selection must not contact Zotero"); } });
  return { root, service };
}

test("no existing .bib leaves a fresh project and an existing binding untouched", async (t) => {
  const { root, service } = await fixture(t);
  assert.equal((await service.setBibFile()).status, "not-found");
  assert.equal(await readProjectConfig(root), undefined);
  const config = { ...newProjectConfig(), library: { type: "user" as const, id: 0 }, bibFile: "missing.bib", collectionKey: "COLL0001" };
  await saveProjectConfig(root, config);
  const snapshot = await readProjectText(root, CONFIG_FILE);
  for (const requested of [undefined, "missing.bib"]) {
    const result = await service.setBibFile(requested);
    assert.equal(result.status, "not-found"); assert.equal(result.projectFilesChanged, false);
    assert.deepEqual(result.candidates, []);
    assert.equal(await readProjectText(root, CONFIG_FILE), snapshot);
    assert.equal(await readProjectText(root, "missing.bib"), undefined);
  }
});

test("a single nested .bib is detected and set before library setup; excluded directories are ignored", async (t) => {
  const { root, service } = await fixture(t);
  await mkdir(path.join(root, "sources"));
  await writeFile(path.join(root, "sources/refs.bib"), "@book{Manual,title={Keep me}}\n");
  for (const directory of [".git", ".zotero/backups", "node_modules", "dist", "build", "out"]) {
    await mkdir(path.join(root, directory), { recursive: true });
    await writeFile(path.join(root, directory, "ignored.bib"), "");
  }
  const result = await service.setBibFile();
  assert.equal(result.status, "selected"); assert.equal(result.bibFile, "sources/refs.bib");
  assert.deepEqual(result.candidates, ["sources/refs.bib"]);
  assert.deepEqual(await readProjectConfig(root), { ...newProjectConfig(), bibFile: "sources/refs.bib" });
  assert.equal(await readProjectText(root, "sources/refs.bib"), "@book{Manual,title={Keep me}}\n");
  assert.equal((await service.setBibFile()).status, "unchanged");
});

test("multiple files are returned for user choice, preview never writes, and exact selection works", async (t) => {
  const { root, service } = await fixture(t);
  await writeFile(path.join(root, "a.bib"), ""); await writeFile(path.join(root, "b.bib"), "");
  const ambiguous = await service.setBibFile();
  assert.equal(ambiguous.status, "ambiguous"); assert.deepEqual(ambiguous.candidates, ["a.bib", "b.bib"]);
  assert.equal(ambiguous.projectFilesChanged, false); assert.equal(await readProjectConfig(root), undefined);
  const preview = await service.setBibFile("b.bib", true);
  assert.equal(preview.status, "preview"); assert.equal(preview.bibFile, "b.bib");
  assert.deepEqual(preview.changedFiles, [CONFIG_FILE]); assert.equal(await readProjectConfig(root), undefined);
  const selected = await service.setBibFile("b.bib");
  assert.equal(selected.status, "selected"); assert.equal((await readProjectConfig(root))!.bibFile, "b.bib");
  assert.equal((await service.setBibFile()).bibFile, "b.bib");
});

test("literal LaTeX references disambiguate files while commented and verbatim examples are ignored", async (t) => {
  const { root, service } = await fixture(t);
  await writeFile(path.join(root, "a.bib"), ""); await writeFile(path.join(root, "b.bib"), "");
  await writeFile(path.join(root, "main.tex"), "% \\addbibresource{a.bib}\n\\verb|\\addbibresource{a.bib}|\n\\addbibresource{b.bib}");
  const result = await service.setBibFile();
  assert.equal(result.status, "selected"); assert.equal(result.bibFile, "b.bib");
});

test("explicit switch preserves both bibliographies and project keys, updates TeX and backs up originals", async (t) => {
  const { root, service } = await fixture(t);
  const config = { ...newProjectConfig("textcite"), library: { type: "group" as const, id: 42 }, collectionKey: "COLL0001", serverId: "db-A",
    bibFile: "old.bib", importedItemKeys: ["ITEM0001"], citationKeys: { ITEM0001: "Stable2026" } };
  await saveProjectConfig(root, config);
  const old = "@book{Stable2026,title={Old manual title}}\n";
  const selected = "@book{Stable2026,title={Selected manual title}}\n";
  const tex = "\\documentclass{article}\n\\usepackage{biblatex}\n\\addbibresource{old.bib}\n\\begin{document}\\textcite{Stable2026}\\end{document}\n";
  await writeFile(path.join(root, "old.bib"), old); await writeFile(path.join(root, "selected.bib"), selected);
  await writeFile(path.join(root, "main.tex"), tex);
  const result = await service.setBibFile("selected.bib");
  assert.equal(result.status, "selected"); assert(result.backup);
  assert.deepEqual(await readProjectConfig(root), { ...config, bibFile: "selected.bib" });
  assert.equal(await readProjectText(root, "old.bib"), old); assert.equal(await readProjectText(root, "selected.bib"), selected);
  const updated = (await readProjectText(root, "main.tex"))!;
  assert.match(updated, /\\addbibresource\{selected.bib\}/); assert.match(updated, /\\printbibliography/); assert.match(updated, /\\textcite\{Stable2026\}/);
  assert.equal(await readProjectText(root, `${result.backup}/main.tex`), tex);
  assert.deepEqual(JSON.parse((await readProjectText(root, `${result.backup}/${CONFIG_FILE}`))!), config);
  assert.equal((await service.setBibFile("selected.bib")).status, "unchanged");
});

test("invalid paths, external symlinks and malformed bibliography contents fail without changing config", async (t) => {
  const { root, service } = await fixture(t);
  const outside = await fixture(t);
  await writeFile(path.join(outside.root, "private.bib"), "");
  await symlink(path.join(outside.root, "private.bib"), path.join(root, "linked.bib"));
  assert.equal((await service.setBibFile()).status, "not-found");
  for (const requested of ["../private.bib", "/tmp/private.bib", ".zotero/private.bib", "main.tex", "linked.bib"]) {
    await assert.rejects(service.setBibFile(requested));
  }
  await writeFile(path.join(root, "broken.bib"), "@book{Broken,title={Oops}");
  await assert.rejects(service.setBibFile("broken.bib"), /Incomplete/);
  assert.equal(await readProjectConfig(root), undefined);
});

test("dynamic TeX references abort a switch and concurrent setup respects the project lock", async (t) => {
  const { root, service } = await fixture(t);
  await saveProjectConfig(root, { ...newProjectConfig(), bibFile: "old.bib" });
  await writeFile(path.join(root, "old.bib"), ""); await writeFile(path.join(root, "new.bib"), "");
  await writeFile(path.join(root, "main.tex"), "\\addbibresource{\\mybibliography}");
  const snapshot = await readProjectText(root, CONFIG_FILE);
  await assert.rejects(service.setBibFile("new.bib"), /dynamic bibliography/);
  assert.equal(await readProjectText(root, CONFIG_FILE), snapshot);
  await withProjectWriteLock(root, () => assert.rejects(service.setBibFile("new.bib"), /action is active/));
});
