// Uses real TeX/Poppler in a temporary project. No Zotero connection.
const assert = require("node:assert/strict");
const { mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

async function main() {
  let keep = false;
  const fonts = [];
  let server = path.resolve(__dirname, "../dist/mcp/server.cjs");
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keep") keep = true;
    else if (args[i] === "--server" && args[i + 1] && !args[i + 1].startsWith("--")) server = path.resolve(args[++i]);
    else if (args[i] === "--font" && args[i + 1] && !args[i + 1].startsWith("--")) fonts.push(args[++i]);
    else throw new Error("Usage: npm run test:tikz:live -- [--keep] [--server FILE] [--font FAMILY ...]");
  }
  const root = await mkdtemp(path.join(tmpdir(), "tikz-live-"));
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [server], stderr: "pipe" });
  let diagnostics = "";
  transport.stderr?.on("data", (data) => { diagnostics += data.toString(); });
  const client = new Client({ name: "tikz-live-smoke", version: "1.0.0" });
  try {
    try { await client.connect(transport); } catch (error) { throw new Error(diagnostics || error.message); }
    assert.equal(client.getServerVersion()?.version, require("../package.json").version);
    const call = async (args) => client.callTool({ name: "tikz_render", arguments: args }, undefined, { timeout: 60000 });
    const code = String.raw`\begin{tikzpicture}[node distance=18mm,>=Stealth]
\node[draw,rounded corners,fill=blue!10,minimum width=24mm,minimum height=9mm] (start) {Start};
\node[draw,rounded corners,fill=green!10,right=of start,minimum width=24mm,minimum height=9mm] (result) {Ergebnis};
\draw[->,thick] (start) -- node[above] {Schritt} (result);
\end{tikzpicture}`;
    const request = { projectPath: root, name: "ablauf", libraries: ["positioning", "arrows.meta"], code };
    const noProject = await call({ name: "ablauf", code });
    assert.equal(noProject.isError, true);
    assert.match(noProject.structuredContent.error.message, /project/i);
    const rendered = await call(request);
    assert(!rendered.isError, JSON.stringify(rendered.structuredContent));
    const result = rendered.structuredContent.result;
    assert.equal(result.status, "created");
    assert.deepEqual((await readdir(root)).sort(), [".cache", "figures"]);
    assert.deepEqual(await readdir(path.join(root, "figures")), ["ablauf.tikz"]);
    const inline = rendered.content.find((block) => block.type === "image");
    assert(inline && inline.mimeType === "image/png");
    assert.deepEqual(Buffer.from(inline.data, "base64"), await readFile(result.previewPath));
    assert.equal((await readFile(result.pdfPath)).subarray(0, 5).toString(), "%PDF-");
    const original = await readFile(result.sourcePath, "utf8");
    const broken = await call({ ...request, code: code.replace("{Start}", "{\\undefinedTikzCommand}"), expectedSha256: result.sha256 });
    assert.equal(broken.isError, true);
    assert.match(broken.structuredContent.error.message, /Undefined control sequence/);
    assert.equal(await readFile(result.sourcePath, "utf8"), original);
    const conflict = await call({ ...request, code: code.replace("Start", "Eingang") });
    assert.equal(conflict.structuredContent.error.code, "CONFLICT");
    const updated = await call({ ...request, code: code.replace("Start", "Eingang"), expectedSha256: result.sha256 });
    assert(!updated.isError, JSON.stringify(updated.structuredContent));
    assert.equal(updated.structuredContent.result.status, "updated");
    const plot = await call({ projectPath: root, name: "funktion", packages: ["pgfplots"],
      code: String.raw`\begin{tikzpicture}\begin{axis}[width=7cm,height=5cm,xlabel={$x$},ylabel={$x^2$}]\addplot[blue,domain=-2:2,samples=50]{x^2};\end{axis}\end{tikzpicture}` });
    assert(!plot.isError, JSON.stringify(plot.structuredContent));
    const preamble = [...new Set((result.preamble + "\n" + plot.structuredContent.result.preamble).split("\n"))].join("\n");
    await writeFile(path.join(root, "main.tex"), `\\documentclass{article}\n${preamble}\n\\begin{document}\n${result.input}\n${plot.structuredContent.result.input}\n\\end{document}\n`);
    await promisify(execFile)("pdflatex", ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: root, timeout: 20000 });
    const fontSamples = [];
    for (const [index, font] of fonts.entries()) {
      for (const engine of ["lualatex", "xelatex"]) {
        const sample = await call({ projectPath: root, name: `font-${index}-${engine}`, engine, font,
          code: String.raw`\begin{tikzpicture}\node[draw,rounded corners,inner sep=8pt] {Schriftprobe: ÄÖÜ äöü — Beispiel 123};\end{tikzpicture}` });
        assert(!sample.isError, JSON.stringify(sample.structuredContent));
        const figure = sample.structuredContent.result;
        assert.equal(figure.engine, engine);
        assert.equal(figure.font, font);
        const filename = `font-${index}-${engine}.tex`;
        await writeFile(path.join(root, filename), `\\documentclass{article}\n${figure.preamble}\n\\begin{document}\n\\edef\\beforefont{\\fontname\\font}\n${figure.input}\n\\edef\\afterfont{\\fontname\\font}\n\\ifx\\beforefont\\afterfont\\else\\errmessage{Figure changed document font}\\fi\n\\end{document}\n`);
        await promisify(execFile)(engine, ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", filename], { cwd: root, timeout: 20000 });
        fontSamples.push({ font, engine, pdf: figure.pdfPath, preview: figure.previewPath });
        const mainFile = `inherited-${index}-${engine}.tex`;
        await writeFile(path.join(root, mainFile), `% !TeX program = ${engine}\n\\documentclass{article}\n\\usepackage{fontspec}\n\\setmainfont{${font}}\n\\begin{document}\nText\n\\end{document}\n`);
        const inherited = await call({ projectPath: root, texFile: mainFile, name: `inherited-${index}-${engine}`, code: request.code, libraries: request.libraries });
        assert(!inherited.isError, JSON.stringify(inherited.structuredContent));
        assert.equal(inherited.structuredContent.result.font, font);
        assert.equal(inherited.structuredContent.result.engine, engine);
        assert.equal(inherited.structuredContent.result.fontSource, "tex");
        assert.equal(inherited.structuredContent.result.texFile, mainFile);
      }
    }
    if (fonts.length) {
      const source = await readFile(result.sourcePath, "utf8");
      const missing = await call({ ...request, font: "Zotero Missing Font 7389", expectedSha256: updated.structuredContent.result.sha256 });
      assert.equal(missing.isError, true);
      assert.equal(await readFile(result.sourcePath, "utf8"), source);
    }
    console.log(JSON.stringify({ success: true, checks: ["explicit project required", "automatic figures directory", "inline PNG", "PDF output", "compiler diagnostics", "existing source preserved on failure", "overwrite conflict", "explicit update", "PGFPlots", "LaTeX input compiles"],
      ...(fonts.length ? { fontChecks: ["LuaLaTeX", "XeLaTeX", "named font inclusion", "document font unchanged", "font and engine from texFile", "missing font preserves source"], fonts } : {}),
      ...(keep ? { project: root, preview: updated.structuredContent.result.previewPath, plotPreview: plot.structuredContent.result.previewPath, fontSamples } : {}) }, null, 2));
  } finally {
    try { await client.close(); }
    finally { if (!keep) await rm(root, { recursive: true, force: true }); }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
