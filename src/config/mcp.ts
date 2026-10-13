import * as path from "node:path";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { readProjectText, writeProjectText } from "./project";
import { isRecord } from "../zotero/validation";

export interface McpLaunch { command: string; args: string[] }
export type McpClient = "codex" | "claude" | "cursor";
export function mcpConfigFile(client: McpClient): string {
  return client === "codex" ? ".codex/config.toml" : client === "cursor" ? ".cursor/mcp.json" : ".mcp.json";
}
export async function validateMcpServerPath(server: string): Promise<void> {
  if (!path.isAbsolute(server) || path.extname(server) !== ".cjs") throw new Error("Select an existing local .cjs MCP server file.");
  if (!(await stat(server)).isFile()) throw new Error("Select a .cjs file, not a directory.");
  await access(server, constants.R_OK);
}
export function mcpLaunch(project: string, server: string, node: string, apiUrl: string, timeoutMs: number): McpLaunch {
  if (!path.isAbsolute(project) || !path.isAbsolute(server) || !node.trim()) throw new Error("MCP requires absolute project and server paths and a Node.js executable.");
  return { command: node, args: [server, "--project", project, "--api-url", apiUrl, "--timeout-ms", String(timeoutMs)] };
}
const start = "# BEGIN Zotero LaTeX Assistant MCP";
const end = "# END Zotero LaTeX Assistant MCP";
export function codexConfig(previous: string | undefined, launch: McpLaunch): string {
  let text = previous ?? "";
  const first = text.indexOf(start);
  if (first >= 0) {
    const last = text.indexOf(end, first);
    if (last < 0 || text.indexOf(start, first + start.length) >= 0) throw new Error("The managed Zotero MCP configuration is malformed. Review it manually.");
    text = text.slice(0, first) + text.slice(last + end.length);
  }
  const parsed = parseToml(text);
  if (isRecord(parsed.mcp_servers) && Object.hasOwn(parsed.mcp_servers, "zotero_latex_assistant")) {
    throw new Error("An unmanaged zotero_latex_assistant server already exists. Review it before replacing it.");
  }
  const next = `${text.trimEnd()}\n\n${start}\n[mcp_servers.zotero_latex_assistant]\ncommand = ${JSON.stringify(launch.command)}\nargs = ${JSON.stringify(launch.args)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 120\n${end}\n`;
  parseToml(next);
  return next;
}
export function claudeConfig(previous: string | undefined, launch: McpLaunch): string {
  return jsonClientConfig(previous, launch, "Claude");
}
export function cursorConfig(previous: string | undefined, launch: McpLaunch): string {
  return jsonClientConfig(previous, launch, "Cursor");
}
function jsonClientConfig(previous: string | undefined, launch: McpLaunch, client: "Claude" | "Cursor"): string {
  const parsed: unknown = previous === undefined ? {} : JSON.parse(previous);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) throw new Error(`Invalid ${client} MCP configuration.`);
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const existing = servers.zotero_latex_assistant;
  if (existing !== undefined) {
    if (!isRecord(existing) || existing.url !== undefined || (existing.type !== undefined && existing.type !== "stdio")) {
      throw new Error("An unrelated zotero_latex_assistant server exists. Review it manually.");
    }
    const args = Array.isArray(existing.args) ? existing.args : [];
    const projectIndex = args.indexOf("--project");
    const sameProject = projectIndex >= 0 && (args[projectIndex + 1] === launch.args[2]
      || (client === "Cursor" && args[projectIndex + 1] === "${workspaceFolder}"));
    const sameSelectedFile = client === "Cursor" && projectIndex < 0 && args[0] === launch.args[0];
    if (!sameProject && !sameSelectedFile) throw new Error("An unrelated zotero_latex_assistant server exists. Review it manually.");
  }
  return JSON.stringify({ ...parsed, mcpServers: { ...servers, zotero_latex_assistant: { ...(isRecord(existing) ? existing : {}), type: "stdio", ...launch } } }, null, 2) + "\n";
}
export async function configureMcp(root: string, client: McpClient, launch: McpLaunch): Promise<string> {
  const file = mcpConfigFile(client);
  const previous = await readProjectText(root, file);
  const next = client === "codex" ? codexConfig(previous, launch) : client === "cursor" ? cursorConfig(previous, launch) : claudeConfig(previous, launch);
  await writeProjectText(root, file, next, previous);
  return file;
}
