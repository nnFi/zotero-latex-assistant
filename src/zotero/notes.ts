import { createHash, randomInt } from "node:crypto";
import { readProjectText, writeProjectText } from "../config/project";
import type { ZoteroItemDetail } from "../shared/types";
import { ZoteroError } from "../shared/errors";
import { isRecord, isTrashedData, validateKey } from "./validation";
import type { ZoteroClient } from "./client";
import type { ZoteroWriter } from "./writer";

export function noteContent(content: string, format: "text" | "html"): string {
  if (!content.trim() || content.length > 100000) throw new Error("Supply non-empty note content up to 100000 characters.");
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content)) throw new Error("Note content must not contain control characters.");
  if (format === "html") return content.trim();
  if (format !== "text") throw new Error("Invalid note format.");
  const escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return escaped.split(/\r?\n/).map((line) => `<p>${line || "<br>"}</p>`).join("\n");
}

export function sourceNote(detail: ZoteroItemDetail, itemKey: string) {
  if (detail.data.itemType !== "note" || detail.data.parentItem !== itemKey
    || isTrashedData(detail.data) || typeof detail.data.note !== "string") {
    throw new Error("The note must belong to this source and must not be in trash.");
  }
  return { key: detail.item.key, parentKey: itemKey, version: detail.version, note: detail.data.note };
}

interface NoteContext {
  root: string;
  client: ZoteroClient;
  writer: ZoteroWriter;
  serverId: string;
  parent: () => Promise<ZoteroItemDetail>;
  checkProject: () => Promise<void>;
}

/** Reserve the child key before submitting and reconcile uncertain outcomes by that exact key. */
export async function createSourceNote(context: NoteContext, content: string, format: "text" | "html", requestId: string, expectedVersion: number) {
  if (requestId.length < 8 || requestId.length > 200) throw new Error("Supply a stable requestId of 8–200 characters.");
  const note = noteContent(content, format);
  const parent = await context.parent();
  if (isTrashedData(parent.data)) throw new Error("The source is in Zotero trash.");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  const digest = hash(JSON.stringify({ library: parent.item.library, parent: parent.item.key, serverId: context.serverId, note, expectedVersion }));
  const journalPath = `.zotero/mcp/notes/${hash(requestId)}.json`;
  let previous = await readProjectText(context.root, journalPath);
  let key: string;
  let state = "prepared";
  if (previous) {
    const journal: unknown = JSON.parse(previous);
    if (!isRecord(journal) || journal.digest !== digest || !["prepared", "submitted", "complete"].includes(String(journal.state))) {
      throw new Error("This note requestId was used with different input. Reuse the original request and content.");
    }
    key = validateKey(journal.key);
    state = String(journal.state);
    let saved: ZoteroItemDetail | undefined;
    try { saved = await context.client.getItem(parent.item.library, key); }
    catch (error) {
      if (state !== "prepared" || !(error instanceof ZoteroError && error.status === 404)) {
        throw new Error(`The previous note outcome is unresolved for ${key}. Inspect Zotero; no second note will be created.`);
      }
    }
    if (saved) {
      const result = sourceNote(saved, parent.item.key);
      if (saved.serverId !== context.serverId || result.note !== note) throw new Error("The allocated note has changed. It will not be recreated.");
      await context.checkProject();
      return { status: "already-created" as const, library: parent.item.library, itemKey: parent.item.key, requestId, ...result, verified: true as const };
    }
  } else {
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    key = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  }
  if (parent.version !== expectedVersion || parent.serverId !== context.serverId) throw new ZoteroError("CONFLICT", "The source changed. Read its metadata again.");
  const save = async (next: string) => {
    const text = JSON.stringify({ digest, key, state: next });
    await writeProjectText(context.root, journalPath, text, previous);
    previous = text;
  };
  if (!previous) await save("prepared");
  const saved = await context.writer.createItem(parent.item.library, context.serverId, key,
    { itemType: "note", parentItem: parent.item.key, note, tags: [], relations: {} }, async () => {
      await context.checkProject();
      context.client.clearCache();
      const latest = await context.parent();
      if (latest.serverId !== context.serverId || latest.version !== expectedVersion || isTrashedData(latest.data)) {
        throw new ZoteroError("CONFLICT", "The source changed before creating the note. Read its metadata again.");
      }
      await context.checkProject();
      await save("submitted");
    }, () => save("prepared"));
  const result = sourceNote(saved, parent.item.key);
  if (saved.serverId !== context.serverId || result.note !== note) throw new Error(`The stored note could not be verified for ${key}. Inspect Zotero before retrying.`);
  await save("complete");
  return { status: "created" as const, library: parent.item.library, itemKey: parent.item.key, requestId, ...result, verified: true as const };
}
