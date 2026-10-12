import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ZoteroClient } from "../src/zotero/client";
import { RequestCoordinator } from "../src/zotero/requestCoordinator";
import { ZoteroError } from "../src/shared/errors";

const library = { type: "user" as const, id: 0 };
const item = { key: "ITEM0001", data: { itemType: "book", title: "Quelle" } };

test("Gleichzeitige gleiche Listenaufrufe über mehrere Clients verursachen nur eine Zotero-Anfrage", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; await delay(10); return new Response(JSON.stringify([item])); };
  const clients = [new ZoteroClient({ fetch }), new ZoteroClient({ fetch })];
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => clients[index % 2]!.listItems(library)));
  assert.equal(calls, 1);
  assert.equal(results.length, 20);
  assert.ok(results.every((result) => result[0]?.key === "ITEM0001"));
});

test("Verschiedene Anfragen werden auch über Loopback-Aliasse erst nach vollständigem Body nacheinander abgearbeitet", async () => {
  let active = 0; let maximum = 0;
  const fetch: typeof globalThis.fetch = async () => {
    active++; maximum = Math.max(maximum, active);
    return new Response(new ReadableStream({ async start(controller) {
      await delay(10); controller.enqueue(new TextEncoder().encode(JSON.stringify([item]))); controller.close(); active--;
    } }));
  };
  await Promise.all([new ZoteroClient({ fetch }).listItems(library, "ROOT0001"),
    new ZoteroClient({ fetch, apiUrl: "http://127.0.0.1:23119/api/" }).listItems(library, "ROOT0002")]);
  assert.equal(maximum, 1);
});

test("Manuelles Leeren des Caches liefert frische Metadaten, ohne andere Antwort-Bodies zu blockieren", async () => {
  let calls = 0;
  const client = new ZoteroClient({ fetch: async () => { calls++; return new Response(JSON.stringify([{ ...item, data: { ...item.data, title: String(calls) } }])); } });
  assert.equal((await client.listItems(library))[0]?.title, "1");
  assert.equal((await client.listItems(library))[0]?.title, "1");
  client.clearCache();
  assert.equal((await client.listItems(library))[0]?.title, "2");
  const root = new ZoteroClient({ fetch: async () => new Response("Local API", { headers: { "Zotero-API-Version": "3" } }) });
  await root.checkConnection(); await root.checkConnection();
});

test("Nach einem Verbindungsabbruch stoppen bereits wartende Anfragen statt Zotero erneut zu belasten", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; await delay(10); throw new Error("offline"); };
  const client = new ZoteroClient({ fetch });
  const results = await Promise.allSettled([client.listItems(library, "ROOT0001"), client.listItems(library, "ROOT0002"), client.listItems(library, "ROOT0003")]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(calls, 1);
});

test("Die Warteschlange wächst nicht unbegrenzt und Fehler blockieren keine späteren gültigen Anfragen", async () => {
  const coordinator = new RequestCoordinator();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests = Array.from({ length: 32 }, () => coordinator.schedule(async () => { await gate; return new Response("ok"); }));
  await assert.rejects(coordinator.schedule(async () => new Response("overflow")), (error: unknown) => error instanceof ZoteroError && error.code === "BUSY");
  release(); await Promise.all(requests);
  await assert.rejects(coordinator.schedule(async () => { throw new ZoteroError("HTTP_ERROR", "bad request"); }));
  assert.equal(await (await coordinator.schedule(async () => new Response("recovered"))).text(), "recovered");
});

test("Wiederholte volle Ergebnisseiten brechen den Abruf ab, statt endlos weitere Anfragen zu erzeugen", async () => {
  let calls = 0;
  const client = new ZoteroClient({ fetch: async () => { calls++; return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ ...item, key: String(index).padStart(8, "0") })))); } });
  await assert.rejects(client.listItems(library), /repeated result pages/);
  assert.equal(calls, 2);
});

test("Nach Cache-Leerung darf ein älterer laufender Abruf den neuen Cache nicht überschreiben", async () => {
  let calls = 0; let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = new ZoteroClient({ fetch: async () => { calls++; const call = calls; if (call === 1) await gate;
    return new Response(JSON.stringify([{ ...item, data: { ...item.data, title: String(call) } }])); } });
  const original = client.listItems(library);
  await delay(1); client.clearCache();
  const fresh = client.listItems(library);
  release(); await original;
  assert.equal((await fresh)[0]?.title, "2");
  assert.equal((await client.listItems(library))[0]?.title, "2");
});

test("Cache und Fehlerpause laufen ab, sodass neue manuelle Aktionen wieder frische Daten abrufen können", async () => {
  let now = 1000; let calls = 0;
  const coordinator = new RequestCoordinator(() => now);
  const read = () => coordinator.read("items", async () => new Response(String(++calls)));
  assert.equal(await (await read()).text(), "1");
  assert.equal(await (await read()).text(), "1");
  now += 30001;
  assert.equal(await (await read()).text(), "2");
  await assert.rejects(coordinator.schedule(async () => { throw new ZoteroError("UNAVAILABLE", "offline"); }));
  await assert.rejects(coordinator.schedule(async () => new Response("too soon")), /a few seconds/);
  now += 5001;
  assert.equal(await (await read()).text(), "3");
});
