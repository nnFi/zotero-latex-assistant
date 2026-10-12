import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { ZoteroError } from "../shared/errors";

const maxFileBytes = 100 * 1024 * 1024;
export interface LocalPdf {
  localPath: string; fileUri: string; sizeBytes: number; sha256: string; mtimeMs: number; data: Buffer;
}

export interface UploadPdf extends LocalPdf { filename: string; md5: string }

/** Explicit local input for an attachment write; URLs and relative paths are not accepted. */
export async function readPdfForUpload(filePath: string): Promise<UploadPdf> {
  if (!path.isAbsolute(filePath) || /[\x00-\x1f]/.test(filePath)) throw new Error("Supply an absolute local PDF file path.");
  const filename = path.basename(filePath);
  if (!/\.pdf$/i.test(filename) || filename.includes("\\") || Buffer.byteLength(filename, "utf8") > 255) {
    throw new Error("Supply a PDF filename ending in .pdf with at most 255 UTF-8 bytes.");
  }
  const pdf = await readLocalPdf(pathToFileURL(filePath).href);
  return { ...pdf, filename, md5: createHash("md5").update(pdf.data).digest("hex") };
}

/** Accept only a local path obtained from Zotero for a verified attachment. */
export async function readLocalPdf(fileUrl: string): Promise<LocalPdf> {
  let url: URL;
  try { url = new URL(fileUrl.trim()); } catch { throw new Error("Zotero did not provide a local attachment file URL."); }
  if (url.protocol !== "file:" || url.hostname || url.search || url.hash || url.username || url.password) {
    throw new Error("Only local file URLs returned by Zotero are supported; remote files are not downloaded.");
  }
  let localPath: string;
  try { localPath = await realpath(fileURLToPath(url)); }
  catch { throw new Error("The PDF is not available on this computer. Locate or download it in Zotero first."); }
  const file = await open(localPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    .catch(() => { throw new Error("The local PDF could not be opened. Check the attachment in Zotero."); });
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 5 || before.size > maxFileBytes) throw new Error("The attachment must be a regular PDF file no larger than 100 MiB.");
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new ZoteroError("CONFLICT", "The PDF changed while reading. Read the attachment again.");
    }
    const data = buffer.subarray(0, length);
    if (!data.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("The Zotero attachment does not contain a PDF file.");
    return { localPath, fileUri: pathToFileURL(localPath).href, sizeBytes: length, mtimeMs: Math.trunc(before.mtimeMs),
      sha256: createHash("sha256").update(data).digest("hex"), data };
  } finally { await file.close(); }
}

