import { setTimeout as delay } from "node:timers/promises";
import { APP_VERSION } from "../shared/version";
import { isRecord } from "../zotero/validation";

export const researchStatuses = ["ok", "not-found", "unavailable", "skipped", "mismatch", "incomplete", "ambiguous", "restricted"] as const;
export type ResearchStatus = typeof researchStatuses[number];
export interface ResearchEvidence {
  provider: string;
  status: ResearchStatus;
  sourceUrl: string;
  checkedAt: string;
  reason: string;
}

export class ResearchFailure extends Error {
  constructor(readonly status: ResearchStatus, message: string, readonly retryable = false) { super(message); }
}

export const researchAgent = `ZoteroLaTeXAssistant/${APP_VERSION}`;
export const redirectStatuses: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid provider record.");
  return value;
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

export async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.length;
      if (size > limit) throw new ResearchFailure("incomplete", "Response exceeds the size limit.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
}

function retryDelay(value: string | null): number {
  if (!value) return 250;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(ms) ? 250 : Math.max(ms, 250);
}

export function evidence(provider: string, sourceUrl: string, status: ResearchStatus, reason: string): ResearchEvidence {
  return { provider, sourceUrl, status, reason, checkedAt: new Date().toISOString() };
}

/** One instance per operation or paged bibliography. Calls within an instance are sequential. */
export class ProviderRun {
  private readonly unavailable = new Set<string>();
  constructor(readonly fetch: typeof globalThis.fetch = globalThis.fetch, readonly openAlexKey = process.env.OPENALEX_API_KEY?.trim()) {}

  async request<T>(provider: string, url: URL, load: (signal: AbortSignal) => Promise<Response>,
    parse: (response: Response) => Promise<T>, { deadline, document = false }: { deadline?: AbortSignal; document?: boolean } = {}) {
    const result = (status: ResearchStatus, reason: string, value: T | null = null) =>
      ({ evidence: evidence(provider, url.href, status, reason), value });
    if (this.unavailable.has(provider)) return result("skipped", "Provider is unavailable for this run.");
    for (let attempt = 0; attempt < 2; attempt++) {
      if (deadline?.aborted) return result("incomplete", "The operation reached its time limit.");
      const timeout = AbortSignal.timeout(document ? 9000 : 5000);
      const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout;
      let wait = 250;
      let reason: string;
      try {
        const response = await load(signal);
        if (response.ok) return result("ok", "", await parse(response));
        await response.body?.cancel();
        const status = response.status;
        if ((status === 404 || status === 410) && provider !== "pubcheck") return result("not-found", `HTTP ${status}.`);
        if (document && [401, 402, 403, 451].includes(status)) return result("restricted", `HTTP ${status}.`);
        if (status === 408 || status === 429 || status >= 500) wait = retryDelay(response.headers.get("retry-after"));
        else wait = Infinity;
        reason = `Provider returned HTTP ${status}.`;
      } catch (error) {
        if (error instanceof ResearchFailure && error.status !== "unavailable") return result(error.status, error.message);
        if (deadline?.aborted) return result("incomplete", "The operation reached its time limit.");
        reason = error instanceof ResearchFailure ? error.message
          : signal.aborted ? "Request timed out." : "Provider request failed.";
        if (error instanceof ResearchFailure && !error.retryable) wait = Infinity;
      }
      if (attempt || wait > 2000) {
        this.unavailable.add(provider);
        return result("unavailable", reason);
      }
      await delay(wait, undefined, deadline ? { signal: deadline } : {}).catch((error: unknown) => {
        if (!deadline?.aborted) throw error;
      });
    }
    throw new Error("Invalid request retry state.");
  }

  json<T>(provider: string, url: URL, parse: (body: unknown) => T, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", researchAgent);
    if (provider === "openalex" && url.origin === "https://api.openalex.org" && this.openAlexKey) {
      headers.set("Authorization", `Bearer ${this.openAlexKey}`);
    }
    return this.request(provider, url, async (signal) => {
      if (provider !== "openalex") return this.fetch(url, { ...init, headers, signal, redirect: "error" });
      let target = url;
      for (let redirects = 0; ; redirects++) {
        const response = await this.fetch(target, { ...init, headers, signal, redirect: "manual" });
        if (!redirectStatuses.has(response.status)) return response;
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location || redirects >= 4) throw new ResearchFailure("unavailable", "Unexpected provider redirect.");
        target = new URL(location, target);
        if (target.origin !== url.origin || target.username || target.password) throw new ResearchFailure("unavailable", "Unexpected provider redirect.");
      }
    }, async (response) => {
      const body = await readLimited(response, 2 * 1024 * 1024);
      try { return parse(JSON.parse(body.toString("utf8"))); }
      catch (error) {
        if (error instanceof ResearchFailure) throw error;
        throw new ResearchFailure("unavailable", "Provider returned an invalid response.");
      }
    }, init.signal ? { deadline: init.signal } : undefined);
  }
}
