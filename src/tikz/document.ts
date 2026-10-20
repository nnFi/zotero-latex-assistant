import { z } from "zod";
import { texCode, texCommandMatches } from "../biblatex/texSyntax";

const libraryName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
export const tikzEngineSchema = z.enum(["pdflatex", "lualatex", "xelatex"]);
export type TikzEngine = z.infer<typeof tikzEngineSchema>;
export const fontNameSchema = z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .()-]*$/u);
export interface TikzFontSettings {
  readonly font?: string;
  readonly fontOptions?: string;
  readonly engine?: TikzEngine;
  readonly preamble?: readonly string[];
  readonly family?: "rmfamily" | "sffamily" | "ttfamily";
}
export const tikzInputSchema = z.object({
  projectPath: z.string().min(1).optional(),
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/)
    .refine((name) => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name), "Choose a filename that is not a reserved Windows device name.")
    .describe("Figure basename without extension, e.g. ablauf; saved as figures/ablauf.tikz."),
  code: z.string().min(1).max(100000).describe("One complete tikzpicture environment; no document wrapper or preamble."),
  libraries: z.array(libraryName).max(30).default([]),
  packages: z.array(z.enum(["pgfplots", "circuitikz", "tikz-cd", "forest"])).max(4).default([]),
  engine: tikzEngineSchema.optional().describe("Override the detected main document engine. Otherwise use lualatex for named fonts, pdflatex for default fonts."),
  font: fontNameSchema.optional().describe("Optional installed text font family, e.g. Arial or Times New Roman. Overrides the main .tex font. Uses fontspec with LuaLaTeX/XeLaTeX, for this figure only; math fonts are unchanged."),
  texFile: z.string().min(1).refine((value) => !value.includes("\\") && !value.includes(":") && !/[\x00-\x1f]/.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== "..") && value.endsWith(".tex"), "Supply a relative project .tex path.")
    .optional().describe("Main .tex file to read when font is omitted. Otherwise detect main.tex or one unambiguous document root."),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional().describe("SHA-256 of the existing .tikz file read before an intentional update. Omit for a new file."),
}).strict();
export type TikzInput = z.infer<typeof tikzInputSchema>;

function isSinglePicture(code: string): boolean {
  const pictures = texCommandMatches(code, /\\(begin|end)\s*\{tikzpicture\}/g);
  const begin = pictures[0];
  const end = pictures.at(-1);
  if (!begin || !end || begin[1] !== "begin" || end[1] !== "end"
    || begin.index !== 0 || end.index! + end[0].length !== code.length) return false;
  let depth = 0;
  for (const [index, picture] of pictures.entries()) {
    depth += picture[1] === "begin" ? 1 : -1;
    if (depth <= 0 && index !== pictures.length - 1) return false;
  }
  return depth === 0;
}

export function prepareTikz(input: TikzInput, inherited: TikzFontSettings = {}): { source: string; preamble: string; document: string; engine: TikzEngine; font: string | null } {
  const settings: TikzFontSettings = input.font ? { font: input.font } : inherited;
  const font = settings.font;
  const engine = input.engine ?? settings.engine ?? (font ? "lualatex" : "pdflatex");
  if (font && engine === "pdflatex") throw new Error("Named fonts require lualatex or xelatex with fontspec; select a compatible engine.");
  const code = input.code.trim();
  const visible = texCode(code).trim();
  const documentCommands = texCommandMatches(visible, /\\(?:documentclass|usepackage)\b|\\(?:begin|end)\s*\{document\}/g);
  if (!isSinglePicture(visible) || documentCommands.length) {
    throw new Error("Supply one tikzpicture environment, with packages and libraries in their separate arguments; no full LaTeX document.");
  }
  const libraries = [...new Set(input.libraries)].sort();
  const packages = [...new Set(input.packages)].sort();
  const preamble = [
    ...(font ? ["\\usepackage{fontspec}"] : settings.preamble ?? []),
    "\\usepackage{tikz}",
    ...packages.map((name) => `\\usepackage{${name}}`),
    ...(libraries.length ? [`\\usetikzlibrary{${libraries.join(",")}}`] : []),
  ].join("\n");
  const fontOptions = settings.fontOptions ? `[${settings.fontOptions}]` : "";
  const selection = font ? `\\fontspec${fontOptions}{${font}}` : settings.family ? `\\${settings.family}` : "";
  const body = selection ? `\\begingroup\n${selection}\n${code}\n\\endgroup` : code;
  const source = `${engine === "pdflatex" ? "" : `% Required engine: ${engine}\n`}% Required preamble:\n${preamble.split("\n").map((line) => `% ${line}`).join("\n")}\n${body}\n`;
  const pageSize = engine === "lualatex" ? "page" : "pdfpage";
  // Ship the measured picture with a 3pt border, without standalone.cls.
  const document = `\\documentclass{article}
${preamble}
\\pagestyle{empty}
\\begin{document}
\\setbox0=\\hbox{%
${body}
}
\\${pageSize}width=\\dimexpr\\wd0+6pt\\relax
\\${pageSize}height=\\dimexpr\\ht0+\\dp0+6pt\\relax
\\hoffset=-1in
\\voffset=-1in
\\shipout\\vbox{\\kern3pt\\hbox{\\kern3pt\\box0\\kern3pt}\\kern3pt}
\\end{document}
`;
  return { source, preamble, document, engine, font: font ?? null };
}
