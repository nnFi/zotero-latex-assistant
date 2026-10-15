import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface BiblatexStyle {
  readonly id: string;
  readonly bibliographyFile: string;
  readonly citationFile: string;
}
export type TexLookup = (args: readonly string[], cwd: string) => Promise<string>;
interface TexLookupOptions {
  readonly platform?: NodeJS.Platform;
  readonly execute?: (executable: string, args: readonly string[], options: {
    cwd: string; timeout: number; maxBuffer: number;
  }) => Promise<{ stdout: string }>;
}

export function validateBiblatexStyle(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(value)) {
    throw new Error("Invalid BibLaTeX style name.");
  }
  return value;
}

/** kpsewhich only reads the local TeX installation; no shell or package installer. */
export function localTexLookup(executable = "kpsewhich", options: TexLookupOptions = {}): TexLookup {
  const platform = options.platform ?? process.platform;
  const run = options.execute ?? execute;
  const fallback = platform === "darwin" && executable === "kpsewhich" ? "/Library/TeX/texbin/kpsewhich" : undefined;
  let selected = executable;
  return async (args, cwd) => {
    for (;;) {
      try {
        return (await run(selected, ["--progname=latex", ...args], { cwd, timeout: 15000, maxBuffer: 8 * 1024 * 1024 })).stdout;
      } catch (error) {
        // GUI-launched VS Code may not inherit MacTeX's PATH. Only try the
        // standard installation when the default command itself is missing.
        const failure = error as { code?: unknown; stdout?: string; stderr?: string; killed?: boolean };
        if (failure.code === "ENOENT" && fallback && selected !== fallback) {
          selected = fallback;
          continue;
        }
        // kpsewhich exits with the number of missing files in a batched lookup.
        if (typeof failure.code === "number" && failure.code > 0 && failure.code <= args.length
          && !failure.killed && !failure.stderr && typeof failure.stdout === "string") return failure.stdout;
        throw new Error("Cannot read the local TeX installation. Install/configure kpsewhich or set zoteroLatexAssistant.kpsewhichPath.");
      }
    }
  };
}

/** Only complete style pairs resolvable by this TeX installation are selectable. */
export async function listInstalledBiblatexStyles(cwd: string, lookup: TexLookup = localTexLookup()): Promise<readonly BiblatexStyle[]> {
  if (!(await lookup(["biblatex.sty"], cwd)).trim()) throw new Error("BibLaTeX is not installed in the local TeX installation.");
  const directories = (await lookup(["--expand-path=$TEXINPUTS"], cwd)).trim().split(path.delimiter);
  const names = new Set<string>();
  for (const directory of new Set(directories)) {
    if (!directory) continue;
    try {
      for (const entry of await readdir(path.resolve(cwd, directory.replace(/^!!/, "")), { withFileTypes: true })) {
        if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.endsWith(".bbx")) continue;
        const name = entry.name.slice(0, -4);
        if (/^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(name)) names.add(name);
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
    }
  }
  const styles: BiblatexStyle[] = [];
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  // Bound command length, retaining kpsewhich's actual search precedence.
  for (let index = 0; index < sorted.length; index += 100) {
    const batch = sorted.slice(index, index + 100);
    const files = (await lookup(batch.flatMap((name) => [`${name}.bbx`, `${name}.cbx`]), cwd)).replace(/\r/g, "").split("\n");
    for (const [i, id] of batch.entries()) {
      const bibliographyFile = files[i * 2]?.trim();
      const citationFile = files[i * 2 + 1]?.trim();
      if (!bibliographyFile || !citationFile) continue;
      try {
        if ((await stat(bibliographyFile)).isFile() && (await stat(citationFile)).isFile()) styles.push({ id, bibliographyFile, citationFile });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  if (!styles.length) throw new Error("No complete local BibLaTeX styles (.bbx and .cbx) were found.");
  return styles;
}
