import { randomInt, createHash } from "node:crypto";
import { z } from "zod";
import type { LibraryRef, ZoteroItemDetail } from "../shared/types";
import { ZoteroError } from "../shared/errors";
import { readProjectText, writeProjectText } from "../config/project";
import type { ZoteroClient } from "./client";
import type { ZoteroWriter } from "./writer";
import { parseAttachment } from "./attachments";
import { readLocalPdf, readPdfForUpload, type UploadPdf } from "./attachmentFiles";
import { isTrashedData } from "./validation";

const key = z.string().regex(/^[A-Z0-9]{8}$/);
const expectedData = z.object({ itemType: z.literal("attachment"), parentItem: key, title: z.string(), filename: z.string(),
  contentType: z.literal("application/pdf"), linkMode: z.enum(["imported_file", "imported_url"]) });
const journalSchema = z.object({ digest: z.string(), key, state: z.enum(["prepared", "create-submitted", "created", "file-submitted", "complete"]),
  expected: expectedData, attachmentVersion: z.number().int().nonnegative().optional() }).strict();
type Journal = z.infer<typeof journalSchema>;
interface Context {
  root: string; client: ZoteroClient; writer: ZoteroWriter; library: LibraryRef; serverId: string; parentKey: string;
  checkProject(): Promise<void>; parent(): Promise<ZoteroItemDetail>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Called under the shared project write lock. Journals never contain PDF bytes or upload tokens. */
export async function importLocalPdf(context: Context, filePath: string, requestId: string, expectedVersion: number, title?: string) {
  const { root, client, writer, library, serverId, parentKey } = context;
  const initialParent = await context.parent();
  if (isTrashedData(initialParent.data)) throw new Error("Cannot attach a PDF to a trashed source.");
  const pdf = await readPdfForUpload(filePath);
  const attachmentTitle = title?.trim() || pdf.filename;
  if (attachmentTitle.length > 1000) throw new Error("Attachment titles must be at most 1000 characters.");
  const digest = hash(JSON.stringify({ library, serverId, parentKey, expectedVersion, localPath: pdf.localPath,
    filename: pdf.filename, title: attachmentTitle, sha256: pdf.sha256 }));
  const journalPath = `.zotero/mcp/attachments/${hash(requestId)}.json`;
  let journalText = await readProjectText(root, journalPath);
  let journal: Journal;
  const save = async (next: Journal): Promise<void> => {
    const nextText = JSON.stringify(next);
    await writeProjectText(root, journalPath, nextText, journalText);
    journal = next; journalText = nextText;
  };
  const assertAttachment = (detail: ZoteroItemDetail): void => {
    if (journal.expected.parentItem !== parentKey || detail.data.parentItem !== parentKey || detail.serverId !== serverId || isTrashedData(detail.data)
      || Object.entries(journal.expected).some(([field, value]) => detail.data[field] !== value)) {
      throw new ZoteroError("CONFLICT", `Attachment ${journal.key} was changed, moved or trashed. It will not be recreated or overwritten.`);
    }
  };
  const verify = async (status: "attached" | "already-attached") => {
    client.clearCache();
    const detail = await client.getItem(library, journal.key);
    assertAttachment(detail);
    const file = await readLocalPdf(await client.attachmentFileUrl(library, journal.key));
    if (file.sha256 !== pdf.sha256 || file.sizeBytes !== pdf.sizeBytes) {
      throw new ZoteroError("CONFLICT", `The stored PDF for ${journal.key} does not match the requested file. It was not overwritten.`);
    }
    await context.checkProject();
    const parent = await context.parent();
    if (isTrashedData(parent.data)) throw new ZoteroError("CONFLICT", "The parent source was trashed during attachment import.");
    await save({ ...journal, state: "complete", attachmentVersion: detail.version });
    return { status, library, itemKey: parentKey, attachmentKey: journal.key, attachment: parseAttachment({ key: journal.key, data: detail.data }),
      version: detail.version, requestId, verified: true as const, sizeBytes: file.sizeBytes, sha256: file.sha256, localPath: file.localPath, fileUri: file.fileUri };
  };
  if (journalText) {
    journal = journalSchema.parse(JSON.parse(journalText));
    if (journal.digest !== digest) throw new Error("This attachment requestId was already used with different input. Reuse the original source, file, title and expectedVersion.");
    if (journal.expected.parentItem !== parentKey) throw new ZoteroError("CONFLICT", "The attachment journal belongs to another parent source.");
  } else {
    if (initialParent.version !== expectedVersion) throw new ZoteroError("CONFLICT", "The source version changed. Read metadata before attaching a PDF.");
    // Compare bytes of stored PDFs, never only their filenames; unrelated attachments are preserved.
    const attachments = await client.listItemAttachments(library, parentKey);
    for (const attachment of attachments) {
      if (attachment.parentKey !== parentKey) throw new ZoteroError("INVALID_RESPONSE", "Zotero returned an attachment belonging to another source.");
      if (attachment.kind !== "pdf") continue;
      const detail = await client.getItem(library, attachment.key);
      if (isTrashedData(detail.data) || detail.data.contentType !== "application/pdf"
        || !["imported_file", "imported_url"].includes(String(detail.data.linkMode))) continue;
      if (detail.data.parentItem !== parentKey) throw new ZoteroError("CONFLICT", "An attachment was moved while checking duplicates.");
      let existing;
      try { existing = await readLocalPdf(await client.attachmentFileUrl(library, attachment.key)); }
      catch (error) {
        // An unavailable local file cannot be compared. Do not hide binding/network failures.
        if (error instanceof ZoteroError && !(error.code === "HTTP_ERROR" && error.status === 404)) throw error;
        continue;
      }
      if (existing.sha256 === pdf.sha256) {
        journal = { digest, key: attachment.key, state: "complete", expected: expectedData.parse(detail.data), attachmentVersion: detail.version };
        await context.checkProject();
        await save(journal);
        return verify("already-attached");
      }
    }
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    journal = { digest, key: Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(""), state: "prepared",
      expected: { itemType: "attachment", parentItem: parentKey, title: attachmentTitle, filename: pdf.filename,
        contentType: "application/pdf", linkMode: "imported_file" } };
    await context.checkProject();
    await save(journal);
  }
  if (journal.state === "complete") return verify("already-attached");
  let parentVersion = journal.state === "prepared" || journal.state === "create-submitted" ? expectedVersion : initialParent.version;
  const preflight = async (checkAttachment: boolean): Promise<void> => {
    await context.checkProject();
    client.clearCache();
    await client.checkConnection();
    const parent = await context.parent();
    if (parent.version !== parentVersion || isTrashedData(parent.data)) throw new ZoteroError("CONFLICT", "The parent source changed before the attachment write.");
    const current: UploadPdf = await readPdfForUpload(filePath);
    if (current.localPath !== pdf.localPath || current.sha256 !== pdf.sha256) throw new ZoteroError("CONFLICT", "The local PDF changed before the attachment write.");
    if (checkAttachment) {
      const detail = await client.getItem(library, journal.key);
      assertAttachment(detail);
      if (detail.version !== journal.attachmentVersion) throw new ZoteroError("CONFLICT", `Attachment ${journal.key} changed before upload.`);
      if (detail.data.md5) throw new ZoteroError("CONFLICT", `Attachment ${journal.key} already contains a file. It was not overwritten.`);
    }
    await context.checkProject();
  };
  try {
    if (journal.state === "prepared") {
      let existing: ZoteroItemDetail | undefined;
      try { existing = await client.getItem(library, journal.key); }
      catch (error) {
        if (!(error instanceof ZoteroError && error.code === "HTTP_ERROR" && error.status === 404)) throw error;
      }
      if (existing) {
        assertAttachment(existing);
        await save({ ...journal, state: "created", attachmentVersion: existing.version });
        parentVersion = (await context.parent()).version;
      }
    }
    if (journal.state === "prepared") {
      const detail = await writer.createItem(library, serverId, journal.key, { ...journal.expected, tags: [], relations: {}, md5: null, mtime: null }, async () => {
        await preflight(false);
        await save({ ...journal, state: "create-submitted" });
      }, () => save({ ...journal, state: "prepared" }));
      assertAttachment(detail);
      await save({ ...journal, state: "created", attachmentVersion: detail.version });
      parentVersion = (await context.parent()).version;
    } else if (journal.state === "create-submitted") {
      // A lost create response is reconciled by the allocated key, never by a second POST.
      let detail: ZoteroItemDetail;
      try { detail = await client.getItem(library, journal.key); }
      catch { throw new Error(`Creation outcome is unresolved for attachment ${journal.key}. It will not be submitted again.`); }
      assertAttachment(detail);
      await save({ ...journal, state: "created", attachmentVersion: detail.version });
      parentVersion = (await context.parent()).version;
    }
    client.clearCache();
    const current = await client.getItem(library, journal.key);
    assertAttachment(current);
    if (current.data.md5) return verify("already-attached");
    await writer.uploadNewPdf(library, serverId, journal.key, pdf, async () => {
      await preflight(true);
      if (journal.state !== "file-submitted") await save({ ...journal, state: "file-submitted" });
    });
    return await verify("attached");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment import failed.";
    const contextMessage = `PDF attachment ${journal.key} is incomplete or uncertain. Retry with the same requestId and input; no existing files are replaced. ${message}`;
    if (error instanceof ZoteroError) throw new ZoteroError(error.code, contextMessage, { cause: error, ...(error.status === undefined ? {} : { status: error.status }) });
    throw new Error(contextMessage, { cause: error });
  }
}
