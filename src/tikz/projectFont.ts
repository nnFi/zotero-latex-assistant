import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { isMissing, projectPath, readProjectText } from "../config/project";
import { texArgument, texCode, texCommandMatches } from "../biblatex/texSyntax";
import { fontNameSchema, tikzEngineSchema, type TikzEngine, type TikzFontSettings } from "./document";

const fontPackages = new Set(["fontspec", "fontenc", "times", "mathptmx", "newtxtext", "newpxtext", "helvet", "courier", "lmodern",
  "tgtermes", "tgpagella", "tgheros", "tgcursor", "charter", "libertine", "libertinus"]);
const safeOptions = /^[a-zA-Z0-9 .,_=:+{}-]*$/;
const namedFontCommands = new Set(["setmainfont", "setsansfont", "setmonofont"]);
const unsupportedFontCommands = new Set(["familydefault", "rmdefault", "sfdefault", "ttdefault", "fontfamily", "defaultfontfeatures"]);
const declarationCommands = new Set([...namedFontCommands, "usepackage", "RequirePackage", "input", "include", "documentclass", "LoadClass"]);
const families = {
  rmdefault: { command: "setmainfont", selection: "rmfamily" },
  sfdefault: { command: "setsansfont", selection: "sffamily" },
  ttdefault: { command: "setmonofont", selection: "ttfamily" },
} as const;
type ReadSource = (file: string) => Promise<string | undefined>;

export interface ProjectFont {
  readonly settings: TikzFontSettings;
  readonly texFile: string | null;
  readonly files: ReadonlyMap<string, string>;
}

async function findMainFile(root: string, read: ReadSource, requested?: string): Promise<string | undefined> {
  const isMain = (text: string): boolean => texCommandMatches(texCode(text), /\\documentclass\b/g).length > 0;
  if (requested) {
    const text = await read(requested);
    if (text === undefined || !isMain(text)) throw new Error(`${requested} must be an existing main .tex file with a documentclass declaration.`);
    return requested;
  }
  const conventional = await read("main.tex");
  if (conventional !== undefined && isMain(conventional)) return "main.tex";
  const candidates: string[] = [];
  let count = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory ? await projectPath(root, directory) : root, { withFileTypes: true })) {
      if (++count > 10000) throw new Error("Too many files for main document detection. Supply texFile explicitly.");
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !["node_modules", "dist", "build", "out", "figures"].includes(entry.name)) await walk(relative);
      else if (entry.isFile() && entry.name.endsWith(".tex")) {
        const text = await read(relative);
        if (text !== undefined && isMain(text)) candidates.push(relative);
      }
    }
  };
  await walk("");
  if (candidates.length > 1) throw new Error(`Multiple main .tex files found. Select texFile: ${candidates.sort().join(", ")}`);
  return candidates[0];
}

function fontDeclaration(code: string, offset: number, file: string) {
  const before = texArgument(code, offset, "[", "]");
  const argument = texArgument(code, before?.end ?? offset, "{", "}");
  if (!argument) throw new Error(`${file}: missing font family. Supply font explicitly.`);
  const after = texArgument(code, argument.end, "[", "]");
  const font = fontNameSchema.safeParse(argument.content);
  const options = [before?.content, after?.content].filter(Boolean).join(",");
  if (!font.success || !safeOptions.test(options)) throw new Error(`${file}: use a literal font family and font options, or supply font explicitly.`);
  return { font: font.data, options, end: after?.end ?? argument.end };
}

