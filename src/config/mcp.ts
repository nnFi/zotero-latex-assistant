import * as path from "node:path";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { parse as parseToml } from "smol-toml";
import { applyEdits, getNodeValue, modify, parseTree, type Node, type ParseError } from "jsonc-parser";
import { readProjectText, writeProjectText } from "./project";
import { isRecord } from "../zotero/validation";

export interface McpLaunch { command: string; args: string[] }
const clientConfigs = {
  codex: { file: ".codex/config.toml", update: codexConfig },
  claude: { file: ".mcp.json", update: claudeConfig },
  cursor: { file: ".cursor/mcp.json", update: cursorConfig },
  vscode: { file: ".vscode/mcp.json", update: vscodeConfig },
};
export type McpClient = keyof typeof clientConfigs;

export function mcpConfigFile(client: McpClient): string {
  return clientConfigs[client].file;
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
  return jsonClientConfig(previous, launch, "claude");
}
export function cursorConfig(previous: string | undefined, launch: McpLaunch): string {
  return jsonClientConfig(previous, launch, "cursor");
}
export function vscodeConfig(previous: string | undefined, launch: McpLaunch): string {
  let text = previous ?? "{}\n";
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  const parsed: unknown = tree && getNodeValue(tree);
  if (errors.length || !tree || !isRecord(parsed) || (parsed.servers !== undefined && !isRecord(parsed.servers))) {
    throw new Error("Invalid VS Code MCP configuration. Fix .vscode/mcp.json before setting up the connection.");
  }
  // JSON parsers take the last duplicate key; modify() edits the first one.
  assertUniqueProperties(tree);
  const existing = isRecord(parsed.servers) ? parsed.servers.zotero_latex_assistant : undefined;
  assertRelatedServer(existing, launch, "vscode");
  const serverPath = ["servers", "zotero_latex_assistant"];
  const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" } };
  // Edit only our launch fields so comments, inputs, other servers and optional settings survive.
  if (existing === undefined) {
    text = applyEdits(text, modify(text, serverPath, { type: "stdio", ...launch }, options));
  } else {
    for (const [key, value] of Object.entries({ type: "stdio", ...launch })) {
      text = applyEdits(text, modify(text, [...serverPath, key], value, options));
    }
  }
  return text;
}
function assertUniqueProperties(node: Node): void {
  if (node.type === "object") {
    const names = new Set<string>();
    for (const property of node.children ?? []) {
      const name = property.children![0]!.value as string;
      if (names.has(name)) throw new Error("Duplicate property in .vscode/mcp.json. Remove duplicate keys before setting up the connection.");
      names.add(name);
    }
  }
  for (const child of node.children ?? []) assertUniqueProperties(child);
}
function assertRelatedServer(existing: unknown, launch: McpLaunch, client: Exclude<McpClient, "codex">): void {
  if (existing === undefined) return;
  if (!isRecord(existing) || existing.url !== undefined || (existing.type !== undefined && existing.type !== "stdio")) {
    throw new Error("An unrelated zotero_latex_assistant server exists. Review it manually.");
  }
  const args = Array.isArray(existing.args) ? existing.args : [];
  const projectIndex = args.indexOf("--project");
  const allowWorkspace = client === "cursor" || client === "vscode";
  const sameProject = projectIndex >= 0 && (args[projectIndex + 1] === launch.args[2]
    || (allowWorkspace && args[projectIndex + 1] === "${workspaceFolder}"));
  const sameSelectedFile = allowWorkspace && projectIndex < 0 && args[0] === launch.args[0];
  if (!sameProject && !sameSelectedFile) throw new Error("An unrelated zotero_latex_assistant server exists. Review it manually.");
}
function jsonClientConfig(previous: string | undefined, launch: McpLaunch, client: "claude" | "cursor"): string {
  const parsed: unknown = previous === undefined ? {} : JSON.parse(previous);
  if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) throw new Error(`Invalid MCP configuration in ${mcpConfigFile(client)}.`);
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const existing = servers.zotero_latex_assistant;
  assertRelatedServer(existing, launch, client);
  return JSON.stringify({ ...parsed, mcpServers: { ...servers, zotero_latex_assistant: { ...(isRecord(existing) ? existing : {}), type: "stdio", ...launch } } }, null, 2) + "\n";
}
export async function configureMcp(root: string, client: McpClient, launch: McpLaunch): Promise<string> {
  const { file, update } = clientConfigs[client];
  const previous = await readProjectText(root, file);
  const next = update(previous, launch);
  await writeProjectText(root, file, next, previous);
  return file;
}
