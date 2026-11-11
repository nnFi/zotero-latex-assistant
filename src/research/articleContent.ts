import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { SaxesParser } from "saxes";
import { normalizedDoi } from "../biblatex/duplicates";
import { isRecord } from "../zotero/validation";
import { safeUrl, text } from "./literature";

export interface ArticleSection { heading: string | null; text: string }
type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

const omitted = /^(?:abstract|summary|keywords|references|bibliography|related content|supplementary (?:information|material))$/i;
const ignored = new Set(["script", "style", "noscript", "template", "nav", "aside", "form", "footer"]);

function toSections(blocks: { heading: boolean; text: string }[]): ArticleSection[] {
  const sections: ArticleSection[] = [];
  let heading: string | null = null;
  let paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.heading) {
      if (paragraphs.length) sections.push({ heading, text: paragraphs.join("\n\n") });
      heading = block.text;
      paragraphs = [];
    } else paragraphs.push(block.text);
  }
  if (paragraphs.length) sections.push({ heading, text: paragraphs.join("\n\n") });
  return sections;
}

export function xmlSections(source: string): ArticleSection[] {
  const blocks: { heading: boolean; text: string }[] = [];
  const stack: { skipped: boolean }[] = [];
  let bodyDepth = 0;
  let article = false;
  let block: { heading: boolean; text: string; depth: number } | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", ({ local, attributes }) => {
    const parent = stack.at(-1);
    const kind = attributes.type?.value ?? attributes["sec-type"]?.value ?? "";
    const skipped = Boolean(parent?.skipped) || omitted.test(kind)
      || ["abstract", "back", "listBibl", "ref-list", "fig", "table-wrap"].includes(local);
    stack.push({ skipped });
    if (stack.length === 1) article = local === "TEI" || local === "article";
    if (!article || skipped) return;
    if (local === "body" && !bodyDepth) bodyDepth = stack.length;
    if (bodyDepth && !block && ["head", "title", "p"].includes(local)) {
      block = { heading: local !== "p", text: "", depth: stack.length };
    }
  });
  const append = (value: string) => { if (block && !stack.at(-1)?.skipped) block.text += value; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (block?.depth === stack.length) {
      const value = block.text.replace(/\s+/g, " ").trim();
      if (value) blocks.push({ heading: block.heading, text: value });
      block = undefined;
    }
    if (bodyDepth === stack.length) bodyDepth = 0;
    stack.pop();
  });
  // No external entities or DTD loading. Saxes leaves document declarations uninterpreted.
  try { parser.write(source).close(); }
  catch { return []; }
  return toSections(blocks).filter((section) => !section.heading || !omitted.test(section.heading));
}

const attr = (node: Element, name: string) => node.attrs.find((entry) => entry.name === name)?.value ?? "";

function* elements(root: Node): Iterable<Element> {
  const queue = [root];
  while (queue.length) {
    const node = queue.pop()!;
    if ("tagName" in node) yield node;
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) queue.push(node.childNodes[i]!);
  }
}

function content(node: Node): string {
  const values: string[] = [];
  const queue = [node];
  while (queue.length) {
    const child = queue.pop()!;
    if ("tagName" in child && ignored.has(child.tagName)) continue;
    if ("value" in child) values.push(child.value);
    if ("childNodes" in child) for (let i = child.childNodes.length - 1; i >= 0; i--) queue.push(child.childNodes[i]!);
  }
  return values.join("").replace(/\s+/g, " ").trim();
}

function excluded(node: Element): boolean {
  for (let current: Node | null = node; current; current = "parentNode" in current ? current.parentNode : null) {
    if (!("tagName" in current)) continue;
    if (ignored.has(current.tagName) || current.attrs.some((entry) => entry.name === "hidden") || attr(current, "aria-hidden") === "true"
      || /(?:^|[\s_-])(?:abstract|bibliography|references|supplementary|related|paywall)(?:[\s_-]|$)/i.test(`${attr(current, "id")} ${attr(current, "class")}`)) return true;
  }
  return false;
}

function link(value: string, base: URL): string | null {
  try { return safeUrl(new URL(value, base).href); } catch { return null; }
}

