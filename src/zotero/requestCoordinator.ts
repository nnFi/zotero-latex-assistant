import { ZoteroError } from "../shared/errors";

interface StoredResponse {
  readonly body: ArrayBuffer | null;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
}

function restore(stored: StoredResponse): Response {
  return new Response(stored.body, { status: stored.status, statusText: stored.statusText, headers: stored.headers });
}

/** Ein gemeinsamer Kanal pro lokalem Server, auch über mehrere Client-Instanzen. */
export class RequestCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private unavailableUntil = 0;
  private readonly active = new Map<string, Promise<StoredResponse>>();
  private readonly cache = new Map<string, { response: StoredResponse; until: number }>();
  private generation = 0;

  constructor(private readonly now: () => number = Date.now) {}

  invalidate(): void { this.generation++; this.cache.clear(); }

  async read(key: string, action: () => Promise<Response>): Promise<Response> {
    const cached = this.cache.get(key);
    if (cached && cached.until > this.now()) return restore(cached.response);
    this.cache.delete(key);
    const generation = this.generation;
    const activeKey = `${generation}:${key}`;
    let request = this.active.get(activeKey);
    if (!request) {
      request = this.schedule(action).then(async (response): Promise<StoredResponse> => ({
        body: response.body === null ? null : await response.arrayBuffer(), status: response.status,
        statusText: response.statusText, headers: new Headers(response.headers),
      }));
      this.active.set(activeKey, request);
      void request.then((response) => {
        if (generation === this.generation) {
          // Rohdaten maximal kurz behalten; manuelles Aktualisieren leert den Cache.
          if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { response, until: this.now() + 30000 });
        }
      }, () => {}).finally(() => this.active.delete(activeKey));
    }
    // Unabhängige Bodies: das Abbrechen einer Antwort blockiert keinen Cache-/Parallel-Leser.
    return restore(await request);
  }

  async schedule(action: () => Promise<Response>): Promise<Response> {
    if (this.pending >= 32) throw new ZoteroError("BUSY", "Several Zotero requests are already queued. Wait for the current operation to finish.");
    this.pending++;
    const request = this.tail.then(async () => {
      if (this.now() < this.unavailableUntil) throw new ZoteroError("UNAVAILABLE", "Zotero is currently unavailable. Check Zotero and refresh again in a few seconds.");
      try { return await action(); }
      catch (error) {
        if (error instanceof ZoteroError && ["UNAVAILABLE", "TIMEOUT"].includes(error.code)) {
          this.unavailableUntil = this.now() + 5000;
          this.invalidate();
        }
        throw error;
      }
    });
    this.tail = request.then(() => {}, () => {}).finally(() => { this.pending--; });
    return request;
  }
}

const coordinators = new WeakMap<typeof globalThis.fetch, Map<string, RequestCoordinator>>();

export function coordinatorFor(fetch: typeof globalThis.fetch, url: URL): RequestCoordinator {
  let servers = coordinators.get(fetch);
  if (!servers) { servers = new Map(); coordinators.set(fetch, servers); }
  // localhost, IPv4 und IPv6 können dieselbe Zotero-Instanz ansprechen.
  const key = `loopback:${url.port || "80"}`;
  let coordinator = servers.get(key);
  if (!coordinator) { coordinator = new RequestCoordinator(); servers.set(key, coordinator); }
  return coordinator;
}
