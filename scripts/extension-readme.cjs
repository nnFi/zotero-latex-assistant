const { readFile, mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

// The built-in extension details view cannot navigate to another local file.
// Package one document and turn documentation links into in-page navigation.
const root = path.resolve(__dirname, "..");
const documents = new Map();
const anchors = new Set();
const destinations = new Set();
const linkPattern = /(?<!!)\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const documentId = (file) => `doc-${file.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
const slug = (text) => text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "").replace(/ /g, "-");
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function prose(text, transform) {
  let fence;
  return text.split("\n").map((line) => {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter && (!fence || delimiter[0] === fence[0] && delimiter.length >= fence.length)) {
      fence = fence ? undefined : delimiter;
      return line;
    }
    return fence ? line : transform(line);
  }).join("\n");
}

function localTarget(file, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return;
  const [relative, fragment = ""] = href.split("#");
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(relative || path.posix.basename(file))));
  if (target.startsWith("../") || path.posix.isAbsolute(target)) throw new Error(`Documentation link leaves the extension: ${href}`);
  return { file: target, fragment: decodeURIComponent(fragment) };
}

async function collect(file) {
  if (documents.has(file)) return;
  const text = await readFile(path.join(root, file), "utf8");
  documents.set(file, text);
  if (!file.endsWith(".md")) return;
  const linked = new Set();
  prose(text, (line) => {
    for (const match of line.matchAll(linkPattern)) {
      const target = localTarget(file, match[2]);
      if (target && /\.(md|json)$/i.test(target.file)) linked.add(target.file);
    }
    return line;
  });
  for (const target of linked) await collect(target);
}

function render(file, text) {
  const prefix = documentId(file);
  anchors.add(prefix);
  const start = `<a id="${prefix}"></a>\n\n`;
  if (file.endsWith(".json")) return `${start}## ${path.posix.basename(file)}\n\n\`\`\`json\n${text.trim()}\n\`\`\`\n`;
  const counts = new Map();
  let sectionOpen = false;
  const content = prose(text, (line) => {
    const heading = /^(#{1,6}) (.+)$/.exec(line);
    if (heading) {
      const base = slug(heading[2].replace(/ +#+\s*$/, ""));
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      const id = `${prefix}-${base}${count ? `-${count}` : ""}`;
      anchors.add(id);
      if (file === "README.md" || heading[1] === "#") {
        line = `${sectionOpen ? "\n</details>\n\n" : ""}<a id="${id}"></a>\n\n${line}`;
        sectionOpen = false;
      } else {
        // Every target sits on a visible summary. VS Code uses scrollIntoView
        // for fragment links and does not open closed ancestor details elements.
        line = `${sectionOpen ? "\n</details>\n\n" : ""}<details>\n<summary id="${id}"><strong>${escapeHtml(heading[2])}</strong></summary>\n`;
        sectionOpen = true;
      }
    }
    return line.replace(linkPattern, (original, label, href) => {
      const target = localTarget(file, href);
      if (!target) return original;
      // A source/server file is a path to copy, not a document to navigate to.
      if (!documents.has(target.file)) return label;
      const id = documentId(target.file) + (target.fragment ? `-${target.fragment}` : "");
      destinations.add(id);
      return `[${label}](#${id})`;
    });
  });
  return start + content + (sectionOpen ? "\n\n</details>\n" : "");
}

async function run() {
  await collect("README.md");
  const rendered = [...documents].map(([file, text]) => render(file, text));
  for (const id of destinations) {
    if (!anchors.has(id)) throw new Error(`Documentation link has no section: #${id}`);
  }
  const result = rendered.join("\n\n---\n\n");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist/extension-readme.md"), result);
  console.log(`Extension details: ${documents.size} embedded documents, ${destinations.size} validated navigation targets.`);
}

run().catch((error) => { console.error(error.message); process.exitCode = 1; });
