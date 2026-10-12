# MCP mit Codex und Claude

Stand: 12. Oktober 2026. Der lokale stdio-Server unterstützt Lesen, bibliografische
Neuanlage, gezielte Quellenaktualisierung, wiederherstellbares Verschieben in den
Zotero-Papierkorb, Anhängen lokaler PDFs als gespeicherte Kopie und Weitergabe
angehängter PDFs an den Agenten.
Es gibt keine lokale Textextraktion, OCR oder serverseitige Modellanalyse.

## Voraussetzungen und Einrichtung

Die Einrichtungsaktionen stehen sowohl in der Befehlspalette als auch im
Zahnrad-Menü der Zotero-Seitenleiste (**Configure project**):
**Set up Codex MCP connection** und **Set up Claude MCP connection**.

- Node.js 20 oder neuer auf derselben Maschine wie Zotero; bei Bedarf den absoluten
  Programmpfad in `zoteroLatexAssistant.nodePath` eintragen.
- Zotero starten und unter Einstellungen → Erweitert die Kommunikation mit anderen
  Anwendungen erlauben. Lesen ist ohne Schlüssel möglich. Schreiben benötigt Zotero 10+.
- Den lokalen LaTeX-Projektordner öffnen und über **Zotero: Set library** die
  Bibliothek und ausdrücklich die gewünschte Sammlung auswählen. Dadurch werden
  Bibliothek, Sammlung und bei Zotero 10 die Server-ID in `.zotero/config.json` gespeichert.
  Eine `.bib`-Datei ist für diese MCP-Werkzeuge nicht erforderlich.
- Ein VSIX über `npm ci && npm run package` bauen und installieren oder mit F5 den
  Extension Development Host starten. Das Paket enthält `dist/mcp/server.cjs`
  einschließlich seiner Laufzeitabhängigkeiten. Der Rechner benötigt kein globales MCP-SDK.

### Codex-Erweiterung in VS Code

1. **Zotero: Set up Codex MCP connection** aufrufen. Bei mehreren Projektordnern
   gilt der aktive Editorordner oder die ausdrücklich gewählte Ordnerauswahl.
2. Die Aktion schreibt einen markierten Serverabschnitt in **dieses Projekts**
   `.codex/config.toml`, erhält andere Server und öffnet die fertige Konfiguration.
   Sie übergibt Extension-Serverpfad, Projektpfad, lokale API-URL und Zeitlimit als Argumente.
3. Das Projekt in Codex als vertrauenswürdig verwenden und die Codex-IDE-Sitzung
   neu starten. Zuerst bitten: „Rufe `zotero_get_selected_collection` auf und zeige
   Bibliothek und ausgewählte Sammlung.“ Erst bei passender Zuordnung schreiben.

