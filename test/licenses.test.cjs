const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm, readdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { licenseDocuments, checkedLicenseDocuments, validateBundleLicenses, validateSourceMap } = require("../scripts/licenses.cjs");
const root = path.resolve(__dirname, "..");

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "zotero-licenses-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of ["LICENSE", "package.json", "THIRD-PARTY-NOTICES.md", "media/CSL-LOCALES-NOTICE.md"]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(directory, file));
  }
  await cp(path.join(root, "licenses"), path.join(directory, "licenses"), { recursive: true });
  for (const component of require("../licenses/components.json").filter((entry) => entry.installedLicense)) {
    const target = path.join(directory, "node_modules", component.name);
    await mkdir(target, { recursive: true });
    for (const file of ["package.json", component.installedLicense]) {
      await copyFile(path.join(root, "node_modules", component.name, file), path.join(target, file));
    }
  }
  return directory;
}

test("license notices preserve every upstream text, CSL credits and the SDK transition", async () => {
  const { components, notices, banner } = await checkedLicenseDocuments();
  assert.equal(JSON.parse(await readFile(path.join(root, "package.json"))).license, "MIT");
  assert.equal(JSON.parse(await readFile(path.join(root, "package-lock.json"))).packages[""].license, "MIT");
  for (const component of components) {
    const original = await readFile(path.join(root, "licenses", component.file), "utf8");
    assert(notices.includes(original.replace(/\r\n/g, "\n").trimEnd()));
  }
  assert.match(notices, /licensing transition/);
  assert.match(notices, /Copyright \(c\) 2011-2021, Gary Court/);
  assert.match(notices, /Copyright \(c\) Microsoft Corporation/);
  assert.match(notices, /https:\/\/citationstyles.org\//);
  assert.match(notices, /Andrew Dunning/);
  assert.match(notices, /Attribution-ShareAlike 3.0 Unported/);
  assert.match(banner, /Copyright \(c\) 2026 Finn Plaßmeier/);
  const context = { module: { exports: null } };
  new vm.Script(banner + "\nmodule.exports = 'server still starts';").runInNewContext(context);
  assert.equal(context.module.exports, "server still starts");
});

test("changed installed versions and upstream licenses require a fresh review", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "node_modules/zod/package.json");
  const original = await readFile(file, "utf8");
  await writeFile(file, JSON.stringify({ ...JSON.parse(original), version: "99.0.0" }));
  await assert.rejects(licenseDocuments(directory), /zod@99\.0\.0/);
  await writeFile(file, original);
  await writeFile(path.join(directory, "node_modules/zod/LICENSE"), "Changed upstream terms");
  await assert.rejects(licenseDocuments(directory), /Upstream license changed for zod/);
});

test("an upstream NOTICE file cannot silently be omitted", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "node_modules/zod/NOTICE"), "Required additional attribution");
  await assert.rejects(licenseDocuments(directory), /Preserve .*zod\/NOTICE/);
});

test("new runtime dependencies and stale consolidated notices stop the license check", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "THIRD-PARTY-NOTICES.md"), "Incomplete notices");
  await assert.rejects(checkedLicenseDocuments(directory), /notices are stale/);
  const file = path.join(directory, "package.json");
  const manifest = JSON.parse(await readFile(file, "utf8"));
  manifest.dependencies.unreviewed = "1.0.0";
  await mkdir(path.join(directory, "node_modules/unreviewed"));
  await writeFile(path.join(directory, "node_modules/unreviewed/package.json"), JSON.stringify({ version: "1.0.0" }));
  await writeFile(file, JSON.stringify(manifest));
  await assert.rejects(licenseDocuments(directory), /unreviewed@1\.0\.0/);
});

test("prebundled SDK dependency upgrades and unknown source layouts stop bundling", async () => {
  const { components } = await checkedLicenseDocuments();
  const map = (source) => ({ sources: [source] });
  validateSourceMap(components, map("../../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.18.0/node_modules/ajv-formats/index.js"), "2.3.1");
  assert.throws(() => validateSourceMap(components, map("../node_modules/.pnpm/ajv@99.0.0/node_modules/ajv/index.js"), "2.3.1"), /ajv@99\.0\.0/);
  assert.throws(() => validateSourceMap(components, map("../node_modules/new-vendor/index.js"), "2.3.1"), /Unreviewed upstream bundled source/);
});

test("the reviewed SDK's actually shipped JavaScript inputs include covered vendor sources", async () => {
  const { components } = await checkedLicenseDocuments();
  const directory = path.join(root, "node_modules/@modelcontextprotocol/server/dist");
  // The alternative Cloudflare validator is not part of our Node.js distribution.
  const files = (await readdir(directory)).filter((file) => file.endsWith(".mjs") && !file.startsWith("cfWorkerProvider"));
  const inputs = Object.fromEntries(files.map((file) => [`node_modules/@modelcontextprotocol/server/dist/${file}`, {}]));
  await validateBundleLicenses(components, { inputs });
});
