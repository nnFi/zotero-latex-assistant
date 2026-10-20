import { execFile, type ExecFileOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { isMissing, projectPath, readProjectText, writeProjectText } from "../config/project";
import { ZoteroError } from "../shared/errors";
import { prepareTikz, tikzInputSchema, type TikzEngine, type TikzInput } from "./document";
import { readProjectFont } from "./projectFont";

const execute = promisify(execFile);
const PROCESS_TIMEOUT_MS = 20000;
const CACHE_PATH = ".cache/zotero-latex-assistant/tikz";
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

interface RenderedFigure {
  readonly pdf: Buffer;
  readonly preview: Buffer;
  readonly warnings: string[];
}

export interface TikzRenderResult {
  readonly status: "created" | "updated" | "unchanged";
  readonly project: string;
  readonly sourcePath: string;
  readonly relativePath: string;
  readonly sha256: string;
  readonly pdfPath: string;
  readonly previewPath: string;
  readonly preamble: string;
  readonly engine: TikzEngine;
  readonly font: string | null;
  readonly fontSource: "argument" | "tex" | "default";
  readonly texFile: string | null;
  readonly input: string;
  readonly warnings: string[];
  readonly previewBase64: string;
}

export type TikzRunner = (executable: TikzEngine | "pdftoppm", args: readonly string[], cwd: string) => Promise<string>;

export function localTikzRunner(options: {
  platform?: NodeJS.Platform;
  execute?: (executable: string, args: readonly string[], options: ExecFileOptions) => Promise<{ stdout: string | Buffer }>;
} = {}): TikzRunner {
  const platform = options.platform ?? process.platform;
  const run = options.execute ?? execute;
  return async (executable, args, cwd) => {
    const invoke = async (selected: string): Promise<string> => {
      const result = await run(selected, [...args], {
        cwd, timeout: PROCESS_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
        env: { ...process.env, shell_escape: "f", openout_any: "p", MKTEXPK: "0", MKTEXMF: "0", MKTEXTFM: "0",
          TEXMFOUTPUT: cwd, TEXMF_OUTPUT_DIRECTORY: cwd },
      });
      return result.stdout.toString();
    };
    try { return await invoke(executable); }
    catch (error) {
      if (platform === "darwin" && executable !== "pdftoppm" && isMissing(error)) {
        return invoke(`/Library/TeX/texbin/${executable}`);
      }
      throw error;
    }
  };
}

function diagnostics(error: unknown, executable: TikzEngine | "pdftoppm"): string {
  if (isMissing(error)) return executable === "pdftoppm"
    ? "pdftoppm not found. Install Poppler and make pdftoppm available on PATH."
    : `${executable} not found. Install TeX Live/MacTeX with TikZ and make ${executable} available on PATH.`;
  if (typeof error !== "object" || error === null) return String(error);
  const failure = error as { killed?: boolean; stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
  if (failure.killed) return `Rendering exceeded its ${PROCESS_TIMEOUT_MS / 1000} second time or output limit. Simplify the picture and retry.`;
  const output = [failure.stdout?.toString(), failure.stderr?.toString()].filter(Boolean).join("\n");
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("!") || /^\.\/figure\.tex:\d+:/.test(line));
  return ((start >= 0 ? lines.slice(start, start + 25).join("\n") : output.slice(-6000)) || failure.message || "Rendering failed.").slice(0, 6000);
}

async function outputBytes(directory: string, name: string, signature: Buffer, limit: number): Promise<Buffer> {
  const file = path.join(directory, name);
  if ((await stat(file)).size > limit) throw new Error(`${name} exceeds the output size limit.`);
  const bytes = await readFile(file);
  if (!bytes.subarray(0, signature.length).equals(signature)) throw new Error(`The renderer did not produce a valid ${name}.`);
  return bytes;
}

async function compileTikz(document: string, engine: TikzEngine, run: TikzRunner): Promise<RenderedFigure> {
  const temporary = await mkdtemp(path.join(tmpdir(), "zotero-tikz-"));
  try {
    await writeFile(path.join(temporary, "figure.tex"), document, { flag: "wx" });
    let log: string;
    try {
      log = await run(engine, ["-no-shell-escape", "-no-parse-first-line", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "figure.tex"], temporary);
    } catch (error) { throw new Error(`TikZ compilation failed (${engine}). ${diagnostics(error, engine)}`); }
    const pdf = await outputBytes(temporary, "figure.pdf", Buffer.from("%PDF-"), 10 * 1024 * 1024);
    try { await run("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-scale-to", "1600", "-png", "figure.pdf", "preview"], temporary); }
    catch (error) { throw new Error(`TikZ preview failed. ${diagnostics(error, "pdftoppm")}`); }
    const preview = await outputBytes(temporary, "preview.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 5 * 1024 * 1024);
    return { pdf, preview, warnings: log.split(/\r?\n/).filter((line) => /Warning:|Overfull|Underfull/.test(line)).slice(0, 20) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function saveFigure(root: string, source: { path: string; text: string; previous: string | undefined }, rendered: RenderedFigure) {
  const cacheBase = await projectPath(root, CACHE_PATH);
  await mkdir(cacheBase, { recursive: true });
  await projectPath(root, CACHE_PATH);
  const cached = await mkdtemp(path.join(cacheBase, "render-"));
  let saved = false;
  try {
    const cacheRelative = path.relative(root, cached);
    const pdfPath = await projectPath(root, path.join(cacheRelative, "figure.pdf"));
    const previewPath = await projectPath(root, path.join(cacheRelative, "preview.png"));
    await writeFile(pdfPath, rendered.pdf, { flag: "wx" });
    await writeFile(previewPath, rendered.preview, { flag: "wx" });
    const lock = await projectPath(root, `${CACHE_PATH}/write.lock`);
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new ZoteroError("BUSY", "Another TikZ source write is active. Retry after it finishes. After a crashed process, remove .cache/zotero-latex-assistant/tikz/write.lock only once all TikZ MCP processes have stopped.");
    }
    try {
      if (await readProjectText(root, source.path) !== source.previous) throw new ZoteroError("CONFLICT", "The figure changed during rendering. Read it and retry.");
      if (source.previous !== source.text) await writeProjectText(root, source.path, source.text, source.previous);
    } finally { await rm(lock, { recursive: true, force: true }); }
    const sourcePath = await projectPath(root, source.path);
    saved = true;
    return { sourcePath, pdfPath, previewPath };
  } finally {
    if (!saved) await rm(await projectPath(root, path.relative(root, cached)), { recursive: true, force: true });
  }
}

export async function renderTikz(root: string, raw: TikzInput, run: TikzRunner = localTikzRunner()): Promise<TikzRenderResult> {
  const input = tikzInputSchema.parse(raw);
  if (!path.isAbsolute(root) || !(await stat(root)).isDirectory()) throw new Error("An existing absolute LaTeX project directory is required.");
  root = await realpath(root);
  const inherited = input.font ? undefined : await readProjectFont(root, input.texFile, input.engine);
  const { source, preamble, document, engine, font } = prepareTikz(input, inherited?.settings);
  const relativePath = `figures/${input.name}.tikz`;
  const previous = await readProjectText(root, relativePath);
  if ((input.expectedSha256 !== undefined && (previous === undefined || digest(previous) !== input.expectedSha256))
    || (previous !== undefined && previous !== source && input.expectedSha256 === undefined)) {
    throw new ZoteroError("CONFLICT", `${relativePath} already exists or changed. Read the current file before updating and pass its SHA-256 as expectedSha256.`);
  }
  const rendered = await compileTikz(document, engine, run);
  for (const [file, text] of inherited?.files ?? []) {
    if (await readProjectText(root, file) !== text) throw new ZoteroError("CONFLICT", `${file} changed during font detection/rendering. Read the current main document and retry.`);
  }
  const files = await saveFigure(root, { path: relativePath, text: source, previous }, rendered);
  return { status: previous === source ? "unchanged" : previous === undefined ? "created" : "updated",
    project: root, ...files, relativePath, sha256: digest(source), preamble, engine, font,
    fontSource: input.font ? "argument" : inherited?.texFile ? "tex" : "default", texFile: inherited?.texFile ?? null, input: `\\input{${relativePath}}`,
    warnings: rendered.warnings, previewBase64: rendered.preview.toString("base64") };
}
