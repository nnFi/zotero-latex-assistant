import type { McpClient } from "../config/mcp";

export const mcpSetupOptions = [
  { client: "vscode", command: "setupVSCode", label: "VS Code / Copilot",
    nextStep: "Start the server with MCP: List Servers and enable its tools in Copilot Agent chat." },
  { client: "codex", command: "setupCodex", label: "Codex",
    nextStep: "Trust this project in Codex and restart its IDE session." },
  { client: "claude", command: "setupClaude", label: "Claude",
    nextStep: "Approve the project server in Claude Code and check it with /mcp." },
  { client: "cursor", command: "setupCursor", label: "Cursor",
    nextStep: "Enable or restart the server in Cursor's MCP settings." },
] as const satisfies readonly { client: McpClient; command: string; label: string; nextStep: string }[];
