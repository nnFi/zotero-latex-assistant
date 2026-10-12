# Implementierte MCP-Werkzeuge

Der eigenständige stdio-Einstieg `mcp/server.ts` registriert 28 Werkzeuge über
das offizielle TypeScript-SDK 2.3.1. Die gemeinsame Geschäftslogik liegt in
`src/zotero/projectService.ts`; sie importiert keine VS-Code-API.

| Werkzeug | Zweck |
| --- | --- |
| `zotero_list_libraries` | Bibliotheken für die Projekteinstellung anzeigen |
| `zotero_list_collections` | Sammlungen der konfigurierten Bibliothek anzeigen |
| `zotero_get_collection` | Sammlung, Version, Unter-Sammlungen und Löschsperre prüfen |
| `zotero_create_collection` | Sammlung oder Unter-Sammlung mit stabiler Anfrage-ID anlegen |
| `zotero_set_project_collection` | Projekt wie „Set library“ zuordnen bzw. Sammlung mit gesicherter Literatur-/Zitationsbereinigung wechseln |
| `zotero_delete_collection` | Nicht zugeordnete Sammlung versionsgeschützt löschen; zugeordnete Sammlung und ihre Vorfahren bleiben gesperrt |
| `zotero_get_selected_collection` | Projektbindung und Schreibbereitschaft prüfen |
| `zotero_search` | Bibliografische Quellen im ausgewählten Scope durchsuchen |
| `zotero_research` | Zotero und Projekt-.bib zuerst durchsuchen, danach bei Bedarf neue Identifier-Metadaten mit Herkunft verifizieren |
| `zotero_sync_bibliography` | Nur fehlende, ausdrücklich zitierte Quellen aus gespeicherten LaTeX-Dateien automatisch in die .bib übernehmen |
| `zotero_list_notes` | Notizschlüssel, Elternquelle und Versionen auflisten |
| `zotero_get_note` | Vollständigen gespeicherten HTML-Inhalt einer Quellennotiz lesen |
| `zotero_create_note` | Zusammenfassung oder eigene Gedanken mit stabiler Anfrage-ID bei einer Quelle speichern |
| `zotero_update_note` | Inhalt einer eindeutig ausgewählten Notiz versionsgeschützt ersetzen |
| `zotero_list_trash` | Wiederherstellbare Quellen im Projektscope mit Versionen und Sammlungen auflisten |
| `zotero_restore_item` | Eindeutig ausgewählte Quelle aus dem Papierkorb wiederherstellen und Zustand verifizieren |
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
Der Bib-Abgleich schreibt ausschließlich Projektdateien; ein Auftrag zum Schreiben
mit Zitationen umfasst deren automatische Übernahme. Er braucht keine Zotero-Schreibfreigabe.
Auch die Projektzuordnung schreibt ausschließlich Projektdateien. Für das Löschen
einer Sammlung muss zuerst erfolgreich von ihr weg gewechselt werden. Die Löschung
entfernt keine Quellen; Unter-Sammlungen benötigen einen ausdrücklichen Auftrag.
Der eigenständige Prozess speichert Zugangsschlüssel nur sitzungsbezogen im Speicher.

Einrichtung für Codex und Claude, Metadatenschema, Wiederholungsverhalten,
Papierkorbprüfung und Prüfgrenzen: [MCP-Dokumentation](../../docs/MCP.md).
PDFs werden ohne lokale Textextraktion, OCR oder Modellaufruf weitergegeben.
`includeContent=false` (Standard) liefert den geprüften lokalen Pfad; `true` ergänzt
eine eingebettete `application/pdf`-Ressource. Die Lesefähigkeit hängt vom MCP-Client
bzw. seinem Datei-/PDF-Werkzeug ab. PDF-Anhängen ist über `zotero_attach_pdf`
implementiert; Editorwerkzeuge sind noch nicht implementiert. Identifier-Recherche und
der wissenschaftliche Ablauf sind über `zotero_research` und die DOI-/ISBN-Werkzeuge
verfügbar; sie laden keine PDFs herunter.
