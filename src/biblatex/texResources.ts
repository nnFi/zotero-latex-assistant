import * as path from "node:path";
import { texArgument, texCode, texCommandMatches as commandMatches } from "./texSyntax";
import type { TexChange, TexSource } from "./texStyle";

export function reachableTexSources(source: TexSource, sources: readonly TexSource[], seen = new Set<string>()): readonly TexSource[] {
  if (seen.has(source.path)) return [];
  seen.add(source.path);
  const result = [source];
  const code = texCode(source.text);
  for (const match of commandMatches(code, /\\(input|include|usepackage|RequirePackage|documentclass|LoadClass)\b/g)) {
    const offset = match.index! + match[0].length;
    const optional = texArgument(code, offset, "[", "]");
    const arg = texArgument(code, optional?.end ?? offset, "{", "}");
    if (!arg) continue;
    const extension = ["input", "include"].includes(match[1]!) ? ".tex" : ["documentclass", "LoadClass"].includes(match[1]!) ? ".cls" : ".sty";
    for (let name of arg.content.split(",").map((value) => value.trim())) {
      if (!name.endsWith(extension)) name += extension;
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), name));
      const dependency = sources.find((candidate) => candidate.path === relative) ?? sources.find((candidate) => candidate.path === name);
      if (dependency) result.push(...reachableTexSources(dependency, sources, seen));
    }
  }
  return result;
}

interface Resource { start: number; end: number; name: string; extensionless: boolean }
function resources(source: TexSource): readonly Resource[] {
  const code = texCode(source.text);
  const result: Resource[] = [];
  for (const match of commandMatches(code, /\\(addbibresource|addglobalbib|addsectionbib|bibliography)\b/g)) {
    const offset = match.index! + match[0].length;
    const optional = texArgument(code, offset, "[", "]");
    const arg = texArgument(code, optional?.end ?? offset, "{", "}");
    if (!arg) throw new Error(`${source.path}: cannot read the bibliography resource argument.`);
    if (/\blocation\s*=\s*remote\b/.test(optional?.content ?? "")) continue;
    let start = arg.start + 1;
    for (const part of match[1] === "bibliography" ? arg.content.split(",") : [arg.content]) {
      const name = part.trim();
      if (/^[a-z]+:\/\//i.test(name)) { start += part.length + 1; continue; }
      if (!name || /[\\{}%#$^~]/.test(name) || /[\r\n]/.test(name)) {
        throw new Error(`${source.path}: dynamic bibliography resource paths cannot be updated automatically. Use a literal .bib path first.`);
      }
      const leading = part.length - part.trimStart().length;
      const tokenStart = start + leading;
      const tokenEnd = tokenStart + name.length;
      if (source.text.slice(tokenStart, tokenEnd) !== name) throw new Error(`${source.path}: a commented bibliography path cannot be updated automatically.`);
      result.push({ start: tokenStart, end: tokenEnd, name, extensionless: match[1] === "bibliography" && !name.endsWith(".bib") });
      start += part.length + 1;
    }
  }
  return result;
}

function matchesResource(name: string, bibFile: string, context: string): boolean {
  const file = name.endsWith(".bib") ? name : `${name}.bib`;
  return path.posix.normalize(path.posix.join(path.posix.dirname(context), file)) === bibFile;
}

/** Change only the selected local resource; preserve options, other resources and examples. */
export function planBiblatexResources(sources: readonly TexSource[], previousBib: string, bibFile: string): readonly TexChange[] {
  if (/[{}%#$^~\\\r\n&]/.test(bibFile)) throw new Error("The .bib file name contains characters that cannot be inserted into a LaTeX resource reference.");
  const roots = sources.filter((source) => commandMatches(texCode(source.text), /\\documentclass\b/g).length);
  const reachable = new Map(roots.map((root) => [root.path, reachableTexSources(root, sources)]));
  const changed = sources.map((source) => {
    const contexts = roots.filter((root) => reachable.get(root.path)!.some((dependency) => dependency.path === source.path));
    if (!contexts.length) contexts.push(source);
    const edits: { start: number; end: number; text: string }[] = [];
    for (const ref of resources(source)) {
      if (!previousBib || previousBib === bibFile) continue;
      const matched = contexts.filter((context) => matchesResource(ref.name, previousBib, context.path));
      if (!matched.length) {
        // Root-relative resources are also common when compiling from the workspace.
        if (!matchesResource(ref.name, previousBib, "main.tex")) continue;
        matched.push({ path: "main.tex", text: "" });
      } else if (matched.length !== contexts.length) {
        throw new Error(`${source.path}: the shared bibliography reference resolves differently in multiple documents. Update it explicitly first.`);
      }
      const names = new Set(matched.map((context) => path.posix.relative(path.posix.dirname(context.path), bibFile)));
      if (names.size !== 1) throw new Error(`${source.path}: a shared bibliography reference requires different paths in multiple documents.`);
      let name = [...names][0]!;
      if (ref.extensionless) name = name.slice(0, -4);
      edits.push({ start: ref.start, end: ref.end, text: name });
    }
    let text = source.text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    return { path: source.path, text };
  });
  // Complete an existing BibLaTeX setup without inventing a citation style.
  for (const root of changed.filter((source) => roots.some((original) => original.path === source.path))) {
    const dependencies = reachableTexSources(root, changed);
    const loads = dependencies.some((dependency) => commandMatches(texCode(dependency.text), /\\(?:usepackage|RequirePackage)\s*(?:\[[\s\S]*?\])?\s*\{[^}]*\bbiblatex\b[^}]*\}/g).length);
    if (!loads) continue;
    const code = texCode(root.text);
    const begin = /\\begin\s*\{document\}/.exec(code);
    const end = /\\end\s*\{document\}/.exec(code);
    if (!begin || !end) throw new Error(`${root.path}: a complete document environment is required to add bibliography references.`);
    const newline = root.text.includes("\r\n") ? "\r\n" : "\n";
    const edits: { start: number; text: string }[] = [];
    if (!dependencies.some((dependency) => resources(dependency).some((ref) => matchesResource(ref.name, bibFile, root.path)
      || matchesResource(ref.name, bibFile, "main.tex")))) {
      edits.push({ start: begin.index, text: `\\addbibresource{${path.posix.relative(path.posix.dirname(root.path), bibFile)}}${newline}` });
    }
    if (!dependencies.some((dependency) => commandMatches(texCode(dependency.text), /\\printbibliography\b/g).length)) {
      edits.push({ start: end.index, text: `\\printbibliography${newline}` });
    }
    for (const edit of edits.sort((a, b) => b.start - a.start)) root.text = root.text.slice(0, edit.start) + edit.text + root.text.slice(edit.start);
  }
  return changed.flatMap((source, i) => source.text === sources[i]!.text ? [] : [{ ...source, previous: sources[i]!.text }]);
}
