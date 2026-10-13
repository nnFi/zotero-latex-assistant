import { homedir } from "node:os";
import * as path from "node:path";

/** Private persistent selection and write journals; never infer a project from cwd. */
export function mcpStateDirectory(): string {
  const configured = process.platform === "win32" ? process.env.LOCALAPPDATA : process.env.XDG_STATE_HOME;
  const base = configured && path.isAbsolute(configured) ? configured
    : process.platform === "win32" ? path.join(homedir(), "AppData", "Local")
    : process.platform === "darwin" ? path.join(homedir(), "Library", "Application Support")
    : path.join(homedir(), ".local", "state");
  return path.join(base, "zotero-latex-assistant");
}
