import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { LibraryRef, ProjectConfig } from "../shared/types";
import { isRecord, libraryPrefix, validateKey } from "../zotero/validation";
import { validateCitationKey } from "../biblatex/keys";
import { canonicalLocale } from "../biblatex/language";
import { validateBiblatexStyle } from "../biblatex/styles";
import { texArgument, texCode, texCommandMatches } from "../biblatex/texSyntax";

export const CONFIG_FILE = ".zotero/config.json";

/** Bibliothek, Bib-Datei und Stil können in beliebiger Reihenfolge eingerichtet werden. */
export function newProjectConfig(citationCommand: ProjectConfig["citationCommand"] = "autocite"): ProjectConfig {
  return { version: 1, library: null, collectionKey: "", bibFile: "", citationStyle: "", citationStyleType: "biblatex", citationCommand, importedItemKeys: [] };
}

export function withProjectLibrary(config: ProjectConfig, library: LibraryRef, collectionKey: string, serverId?: string): ProjectConfig {
  libraryPrefix(library);
  if (collectionKey) validateKey(collectionKey);
  const same = config.library?.type === library.type && config.library.id === library.id
    && config.serverId === serverId;
  if (!same && config.importedItemKeys.length) {
    throw new Error("This project already contains imported sources. Run “Delete all citations” to reset it before selecting a different library or Zotero database, or use a separate project to preserve existing citations.");
  }
  const { serverId: _previousServerId, ...previous } = config;
  return { ...previous, library, collectionKey, importedItemKeys: same ? config.importedItemKeys : [], ...(serverId ? { serverId } : {}) };
}

export function validateBibFile(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)
    || value.includes("\\") || value.includes(":") || /[\x00-\x1f]/.test(value)
    || value.split("/").some((part) => !part || part === "." || part === "..")
    || !value.endsWith(".bib") || value.startsWith(".zotero/")) {
    throw new Error("Enter a relative project path ending in .bib, e.g. references.bib.");
  }
  return value;
}

export function parseProjectConfig(value: unknown): ProjectConfig {
  if (!isRecord(value) || value.version !== 1 || (value.library !== null && (!isRecord(value.library)
    || !["user", "group"].includes(String(value.library.type)) || typeof value.library.id !== "number"))) {
    throw new Error("Invalid .zotero/config.json: version 1 and a library binding or null are required.");
  }
  const library = value.library === null ? null : { type: value.library.type as "user" | "group", id: value.library.id as number };
  if (library) libraryPrefix(library);
  if (typeof value.collectionKey !== "string" || typeof value.citationStyle !== "string"
    || !["autocite", "parencite", "textcite"].includes(String(value.citationCommand))
    || !Array.isArray(value.importedItemKeys)
    || (value.serverId !== undefined && (typeof value.serverId !== "string" || !value.serverId))) {
    throw new Error("Invalid project configuration: check the collection, citation style, citation command or import list.");
  }
  if (value.collectionKey) validateKey(value.collectionKey);
  if (value.citationStyleType !== undefined && value.citationStyleType !== "biblatex") throw new Error("Invalid citation style type.");
  if (value.citationStyleType === "biblatex" && value.citationStyle) validateBiblatexStyle(value.citationStyle);
  const keys = value.importedItemKeys.map(validateKey);
  let citationKeys: Record<string, string> | undefined;
  if (value.citationKeys !== undefined) {
    if (!isRecord(value.citationKeys)) throw new Error("Invalid citation key mapping.");
    citationKeys = Object.fromEntries(Object.entries(value.citationKeys).map(([key, name]) => {
      validateKey(key);
      if (!keys.includes(key)) throw new Error("Citation keys must belong to imported project sources.");
      return [key, validateCitationKey(name)];
    }));
    if (new Set(Object.values(citationKeys)).size !== Object.keys(citationKeys).length) throw new Error("Duplicate citation keys in the project configuration.");
  }
  if (!library && (value.collectionKey || keys.length || value.serverId)) {
    throw new Error("Collection, imported sources and server ID require a library binding.");
  }
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate Zotero keys in the import list.");
  return {
    version: 1, library, collectionKey: value.collectionKey,
    bibFile: value.bibFile === "" ? "" : validateBibFile(value.bibFile), citationStyle: value.citationStyle,
    citationCommand: value.citationCommand as ProjectConfig["citationCommand"], importedItemKeys: keys,
    ...(value.citationStyleType === "biblatex" ? { citationStyleType: "biblatex" as const } : {}),
    ...(citationKeys ? { citationKeys } : {}),
    ...(value.citationLocale !== undefined ? { citationLocale: canonicalLocale(value.citationLocale) } : {}),
    ...(typeof value.serverId === "string" ? { serverId: value.serverId } : {}),
  };
}

export function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

