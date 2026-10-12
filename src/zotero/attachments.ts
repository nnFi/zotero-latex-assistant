import type { AttachmentKind, ZoteroAttachment } from "../shared/types";
import { ZoteroError } from "../shared/errors";
import { isRecord, optionalString, validateKey } from "./validation";

export function attachmentKind(contentType: string, filename: string, linkMode: string): AttachmentKind {
  if (linkMode === "linked_url") return "link";
  const mime = contentType.toLowerCase().split(";")[0]!.trim();
  const extension = filename.toLowerCase().split(".").pop();
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "svg", "webp", "tif", "tiff"].includes(extension ?? "")) return "image";
  if (mime === "text/html" || ["html", "htm"].includes(extension ?? "")) return "web";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "flac", "m4a"].includes(extension ?? "")) return "audio";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "mkv"].includes(extension ?? "")) return "video";
  if (mime === "application/epub+zip" || ["epub", "mobi"].includes(extension ?? "")) return "ebook";
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension ?? "") || mime === "application/zip") return "archive";
  if (mime.startsWith("text/") || /(?:wordprocessing|spreadsheet|presentation|msword)/.test(mime)
    || ["doc", "docx", "odt", "txt", "rtf", "csv", "xls", "xlsx", "ppt", "pptx"].includes(extension ?? "")) return "document";
  return "file";
}

export function parseAttachment(value: unknown): ZoteroAttachment {
  if (!isRecord(value) || !isRecord(value.data) || value.data.itemType !== "attachment") {
    throw new ZoteroError("INVALID_RESPONSE", "Zotero returned invalid attachment metadata.");
  }
  const data = value.data;
  const contentType = optionalString(data, "contentType");
  const filename = optionalString(data, "filename");
  return { key: validateKey(value.key), parentKey: data.parentItem ? validateKey(data.parentItem) : null,
    title: optionalString(data, "title") || filename || "Attachment", filename, contentType,
    kind: attachmentKind(contentType, filename, optionalString(data, "linkMode")) };
}

export function attachmentsByItem(attachments: readonly ZoteroAttachment[]): ReadonlyMap<string, readonly ZoteroAttachment[]> {
  const result = new Map<string, ZoteroAttachment[]>();
  for (const attachment of attachments) {
    // Auch eigenständige Anhänge bekommen eine Typanzeige in ihrer eigenen Zeile.
    const key = attachment.parentKey ?? attachment.key;
    const entries = result.get(key) ?? [];
    entries.push(attachment);
    result.set(key, entries);
  }
  return result;
}
