import * as vscode from "vscode";
import type { ZoteroClientOptions } from "../zotero/client";
import type { ProjectSettings } from "../shared/types";

export const CONFIG_SECTION = "zoteroLatexAssistant";

export type BibliographyExporter = "better-biblatex" | "native";

export function getBibliographyExporter(resource: vscode.Uri): BibliographyExporter {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION, resource).get<string>("bibliographyExporter", "better-biblatex");
  if (value !== "better-biblatex" && value !== "native") throw new Error("Choose better-biblatex or native for zoteroLatexAssistant.bibliographyExporter.");
  return value;
}

export function getClientOptions(): ZoteroClientOptions {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    apiUrl: config.get<string>("apiUrl", "http://localhost:23119/api/"),
    timeoutMs: config.get<number>("requestTimeoutMs", 5000),
  };
}

/** Resource-Scope hält spätere Projekt-Einstellungen auch bei mehreren Ordnern getrennt. */
export function getProjectSettings(resource: vscode.Uri): ProjectSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
  return {
    library: {
      type: config.get<"user" | "group">("libraryType", "user"),
      id: config.get<number>("libraryId", 0),
    },
    collectionKey: config.get<string>("collectionKey", ""),
    bibFile: config.get<string>("bibFile", "literatur.bib"),
    citationCommand: config.get<ProjectSettings["citationCommand"]>("citationCommand", "autocite"),
  };
}
