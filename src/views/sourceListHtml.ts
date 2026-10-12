import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZoteroAttachment, ZoteroItem } from "../shared/types";
import { creatorNameList } from "../zotero/items";
import { isImportableItem } from "../biblatex/selection";
import { escapeHtml, shell } from "./webviewHtml";
import { attachmentBadges } from "./attachmentBadges";

const compiledScripts = new Map<string, string>();
function sourceListScript(scriptPath = join(__dirname, "../../webview/sourceList.js")): string {
  let script = compiledScripts.get(scriptPath);
  if (script === undefined) {
    script = readFileSync(scriptPath, "utf8");
    compiledScripts.set(scriptPath, script);
  }
  return script;
}

const typeNames: Record<string, string> = {
  book: "Book", bookSection: "Book section", journalArticle: "Journal article", conferencePaper: "Conference paper",
  report: "Report", blogPost: "Blog post", webpage: "Web page", document: "Document", preprint: "Preprint",
  thesis: "Thesis", computerProgram: "Software", magazineArticle: "Magazine article", newspaperArticle: "Newspaper article",
  presentation: "Presentation", dataset: "Dataset", manuscript: "Manuscript", patent: "Patent",
  attachment: "Attachment", note: "Note", annotation: "Annotation",
};

export function sourceListHtml(title: string, items: readonly ZoteroItem[], importedKeys: readonly string[], stateId: string,
  attachments?: ReadonlyMap<string, readonly ZoteroAttachment[]>, attachmentError = "", citationKeys?: Readonly<Record<string, string>>, bibliographyError = "", scriptPath?: string): string {
  const imported = new Set(importedKeys);
  const rows = [...items].sort((a, b) => a.title.localeCompare(b.title)).map((item) => {
    const names = creatorNameList(item);
    const creators = names.join(", ");
    const visibleCreators = escapeHtml(names.slice(0, 3).join(", "));
    const moreCreators = names.length > 3 ? `<span class="more-authors">+${names.length - 3} more · ${names.length} total</span>` : "";
    const type = typeNames[item.itemType] ?? item.itemType;
    const keyName = citationKeys?.[item.key] ?? "";
    const search = [item.title, creators, type, item.date, item.doi, keyName].join(" ").toLocaleLowerCase("en");
    const present = imported.has(item.key) && isImportableItem(item);
    return `<tr data-key="${escapeHtml(item.key)}" data-in-bib="${present}" data-search="${escapeHtml(search)}">
      <td class="check"><input type="checkbox" class="pick" aria-label="${escapeHtml(item.title)} – include in project .bib" ${isImportableItem(item) ? "" : "disabled"} ${present ? "checked" : ""}></td>
      <td><button class="title-link" data-action="select" title="Include or exclude source">${escapeHtml(item.title)}</button>${imported.has(item.key) ? '<span class="imported">In project .bib</span>' : ""}${keyName ? `<span class="imported">Citation key: ${escapeHtml(keyName)}</span>` : ""}</td>
      <td class="authors">${visibleCreators}${moreCreators}</td><td class="type">${escapeHtml(type)}</td>
      <td class="attachments">${attachmentBadges(attachments ? attachments.get(item.key) ?? [] : undefined, attachmentError)}</td>
      <td class="action"><button data-action="cite" title="Import the source if needed and cite it in the LaTeX document" ${isImportableItem(item) ? "" : 'disabled data-unavailable="true"'}>Cite</button><button class="secondary" data-action="open">Open in Zotero</button></td></tr>`;
  }).join("");
  const body = `<header id="list-header" class="list-header" data-state-id="${escapeHtml(stateId)}"><h1>${escapeHtml(title)}</h1>
    <div class="toolbar"><button id="import">Update project .bib</button><button id="doi">Search DOI / title</button><button id="refresh" class="secondary">Refresh list</button></div>
    <p class="muted">Checkboxes reflect the project .bib. Updating adds checked sources and removes unchecked sources together with their LaTeX citations. Save open LaTeX changes before updating. Saved .bib changes update the list automatically.</p>
    <div class="filter"><label for="search">Filter sources</label><input id="search" type="search" placeholder="Title, creator, year or DOI …"><span id="selection" aria-live="polite"></span></div>
    <div id="status" role="status" aria-live="polite"></div></header>
    ${attachmentError ? `<p class="muted">Attachment information unavailable: ${escapeHtml(attachmentError)}</p>` : ""}
    ${bibliographyError ? `<p role="alert">Project .bib could not be read: ${escapeHtml(bibliographyError)}. Existing-source markers are unavailable.</p>` : ""}
    <div class="table-scroll"><table aria-label="Zotero sources"><thead><tr><th class="check"><input id="all" type="checkbox" aria-label="Select all visible sources"></th><th>Title</th><th>Creators</th><th>Item type</th><th>Attachments</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p id="empty" class="muted" ${items.length ? "hidden" : ""}>No sources available.</p>`;
  return shell(title, body, sourceListScript(scriptPath),
  `body{max-width:none;padding:0 20px 20px;background:var(--vscode-editor-background)}.list-header{position:sticky;top:0;background:var(--vscode-editor-background);padding:18px 0 8px;z-index:2}.list-header h1{margin:0 0 10px}.toolbar{display:flex;flex-wrap:wrap;gap:8px}.toolbar button{margin:0}.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}.filter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.filter label{margin:0}.filter input{width:320px;max-width:100%}#selection{color:var(--vscode-descriptionForeground);white-space:nowrap}#status:empty{display:none}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;table-layout:auto}th{color:var(--vscode-descriptionForeground);font-weight:600;border-bottom:1px solid var(--vscode-panel-border);padding:10px}td{padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:middle}tbody tr:nth-child(even){background:var(--vscode-list-inactiveSelectionBackground)}tbody tr:hover{background:var(--vscode-list-hoverBackground)}tr[hidden]{display:none}.check{width:28px}.check input{width:16px;height:16px;accent-color:var(--vscode-focusBorder);padding:0}.title-link{display:block;text-align:left;color:var(--vscode-foreground);background:none;padding:0;margin:0;line-height:1.5}.title-link:hover{text-decoration:underline;color:var(--vscode-textLink-foreground)}.authors{width:22%}.more-authors{display:block;margin-top:4px;font-size:12px;color:var(--vscode-descriptionForeground)}.type{width:140px}.attachments{min-width:110px}.attachment-badge{display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;white-space:nowrap}.attachment-unknown{color:var(--vscode-descriptionForeground)}.action{width:220px;white-space:nowrap}.action button{margin:0 6px 0 0;font-size:12px}.action button:last-child{margin-right:0}.imported{display:block;font-size:11px;color:var(--vscode-descriptionForeground)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}`);
}