/** Inspect literal preamble declarations without executing project TeX. */
export async function readProjectFont(root: string, requested?: string, engineOverride?: TikzEngine): Promise<ProjectFont> {
  const files = new Map<string, string>();
  const read: ReadSource = async (file) => {
    if (files.has(file)) return files.get(file);
    const target = await projectPath(root, file);
    try {
      if ((await stat(target)).size > 2 * 1024 * 1024) throw new Error(`${file} is too large for font detection.`);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    const text = await readProjectText(root, file);
    if (text !== undefined) files.set(file, text);
    return text;
  };
  const main = await findMainFile(root, read, requested);
  if (!main) return { settings: {}, texFile: null, files: new Map() };
  const mainText = files.get(main)!;
  files.clear();
  files.set(main, mainText);
  return { texFile: main, files, settings: await readFontSettings(main, mainText, read, engineOverride) };
}

async function readFontSettings(main: string, mainText: string, read: ReadSource, engineOverride?: TikzEngine): Promise<TikzFontSettings> {
  const magic = /^\s*%\s*!\s*TeX\s+(?:program|TS-program)\s*=\s*(\w+)/im.exec(mainText)?.[1]?.toLowerCase();
  const detectedEngine = magic ? tikzEngineSchema.safeParse(magic) : undefined;
  if (detectedEngine && !detectedEngine.success && !engineOverride) throw new Error(`Unsupported TeX engine ${magic} in ${main}. Supply engine explicitly.`);
  const named = new Map<string, { font: string; options: string }>();
  const packages = new Map<string, string>();
  const state: { family: keyof typeof families; conditional: boolean; dynamicFont: boolean } = {
    family: "rmdefault", conditional: false, dynamicFont: false,
  };
  const visiting = new Set<string>();
  const loadedPackages = new Set<string>();
  const dependencies = new Set<string>();

  const dependency = async (file: string, name: string, extension: string, required: boolean): Promise<void> => {
    if (/[\\{}%#$^~\x00-\x1f]/.test(name)) throw new Error(`${file}: dynamic preamble paths require an explicit font argument.`);
    const candidate = path.posix.normalize(name.endsWith(extension) ? name : name + extension);
    if (!required && loadedPackages.has(candidate)) return;
    if (await read(candidate) === undefined) {
      if (required) throw new Error(`${file}: cannot read preamble dependency ${name}. Supply font explicitly.`);
      return;
    }
    if (!required) loadedPackages.add(candidate);
    await visit(candidate);
  };
  const visit = async (file: string): Promise<void> => {
    if (visiting.has(file)) throw new Error(`Circular preamble dependency at ${file}. Supply font explicitly.`);
    dependencies.add(file);
    if (visiting.size >= 20 || dependencies.size > 100) throw new Error("Too many preamble dependencies. Supply font explicitly.");
    visiting.add(file);
    const visible = texCode((await read(file))!);
    const body = texCommandMatches(visible, /\\begin\s*\{document\}/g)[0];
    const code = visible.slice(0, body?.index ?? visible.length);
    let depth = 0;
    let skipUntil = 0;
    for (const match of texCommandMatches(code, /\\([a-zA-Z@]+)\*?|[{}]/g)) {
      if (match.index! < skipUntil) continue;
      if (match[0] === "{") { depth++; continue; }
      if (match[0] === "}") { depth--; continue; }
      const command = match[1]!;
      if (depth !== 0) {
        if (namedFontCommands.has(command) || unsupportedFontCommands.has(command)) state.dynamicFont = true;
        continue;
      }
      if (unsupportedFontCommands.has(command)) state.dynamicFont = true;
      if (/^if|^(?:else|fi)$/.test(command)) state.conditional = true;
      const offset = match.index! + match[0].length;
      if (command === "renewcommand" || command === "def") {
        const declaration = /^\s*(?:\{\s*\\familydefault\s*\}|\\familydefault)\s*\{\s*\\(rmdefault|sfdefault|ttdefault)\s*\}/.exec(code.slice(offset));
        if (declaration) {
          state.family = declaration[1] as keyof typeof families;
          skipUntil = offset + declaration[0].length;
        }
      }
      if (namedFontCommands.has(command)) {
        const declaration = fontDeclaration(code, offset, file);
        named.set(command, declaration);
        skipUntil = declaration.end;
        continue;
      }
      if (!declarationCommands.has(command)) continue;
      const before = texArgument(code, offset, "[", "]");
      const argument = texArgument(code, before?.end ?? offset, "{", "}");
      if (!argument) throw new Error(`${file}: cannot read ${command}. Supply font explicitly.`);
      skipUntil = argument.end;
      if (["input", "include"].includes(command)) await dependency(file, argument.content.trim(), ".tex", true);
      else {
        for (const name of argument.content.split(",").map((value) => value.trim())) {
          if (fontPackages.has(name)) {
            if (!safeOptions.test(before?.content ?? "")) throw new Error(`${file}: dynamic font package options require an explicit font argument.`);
            const declaration = `\\usepackage${before ? `[${before.content}]` : ""}{${name}}`;
            const loaded = packages.get(name);
            if (loaded && before && loaded !== declaration) throw new Error(`${file}: conflicting options for font package ${name}. Resolve the package options first.`);
            if (!loaded) packages.set(name, declaration);
          } else await dependency(file, name, ["documentclass", "LoadClass"].includes(command) ? ".cls" : ".sty", false);
        }
      }
    }
    visiting.delete(file);
  };
  await visit(main);
  if (state.dynamicFont) throw new Error(`${main}: macro-based or unsupported font settings require an explicit font argument.`);
  if (state.conditional && (named.size || packages.size || state.family !== "rmdefault")) throw new Error(`${main}: conditional font settings cannot be inferred reliably. Supply font explicitly.`);
  const selected = named.get(families[state.family].command);
  const engine = detectedEngine?.success ? detectedEngine.data : selected || packages.has("fontspec") ? "lualatex" : undefined;
  return {
    ...(selected ? { font: selected.font, fontOptions: selected.options } : {}),
    ...(engine ? { engine } : {}),
    preamble: [...packages.values()],
    ...(state.family !== "rmdefault" ? { family: families[state.family].selection } : {}),
  };
}
