import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { readProjectSources } from "../src/config/projectSources";

test("Project scans read nested sources and optional bibliographies, excluding backups, tooling and symlinks", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-project-sources-"));
  const outside = await mkdtemp(path.join(tmpdir(), "zotero-outside-sources-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const files = {
    "main.tex": "Main document",
    "chapters/chapter.ltx": "Chapter",
    "styles/local.sty": "Package",
    "styles/local.cls": "Class",
    "sources/references.bib": "@book{Keep,title={Source}}",
    ".zotero/backups/main.tex": "Old citations",
    ".cursor/example.tex": "Tooling example",
    "node_modules/example.tex": "Dependency example",
    "dist/main.tex": "Generated document",
    "notes.md": "Not a TeX source",
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
  await writeFile(path.join(outside, "foreign.tex"), "Foreign document");
  await symlink(outside, path.join(root, "linked-directory"), "dir");
  await symlink(path.join(outside, "foreign.tex"), path.join(root, "linked-file.tex"), "file");
  await symlink(path.join(root, "main.tex"), path.join(root, "duplicate.tex"), "file");

  const expected = ["chapters/chapter.ltx", "main.tex", "styles/local.cls", "styles/local.sty"];
  assert.deepEqual(await readProjectSources(root), expected.map((file) => ({ path: file, text: files[file as keyof typeof files] })));
  assert.deepEqual((await readProjectSources(root, true)).map((source) => source.path), [...expected, "sources/references.bib"].sort());
});
