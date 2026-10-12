# Implementierte MCP-Werkzeuge

Der eigenständige stdio-Einstieg `mcp/server.ts` registriert sechzehn Werkzeuge über
das offizielle TypeScript-SDK 2.3.1. Die gemeinsame Geschäftslogik liegt in
`src/zotero/projectService.ts`; sie importiert keine VS-Code-API.

| Werkzeug | Zweck |
| --- | --- |
| `zotero_list_libraries` | Bibliotheken für die Projekteinstellung anzeigen |
| `zotero_list_collections` | Sammlungen der konfigurierten Bibliothek anzeigen |
| `zotero_get_selected_collection` | Projektbindung und Schreibbereitschaft prüfen |
| `zotero_search` | Bibliografische Quellen im ausgewählten Scope durchsuchen |
| `zotero_get_metadata` | Eindeutige Quelle, Version, Sammlungen und Zitationswarnungen lesen |
| `zotero_get_item_schema` | Zulässige Felder, Erstellerrollen und Empfehlungen je Quellentyp aus der lokalen Zotero-Version lesen |
| `zotero_validate_metadata` | Feldstruktur prüfen und fehlende empfohlene Angaben melden; nur Typ und Titel sind Pflicht |
| `zotero_lookup_identifier` | DOI über Crossref/DataCite oder ISBN über Open Library als Metadatenvorschau auflösen |
| `zotero_import_identifier` | DOI-/ISBN-Quelle mit festem Zitierschlüssel und Herkunftsnachweis in die ausgewählte Sammlung aufnehmen |
| `zotero_check_duplicates` | Normalisierte DOI und bibliografische Übereinstimmungen prüfen |
| `zotero_create_item` | Validierte Quelle mit festem Zitierschlüssel, automatischer Sammlung und stabiler Anfrage-ID anlegen |
| `zotero_update_item` | Teilweise Metadatenänderungen validieren, versionsgeschützt schreiben und rücklesen |
| `zotero_list_attachments` | Anhänge einer Quelle im Projektscope ohne Dateizugriff auflisten |
| `zotero_attach_pdf` | Lokale PDF als gespeicherte Kopie anhängen, identische gespeicherte PDFs wiederverwenden und Dateibytes verifizieren |
| `zotero_get_attachment` | Lokalen PDF-Pfad und optional unveränderte PDF-Bytes als eingebettete MCP-Ressource zurückgeben |
| `zotero_delete_item` | Quelle versionsgeschützt in den wiederherstellbaren Papierkorb verschieben |

Schemas, Annotationen und Beschreibungen stehen direkt an den Registrierungen.
Ergebnisse haben `ok` und `result` bzw. `error`, ergänzt um MCP-Textinhalt.
Schreiben braucht eine ausdrückliche Benutzeranweisung oder Zustimmung zum
Vorschlag, konfigurierte Bibliothek, ausgewählte Sammlung, Server-ID und Zotero-Freigabe.
Der eigenständige Prozess speichert Zugangsschlüssel nur sitzungsbezogen im Speicher.

Einrichtung für Codex und Claude, Metadatenschema, Wiederholungsverhalten,
Papierkorbprüfung und Prüfgrenzen: [MCP-Dokumentation](../../docs/MCP.md).
PDFs werden ohne lokale Textextraktion, OCR oder Modellaufruf weitergegeben.
`includeContent=false` (Standard) liefert den geprüften lokalen Pfad; `true` ergänzt
eine eingebettete `application/pdf`-Ressource. Die Lesefähigkeit hängt vom MCP-Client
bzw. seinem Datei-/PDF-Werkzeug ab. PDF-Anhängen ist über `zotero_attach_pdf`
implementiert; Editorwerkzeuge sind noch nicht implementiert. Identifier-Recherche ist über
die beiden DOI-/ISBN-Werkzeuge verfügbar; sie lädt keine PDFs herunter.
