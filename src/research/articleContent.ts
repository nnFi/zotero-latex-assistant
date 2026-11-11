import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { SaxesParser } from "saxes";
import { normalizedDoi } from "../biblatex/duplicates";
import { isRecord } from "../zotero/validation";
import { text } from "./literature";
import { safeUrl } from "./providerRun";

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
  const skippedTags: boolean[] = [];
  let bodyDepth = 0;
  let article = false;
  let block: { heading: boolean; text: string; depth: number } | undefined;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", ({ local, attributes }) => {
    const kind = attributes.type?.value ?? attributes["sec-type"]?.value ?? "";
    const skipped = skippedTags.at(-1) === true || omitted.test(kind)
      || ["abstract", "back", "listBibl", "ref-list", "fig", "table-wrap"].includes(local);
    skippedTags.push(skipped);
    if (skippedTags.length === 1) article = local === "TEI" || local === "article";
    if (!article || skipped) return;
    if (local === "body" && !bodyDepth) bodyDepth = skippedTags.length;
    if (bodyDepth && !block && ["head", "title", "p"].includes(local)) {
      block = { heading: local !== "p", text: "", depth: skippedTags.length };
    }
  });
  const append = (value: string) => { if (block && !skippedTags.at(-1)) block.text += value; };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    if (block?.depth === skippedTags.length) {
      const value = block.text.replace(/\s+/g, " ").trim();
      if (value) blocks.push({ heading: block.heading, text: value });
      block = undefined;
    }
    if (bodyDepth === skippedTags.length) bodyDepth = 0;
    skippedTags.pop();
  });
  // No external entities or DTD loading. Saxes leaves document declarations uninterpreted.
  try { parser.write(source).close(); }
  catch { return []; }
  return toSections(blocks).filter((section) => !section.heading || !omitted.test(section.heading));
}

const attr = (node: Element, name: string) => node.attrs.find((entry) => entry.name === name)?.value ?? "";
const isElement = (node: Node): node is Element => "tagName" in node;
const idAndClass = (node: Element) => `${attr(node, "id")} ${attr(node, "class")}`;

function hidden(node: Element): boolean {
  return ignored.has(node.tagName) || node.attrs.some(({ name }) => name === "hidden") || attr(node, "aria-hidden") === "true"
    || /(?:^|[\s_-])(?:abstract|bibliography|references|supplementary|related|paywall)(?:[\s_-]|$)/i.test(idAndClass(node));
}

function* walk(root: Node, visibleOnly = false): Iterable<Node> {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (visibleOnly && isElement(node) && hidden(node)) continue;
    yield node;
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]!);
  }
}

function content(node: Node): string {
  const values: string[] = [];
  for (const child of walk(node, true)) {
    if ("value" in child) values.push(child.value);
  }
  return values.join("").replace(/\s+/g, " ").trim();
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
  const root = parse(html);
  const links = new Set<string>();
  const archives = new Set<string>();
  const authors: string[] = [];
  let doi: string | undefined, title: string | undefined, dcTitle: string | undefined;
  const add = (target: Set<string>, value: string) => {
    const resolved = value ? link(value, url) : null;
    if (resolved) target.add(resolved);
  };
  let restricted = false;
  for (const node of walk(root)) {
    if (!isElement(node)) continue;
    if (node.tagName === "meta") {
      const name = (attr(node, "name") || attr(node, "property")).toLowerCase();
      const value = attr(node, "content");
      if (name === "citation_doi") doi ??= normalizedDoi(value);
      if (name === "citation_title") title ??= value;
      if (name === "dc.title") dcTitle ??= value;
      if (name === "citation_author" && value) authors.push(value);
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
  }
  const scopes: Element[] = [];
  const articles: Element[] = [];
  for (const node of walk(root, true)) {
    if (!isElement(node)) continue;
    if (attr(node, "itemprop") === "articleBody" ||
      /(?:^|[\s_-])(?:article[-_ ]?body|full[-_ ]?text|article__body)(?:[\s_-]|$)/i.test(idAndClass(node))) scopes.push(node);
    if (node.tagName === "article") articles.push(node);
    if (node.tagName !== "a") continue;
    const label = content(node);
    if (/^(?:(?:download|view|read|open)\s+(?:the\s+)?)?(?:full[- ]text|pdf|full[- ]text\s+pdf|xml)(?:\s+\(pdf\))?$/i.test(label)) add(links, attr(node, "href"));
    if (/\b(?:repository|repositorium|conference archive|open access (?:copy|version))\b/i.test(label)) add(archives, attr(node, "href"));
  }
  const candidates = scopes.length ? scopes : articles;
  const sections = [];
  if (!restricted) for (const candidate of candidates) {
    const blocks = [...walk(candidate, true)].filter(isElement).filter((node) => /^(?:p|h[2-6])$/.test(node.tagName))
      .map((node) => ({ heading: node.tagName !== "p", text: content(node) })).filter((block) => block.text);
    const body = toSections(blocks).filter((section) => !section.heading || !omitted.test(section.heading));
    // Generic article elements also wrap abstracts and news cards. Require identifiable body sections.
    if (body.length && (scopes.length || body.some((section) => /\b(?:introduction|background|method(?:s|ology)?|results?|discussion|conclusions?|einleitung|methoden?|ergebnisse|diskussion)\b/i.test(section.heading ?? "")))) {
      sections.push(...body);
      break;
    }
  }
  return { sections, links: [...links], archives: [...archives], restricted, doi: doi ?? null, title: title || dcTitle, authors };
}
