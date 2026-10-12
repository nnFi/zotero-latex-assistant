# Projektauftrag: Zotero LaTeX Assistant

## 1. Projektziel

Entwickle eine eigenständige, lokal nutzbare Visual-Studio-Code-Extension mit dem Namen **Zotero LaTeX Assistant**.

Die Extension soll Zotero, LaTeX und das in VS Code verwendete KI-Sprachmodell miteinander verbinden.

Sie soll zwei voneinander unabhängige Funktionsbereiche besitzen:

1. **Klassische Zotero-Integration:** Literatur verwalten, suchen, auswählen, importieren und in LaTeX zitieren, vollständig ohne KI.
2. **KI-Integration über MCP:** Dem Sprachmodell ermöglichen, Zotero-Sammlungen zu durchsuchen, vorhandene PDFs zu analysieren, wissenschaftliche Literatur zu recherchieren und neue Quellen einschließlich verfügbarer PDFs in ausgewählte Zotero-Sammlungen aufzunehmen.

Die Extension soll langfristig ein vollständiger wissenschaftlicher Literaturassistent für die Arbeit mit LaTeX werden, ohne Zotero als Literaturverwaltung zu ersetzen.

## 2. Entwicklungsumgebung

- Betriebssystem: Fedora Linux
- Editor: Visual Studio Code
- Programmiersprache: TypeScript
- Laufzeit: Node.js
- Paketmanager: npm
- Extension API: VS Code Extension API
- KI-Schnittstelle: Model Context Protocol (MCP)
- Zotero: Lokale Zotero-Desktopinstallation
- Literaturformat: BibLaTeX mit Biber
- Versionsverwaltung: Git

Nutze möglichst offizielle APIs und etablierte Open-Source-Bibliotheken.

Erstelle eine saubere, modulare Architektur mit klarer Trennung zwischen Oberfläche, Zotero-Anbindung, Literaturimport, PDF-Verarbeitung und KI-Schnittstelle.

Die Erweiterung muss ohne Cloud-Dienst für lokale Bibliotheksfunktionen nutzbar sein. Externe Literaturrecherche und cloudbasierte Sprachmodelle dürfen Internetzugriff benötigen.

## 3. Zotero-Anbindung

Verbinde die Extension mit Zotero über die offizielle lokale API, soweit diese die erforderlichen Operationen unterstützt.

Standardadresse:

`http://localhost:23119/api/`

Implementiere mindestens:

- Verbindung zum lokalen Zotero prüfen.
- Alle verfügbaren Bibliotheken und Sammlungen anzeigen.
- Hierarchische Sammlungsstrukturen berücksichtigen.
- Sammlungen auswählen und durchsuchen.
- Einträge anhand von Titel, Autor, DOI, Jahr und Schlagwörtern suchen.
- Bibliografische Metadaten abrufen.
- Zugehörige PDF-Anhänge identifizieren und öffnen.
- Neue Literaturdatensätze erstellen.
- Bestehende Datensätze ergänzen.
- Literatur zu ausgewählten Sammlungen hinzufügen.
- Vorhandene Quellen vor dem Import auf Duplikate prüfen.

Prüfe anhand der aktuellen offiziellen Zotero-Dokumentation, welche Schreiboperationen die lokale API unterstützt. Implementiere keine undokumentierten Endpunkte auf Verdacht.

Falls bestimmte Operationen lokal nicht verfügbar sind, verwende einen klar gekapselten alternativen Adapter, beispielsweise die offizielle Zotero Web API mit entsprechender Authentifizierung.

Greife nicht schreibend auf die Zotero-SQLite-Datenbank zu.

## 4. Zotero-Sammlung pro VS-Code-Projekt

Jedes VS-Code-Projekt soll mit einer bestimmten Zotero-Sammlung verknüpft werden können.

Beispiel:

- VS-Code-Projekt: `Masterarbeit`
- Zotero-Bibliothek: `Meine Bibliothek`
- Zotero-Sammlung: `Masterarbeit / Sentimentanalyse`
- Literaturdatei: `literatur.bib`

Speichere diese Konfiguration projektbezogen, möglichst in `.vscode/settings.json`.

Die Auswahl muss über die Oberfläche veränderbar sein.

