import { readdir } from "node:fs/promises";
import { projectPath, readProjectText } from "./project";

export interface ProjectSource { readonly path: string; readonly text: string }

const excludedDirectories = new Set([
  ".git", ".zotero", ".codex", ".claude", ".cursor", "node_modules", "dist", "build", "out",
]);

/** Read saved TeX sources without following symlinks or scanning generated/configuration directories. */
export async function readProjectSources(root: string, includeBibliographies = false): Promise<ProjectSource[]> {
  const sources: ProjectSource[] = [];
  async function walk(relative: string): Promise<void> {
    const directory = relative ? await projectPath(root, relative) : root;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) await walk(file);
      if (entry.isFile() && (/\.(tex|ltx|sty|cls)$/.test(entry.name) || (includeBibliographies && entry.name.endsWith(".bib")))) {
        const text = await readProjectText(root, file);
        if (text !== undefined) sources.push({ path: file, text });
      }
    }
  }
  await walk("");
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}
