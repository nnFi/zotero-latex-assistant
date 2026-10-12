import type { ProjectConfig, ZoteroItem } from "../shared/types";
import { bibEntries } from "./importer";
import { legacyCitationKey, projectCitationKey } from "./keys";
import { isImportableItem } from "./selection";

export interface BibliographyPresence {
  readonly itemKeys: readonly string[];
  readonly citationKeys: Readonly<Record<string, string>>;
}

/** Include known project sources even after changing collections or going offline. */
export function projectBibliographyItems(config: ProjectConfig, items: readonly ZoteroItem[]): readonly ZoteroItem[] {
  if (!config.library) return items;
  const sources = new Map(items.filter((item) => item.library.type === config.library!.type && item.library.id === config.library!.id)
    .map((item) => [item.key, item]));
  for (const key of config.importedItemKeys) if (!sources.has(key)) sources.set(key, {
    key, library: config.library, itemType: "book", title: "", creators: [], date: "", doi: "", url: "",
  });
  return [...sources.values()];
}

/** Shared read-only lookup for list, citation preparation and metadata refresh. */
export async function resolveBibliographyPresence(config: ProjectConfig, items: readonly ZoteroItem[], bibliography: string,
  options: { resolvedKeys?: Readonly<Record<string, string>>; attemptedKeys?: Set<string>;
    lookup?: (keys: readonly string[]) => Promise<Readonly<Record<string, string>> | undefined>;
    onLookupError?: (error: unknown) => void } = {}): Promise<BibliographyPresence & { resolvedKeys: Readonly<Record<string, string>> }> {
  const sources = projectBibliographyItems(config, items);
  let resolvedKeys = options.resolvedKeys ?? {};
  let presence = bibliographyPresence(config, sources, bibliography, resolvedKeys);
  const known = new Set([...config.importedItemKeys.map((key) => projectCitationKey(config, key)), ...Object.values(presence.citationKeys)]);
  const unresolved = sources.filter((item) => isImportableItem(item) && !config.importedItemKeys.includes(item.key)
    && !presence.itemKeys.includes(item.key) && !options.attemptedKeys?.has(item.key));
  if (options.lookup && unresolved.length && bibEntries(bibliography).some((entry) => !known.has(entry.key))) {
    unresolved.forEach((item) => options.attemptedKeys?.add(item.key));
    try {
      resolvedKeys = { ...resolvedKeys, ...await options.lookup(unresolved.map((item) => item.key)) };
      presence = bibliographyPresence(config, sources, bibliography, resolvedKeys);
    } catch (error) { options.onLookupError?.(error); }
  }
  return { ...presence, resolvedKeys };
}

/** Exact keys determine presence, never the import list alone or a title similarity. */
export function bibliographyPresence(config: ProjectConfig, items: readonly ZoteroItem[], bibliography: string,
  resolvedKeys: Readonly<Record<string, string>> = {}): BibliographyPresence {
  const existing = new Set(bibEntries(bibliography).map((entry) => entry.key));
  const matches = new Map<string, string[]>();
  const candidates = new Map<string, readonly string[]>();
  for (const item of items) {
    if (!config.library || item.library.type !== config.library.type || item.library.id !== config.library.id || !isImportableItem(item)) continue;
    const persistent = config.citationKeys?.[item.key];
    // A persisted project key remains authoritative when Zotero / BBT has changed it.
    const keys = persistent || config.importedItemKeys.includes(item.key) ? [projectCitationKey(config, item.key)]
      : [...new Set([legacyCitationKey(config.library, item.key), item.citationKey, resolvedKeys[item.key]].filter((key): key is string => !!key))];
    candidates.set(item.key, keys);
    for (const key of keys) {
      if (!existing.has(key)) continue;
      matches.set(key, [...(matches.get(key) ?? []), item.key]);
    }
  }
  const citationKeys: Record<string, string> = {};
  for (const [itemKey, keys] of candidates) {
    const found = keys.filter((key) => existing.has(key) && matches.get(key)?.length === 1);
    if (found.length === 1) citationKeys[itemKey] = found[0]!;
  }
  return { itemKeys: Object.keys(citationKeys), citationKeys };
}
