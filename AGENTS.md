# Packaging and repository updates

Always keep the current installable VSIX in this repository as
`zotero-latex-assistant-latest.vsix`.
After changing extension code, dependencies, or bundled assets, run
`npm run package` before committing and pushing, and include the updated VSIX
in the same commit as the changes. Do not commit older versioned VSIX files.
