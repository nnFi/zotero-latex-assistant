import { mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { projectPath } from "./project";
import { ZoteroError } from "../shared/errors";

/** Shared by the standalone MCP process and extension project commands. */
export async function withProjectWriteLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const lock = await projectPath(root, ".zotero/mcp/write.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  await projectPath(root, ".zotero/mcp/write.lock");
  try { await mkdir(lock); }
  catch { throw new ZoteroError("BUSY", "Another MCP write or Zotero project action is active. After a crashed process, remove .zotero/mcp/write.lock only once all Zotero MCP processes and extension actions have stopped."); }
  try { return await action(); } finally { await rm(lock, { recursive: true, force: true }); }
}
