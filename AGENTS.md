# Packaging and repository updates

Always keep the current installable VSIX in this repository as
`zotero-latex-assistant-latest.vsix`.
After changing extension code, dependencies, or bundled assets, run
`npm run package` before committing and pushing, and include the updated VSIX
in the same commit as the changes. Do not commit older versioned VSIX files.

Also include the current standalone MCP server as `mcp-latest.cjs` in the
repository and in the same commit. `npm run compile` (also run by
`npm run package`) copies the bundled `dist/mcp/server.cjs` to this file.