Sämtliche Zotero-Schreiboperationen der KI sollen standardmäßig auf die ausgewählte Sammlung beschränkt sein.

Falls noch keine Sammlung ausgewählt wurde, darf die KI nicht ungefragt in irgendeine Sammlung schreiben.

## 5. Oberfläche innerhalb von VS Code

Erstelle eine eigene Ansicht in der VS-Code-Seitenleiste mit dem Namen **Zotero**.

Die Ansicht soll enthalten:

- Bibliotheks- und Sammlungsauswahl
- Suchfeld für Literatur
- Liste der gefundenen Einträge
- Anzeige von Titel, Autoren, Jahr und DOI
- Kennzeichnung verfügbarer PDFs
- Aktionen zum Öffnen von Quellen
- Aktion zum Importieren in BibLaTeX
- Aktion zum Einfügen einer LaTeX-Zitation
- Aktion zur Analyse eines PDFs durch das Sprachmodell
- Aktualisierungsfunktion

Bevorzuge native VS-Code-Komponenten wie TreeView, QuickPick und Commands. Verwende Webviews nur, wenn ihre zusätzlichen Möglichkeiten tatsächlich erforderlich sind.

Die Oberfläche soll sich automatisch an das aktive VS-Code-Farbschema anpassen.

## 6. Integration in LaTeX und BibLaTeX

Die Extension soll Literaturdatensätze aus Zotero in eine konfigurierbare `.bib`-Datei des geöffneten Projekts importieren können.

Nutze vorzugsweise **Better BibTeX for Zotero** für den Export bibliografischer Einträge und die Verwaltung stabiler Citation Keys.

Implementiere:

- Konfiguration des Pfads zur `.bib`-Datei
- Import einzelner ausgewählter Quellen
- Import mehrerer markierter Quellen
- Erkennung bereits vorhandener Citation Keys
- Vermeidung doppelter BibLaTeX-Einträge
- Erhaltung bereits vorhandener Einträge
- Unterstützung von BibLaTeX-Feldern wie `doi`, `url`, `date`, `journaltitle` und `author`
- Einfügen von Zitierbefehlen an der Cursorposition

Beispiele:

`\autocite{mueller2024}`

`\parencite{mueller2024}`

`\textcite{mueller2024}`

Der bevorzugte Zitierbefehl soll konfigurierbar sein.

Die Zotero-Sammlung und die `.bib`-Datei sind unterschiedliche Datenbestände. Nicht jeder Zotero-Eintrag muss automatisch in die `.bib`-Datei übernommen werden.

Vermeide einen vollständigen Export, der bestehende Projektdateien unbeabsichtigt überschreibt.

## 7. MCP-Server für das Sprachmodell

Implementiere einen MCP-Server mit dem offiziellen TypeScript MCP SDK.

Der Server soll lokal über `stdio` gestartet und in kompatible VS-Code-Sprachmodellumgebungen eingebunden werden können.

Die Funktionalität darf nicht fest an einen bestimmten Modellanbieter gebunden sein.

Vorgesehene MCP-Werkzeuge:

### Lesezugriff

- `zotero_list_libraries`
- `zotero_list_collections`
- `zotero_get_selected_collection`
- `zotero_search`
- `zotero_get_metadata`
- `zotero_list_attachments`
- `zotero_get_fulltext`
- `zotero_read_pdf_pages`

### Literaturrecherche

- `zotero_search_external`
- `zotero_lookup_doi`
- `zotero_check_duplicates`
- `zotero_find_evidence`

### Schreibzugriff

- `zotero_create_item`
- `zotero_update_item`
- `zotero_add_to_collection`
- `zotero_attach_pdf`
- `zotero_import_bibtex`
- `zotero_insert_citation`

Prüfe, welche Werkzeuge tatsächlich serverseitig notwendig sind und welche besser über native VS-Code-Befehle umgesetzt werden.

Jedes Werkzeug soll ein klar definiertes Eingabeschema, strukturierte Rückgabewerte und nachvollziehbare Fehlermeldungen besitzen.

## 8. PDF-Verarbeitung

Das Sprachmodell soll die PDFs lesen können, die in Zotero an Literaturdatensätze angehängt wurden.

Unterstütze:

