import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { main } from "../mcp/server";
import { ZoteroProjectService } from "../src/zotero/projectService";
import { CONFIG_FILE, readProjectText } from "../src/config/project";

test("MCP startup rejects malformed flags, invalid project paths and mixed storage modes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-startup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "file.txt"), "");
  for (const args of [
    ["--project"], ["--unknown", root], ["--project", "relative"],
    ["--project", path.join(root, "missing")], ["--project", path.join(root, "file.txt")],
    ["--project", root, "--project", root], ["--state-dir", "relative"],
    ["--project", root, "--state-dir", root],
  ]) await assert.rejects(main(args));
  assert.equal(await readProjectText(root, CONFIG_FILE), undefined);
});

test("per-call project routing is explicit and leaves independent settings untouched", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-routing-"));
  const other = await mkdtemp(path.join(tmpdir(), "mcp-routing-other-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); });
  const standalone = new ZoteroProjectService(null, {}, path.join(root, "state"));
  assert.equal(await standalone.forProject(), standalone);
  const project = await standalone.forProject(other);
  assert.equal(project.projectRoot, other);
  assert.equal((await standalone.context()).mode, "standalone");
  assert.equal((await project.context()).configExists, false);
  assert.equal(await project.forProject(other), project);
  await assert.rejects(project.forProject(root), /outside/);
  await assert.rejects(standalone.forProject("relative"), /absolute/);
  await assert.rejects(standalone.forProject(path.join(root, "missing")));
  await writeFile(path.join(other, "file.txt"), "text");
  await assert.rejects(standalone.forProject(path.join(other, "file.txt")), /directory/);
  assert.equal(await readProjectText(other, CONFIG_FILE), undefined);
});

test("malformed project settings are reported without being overwritten", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-malformed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".zotero"));
  const invalid = '{"version":999}';
  await writeFile(path.join(root, CONFIG_FILE), invalid);
  await assert.rejects(new ZoteroProjectService(root).context(), /Invalid/);
  assert.equal(await readProjectText(root, CONFIG_FILE), invalid);
});