Codex CLI und IDE-Erweiterung teilen die MCP-Konfiguration. Projektkonfigurationen
werden nur für vertrauenswürdige Projekte geladen. Eine Registrierung in VS Codes
eigener MCP-Verwaltung ist dafür nicht erforderlich und ersetzt diese Einrichtung nicht.
Quelle: [Offizielle Codex-MCP-Dokumentation](https://developers.openai.com/codex/mcp).

Beispiel, mit den tatsächlichen absoluten Pfaden ersetzen:

```toml
[mcp_servers.zotero_latex_assistant]
command = "/usr/bin/node"
args = ["/absoluter/extension/pfad/dist/mcp/server.cjs", "--project", "/absolutes/latex/projekt", "--api-url", "http://localhost:23119/api/", "--timeout-ms", "5000"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Bei einem Extension-Update mit verändertem Installationspfad die Einrichtungsaktion
erneut aufrufen. Der markierte Abschnitt wird ersetzt. Ein gleichnamiger, nicht
von der Aktion verwalteter Server wird zum Schutz vorhandener Einstellungen abgewiesen.
Absolute lokale Pfade sind maschinenabhängig; die erzeugte Client-Konfiguration
nicht ungeprüft mit anderen Rechnern teilen.

### Claude Code und Claude-Erweiterung in VS Code

1. **Zotero: Set up Claude MCP connection** aufrufen.
2. Die Aktion ergänzt den Server in der projektbezogenen `.mcp.json` und öffnet
   die Datei. Andere Server bleiben erhalten.
3. Den Projektserver in Claude Code zulassen und über `/mcp` die Verbindung prüfen.
   Gegebenenfalls die IDE-Sitzung neu starten. Anschließend ebenfalls zuerst
   `zotero_get_selected_collection` verwenden.

Claude Code verwendet projektbezogene `.mcp.json`-Dateien und fordert die Zustimmung
zum Projektserver an. Diese Konfiguration ist von Claude Desktops Konfiguration getrennt.
Quelle: [Offizielle Claude-Code-MCP-Dokumentation](https://code.claude.com/docs/en/mcp).

```json
{
  "mcpServers": {
    "zotero_latex_assistant": {
      "type": "stdio",
      "command": "/usr/bin/node",
      "args": ["/absoluter/extension/pfad/dist/mcp/server.cjs", "--project", "/absolutes/latex/projekt"]
    }
  }
}
```

Andere lokale stdio-MCP-Clients einschließlich Claude Desktop können denselben
Server starten. Für Claude Desktop den Servereintrag mit den tatsächlichen Pfaden
in dessen separate MCP-Konfiguration übernehmen. Diese manuelle Desktop-Einrichtung
wurde hier nicht live geprüft. Ein Cloud-Client erreicht den lokalen stdio-Prozess
nicht ohne zusätzliche Infrastruktur.

## Werkzeuge und Ergebnisse

Jedes Werkzeug liefert Text mit JSON sowie strukturierte Daten. Erfolg hat
`{ "ok": true, "result": … }`; Fehler hat `isError: true` und
`{ "ok": false, "error": { "code": …, "message": … } }`.
Werkzeuge haben Ein- und Ausgabeschemas, beschreibende Hinweise und MCP-Annotationen.
Leseoperationen sind als lesend markiert. Papierkorb ist als destruktive, wiederholbare
Operation markiert; es gibt kein Werkzeug für endgültiges Löschen.

| Werkzeug | Eingaben | Ergebnis / Zugriff |
| --- | --- | --- |
| `zotero_list_libraries` | keine | Lokale persönliche und Gruppenbibliotheken; Auswahl unverändert |
| `zotero_list_collections` | keine | Sammlungen mit Elternschlüsseln der konfigurierten Bibliothek |
| `zotero_get_selected_collection` | keine | Projekt, Bibliothek, Server-ID, Sammlung und `writeReady` |
| `zotero_search` | `query`, optional `limit` (1–100), `offset` | Bibliografische Quellen im ausgewählten Scope, Trefferzahl und Keys |
| `zotero_get_metadata` | `library`, `itemKey` | Gespeicherte Felder, Version, Sammlungsliste und Projekt-Zitationswarnungen |
| `zotero_get_item_schema` | `itemType` | Zulässige Felder und Erstellerrollen der lokalen Zotero-Version, Pflichtangaben und Empfehlungen |
| `zotero_validate_metadata` | `metadata` | Feld-/Rollenprüfung und fehlende empfohlene Angaben, ohne Neuanlage |
| `zotero_lookup_identifier` | `identifier` | DOI-/ISBN-Metadatenvorschau mit Anbieter, Herkunft, Typzuordnung und Empfehlungen |
| `zotero_import_identifier` | `identifier`, `requestId`, optional `overrides`, `citationKey`, `allowPossibleDuplicate` | Verifizierte DOI-/ISBN-Neuanlage mit festem Zitierschlüssel in der ausgewählten Sammlung |
| `zotero_check_duplicates` | `metadata` | Bibliotheksweite DOI- und Titel/Autor/Jahr-Übereinstimmungen |
| `zotero_create_item` | `metadata`, `requestId`, optional `allowPossibleDuplicate` | Verifizierte gespeicherte Quelle oder `duplicate-blocked` |
| `zotero_update_item` | `library`, `itemKey`, `expectedVersion`, partielle `metadata`, optional `allowPossibleDuplicate` | Verifizierter Update-/Unverändert-Status oder `duplicate-blocked`; ausgelassene Felder bleiben erhalten |
| `zotero_list_attachments` | `library`, `itemKey` | Metadaten aller Anhänge dieser Quelle; keine Aussage über lokale Dateiverfügbarkeit |
| `zotero_attach_pdf` | `library`, `itemKey`, `filePath`, `expectedVersion`, `requestId`, optional `title` | Verifizierte gespeicherte PDF-Kopie an einer vorhandenen Quelle oder wiederverwendeter identischer Anhang |
| `zotero_get_attachment` | `library`, `itemKey`, `attachmentKey`, optional `includeContent` | Geprüfter PDF-Dateipfad, Datei-URI, Größe und SHA-256; optional originale PDF-Bytes als MCP-Ressource |
| `zotero_delete_item` | `library`, `itemKey`, `expectedVersion` | Verifizierter Papierkorbzustand, Version und Warnungen |

`library` ist beispielsweise `{ "type": "user", "id": 0 }` oder eine Gruppe
mit ihrer echten Gruppen-ID. Ein fremder Scope wird abgewiesen. Ein leerer
Sammlungsschlüssel erlaubt Lesezugriff auf die konfigurierte Bibliothek und sperrt
Schreiben. Eine Sammlung wird nicht automatisch gewählt oder erweitert.

Metadaten verwenden Zotero-Namen, beispielsweise:

```json
{
  "metadata": {
    "itemType": "journalArticle",
    "title": "Der tatsächlich verifizierte Publikationstitel",
    "creators": [{ "creatorType": "author", "firstName": "Anna", "lastName": "Müller" }],
    "fields": { "date": "2026", "publicationTitle": "Der verifizierte Zeitschriftenname" },
    "tags": []
  },
  "requestId": "eine-stabile-eindeutige-anfrage-id"
}
```

Organisationen verwenden `name` statt `firstName`/`lastName`. Felder und Rollen
werden gegen die lokale Zotero-Version über `itemTypeFields` und
`itemTypeCreatorTypes` geprüft. `items/new` ist in der geprüften lokalen Version
nicht verfügbar und wird nicht verwendet. Anhang, Notiz und Annotation sind keine
zulässigen bibliografischen Neuanlagen. Eine gültige Feldstruktur bestätigt keine
Publikation: Der Client muss Tatsachen und Quellen vor der Übernahme verifizieren.
Quellen: [Zotero-Typen und Felder](https://www.zotero.org/support/dev/web_api/v3/types_and_fields),
[Lokale API](https://www.zotero.org/support/dev/web_api/v3/local_api).

### Optionale Angaben, Zitierschlüssel und Identifier-Import

**Nur `itemType` und `title` sind Pflichtangaben für die Neuanlage.** Ersteller,
Datum, Verlag, Seiten, DOI, ISBN und andere Felder dürfen fehlen oder leer sein.
Die Werkzeuge melden quellentypbezogene Empfehlungen in `completeness`:
`required` enthält nur Typ und Titel; `missingRecommended` blockiert keine Anlage.
`complete: true` bedeutet, dass die Pflichtangaben vorhanden sind, nicht dass alle
denkbaren bibliografischen Angaben ausgefüllt wurden. Für Bücher sind Autor oder
Herausgeber möglich. Für weitere Typen ohne eigenes Empfehlungsprofil gilt ein
allgemeines Profil. Die zulässigen Felder und Rollen kommen stets aus Zotero.

`zotero_create_item` setzt bei jeder Neuanlage einen festen Zitierschlüssel.
Optional lässt er sich mit `metadata.citationKey` vorgeben; andernfalls wird ein
lesbarer Schlüssel mit einem stabilen Suffix aus der `requestId` erzeugt. Native
`citationKey`-Felder haben Vorrang, ältere Schemas verwenden `Citation Key: …` in
`extra`. Vorhandene Zusatzangaben bleiben erhalten. Schlüsselkonflikte in der
Bibliothek, Better BibTeX (falls verfügbar), der Projektzuordnung und Projekt-`.bib`
werden vor und nach der Zotero-Freigabe geprüft. Das Ergebnis enthält `citationKey`.
Der spätere Projektimport bewahrt diesen Schlüssel auch beim nativen Export;
bereits bestehende Projektzuordnungen werden nicht umbenannt.

`zotero_lookup_identifier` liefert eine Vorschau ohne Zotero-Schreibzugriff.
DOIs werden über Crossref aufgelöst; nur nach einem Crossref-404 wird DataCite
versucht. ISBN-10 und ISBN-13 werden inklusive Prüfziffer validiert und auf eine
gemeinsame ISBN-13-Identität normalisiert. Buchmetadaten kommen aus Open Library.
Es wird ausschließlich der Identifier an feste öffentliche HTTPS-Endpunkte
gesendet. Die beiden Identifier-Werkzeuge haben `openWorldHint: true`.

`zotero_import_identifier` führt Auflösung, Feldzuordnung, Dublettenprüfung,
Schlüsselsetzung und verifizierte Neuanlage in einem Aufruf aus, beispielsweise:

```json
{
  "identifier": "9780306406157",
  "requestId": "projekt-buchimport-001"
}
```

Optional sind ein fester `citationKey` und partielle `overrides` (Titel, Ersteller,
Felder, Tags). Korrekturen müssen die aufgelöste DOI bzw. ISBN-Buchausgabe bewahren.
Nicht passende Anbieterfelder/-rollen werden mit Hinweisen ausgelassen. DOI wird
bei Quellentypen ohne DOI-Feld in `extra` erhalten. Fehlende Angaben werden nicht
erfunden; Publikationstypen ohne sichere Zuordnung werden abgewiesen. Volltexte,
PDF-Anhänge und Projekt-`.bib` werden durch den Identifier-Import nicht geschrieben.

Bei Dissertationen und Berichten wird `publisher` nicht als Hochschule bzw.
herausgebende Institution übernommen. Crossrefs separate `institution[].name`-
Angaben liefern `university` bei Dissertationen und `institution` bei Berichten.
Fehlende oder ungültige Namen bleiben leer. DataCites `publisher` kann auch ein
Repository bezeichnen; auch Autorenaffiliationen sowie `HostingInstitution` und
`Producer` belegen diese bibliografischen Rollen nicht. Deshalb bleiben die
entsprechenden Felder im DataCite-Import leer und dürfen durch geprüfte Overrides
ergänzt werden. Für Bücher und andere passende Quellentypen bleibt die bisherige
Verlagszuordnung erhalten.

Eine fehlende eindeutige Institutionsangabe erscheint als Hinweis in `warnings`
bei der DOI-Abfrage und in `lookupWarnings` beim Import. Hinweise werden zusammen
mit den aufgelösten Metadaten für Wiederholungen gespeichert und blockieren keine
Neuanlage. Bereits gespeicherte Quellen und eingefrorene alte Importaufträge werden
durch diese Korrektur nicht verändert.

Grundlage: [Crossref – Institutionsangaben nach Quellentyp](https://www.crossref.org/documentation/schema-library/required-recommended-elements/),
[DataCite – Publisher](https://datacite-metadata-schema.readthedocs.io/en/4.7/properties/publisher/)
und [DataCite – Beitragsrollen](https://datacite-metadata-schema.readthedocs.io/en/4.7/appendices/appendix-1/contributorType/).

Anbieter und Rückgaben müssen bibliografisch geprüft werden. Die Anbieter decken
nicht alle Identifier ab; HTTP-Fehler, Rate-Limits, falsche Identifier, übergroße
Antworten und unbekannte Typen liefern Fehler. Netzwerkaufrufe haben 15 Sekunden
Timeout und ein Antwortlimit von 2 MiB. Weiterleitungen werden nicht verfolgt.

Unter `.zotero/mcp/imports/` werden die aufgelösten Metadaten, Eingabedigest und
Herkunft für eine Import-Anfrage eingefroren. Wiederholungen mit gleicher `requestId`,
Identifier, Korrekturen und Schlüssel verwenden diese Daten ohne erneuten
Anbieteraufruf. Der vorhandene Neuanlage-Journalmechanismus schützt auch nach
Antwortverlust und Prozessneustart vor Doppelanlagen. Für eine neue Anfrage mit
anderen Korrekturen eine neue ID verwenden; einen unklaren Schreibausgang zuerst
mit der ursprünglichen ID auflösen.

Gleiche DOI oder ISBN derselben Buchausgabe blockieren auch mit
`allowPossibleDuplicate: true`. Buchkapitel mit gemeinsamer ISBN sind eigenständige
Quellen. Titel-/Autor-/Jahr-Übereinstimmungen bleiben überprüfbare mögliche Dubletten.

Anbieterdokumentation: [Crossref REST API](https://github.com/Crossref/rest-api-doc),
[DataCite DOI-Abfrage](https://support.datacite.org/docs/api-get-doi),
[Open Library Books API](https://openlibrary.org/dev/docs/api/books).

## Schreiben, Wiederholen und Papierkorb

Eine ausdrückliche Benutzeranweisung zum Anlegen, Aktualisieren oder Löschen gilt als Auftrag.
Eine vom Modell selbst vorgeschlagene Schreibaktion benötigt zuvor Zustimmung.
Die Werkzeugbeschreibungen vermitteln diese Regel; der MCP-Prozess kann die
menschliche Absicht nicht selbst überprüfen. Client-Freigaben und Zotero-Freigaben
bleiben wirksam. Das Paket konfiguriert keine pauschale automatische Schreibfreigabe.

- Zotero zeigt bei Bedarf seine lokale Autorisierung. Einmalige Schlüssel werden
  nicht gespeichert. „Always Allow“ wird im MCP-Prozess nur bis zu dessen Ende im
  Arbeitsspeicher gehalten; die Extension nutzt für eigene Abläufe SecretStorage.
  Schlüssel stehen weder in Projektdateien noch in Ergebnissen oder Logs.
- Instanz-ID, Projektkonfiguration, Sammlung und bei Papierkorb die aktuelle
  Item-Version werden nach der Autorisierung unmittelbar vor dem Schreiben erneut
  geprüft. `401` fordert einmal eine neue Freigabe an; `403`, Datenbankwechsel
  oder Versionskonflikte überschreiben keine Quelle.
- Gleiche normalisierte DOI oder ISBN-Buchausgabe blockiert Neuanlage auch mit Override. Mögliche
  Titel/Autor/Jahr-Dubletten benötigen Überprüfung und ausdrücklichen Override.
  Neue Einträge bekommen automatisch die ausgewählte Sammlung.
- `requestId` bei jedem Wiederholungsversuch mit identischen Metadaten erhalten.
  `.zotero/mcp/requests/` enthält ausschließlich Digest, vorab vergebenen Item-Key
  und Bearbeitungszustand. Ein gespeicherter Key mit `version: 0` schützt die
  Neuanlage zusätzlich vor dem Überschreiben eines bestehenden Objekts.
  Die Zuordnung übersteht normale Prozessneustarts. Unklare Antworten werden
  anhand dieses Keys aufgelöst, ohne Neuanlage erneut zu senden. Der Key einer
  bereits geänderten/gelöschten Quelle wird nicht wiederverwendet.
- Bestätigte Ablehnungen der eigentlichen Neuanlage (HTTP 400, 401, 403, 404,
  405, 409, 412, 413, 415, 422, 428 oder 429) setzen das Journal auf `prepared`
  zurück. Das gilt auch für eindeutig abgelehnte einzelne Datensätze in einer
  Batch-Antwort, sofern diese keine erfolgreichen oder unveränderten Einträge
  enthält. Nach Behebung des Problems dieselbe Anfrage-ID und dieselben Daten
  wiederholen: Der reservierte Key bleibt erhalten, sein Fehlen muss durch eine
  erfolgreiche Abfrage mit HTTP 404 bestätigt werden, und alle Schreibprüfungen
  laufen erneut. Eine verweigerte Freigabe vor dem POST bleibt ebenfalls
  wiederholbar. Timeouts, Netzwerkabbrüche, HTTP 408/5xx, unvollständige Antworten
  und Fehler beim Rücklesen nach erfolgreichem POST bleiben unklare Ausgänge.
  Bereits vorhandene unklare Journale werden nicht automatisch zurückgesetzt.
- `.zotero/mcp/write.lock` sperrt konkurrierende MCP-Schreibabläufe pro Projekt.
  Nach einem Prozessabsturz die Sperre nur entfernen, wenn alle zu diesem Projekt
  gehörenden Zotero-MCP-Prozesse beendet sind. Anfrageprotokolle zum Schutz vor
  Doppelanlagen erhalten. Außerhalb dieses Projekts gestartete MCP-Prozesse und
  manuelle Zotero-Änderungen sind nicht durch diese Projektsperre koordiniert.
- Löschen verwendet ausschließlich `PATCH { "deleted": 1 }` mit
  `If-Unmodified-Since-Version`; anschließend werden Einzelobjekt und
  `items/trash` mit Paginierung und lokalem Key-Vergleich geprüft. Die lokale
  Version 10.0.6 liefert beim `itemKey`-Filter keine Papierkorbtreffer;
  `deleted: true` und `deleted: 1` werden als Papierkorbstatus erkannt. HTTP `DELETE` wäre endgültiges Löschen und wird
  nicht verwendet. Wiederholung gibt `already-trashed` zurück.
- Metadaten und Papierkorbergebnis nennen weitere Sammlungszugehörigkeiten,
  Projektimport, tatsächliche Bib-Zugehörigkeit und erkannte LaTeX-Zitationsdateien.
  Die vorhandene Bestandserkennung berücksichtigt persistierte, Extra- und bei
  Verfügbarkeit lokale BBT-Schlüssel. Nicht sicher auflösbare
  TeX-Zitationen erzeugen einen Warnhinweis. Ungespeicherte Editortexte sind ohne
  Editorbrücke nicht verfügbar.
- `.bib`, LaTeX und Projekt-Zitierzuordnung werden nicht automatisch bereinigt.
  Dafür gesondert den vorhandenen Projektworkflow mit Sicherung und
  `writeProjectChanges` beauftragen. Eine Editorbrücke ist noch nicht implementiert.

Quellen: [Lokale Autorisierung und Server-ID](https://www.zotero.org/support/dev/web_api/v3/local_api),
[Zotero-Schreiboperationen und Objektversionen](https://www.zotero.org/support/dev/web_api/v3/write_requests),
[Offizielle Zotero-Implementierung der JSON-Felder](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/item.js),
[Offizielle lokale API-Tests](https://github.com/zotero/zotero/blob/main/test/tests/server_localAPITest.js).


## Lokale PDFs anhängen

`zotero_attach_pdf` nimmt einen **absoluten lokalen Pfad** zu einer PDF entgegen
und legt einen `imported_file`-Anhang unter einer vorhandenen bibliografischen
Quelle an. Die Quelle muss in der ausdrücklich ausgewählten Projektsammlung
liegen. Vor dem ersten Aufruf ihre aktuelle Version mit `zotero_get_metadata`
lesen, beispielsweise:

```json
{
  "library": { "type": "user", "id": 0 },
  "itemKey": "ITEM2345",
  "filePath": "/absoluter/pfad/paper.pdf",
  "expectedVersion": 10,
  "requestId": "projekt-pdf-anhaengen-001",
  "title": "Volltext"
}
```

Ohne `title` wird der Dateiname verwendet. Die Eingabe muss eine reguläre lokale
Datei mit `.pdf`-Endung und PDF-Signatur sein; maximal 100 MiB und ein Dateiname
bis 255 UTF-8-Bytes sind zulässig. Symbolische Verknüpfungen werden aufgelöst.
Relative Pfade, URLs, Nicht-PDF-Inhalte und übergroße Dateien werden abgewiesen.
Es gibt keinen automatischen Download, keine Textextraktion und keine OCR.

Der Anhang enthält eine **gespeicherte Kopie in Zotero**, keine Verknüpfung auf
die Eingabedatei. Die ursprüngliche Datei bleibt unverändert und darf nach
erfolgreichem Abschluss verschoben werden. Persönliche Bibliotheken und Gruppen
werden unterstützt, soweit Zotero das Schreiben von Dateien dort erlaubt.
Identische bereits gespeicherte PDF-Anhänge derselben Quelle werden anhand ihrer
lokalen SHA-256 wiederverwendet. Gleiche Dateinamen mit anderen Inhalten bleiben
separate Anhänge. Nicht verfügbare lokale Dateien können nicht auf Inhaltsgleichheit
geprüft werden. Bestehende Anhänge werden nicht ersetzt oder umbenannt.

Der lokale Zotero-10-Upload besteht aus Anhangsneuanlage sowie Datei-Autorisierung,
Übertragung und Registrierung. Dateioperationen verwenden `If-None-Match: *`.
Vor jedem Schreibschritt werden Projektbindung, Parent, Objektversionen und
Eingabedatei erneut geprüft, auch nach Zotero-Freigaben. Die Uploadadresse muss
zum konfigurierten lokalen Zotero-Server und dessen Upload-Endpunkt gehören;
PDF-Bytes und Zugangsschlüssel werden nicht an externe Server gesendet.
Eine einmalige Zotero-Freigabe kann für die einzelnen Schreibschritte erneut
angefordert werden. Dauerhafte Freigaben bleiben sitzungsbezogen gespeichert.

Erfolg enthält `status: attached` bzw. `already-attached`, `attachmentKey`,
`attachment`, `version`, `verified: true`, Größe, SHA-256 sowie den von Zotero
bestätigten lokalen Speicherpfad und die Datei-URI. Der gespeicherte Inhalt wird
vollständig mit dem Eingabeinhalt verglichen. `.bib` und LaTeX werden nicht geändert.

Unter `.zotero/mcp/attachments/` stehen Anfrage-Digest, vorab vergebener Anhangs-Key,
erwartete Metadaten, Version und Fortschritt; PDF-Bytes und Uploadschlüssel werden
dort nicht gespeichert. Nach Timeout oder Teilerfolg **dieselbe `requestId`,
Quelle, unveränderte Eingabedatei, Titel und ursprüngliche `expectedVersion`**
verwenden. Eine verlorene Neuanlage-Antwort wird am vergebenen Key aufgelöst;
ein unklarer Ausgang ohne auffindbaren Key wird nicht erneut als Neuanlage gesendet.
Eine bestätigte Ablehnung der Anhangsneuanlage setzt ihren Zustand auf `prepared`
zurück; dieselbe Anfrage lässt sich nach Behebung der Ursache mit dem reservierten
Anhangs-Key wiederholen. Dafür gelten dieselben Ablehnungscodes und Prüfungen wie
bei Quellen. Diese Rücksetzung gilt ausschließlich für die Metadatenneuanlage,
nicht für nachfolgende Upload- oder Registrierungsfehler.
Ein unterbrochener Datei-Upload wird auf demselben Anhang fortgesetzt. Eine bereits
erfolgreiche Registrierung wird durch Rücklesen der gespeicherten Bytes bestätigt.
Ein geänderter, verschobener oder gelöschter Anhang wird nicht überschrieben oder
neu erstellt. Fehler nach Beginn nennen den reservierten Anhangs-Key; bei einem
Teilfehler kann zunächst ein leerer Anhang in Zotero sichtbar sein.

Quelle: [Zotero Local API – File Uploads](https://www.zotero.org/support/dev/web_api/v3/local_api#file_uploads).

Prüfstand: 344 Tests bestanden. PDF-Neuanlage und alle Uploadphasen wurden mit
simuliertem Zotero, tatsächlichen lokalen Dateibytes und dem gebündelten
stdio-Prozess geprüft, einschließlich Antwortverlust, Gruppen, einmaliger
Freigaben, falscher Uploadadressen und Version-/Scope-Konflikten. Dieser
Schreibablauf wurde noch nicht als neuer Live-Upload in die persönliche
Zotero-Bibliothek ausgeführt.

## Quellen aktualisieren und PDFs an den Agenten übergeben

1. `zotero_get_metadata` mit eindeutigem Bibliotheks-/Quellenschlüssel lesen.
2. Für eine beauftragte Korrektur `zotero_update_item` mit der gelesenen Version und
   ausschließlich den gewünschten Änderungen aufrufen, zum Beispiel:

```json
{
  "library": { "type": "user", "id": 0 },
  "itemKey": "ABCDEFGH",
  "expectedVersion": 12,
  "metadata": { "fields": { "date": "2025", "publicationTitle": "Korrigierter Zeitschriftenname" } }
}
```

Ausgelassene Titel, Autoren, Tags, Extra-Felder, Sammlungen und Relationen bleiben
unverändert. Angegebene Autoren-/Tag-Arrays ersetzen diese Arrays ausdrücklich;
ein leerer Feldwert löscht den Feldinhalt. Typ und Systemfelder sowie Sammlungen
und Relationen sind über dieses Werkzeug nicht änderbar. Dublettenprüfung schließt
die bearbeitete Quelle selbst aus und berücksichtigt andere Sammlungen. Nach der
Zotero-Freigabe werden Projektbindung, Mitgliedschaft, Version und Dubletten erneut
geprüft. `PATCH` verwendet `If-Unmodified-Since-Version`, danach werden Version und
geänderte Werte rückgelesen. Bei unklarer Antwort zuerst erneut lesen; eine alte
Version ist keine Erlaubnis zum Überschreiben. Die Projekt-.bib lässt sich bei
Bedarf über **Update .bib manually** nachziehen; das MCP-Update ändert sie nicht.

Explizite Änderungen an `fields.citationKey` bzw. `Citation Key: …` in `fields.extra`
werden ebenfalls geprüft. Native und Extra-Angaben müssen denselben Schlüssel
enthalten; überholte Extra-Schlüssel bei einem nativen Wechsel ausdrücklich
entfernen oder entsprechend ändern. Nicht passende oder widersprüchliche Angaben
werden vor der Zotero-Freigabe abgewiesen. Bei reinen Notizänderungen mit unverändertem
Extra-Schlüssel wird keine Schlüsseländerung angenommen.

Die Kollisionsprüfung berücksichtigt bibliotheksweit andere Quellen, verfügbare
Better-BibTeX-Schlüssel, Projektzuordnungen und vorhandene `.bib`-Einträge, auch bei
unterschiedlicher Groß-/Kleinschreibung. Implizite alte Projektschlüssel bleiben
ebenfalls reserviert. Die bearbeitete Quelle selbst und der ihr eindeutig
zugeordnete Eintrag in der Projektbibliografie werden ausgeschlossen. Unzugeordnete
Bibliografie-Einträge bleiben reserviert. Nach der Freigabe wird diese Prüfung
erneut mit frischen Daten ausgeführt. `allowPossibleDuplicate` übergeht keine
Schlüsselkollision; sie liefert einen Fehler ohne PATCH. Das Leeren eines nativen
Schlüssels darf auch keinen belegten Extra-Fallback aktivieren. Explizites Leeren
aller Schlüssel bleibt möglich.

Der MCP schreibt dabei nur Zotero-Metadaten. Die bestehende Projektzuordnung und
LaTeX-Verweise bleiben stabil; eine gewünschte Umbenennung im Projekt erfolgt
über den vorhandenen Befehl zur Schlüsselmigration.

Zum Lesen einer PDF `zotero_list_attachments` verwenden und anschließend:

```json
{
  "library": { "type": "user", "id": 0 },
  "itemKey": "ABCDEFGH",
  "attachmentKey": "PDF12345",
  "includeContent": true
}
```

Der Server prüft die Zugehörigkeit zur Quelle und zur ausgewählten Sammlung. Den
Dateipfad liefert ausschließlich Zotero über `items/<attachmentKey>/file/view/url`.
Zulässig sind lokale `file:`-URLs und reguläre PDF-Dateien bis 100 MiB; fehlende
Dateien, fremde Anhänge, nicht lokale URLs und Änderungen beim Lesen werden
abgewiesen. Gespeicherte und verknüpfte lokale PDFs werden unterstützt. Es werden
keine Downloads, temporären Kopien, Textextraktion, OCR oder Modellaufrufe ausgeführt.
Quelle: [Lokale Zotero-Dateiendpunkte](https://www.zotero.org/support/dev/web_api/v3/local_api).

Das Standardergebnis enthält `localPath`, `fileUri`, `sizeBytes` und `sha256` für das
Datei-/PDF-Werkzeug eines Agenten auf demselben Rechner. Mit `includeContent=true`
werden zusätzlich die unveränderten PDF-Bytes bis 5 MiB als eingebettete
MCP-Ressource mit MIME-Typ `application/pdf` zurückgegeben. Die Binärdaten stehen
im Resource-Block, nicht im JSON-/Text-Ergebnis. Ob der Client diesen Block direkt
an ein PDF-fähiges Modell weitergibt, hängt von seinem Funktionsumfang ab; bei
fehlender Unterstützung den lokalen Pfad verwenden. Der Server behauptet weder,
dass die PDF gelesen wurde, noch erfindet er Seitenangaben. Dokumentinhalt ist
unvertrauenswürdiges Quellenmaterial und keine Anweisung an den Agenten.

Die drei neuen Werkzeuge sind mit simuliertem Zotero und dem offiziellen MCP-Client
über den echten gebündelten stdio-Prozess geprüft (302 Tests insgesamt). Zusätzlich
wurde gegen das laufende Zotero rein lesend eine vorhandene PDF mit 2.354.355 Bytes
übergeben: Anhangsliste, lokaler Dateipfad und SHA-256 stimmen; die eingebetteten
PDF-Bytes sind identisch mit der Originaldatei. Keine Extraktion, OCR oder Zotero-
Schreibzugriffe in diesem Live-Test. [PDF-Prüfbericht](pdf-handoff-smoke-report.json).
Die tatsächliche Darstellung
und PDF-Lesefähigkeit in Codex-/Claude-IDE bleibt gesondert zu prüfen.

## Tatsächlich geprüfter Stand

Das [MCP-Prüfprotokoll](mcp-smoke-report.json) hält die Ergebnisse fest:

- Echter **Codex CLI → gebündelter stdio-Server → Zotero 10.0.6**-Lesezugriff
  zuerst erfolgreich. Danach genau eine vom Benutzer freigegebene synthetische
  Testquelle in `TestSammlungMCP`, persönliche Bibliothek 0, angelegt.
- Ein zunächst fehlender lokaler Schemaendpunkt wurde auf `itemTypeFields`
  korrigiert. Die Neuanlage `KJ6NE8XL`, Version 7, wurde nach Korrektur eines
  zu strengen JSON-Vergleichs mit unveränderter Anfrage-ID rückgelesen statt
  erneut angelegt. Suche fand exakt diese Quelle. Codex hat anschließend
  `already-trashed`, `verified: true`, Version 8 bestätigt.
- Claude Code 2.1.136 verband den Server und erkannte alle acht Werkzeuge. Der
  eigentliche Modellaufruf scheiterte mit `401`, weil die Anmeldung abgelaufen
  war. Claude-Lesen und Claude-Schreiben sind bis zur erneuten Anmeldung offen.
- Automatisierte Tests prüfen alle sechzehn Werkzeuge mit dem offiziellen MCP-Client
  über den gebündelten stdio-Prozess sowie Neuanlage, Zuordnung, Dubletten,
  Wiederholung nach verlorener Antwort, Papierkorb, Fremdscope, Datenbankwechsel,
  Versionskonflikte, verweigerte/abgelaufene Freigaben und Änderungen während des
  Autorisierungsdialogs. Beide TypeScript-Projekte werden geprüft.
- DOI-/ISBN-Erweiterung: 327 Tests bestanden. Crossref-Auflösung für
  `10.1038/nature12373`, Open-Library-Auflösung für `9780306406157` und das native
  `citationKey`-Feld der laufenden lokalen Zotero-Version wurden nur lesend live
  geprüft. Neue Identifier-Neuanlagen wurden mit API-Testdoubles und dem echten
  stdio-Prozess geprüft; die Live-Prüfung hat keine Zotero-Quelle angelegt.
- Die interaktive Nutzung direkt in Codex-/Claude-IDE und Claude Desktop bleibt
  separat offen. Der Codex-CLI-Nachweis belegt dieselbe MCP-Konfiguration, ersetzt
  aber keinen manuellen IDE-Test. Paket- und Extension-Host-Prüfungen sind ebenfalls
  im Bericht gesondert ausgewiesen. Der aus dem VSIX entpackte Server wurde ohne
  externe node_modules mit allen acht simulierten Werkzeugen und anschließend
  lesend gegen echtes Zotero geprüft.

Offizielles stabiles SDK: `@modelcontextprotocol/server` **2.3.1**, mit Client 2.3.1
für Tests, exakt in der Lockdatei. Laufzeitabhängigkeiten werden mit esbuild in
Server und Extension gebündelt. `stdout` ist ausschließlich MCP-Protokoll;
Startdiagnosen gehen nach `stderr`.
Quelle: [Offizielles TypeScript-MCP-SDK](https://github.com/modelcontextprotocol/typescript-sdk).


## Reproduzierbare lokale Prüfungen

`npm test` führt alle simulierten Fälle einschließlich des echten stdio-Transports
mit offiziellem MCP-Client aus. `npm run check` prüft Extension/Server und Webview.
`npm run test:live` verwendet ein separates VS-Code-Profil und temporäres Projekt;
dort werden auch die Einrichtungsaktionen für beide Clients tatsächlich aufgerufen.

Ein lesender MCP-Smoke gegen ein bereits eingerichtetes Projekt:

```sh
npm run test:mcp:live -- --project /absolutes/latex/projekt
```

Nur mit ausdrücklich freigegebener Testsammlung und stabiler Anfrage-ID schreiben:

```sh
npm run test:mcp:live -- --project /absolutes/testprojekt --write --test-collection TestSammlungMCP --request-id mcp-test-eindeutig-001
```

Der zweite Aufruf erzeugt eine klar als synthetischen MCP-Test bezeichnete Quelle,
findet sie wieder und verschiebt genau ihren gespeicherten Key in den Papierkorb.
Bei unklarer Antwort dieselbe Anfrage-ID erhalten und den Zustand prüfen; keine
zweite Anfrage-ID zur Wiederholung verwenden. Dieses Skript verwendet den
offiziellen SDK-Client, kein Sprachmodell. Den eigentlichen Clienttest zusätzlich
in Codex oder Claude mit der oben beschriebenen Projektkonfiguration durchführen.