- Erkennen aller PDF-Anhänge einer Quelle
- Abrufen des von Zotero indexierten Volltexts
- Lesen bestimmter PDF-Seiten
- Extrahieren von Text mit nachvollziehbaren Seitenangaben
- Suchen relevanter Textstellen innerhalb eines Dokuments
- Rückgabe von Fundstellen mit Quellenschlüssel und Seitenzahl
- Umgang mit mehreren PDF-Anhängen pro Quelle

Prüfe PDF.js oder eine andere geeignete PDF-Bibliothek für die lokale Verarbeitung.

Die visuelle Analyse von Scans übernimmt bei Bedarf das ausgewählte Sprachmodell über dessen PDF- oder Bildunterstützung.

Das Sprachmodell soll bei wissenschaftlichen Aussagen zwischen tatsächlich gelesenen Dokumentinhalten und eigenen Schlussfolgerungen unterscheiden können.

Erfinde keine Seitenzahlen, Zitate oder Inhalte. Seitenangaben müssen aus der tatsächlich untersuchten PDF hervorgehen.

PDF-Dateien sollen nicht unnötig in temporäre Projektverzeichnisse kopiert werden.

## 9. Externe wissenschaftliche Literaturrecherche

Das Sprachmodell soll neue wissenschaftliche Quellen zu einem vom Benutzer beschriebenen Thema recherchieren können.

Prüfe geeignete Schnittstellen, beispielsweise:

- Crossref für DOI und bibliografische Metadaten
- OpenAlex für wissenschaftliche Publikationen
- Unpaywall für rechtmäßig frei verfügbare Volltexte

Achte auf API-Nutzungsbedingungen, Rate Limits und erforderliche Authentifizierung.

Die KI soll:

1. Wissenschaftliche Veröffentlichungen recherchieren.
2. Bibliografische Metadaten verifizieren.
3. Prüfen, ob ein Eintrag bereits in Zotero vorhanden ist.
4. Verfügbare Open-Access-PDFs ermitteln.
5. Geeignete Quellen zur Übernahme anbieten.
6. Nach Freigabe neue Zotero-Einträge erstellen.
7. Verfügbare PDFs als Anhänge hinzufügen.
8. Die Einträge der ausgewählten Sammlung zuordnen.

Importiere keine urheberrechtlich geschützten PDFs aus unzulässigen Quellen.

Ein DOI allein garantiert nicht, dass ein vollständiger PDF-Text verfügbar ist.

## 10. KI-gestützter wissenschaftlicher Workflow

Folgendes Szenario muss langfristig unterstützt werden:

Der Benutzer öffnet sein LaTeX-Projekt in VS Code und schreibt im KI-Chat:

"Suche fünf wissenschaftliche Arbeiten zu den Grenzen lexikonbasierter Sentimentanalyse. Prüfe zuerst meine ausgewählte Zotero-Sammlung. Recherchiere fehlende Veröffentlichungen, lies die verfügbaren PDFs und schlage geeignete Quellen vor. Ergänze nach meiner Freigabe die Zotero-Sammlung und füge die tatsächlich zitierten Quellen in meine literatur.bib ein. Ergänze meinen LaTeX-Abschnitt mit belegbaren Zitaten."

Das System soll:

- Bestehende Literatur bevorzugt berücksichtigen.
- Fehlende Quellen recherchieren.
- Doppelte Einträge vermeiden.
- Neue Quellen nachvollziehbar vorschlagen.
- PDFs analysieren und relevante Fundstellen ermitteln.
- Den Import neuer Einträge ermöglichen.
- Zotero und LaTeX mit konsistenten Citation Keys verbinden.
- Nur nachweislich passende Quellen zitieren.

## 11. Sicherheit und Datenintegrität

Besonders wichtig ist der kontrollierte Schreibzugriff.

Beachte folgende Anforderungen:

- Schreibfunktionen und Lesefunktionen logisch trennen.
- Neue Quellen vor dem endgültigen Import zur Bestätigung anzeigen.
- Bestehende Datensätze nicht ungefragt überschreiben.
- Keine Quellen automatisch löschen.
- Metadatenänderungen nachvollziehbar machen.
- Duplikate anhand mehrerer Merkmale erkennen.
- PDF-Dateien nur aus zulässigen Quellen herunterladen.
- Lokale Dateipfade sorgfältig validieren.
- Fehlerhafte Importe dürfen vorhandene `.bib`-Dateien nicht beschädigen.
- Zugangsdaten niemals im Repository oder in Projektdateien speichern.
- Externe KI-Modelle dürfen lokale PDF-Inhalte nur gemäß der vom Benutzer gewählten Modellanbindung verarbeiten.