/** Auch bestehende Symlinks in Elternordnern dürfen nicht aus dem Projekt führen. */
export async function projectPath(root: string, relative: string): Promise<string> {
  const rootPath = await realpath(root);
  const target = path.resolve(rootPath, relative);
  const inside = (candidate: string): boolean => candidate === rootPath || candidate.startsWith(rootPath + path.sep);
  if (!inside(target) || target === rootPath) throw new Error("The file path is outside the project.");
  let component = rootPath;
  for (const part of path.relative(rootPath, target).split(path.sep)) {
    component = path.join(component, part);
    try {
      if ((await lstat(component)).isSymbolicLink()) {
        let resolved: string;
        try { resolved = await realpath(component); }
        catch { throw new Error("The file path contains an unresolvable symlink."); }
        if (!inside(resolved)) throw new Error("The file path points outside the project through a symlink.");
      }
    } catch (error) { if (!isMissing(error)) throw error; break; }
  }
  let current = target;
  for (;;) {
    try {
      if (!inside(await realpath(current))) throw new Error("The file path points outside the project through a symlink.");
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      current = path.dirname(current);
    }
  }
  return target;
}

export async function readProjectConfig(root: string): Promise<ProjectConfig | undefined> {
  try {
    return parseProjectConfig(JSON.parse(await readFile(await projectPath(root, CONFIG_FILE), "utf8")));
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function readProjectText(root: string, relative: string): Promise<string | undefined> {
  try { return await readFile(await projectPath(root, relative), "utf8"); }
  catch (error) { if (isMissing(error)) return undefined; throw error; }
}

/** Schreiben erst nach vollständiger Verarbeitung; unerwartete Änderungen brechen den Vorgang ab. */
export async function writeProjectText(root: string, relative: string, text: string, expected: string | undefined): Promise<void> {
  const target = await projectPath(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await projectPath(root, relative);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx" });
    if (await readProjectText(root, relative) !== expected) {
      throw new Error("The file has changed in the meantime. Please retry.");
    }
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

export async function saveProjectConfig(root: string, config: ProjectConfig, expected?: string): Promise<void> {
  const valid = parseProjectConfig(config);
  await writeProjectText(root, CONFIG_FILE, JSON.stringify(valid, null, 2) + "\n", expected);
}

export interface ProjectFileChange { readonly path: string; readonly text: string; readonly previous: string | undefined }

/** Preflight every file, back up originals, and roll back completed writes on failure. */
export async function writeProjectChanges(root: string, changes: readonly ProjectFileChange[], kind: "style" | "bibliography" | "migration" | "reset" = "style"): Promise<string | undefined> {
  if (!changes.length) return undefined;
  if (new Set(changes.map((change) => change.path)).size !== changes.length) throw new Error("Duplicate project file changes.");
  for (const change of changes) {
    if (await readProjectText(root, change.path) !== change.previous) throw new Error(`${change.path} has changed in the meantime. Please retry.`);
  }
  const backup = `.zotero/backups/${kind}-${randomUUID()}`;
  for (const change of changes) {
    if (change.previous !== undefined) await writeProjectText(root, `${backup}/${change.path}`, change.previous, undefined);
  }
  const completed: ProjectFileChange[] = [];
  try {
    for (const change of changes) {
      await writeProjectText(root, change.path, change.text, change.previous);
      completed.push(change);
    }
  } catch (error) {
    const failures: string[] = [];
    for (const change of completed.reverse()) {
      try {
        if (change.previous !== undefined) await writeProjectText(root, change.path, change.previous, change.text);
        else {
          if (await readProjectText(root, change.path) !== change.text) throw new Error("File changed during rollback.");
          await rm(await projectPath(root, change.path));
        }
      } catch { failures.push(change.path); }
    }
    if (failures.length) throw new Error(`Could not restore ${failures.join(", ")}. Original files are in ${backup}.`, { cause: error });
    throw error;
  }
  return backup;
}

/** TeX-Referenzen haben Vorrang; bei Mehrdeutigkeit wird keine Datei geraten. */
export function discoverBibFile(files: readonly string[], texSources: readonly { path: string; text: string }[]): string | undefined {
  const references = new Set<string>();
  for (const source of texSources) {
    try {
      const code = texCode(source.text);
      for (const match of texCommandMatches(code, /\\(addbibresource|addglobalbib|addsectionbib|bibliography)\b/g)) {
        const offset = match.index! + match[0].length;
        const optional = texArgument(code, offset, "[", "]");
        const argument = texArgument(code, optional?.end ?? offset, "{", "}");
        if (!argument) return undefined;
        if (/\blocation\s*=\s*remote\b/.test(optional?.content ?? "")) continue;
        const names = match[1] === "bibliography" ? argument.content.split(",") : [argument.content];
        for (let ref of names) {
          ref = ref.trim();
          if (!ref || /^[a-z]+:\/\//i.test(ref) || /[\\{}%#$^~]/.test(ref)) continue;
          if (!ref.endsWith(".bib")) ref += ".bib";
          const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), ref));
          if (files.includes(candidate)) references.add(candidate);
          else if (files.includes(ref)) references.add(ref);
        }
      }
    } catch {
      // Discovery is advisory: incomplete TeX must not block the file picker or produce a guess.
      return undefined;
    }
  }
  if (references.size === 1) return [...references][0];
  return references.size === 0 && files.length === 1 ? files[0] : undefined;
}