function articleRestricted(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(articleRestricted);
  if (!isRecord(value)) return false;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return (types.some((type) => typeof type === "string" && /article$/i.test(type))
    && (value.isAccessibleForFree === false || text(value.isAccessibleForFree).toLowerCase() === "false"))
    || (Array.isArray(value["@graph"]) && value["@graph"].some(articleRestricted));
}

export function inspectHtml(html: string, url: URL) {
  const nodes = [...elements(parse(html))];
  const metadata = new Map<string, string[]>();
  const links = new Set<string>();
  const archives = new Set<string>();
  const add = (target: Set<string>, value: string) => {
    const resolved = value ? link(value, url) : null;
    if (resolved) target.add(resolved);
  };
  let restricted = false;
  for (const node of nodes) {
    if (node.tagName === "meta") {
      const name = (attr(node, "name") || attr(node, "property")).toLowerCase();
      const value = attr(node, "content");
      metadata.set(name, [...(metadata.get(name) ?? []), value]);
      if (name === "citation_fulltext_world_readable" && /^(?:false|no|0)$/i.test(value)) restricted = true;
      if (["citation_pdf_url", "citation_xml_url", "citation_fulltext_html_url"].includes(name)) add(links, value);
      if (name === "dc.identifier" && /\.pdf(?:[?#]|$)/i.test(value)) add(links, value);
    }
    if (node.tagName === "script" && attr(node, "type") === "application/ld+json") {
      try { restricted ||= articleRestricted(JSON.parse(node.childNodes.flatMap((child) => "value" in child ? [child.value] : []).join(""))); }
      catch { /* Optional metadata. */ }
    }
    if (attr(node, "itemprop").toLowerCase() === "isaccessibleforfree" && /^(?:false|no|0)$/i.test(attr(node, "content"))) restricted = true;
    const rel = attr(node, "rel").split(/\s+/);
    if (node.tagName === "link" && rel.includes("alternate") && /(?:pdf|xml)(?:$|;)/i.test(attr(node, "type"))) add(links, attr(node, "href"));
    if (node.tagName !== "a" || excluded(node)) continue;
    const label = content(node);
    if (/^(?:(?:download|view|read|open)\s+(?:the\s+)?)?(?:full[- ]text|pdf|full[- ]text\s+pdf|xml)(?:\s+\(pdf\))?$/i.test(label)) add(links, attr(node, "href"));
    if (/\b(?:repository|repositorium|conference archive|open access (?:copy|version))\b/i.test(label)) add(archives, attr(node, "href"));
  }
  const scopes = nodes.filter((node) => (attr(node, "itemprop") === "articleBody" ||
    /(?:^|[\s_-])(?:article[-_ ]?body|full[-_ ]?text|article__body)(?:[\s_-]|$)/i.test(`${attr(node, "id")} ${attr(node, "class")}`)) && !excluded(node));
  const candidates = scopes.length ? scopes : nodes.filter((node) => node.tagName === "article" && !excluded(node));
  const sections = [];
  if (!restricted) for (const candidate of candidates) {
    const blocks = [...elements(candidate)].filter((node) => /^(?:p|h[2-6])$/.test(node.tagName) && !excluded(node))
      .map((node) => ({ heading: node.tagName !== "p", text: content(node) })).filter((block) => block.text);
    const body = toSections(blocks).filter((section) => !section.heading || !omitted.test(section.heading));
    // Generic article elements also wrap abstracts and news cards. Require identifiable body sections.
    if (body.length && (scopes.length || body.some((section) => /\b(?:introduction|background|method(?:s|ology)?|results?|discussion|conclusions?|einleitung|methoden?|ergebnisse|diskussion)\b/i.test(section.heading ?? "")))) {
      sections.push(...body);
      break;
    }
  }
  return { sections, links: [...links], archives: [...archives], restricted,
    doi: (metadata.get("citation_doi") ?? []).map(normalizedDoi).find(Boolean) ?? null,
    title: metadata.get("citation_title")?.[0] || metadata.get("dc.title")?.[0],
    authors: metadata.get("citation_author")?.filter(Boolean) ?? [],
  };
}
