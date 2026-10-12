import { validateBiblatexStyle } from "./styles";
import { texCode, texArgument, texCommandMatches as commandMatches } from "./texSyntax";
import { planBiblatexResources, reachableTexSources } from "./texResources";

export interface TexSource { readonly path: string; readonly text: string }
export interface TexChange extends TexSource { readonly previous: string }

const codeOnly = texCode;
const argument = texArgument;

function options(value: string, style: string, includeStyle: boolean): string {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= value.length; i++) {
    if (value[i] === "{") depth++;
    if (value[i] === "}") depth--;
    if (i === value.length || (value[i] === "," && depth === 0)) {
      const part = value.slice(start, i).trim();
      if (part && !/^(?:style|bibstyle|citestyle)\s*=/.test(part)) parts.push(part);
      start = i + 1;
    }
  }
  if (includeStyle) parts.push(`style=${style}`);
  return parts.join(",");
}

/** Synchronize all active package declarations, preserving other package options. */
export function planBiblatexStyle(sources: readonly TexSource[], style: string, bibFile = ""): readonly TexChange[] {
  validateBiblatexStyle(style);
  const parsed = sources.map((source) => ({ source, code: codeOnly(source.text),
    edits: [] as { start: number; end: number; text: string }[], loads: false }));
  for (const file of parsed) {
    if (commandMatches(file.code, /\\bibliographystyle\s*\{/g).length) {
      throw new Error(`${file.source.path} uses classic BibTeX. Convert it to BibLaTeX before selecting a BibLaTeX style.`);
    }
    for (const match of commandMatches(file.code, /\\(usepackage|RequirePackage|PassOptionsToPackage|ExecuteBibliographyOptions)\b/g)) {
      const command = match[1]!;
      const offset = match.index! + match[0].length;
      if (command === "ExecuteBibliographyOptions") {
        const arg = argument(file.code, offset, "{", "}");
        if (arg && /(?:^|,)\s*(?:style|bibstyle|citestyle)\s*=/.test(arg.content)) {
          file.edits.push({ start: arg.start, end: arg.end, text: `{${options(arg.content, style, false)}}` });
        }
        continue;
      }
      const optional = command === "PassOptionsToPackage" ? argument(file.code, offset, "{", "}") : argument(file.code, offset, "[", "]");
      const packages = argument(file.code, optional?.end ?? offset, "{", "}");
      if (!packages || !packages.content.split(",").map((part) => part.trim()).includes("biblatex")) continue;
      if (packages.content.trim() !== "biblatex") throw new Error(`${file.source.path}: load biblatex in its own package declaration before changing the style.`);
      if (command !== "PassOptionsToPackage") file.loads = true;
      const content = options(optional?.content ?? "", style, command !== "PassOptionsToPackage");
      const bracket = command === "PassOptionsToPackage" ? ["{", "}"] : ["[", "]"];
      file.edits.push({ start: optional?.start ?? packages.start, end: optional?.end ?? packages.start,
        text: `${bracket[0]}${content}${bracket[1]}` });
    }
  }
  for (const file of parsed) {
    const match = commandMatches(file.code, /\\documentclass\b/g)[0];
    if (!match) continue;
    const reachable = new Set(reachableTexSources(file.source, sources).map((source) => source.path));
    const dependencies = parsed.filter((dependency) => reachable.has(dependency.source.path));
    const offset = match.index! + match[0].length;
    const optional = argument(file.code, offset, "[", "]");
    const cls = argument(file.code, optional?.end ?? offset, "{", "}");
    if (!cls) throw new Error(`${file.source.path}: cannot find the document class argument.`);
    const newline = file.source.text.includes("\r\n") ? "\r\n" : "\n";
    const endOfLine = file.source.text.indexOf("\n", cls.end);
    // Insert after any trailing comment on the documentclass line.
    const nextCode = file.code.slice(cls.end, endOfLine < 0 ? undefined : endOfLine).trim();
    const position = endOfLine < 0 || nextCode ? cls.end : endOfLine + 1;
    if (!dependencies.some((dependency) => dependency.loads)) {
      file.edits.push({ start: position, end: position,
        text: `${position === cls.end ? newline : ""}\\usepackage[style=${style}]{biblatex}${newline}` });
    }
  }
  const updated = parsed.map((file) => {
    let text = file.source.text;
    for (const edit of file.edits.map((edit, order) => ({ ...edit, order })).sort((a, b) => b.start - a.start || b.order - a.order)) {
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    }
    return { path: file.source.path, text };
  });
  if (bibFile) {
    for (const change of planBiblatexResources(updated, "", bibFile)) updated.find((source) => source.path === change.path)!.text = change.text;
  }
  return updated.flatMap((source, i) => source.text === sources[i]!.text ? [] : [{ ...source, previous: sources[i]!.text }]);
}
