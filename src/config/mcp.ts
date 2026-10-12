import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { readProjectText, writeProjectText } from "./project";
import { isRecord } from "../zotero/validation";

export interface McpLaunch { command: string; args: string[] }
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
  const parsed: unknown = previous === undefined ? {} : JSON.parse(previous);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) throw new Error("Invalid Claude .mcp.json configuration.");
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const existing = servers.zotero_latex_assistant;
  if (existing !== undefined && (!isRecord(existing) || !Array.isArray(existing.args) || !existing.args.includes("--project")
    || !existing.args.includes(launch.args[2]))) throw new Error("An unrelated zotero_latex_assistant server exists. Review it manually.");
  return JSON.stringify({ ...parsed, mcpServers: { ...servers, zotero_latex_assistant: { type: "stdio", ...launch } } }, null, 2) + "\n";
}
export async function configureMcp(root: string, client: "codex" | "claude", launch: McpLaunch): Promise<string> {
  const file = client === "codex" ? ".codex/config.toml" : ".mcp.json";
  const previous = await readProjectText(root, file);
  const next = client === "codex" ? codexConfig(previous, launch) : claudeConfig(previous, launch);
  await writeProjectText(root, file, next, previous);
  return file;
}
