import { createHash, randomInt } from "node:crypto";
import { readProjectText, writeProjectText } from "../config/project";
import type { ZoteroCollection, ZoteroCollectionDetail } from "../shared/types";
import { ZoteroError } from "../shared/errors";
import { isRecord, isTrashedData, validateKey } from "./validation";
import type { ZoteroClient } from "./client";
import type { ZoteroWriter } from "./writer";

export function collectionSubtree(collections: readonly ZoteroCollection[], key: string): readonly string[] {
  const children = new Map<string, string[]>();
  for (const collection of collections) if (collection.parentKey) {
    children.set(collection.parentKey, [...children.get(collection.parentKey) ?? [], collection.key]);
  }
  const found = new Set<string>();
  const visit = (current: string) => {
    if (found.has(current)) throw new ZoteroError("INVALID_RESPONSE", "Invalid cyclic collection hierarchy.");
    found.add(current);
    for (const child of children.get(current) ?? []) visit(child);
  };
  visit(key);
  return [...found].sort();
}

export function assertCollectionDeletionAllowed(affected: readonly string[], assignedKey: string): void {
  if (assignedKey && affected.includes(assignedKey)) {
    throw new ZoteroError("FORBIDDEN", "This collection is assigned to the project or contains its assigned collection. Assign a different collection with zotero_set_project_collection first, then delete it.");
  }
}

interface CreateContext {
  root: string;
  client: ZoteroClient;
  writer: ZoteroWriter;
  library: ZoteroCollection["library"];
  serverId: string;
  checkProject: () => Promise<void>;
}

export async function createProjectCollection(context: CreateContext, name: string, parentKey: string | null, requestId: string) {
  name = name.trim();
  if (!name || name.length > 1000 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Supply a collection name up to 1000 characters without control characters.");
  if (parentKey) validateKey(parentKey);
  if (requestId.length < 8 || requestId.length > 200) throw new Error("Supply a stable requestId of 8–200 characters.");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const digest = hash(JSON.stringify({ library: context.library, serverId: context.serverId, name, parentKey }));
  const journalPath = `.zotero/mcp/collections/${hash(requestId)}.json`;
  let previous = await readProjectText(context.root, journalPath);
  let key: string;
  let state = "prepared";
  if (previous) {
    const journal: unknown = JSON.parse(previous);
    if (!isRecord(journal) || journal.digest !== digest || !["prepared", "submitted", "complete"].includes(String(journal.state))) {
      throw new Error("This collection requestId was used with different input. Reuse its original name, parent and scope.");
    }
    key = validateKey(journal.key); state = String(journal.state);
    let saved: ZoteroCollectionDetail | undefined;
    try { saved = await context.client.getCollectionDetail(context.library, key); }
    catch (error) {
      if (state !== "prepared" || !(error instanceof ZoteroError && error.code === "HTTP_ERROR" && error.status === 404)) {
        throw new Error(`The previous collection outcome is unresolved for ${key}. Inspect Zotero; no second collection will be created.`);
      }
    }
    if (saved) {
      if (saved.serverId !== context.serverId || isTrashedData(saved.data) || saved.collection.name !== name || saved.collection.parentKey !== parentKey) {
        throw new Error("The reserved collection has changed. It will not be recreated.");
      }
      await context.checkProject();
      return { ...saved, status: "already-created" as const, requestId, verified: true as const, projectFilesChanged: false as const };
    }
  } else {
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    key = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  }
  const parent = parentKey ? await context.client.getCollectionDetail(context.library, parentKey) : undefined;
  if (parent && (isTrashedData(parent.data) || parent.serverId !== context.serverId)) throw new Error("The parent collection is not available in this Zotero database.");
  const save = async (next: string) => {
    const text = JSON.stringify({ digest, key, state: next });
    await writeProjectText(context.root, journalPath, text, previous); previous = text;
  };
  if (!previous) await save("prepared");
  const saved = await context.writer.createCollection(context.library, context.serverId, key, name, parentKey, async () => {
    await context.checkProject(); context.client.clearCache();
    await context.client.checkConnection();
    if (parentKey) {
      const latest = await context.client.getCollectionDetail(context.library, parentKey);
      if (latest.version !== parent!.version || latest.serverId !== context.serverId || isTrashedData(latest.data)) {
        throw new ZoteroError("CONFLICT", "The parent collection changed before creation. Review it again.");
      }
    }
    await context.checkProject(); await save("submitted");
  }, () => save("prepared"));
  if (saved.serverId !== context.serverId || saved.collection.name !== name || saved.collection.parentKey !== parentKey || isTrashedData(saved.data)) {
    throw new Error(`Collection ${key} could not be verified. Inspect Zotero before retrying.`);
  }
  await save("complete");
  return { ...saved, status: "created" as const, requestId, verified: true as const, projectFilesChanged: false as const };
}
