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
  const existing = new Set(bibEntries(bibliography).map((entry) => entry.key));
  const imported = new Set(config.importedItemKeys);
  let resolvedKeys = options.resolvedKeys ?? {};
  let presence = presenceFromKeys(config, sources, existing, imported, resolvedKeys);
  const known = new Set([...config.importedItemKeys.map((key) => projectCitationKey(config, key)), ...Object.values(presence.citationKeys)]);
  const present = new Set(presence.itemKeys);
  const unresolved = sources.filter((item) => isImportableItem(item) && !imported.has(item.key)
    && !present.has(item.key) && !options.attemptedKeys?.has(item.key));
  if (options.lookup && unresolved.length && [...existing].some((key) => !known.has(key))) {
    unresolved.forEach((item) => options.attemptedKeys?.add(item.key));
    try {
      resolvedKeys = { ...resolvedKeys, ...await options.lookup(unresolved.map((item) => item.key)) };
      presence = presenceFromKeys(config, sources, existing, imported, resolvedKeys);
    } catch (error) { options.onLookupError?.(error); }
  }
  return { ...presence, resolvedKeys };
}

/** Exact keys determine presence, never the import list alone or a title similarity. */
export function bibliographyPresence(config: ProjectConfig, items: readonly ZoteroItem[], bibliography: string,
  resolvedKeys: Readonly<Record<string, string>> = {}): BibliographyPresence {
  const existing = new Set(bibEntries(bibliography).map((entry) => entry.key));
  return presenceFromKeys(config, items, existing, new Set(config.importedItemKeys), resolvedKeys);
}

function presenceFromKeys(config: ProjectConfig, items: readonly ZoteroItem[], existing: ReadonlySet<string>,
  imported: ReadonlySet<string>, resolvedKeys: Readonly<Record<string, string>>): BibliographyPresence {
  const matches = new Map<string, number>();
  const candidates = new Map<string, readonly string[]>();
  for (const item of items) {
    if (!config.library || item.library.type !== config.library.type || item.library.id !== config.library.id || !isImportableItem(item)) continue;
    const persistent = config.citationKeys?.[item.key];
    // A persisted project key remains authoritative when Zotero / BBT has changed it.
    const keys = persistent || imported.has(item.key) ? [projectCitationKey(config, item.key)]
      : [...new Set([legacyCitationKey(config.library, item.key), item.citationKey, resolvedKeys[item.key]].filter((key): key is string => !!key))];
    candidates.set(item.key, keys);
    for (const key of keys) {
      if (!existing.has(key)) continue;
      matches.set(key, (matches.get(key) ?? 0) + 1);
    }
  }
  const citationKeys: Record<string, string> = {};
  for (const [itemKey, keys] of candidates) {
    const found = keys.filter((key) => existing.has(key) && matches.get(key) === 1);
    if (found.length === 1) citationKeys[itemKey] = found[0]!;
  }
  return { itemKeys: Object.keys(citationKeys), citationKeys };
}
