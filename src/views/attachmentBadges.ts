import type { AttachmentKind, ZoteroAttachment } from "../shared/types";
import { escapeHtml } from "./webviewHtml";

const labels: Record<AttachmentKind, string> = {
  pdf: "PDF", image: "Image", document: "Document", ebook: "E-Book", web: "Web page snapshot",
  link: "Link", audio: "Audio", video: "Video", archive: "Archive", file: "File",
};

const shapes: Record<AttachmentKind, string> = {
  pdf: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 18 6-6 4 4 3-3 5 5"/>',
  document: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h8M8 19h5"/>',
  ebook: '<path d="M12 5v16M12 5C8 3 5 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-1-10 1z"/>',
  web: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  link: '<path d="m10 14 4-4M9 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M15 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  audio: '<path d="M9 18V5l12-2v13M9 7l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 9 6-3v12l-6-3"/>',
  archive: '<path d="M5 2h14v20H5zM12 2v12M10 16h4v3h-4z"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5"/>',
};

export function attachmentBadges(attachments: readonly ZoteroAttachment[] | undefined, error = ""): string {
  if (!attachments) return `<span class="attachment-unknown" title="${escapeHtml(error || "Attachment metadata unavailable")}">?</span>`;
  if (!attachments.length) return '<span class="muted" aria-label="No attachment" title="No attachment">—</span>';
  const grouped = new Map<AttachmentKind, ZoteroAttachment[]>();
  for (const attachment of attachments) {
    const entries = grouped.get(attachment.kind) ?? [];
    entries.push(attachment); grouped.set(attachment.kind, entries);
  }
  return [...grouped].map(([kind, entries]) => {
    const title = `${labels[kind]} (${entries.length}): ${entries.map((entry) => entry.filename || entry.title).join(", ")}`;
    return `<span class="attachment-badge" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${shapes[kind]}</svg><span>${labels[kind]}${entries.length > 1 ? ` ×${entries.length}` : ""}</span></span>`;
  }).join("");
}
