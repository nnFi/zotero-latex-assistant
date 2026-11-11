import { lookup } from "node:dns";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import { safeUrl } from "./literature";
import { researchAgent, ResearchFailure } from "./providerRun";

const blocked = new BlockList();
for (const [prefix, length] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(prefix, length);
for (const [prefix, length] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) {
  blocked.addSubnet(prefix, length, "ipv6");
}
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address);
  return family === 6 && !address.includes("%") && globalIpv6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function publicTarget(url: URL) {
  if (!safeUrl(url.href)) throw new ResearchFailure("restricted", "The target is not a public HTTPS URL.");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if ((isIP(host) && !isPublicAddress(host)) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(host)
    || (!isIP(host) && !host.includes("."))) {
    throw new ResearchFailure("restricted", "The target is not a public HTTPS host.");
  }
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type DocumentRequest = (url: URL, signal: AbortSignal, openAlexKey?: string) => Promise<{ response: Response; url: URL }>;

function publicRequest(url: URL, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = {
      agent: false, signal, autoSelectFamily: false,
      headers: { Accept: "application/pdf, application/xml, text/html;q=0.9, */*;q=0.1", "User-Agent": researchAgent,
        "Accept-Encoding": "identity" },
      lookup: (host, _options, callback) => {
        lookup(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) { callback(error, "", 4); return; }
          const address = addresses.find((entry) => entry.family === 4) ?? addresses[0];
          if (!address || addresses.some((entry) => !isPublicAddress(entry.address))) {
            callback(new ResearchFailure("restricted", "The host resolves to a non-public address."), "", 4);
            return;
          }
          // Use the checked address for the connection while TLS still verifies the original hostname.
          callback(null, address.address, address.family);
        });
      },
    };
    const outgoing = request(url, options, (incoming) => {
      const status = incoming.statusCode ?? 500;
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
        else if (value !== undefined) headers.set(name, value);
      }
      const empty = status === 204 || status === 205 || status === 304;
      if (empty) incoming.resume();
      resolve(new Response(empty ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, { status, headers }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

export const getPublicDocument: DocumentRequest = async (initial, signal, key) => {
  let url = initial;
  for (let redirects = 0; ; redirects++) {
    publicTarget(url);
    const target = new URL(url);
    if (key && target.origin === "https://content.openalex.org") target.searchParams.set("api_key", key);
    const response = await publicRequest(target, signal);
    if (!redirectStatuses.has(response.status)) return { response, url };
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects >= 5) throw new ResearchFailure("incomplete", "The publication redirect could not be followed.");
    try { url = new URL(location, url); }
    catch { throw new ResearchFailure("incomplete", "The publication returned an invalid redirect."); }
    if (key) {
      url.searchParams.delete("api_key");
      if (url.href.includes(key) || url.href.includes(encodeURIComponent(key))) {
        throw new ResearchFailure("restricted", "The redirect contains an OpenAlex credential.");
      }
    }
  }
};
