import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ZoteroClient } from "../src/zotero/client";
import { ZoteroError, type ZoteroErrorCode } from "../src/shared/errors";

function hasCode(code: ZoteroErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof ZoteroError && error.code === code;
}

function json(value: unknown, headers?: ConstructorParameters<typeof Headers>[0]): Response {
  return new Response(JSON.stringify(value), { headers: new Headers(headers) });
}

test("Verbindungsprüfung verwendet den dokumentierten lokalen API-Einstieg", async () => {
  const client = new ZoteroClient({
    fetch: async (input, init) => {
      assert.equal(String(input), "http://localhost:23119/api/");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("Zotero-API-Version"), "3");
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response("Local API", {
        headers: { "Zotero-API-Version": "3", "Zotero-Server-ID": "test-instance" },
      });
    },
  });
  assert.deepEqual(await client.checkConnection(), {
    apiUrl: "http://localhost:23119/api/", apiVersion: "3", serverId: "test-instance",
  });
});

test("Ältere Zotero-Versionen benötigen keine Server-ID", async () => {
  const client = new ZoteroClient({
    fetch: async () => new Response(null, { headers: { "Zotero-API-Version": "3" } }),
  });
  assert.equal((await client.checkConnection()).serverId, undefined);
});

test("Fehlende und inkompatible API-Versionen werden abgelehnt", async () => {
  for (const version of [null, "4"]) {
    const client = new ZoteroClient({
      fetch: async () => new Response(null, { headers: version ? { "Zotero-API-Version": version } : {} }),
    });
    await assert.rejects(client.checkConnection(), hasCode("INVALID_RESPONSE"));
  }
});

test("Bibliotheken enthalten die persönliche Bibliothek und Gruppen", async () => {
  const calls: string[] = [];
  const client = new ZoteroClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname.endsWith("/items")) {
        assert.equal(url.searchParams.get("limit"), "1");
        return json([], { "Total-Results": "42" });
      }
      return json([{ id: 123, data: { name: "Forschungsgruppe" } }]);
    },
  });
  assert.deepEqual(await client.listLibraries(), [
    { type: "user", id: 0, name: "My library", itemCount: 42 },
    { type: "group", id: 123, name: "Forschungsgruppe" },
  ]);
  assert.deepEqual(calls, ["/api/users/0/items", "/api/users/0/groups"]);
});

test("Gruppen werden über mehrere Seiten vollständig gelesen", async () => {
  const offsets: number[] = [];
  const client = new ZoteroClient({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/items")) return json([]);
      const start = Number(url.searchParams.get("start"));
      offsets.push(start);
      return json(Array.from({ length: start === 0 ? 100 : 1 }, (_, index) => ({
        id: start + index + 1, data: { name: `Gruppe ${start + index + 1}` },
      })));
    },
  });
  assert.equal((await client.listLibraries()).length, 102);
  assert.deepEqual(offsets, [0, 100]);
});

test("Fehlende oder ungültige Eintragszahlen werden nicht erfunden", async () => {
  for (const total of [null, "NaN", "-2", "1.5"]) {
    const client = new ZoteroClient({
      fetch: async (input) => String(input).includes("/items?")
        ? json([], total === null ? {} : { "Total-Results": total }) : json([]),
    });
    assert.equal((await client.listLibraries())[0]?.itemCount, undefined);
  }
});

test("Nicht gestartetes Zotero liefert einen verständlichen Verbindungsfehler", async () => {
  const client = new ZoteroClient({ fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(client.checkConnection(), hasCode("UNAVAILABLE"));
});

test("Zeitlimit wird von einem Verbindungsfehler unterschieden", async () => {
  const client = new ZoteroClient({ fetch: async () => { throw new DOMException("timeout", "TimeoutError"); } });
  await assert.rejects(client.checkConnection(), hasCode("TIMEOUT"));
});

test("Die Anfrage wird beim konfigurierten Zeitlimit tatsächlich abgebrochen", async () => {
  const client = new ZoteroClient({
    timeoutMs: 100,
    fetch: async (_input, init) => {
      const signal = init?.signal;
      assert.ok(signal);
      await delay(1000, undefined, { signal });
      return new Response(null, { headers: { "Zotero-API-Version": "3" } });
    },
  });
  await assert.rejects(client.checkConnection(), hasCode("TIMEOUT"));
});

test("Deaktivierte lokale API liefert einen Hinweis auf die Zotero-Einstellung", async () => {
  const client = new ZoteroClient({ fetch: async () => new Response(null, { status: 403 }) });
  await assert.rejects(client.checkConnection(), (error: unknown) =>
    hasCode("FORBIDDEN")(error) && (error as Error).message.includes("Settings"));
});

test("Unerwartete HTTP-Statuscodes werden gemeldet", async () => {
  const client = new ZoteroClient({ fetch: async () => new Response(null, { status: 500 }) });
  await assert.rejects(client.checkConnection(), hasCode("HTTP_ERROR"));
});

test("Beschädigte JSON-Antworten und fehlerhafte Gruppenmetadaten werden erkannt", async () => {
  for (const body of ["kein JSON", "{}", '[{"id":1}]', '[{"id":"1","data":{"name":"Gruppe"}}]']) {
    const client = new ZoteroClient({
      fetch: async (input) => String(input).includes("/items?") ? json([]) : new Response(body),
    });
    await assert.rejects(client.listLibraries(), hasCode("INVALID_RESPONSE"));
  }
});

test("Nur lokale API-Adressen ohne Zugangsdaten sind zulässig", () => {
  for (const apiUrl of [
    "keine URL", "https://api.zotero.org/api/", "http://example.org/api/",
    "http://localhost:23119/connector/", "http://user:secret@localhost:23119/api/",
    "http://localhost:23119/api/?key=secret", "http://localhost:23119/api/#fragment",
  ]) {
    assert.throws(() => new ZoteroClient({ apiUrl }), hasCode("INVALID_CONFIG"));
  }
  for (const apiUrl of ["http://localhost:23119/api", "http://127.0.0.1:23119/api/", "http://[::1]:23119/api/"]) {
    assert.doesNotThrow(() => new ZoteroClient({ apiUrl }));
  }
});

test("Ungültige Zeitlimits werden vor der ersten Anfrage abgelehnt", () => {
  for (const timeoutMs of [0, -1, 99, 60001, 100.5, Number.NaN]) {
    assert.throws(() => new ZoteroClient({ timeoutMs }), hasCode("INVALID_CONFIG"));
  }
});
