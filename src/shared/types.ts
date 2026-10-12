/** Transportneutral: keine Abhängigkeit von der VS-Code-API. */
export interface LibraryRef {
  readonly type: "user" | "group";
  readonly id: number;
}

/** Expected database for sources selected in an already-open view. */
export interface ZoteroDatabaseBinding {
  readonly serverId: string | undefined;
}

export interface ZoteroLibrary extends LibraryRef {
  readonly name: string;
  readonly itemCount?: number;
}

export interface ZoteroCollection {
  readonly library: LibraryRef;
  readonly key: string;
  readonly name: string;
  readonly parentKey: string | null;
}

export interface ZoteroCreator {
  readonly creatorType: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly name: string;
}

export interface ZoteroItem {
  readonly library: LibraryRef;
  readonly key: string;
  readonly itemType: string;
  readonly title: string;
  readonly creators: readonly ZoteroCreator[];
  readonly date: string;
  readonly doi: string;
  readonly url: string;
  readonly citationKey?: string;
}

export type AttachmentKind = "pdf" | "image" | "document" | "ebook" | "web" | "link" | "audio" | "video" | "archive" | "file";

export interface ZoteroAttachment {
  readonly key: string;
  readonly parentKey: string | null;
  readonly title: string;
  readonly filename: string;
  readonly contentType: string;
  readonly kind: AttachmentKind;
}

export interface ZoteroConnectionInfo {
  readonly apiUrl: string;
  readonly apiVersion: string;
  readonly serverId?: string;
}

export interface ProjectSettings {
  readonly library: LibraryRef;
  readonly collectionKey: string;
  readonly bibFile: string;
  readonly citationCommand: "autocite" | "parencite" | "textcite";
}

export interface ProjectConfig extends Omit<ProjectSettings, "library"> {
  readonly library: LibraryRef | null;
  readonly version: 1;
  readonly citationStyle: string;
  readonly citationStyleType?: "biblatex";
  readonly citationLocale?: string;
  readonly importedItemKeys: readonly string[];
  readonly citationKeys?: Readonly<Record<string, string>>;
  readonly serverId?: string;
}

export interface ZoteroItemDetail {
  readonly item: ZoteroItem;
  readonly version: number;
  readonly data: Record<string, unknown>;
  readonly serverId?: string;
}

export interface CitationStyle {
  readonly id: string;
  readonly title: string;
  readonly locale?: string;
  readonly parentId?: string;
  readonly language?: import("../biblatex/language").CitationLanguage;
}
