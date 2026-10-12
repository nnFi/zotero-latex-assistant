import { randomBytes } from "node:crypto";
import type { DoiResult } from "../research/crossref";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const css = `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:920px;margin:auto}
h1{font-size:24px} label{display:block;margin:14px 0 5px}input,textarea,select{box-sizing:border-box;width:100%;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);font:inherit}
textarea{min-height:80px;resize:vertical}textarea[rows="1"]{min-height:38px;height:38px}button{cursor:pointer;margin:8px 8px 8px 0;padding:8px 12px;border:0;color:var(--vscode-button-foreground);background:var(--vscode-button-background)}button:disabled{opacity:.5;cursor:default}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--vscode-textCodeBlock-background);padding:12px} .muted{color:var(--vscode-descriptionForeground)} .creator{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin:8px 0} .creator button{margin:0} #status{padding:8px 0;color:var(--vscode-descriptionForeground)}`;

export function shell(title: string, body: string, script: string, extraCss = ""): string {
  const nonce = randomBytes(18).toString("base64");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
  <title>${escapeHtml(title)}</title><style nonce="${nonce}">${css}${extraCss}</style></head><body>${body}<script nonce="${nonce}">${script}</script></body></html>`;
}

export function doiResultHtml(result: DoiResult): string {
  return shell(result.title, `<h1>${escapeHtml(result.title)}</h1><p>${escapeHtml(result.authors)}</p>
    <p>${escapeHtml(result.publisher)}</p><p>DOI: ${escapeHtml(result.doi)}</p>
    <p class="muted">Metadata from Crossref. No Zotero items were created or changed.</p>
    <button id="open">Open publication</button><button id="copy">Copy DOI</button>
    <details><summary>Full Crossref metadata</summary><pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre></details>`,
  `const api=acquireVsCodeApi();document.getElementById('open').addEventListener('click',()=>api.postMessage({type:'open'}));document.getElementById('copy').addEventListener('click',()=>api.postMessage({type:'copy'}));`);
}

