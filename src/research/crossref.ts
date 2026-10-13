import { APP_VERSION } from "../shared/version";
import { isRecord } from "../zotero/validation";

export interface DoiResult {
  readonly doi: string;
  readonly title: string;
  readonly authors: string;
  readonly publisher: string;
  readonly data: Record<string, unknown>;
}

export function normalizeDoi(input: string): string {
  let doi = input.trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  try { doi = decodeURIComponent(doi); } catch { throw new Error("The DOI contains invalid URL encoding."); }
  if (!/^10\.\d{4,9}\/\S+$/i.test(doi) || /[\x00-\x20]/.test(doi)) throw new Error("Enter a DOI such as 10.1038/nature12373 or a doi.org URL.");
  return doi;
}

function resultFrom(value: unknown): DoiResult {
  if (!isRecord(value) || typeof value.DOI !== "string" || !Array.isArray(value.title)
    || typeof value.title[0] !== "string") throw new Error("Crossref returned incomplete metadata.");
  const authors = Array.isArray(value.author) ? value.author.filter(isRecord)
    .map((author) => [author.given, author.family].filter((part) => typeof part === "string").join(" ")).join(", ") : "";
  return { doi: normalizeDoi(value.DOI), title: value.title[0], authors,
    publisher: typeof value.publisher === "string" ? value.publisher : "", data: value };
}

export class CrossrefClient {
  constructor(private readonly fetch: typeof globalThis.fetch = globalThis.fetch) {}

  async search(input: string): Promise<readonly DoiResult[]> {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Enter a DOI or a title.");
    const isDoi = /^(?:10\.|doi:|https?:\/\/(?:dx\.)?doi\.org\/)/i.test(trimmed);
    const url = isDoi
      ? new URL(`https://api.crossref.org/works/${encodeURIComponent(normalizeDoi(trimmed))}`)
      : new URL("https://api.crossref.org/works");
    if (!isDoi) { url.searchParams.set("query.bibliographic", trimmed); url.searchParams.set("rows", "10"); }
    let response: Response;
    try {
      response = await this.fetch(url, { headers: { Accept: "application/json", "User-Agent": `ZoteroLaTeXAssistant/${APP_VERSION}` },
        signal: AbortSignal.timeout(15000), redirect: "error" });
    } catch { throw new Error("Crossref is unavailable or the request timed out."); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status === 404 ? "This DOI was not found at Crossref. It may belong to another registration agency."
        : response.status === 429 ? "Crossref is limiting requests. Please retry later."
          : `Crossref request failed (HTTP ${response.status}).`);
    }
    const json: unknown = await response.json();
    if (!isRecord(json) || !isRecord(json.message)) throw new Error("Invalid Crossref response.");
    if (isDoi) {
      const result = resultFrom(json.message);
      if (result.doi.toLowerCase() !== normalizeDoi(trimmed).toLowerCase()) throw new Error("The returned DOI does not match the search.");
      return [result];
    }
    if (!Array.isArray(json.message.items)) throw new Error("Crossref did not return a result list.");
    return json.message.items.filter((item: unknown) => isRecord(item) && Array.isArray(item.title) && item.title.length > 0).map(resultFrom);
  }
}