Plane Tests für Schreiboperationen, fehlerhafte Metadaten, nicht verfügbare Zotero-Verbindungen und beschädigte PDFs ein.

## 12. Vorgeschlagene Projektstruktur

Verwende eine modulare Projektstruktur, die bei Bedarf angepasst werden kann.

```text
zotero-latex-assistant/
├── src/
│   ├── extension.ts
│   ├── zotero/
│   │   ├── client.ts
│   │   ├── collections.ts
│   │   ├── items.ts
│   │   └── attachments.ts
│   ├── biblatex/
│   │   ├── exporter.ts
│   │   ├── importer.ts
│   │   └── citations.ts
│   ├── pdf/
│   │   ├── extractor.ts
│   │   └── search.ts
│   ├── research/
│   │   ├── crossref.ts
│   │   ├── openalex.ts
│   │   └── unpaywall.ts
│   ├── views/
│   │   ├── zoteroTree.ts
│   │   └── commands.ts
│   ├── config/
│   │   └── settings.ts
│   └── shared/
│       └── types.ts
├── mcp/
│   ├── server.ts
│   └── tools/
├── test/
├── .vscode/
├── package.json
├── tsconfig.json
└── README.md
```

Die gemeinsame Zotero-Geschäftslogik soll von der VS-Code-Oberfläche und vom MCP-Server wiederverwendet werden können.

## 13. Entwicklungsreihenfolge

Arbeite in nachvollziehbaren Phasen. Jede Phase soll eigenständig ausführbar und testbar sein.

**Phase 1: Grundgerüst**

- Offizielle VS-Code-Extension mit TypeScript erstellen.
- Entwicklungsstart mit F5 ermöglichen.
- Zotero-Verbindung prüfen.
- Erste Bibliotheksinformationen abrufen.
- Fehlerbehandlung für nicht gestartetes Zotero implementieren.

**Phase 2: Native Literaturverwaltung**

- Zotero-Seitenleiste erstellen.
- Sammlungen und Quellen anzeigen.
- Suchfunktion implementieren.
- Quelleninformationen und PDF-Anhänge abrufen.

**Phase 3: LaTeX-Integration**

- Better BibTeX anbinden.
- BibLaTeX-Datei konfigurieren.
- Einzelne Quellen importieren.
- Vorhandene Einträge schützen.
- Zitationen in den Editor einfügen.

**Phase 4: MCP und PDF-Analyse**

- MCP-Server implementieren.
- Leseoperationen bereitstellen.
- PDF-Texte mit Seitenbezug extrahieren.
- MCP-Anbindung in VS Code konfigurieren.
- Test mit einem kompatiblen KI-Agenten durchführen.

**Phase 5: KI-Schreibzugriff**

- Sammlungsbezogene Schreiboperationen implementieren.
- Neue Literaturdatensätze anlegen.
- Metadaten ergänzen.
- Anhänge hinzufügen.
- Bestätigungsmechanismus und Duplikatprüfung implementieren.

**Phase 6: Wissenschaftliche Recherche**

- Externe Literaturdatenbanken anbinden.
- DOI-Metadaten verifizieren.
- Open-Access-PDFs identifizieren.
- KI-gestützte Quellenrecherche umsetzen.

## 14. Anforderungen an die Umsetzung

Bitte beginne mit Phase 1 und entwickle anschließend schrittweise weiter.

Dabei gelten folgende Vorgaben:

1. Prüfe die aktuelle Dokumentation der beteiligten APIs, insbesondere Zotero, Better BibTeX, VS Code und MCP.
2. Verwende keine erfundenen API-Endpunkte oder nicht existierenden Funktionen.
3. Schreibe tatsächlich ausführbaren TypeScript-Code.
4. Verwende TypeScript-Typisierung und sinnvolle Fehlerbehandlung.
5. Ergänze bei Bedarf Unit- und Integrationstests.
6. Erkläre wichtige Architekturentscheidungen kurz und technisch nachvollziehbar.
7. Ver
