const { readFile, writeFile, readdir } = require("node:fs/promises");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const normalize = (text) => text.replace(/\r\n/g, "\n").trimEnd();
const read = (base, file) => readFile(path.join(base, file), "utf8");
const json = async (base, file) => JSON.parse(await read(base, file));

function assertComponent(components, name, version) {
  const component = components.find((entry) => entry.name === name);
  if (!component || component.version !== version) {
    throw new Error(`Review licenses/components.json and upstream notices for ${name}@${version} before bundling.`);
  }
  return component;
}

/** Also inspect packages already vendored by upstream, which npm's dependency tree omits. */
function validateSourceMap(components, map, sdkVersion) {
  for (const source of map.sources) {
    const vendored = /\.pnpm\/((?:@[^/+]+\+)?[^/@]+)@([^/_]+)[^/]*\/node_modules\//.exec(source);
    if (vendored) assertComponent(components, vendored[1].replace("+", "/"), vendored[2]);
    else if (source.includes("node_modules/")) {
      // A changed upstream package manager/layout needs a new inventory review.
      throw new Error(`Unreviewed upstream bundled source: ${source}`);
    }
    if (source.includes("core-internal/")) {
      assertComponent(components, "@modelcontextprotocol/server", sdkVersion);
    }
  }
}

async function licenseDocuments(base = root) {
  const components = await json(base, "licenses/components.json");
  const project = await json(base, "package.json");
  const projectLicense = normalize(await read(base, "LICENSE"));
  const texts = new Map();
  for (const component of components) {
    const text = await read(base, `licenses/${component.file}`);
    if (!text.trim()) throw new Error(`Empty license: ${component.file}`);
    texts.set(component.file, normalize(text));
    if (!component.installedLicense) continue;
    const directory = path.join("node_modules", component.name);
    const installed = await json(base, `${directory}/package.json`);
    assertComponent(components, component.name, installed.version);
    if (normalize(await read(base, `${directory}/${component.installedLicense}`)) !== normalize(text)) {
      throw new Error(`Upstream license changed for ${component.name}. Review licenses/${component.file}.`);
    }
    // Preserve upstream NOTICE files if a later package version introduces one.
    const notices = (await readdir(path.join(base, directory))).filter((name) => /^notice(?:\.|$)/i.test(name));
    for (const notice of notices) {
      if (!texts.get(component.file).includes(normalize(await read(base, `${directory}/${notice}`)))) {
        throw new Error(`Preserve ${directory}/${notice} in licenses/${component.file} before bundling.`);
      }
    }
  }
  // Reject new or changed runtime dependencies even before a bundle is built.
  const visited = new Set();
  async function dependencies(names) {
    for (const name of names) {
      if (visited.has(name)) continue;
      visited.add(name);
      const installed = await json(base, `node_modules/${name}/package.json`);
      const component = assertComponent(components, name, installed.version);
      if (!component.installedLicense) throw new Error(`Missing installed license review for ${name}.`);
      await dependencies(Object.keys(installed.dependencies ?? {}));
    }
  }
  await dependencies(Object.keys(project.dependencies ?? {}));

  let notices = "# Third-party notices\n\n" +
    "Zotero LaTeX Assistant's original code and documentation are licensed under MIT (see LICENSE).\n" +
    "That license does not replace the licenses of the components and data below.\n\n" +
    "This inventory covers the extension and standalone MCP distribution together;\n" +
    "each bundle includes the components used by its entry point. Build-only tools\n" +
    "and external programs such as Zotero, Better BibTeX, TeX and Poppler are not shipped.\n\n" +
    "Distribution changes: upstream JavaScript is combined and transformed by esbuild\n" +
    "into CommonJS bundles and source maps. No intentional functional modifications\n" +
    "are made to the third-party libraries. Existing upstream legal comments are retained.\n\n";
  for (const component of components) {
    notices += `## ${component.name} ${component.version}\n\n` +
      `License: ${component.license}\n\nSource: ${component.source}\n\n` +
      (component.note ? `${component.note}\n\n` : "") +
      `Original license text (${component.file}):\n\n\`\`\`text\n${texts.get(component.file)}\n\`\`\`\n\n`;
  }
  notices += `## Citation Style Language locale data\n\n${normalize(await read(base, "media/CSL-LOCALES-NOTICE.md"))}\n\n` +
    "Full CC BY-SA 3.0 Unported license text follows. Canonical license:\n" +
    "https://creativecommons.org/licenses/by-sa/3.0/\n\n" +
    `\`\`\`text\n${normalize(await read(base, "licenses/CC-BY-SA-3.0.txt"))}\n\`\`\`\n`;
  // Inline the complete texts so copying mcp-latest.cjs alone preserves them.
  // Line comments keep any upstream comment delimiters inert without editing license text.
  const banner = ("Zotero LaTeX Assistant — license information\n\n" + projectLicense + "\n\n" + notices)
    .split("\n").map((line) => line ? `// ${line}` : "//").join("\n");
  return { components, notices, banner };
}

async function checkedLicenseDocuments(base = root) {
  const documents = await licenseDocuments(base);
  if (await read(base, "THIRD-PARTY-NOTICES.md") !== documents.notices) {
    throw new Error("Third-party notices are stale. Review the license inventory and run node scripts/licenses.cjs --write.");
  }
  return documents;
}

async function validateBundleLicenses(components, metafile, base = root) {
  for (const input of Object.keys(metafile.inputs)) {
    const normalized = input.replaceAll("\\", "/");
    const packageName = normalized.split("node_modules/").at(-1);
    if (!normalized.includes("node_modules/")) continue;
    const name = packageName.startsWith("@") ? packageName.split("/").slice(0, 2).join("/") : packageName.split("/")[0];
    const installed = await json(base, `node_modules/${name}/package.json`);
    assertComponent(components, name, installed.version);
    if (!name.startsWith("@modelcontextprotocol/")) continue;
    const code = await read(base, input);
    const sourceMap = /\/\/# sourceMappingURL=([^\r\n]+)/.exec(code)?.[1];
    if (sourceMap) {
      const map = await json(base, path.join(path.dirname(input), sourceMap));
      validateSourceMap(components, map, installed.version);
    }
  }
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--write")) throw new Error("Usage: node scripts/licenses.cjs [--write]");
  const documents = process.argv.includes("--write") ? await licenseDocuments() : await checkedLicenseDocuments();
  if (process.argv.includes("--write")) await writeFile(path.join(root, "THIRD-PARTY-NOTICES.md"), documents.notices);
  console.log(`Licenses verified: ${documents.components.length} library entries and CSL locale data. No bundles built.`);
}

module.exports = { assertComponent, validateSourceMap, licenseDocuments, checkedLicenseDocuments, validateBundleLicenses };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
