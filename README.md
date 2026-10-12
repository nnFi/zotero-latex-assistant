# Zotero LaTeX Assistant

Eine lokale VS-Code-Extension, die Zotero und LaTeX verbinden soll.
Klassische Literaturverwaltung und KI-Unterstützung über den lokalen MCP-Server sind getrennte Bereiche.

**Aktueller Stand:** Zotero-Seitenleiste mit Bibliotheken, hierarchischen Sammlungen,
Projektzuordnung in `.zotero/config.json`, gezieltem BibLaTeX-Import,
Quellenliste mit Mehrfachauswahl, Einfügen von LaTeX-Zitationen und DOI-/Titelsuche über Crossref.
Der lokale MCP-Server bietet außerdem elf Werkzeuge für Lesen, Dublettenprüfung, Quellenaktualisierung,
bibliografische Neuanlage, wiederherstellbaren Zotero-Papierkorb und PDF-Weitergabe
an den Agenten. PDFs werden unverändert als Datei übergeben, ohne lokale Textextraktion.
**Zotero: Set up Codex MCP connection** und **Zotero: Set up Claude MCP connection**
richten das aktuelle Projekt für die jeweiligen VS-Code-KI-Erweiterungen ein.
Beide Aktionen sind auch über das Zahnrad in der Zotero-Seitenleiste auswählbar.
Einrichtung, Freigaben und tatsächlich geprüfte Ergebnisse: [MCP mit Codex und Claude](docs/MCP.md).
Die vollständige Aufgabenliste steht in [PROJEKTSTATUS.md](PROJEKTSTATUS.md).

## Entwicklung starten

Voraussetzungen: Node.js ab Version 20, npm, VS Code ab Version 1.95 und
eine Zotero-Desktopversion mit lokaler API.

1. Den Projektordner in VS Code öffnen.
2. Im Terminal `npm install` ausführen (bei vorhandener Lockdatei alternativ `npm ci`).
3. Zotero starten. Unter **Einstellungen → Erweitert** die Option aktivieren,
   die anderen Anwendungen auf diesem Computer die Kommunikation mit Zotero erlaubt.
4. **F5** drücken und „Zotero LaTeX Assistant starten“ auswählen.
   Der konfigurierte Build läuft vor dem Öffnen des Extension Development Host.
5. Im neuen VS-Code-Fenster links auf das Buchsymbol **Zotero** klicken.
   Die Seitenleiste lädt die persönliche Bibliothek und lokale Gruppen.
   **Meine Bibliothek** lässt sich aufklappen und zeigt die Sammlungen.
   Nur Sammlungen mit echten Unterordnern haben einen Aufklapppfeil.
   Ein Klick auf den Sammlungsnamen öffnet direkt die Quellenliste.
   **Alle Einträge** zeigt den gesamten Bibliotheksbestand, auch Quellen ohne Sammlung.
   Eine Bibliothek oder Sammlung anklicken, um ihre Quellen in der Tabelle zu sehen.
   Die Spalte **Anhänge** zeigt Symbole und Typen wie PDF oder Webseiten-Snapshot.
   Oben stehen außerdem Projektkonfiguration, `.bib`-Aktualisierung und DOI-Suche bereit.
   Bei Verbindungsproblemen zeigt ein Warnhinweis weitere Informationen beim Darüberfahren.
6. Alternativ die Befehlspalette mit **Strg+Umschalt+P** öffnen:
   - **Zotero: Verbindung prüfen** meldet, ob die lokale API erreichbar ist.
   - **Zotero: Bibliotheken anzeigen** zeigt die persönliche Bibliothek und lokale Gruppen.

Der Ausgabekanal **Zotero LaTeX Assistant** enthält Status- und Fehlermeldungen.
Für lokale Lesezugriffe sind weder API-Schlüssel noch Better BibTeX erforderlich.

Nach Änderungen am Extension-Manifest den laufenden Entwicklungsstart mit
**Umschalt+F5** stoppen und mit **F5** neu starten. Über das Aktualisierungssymbol
werden Bibliotheken und Sammlungen neu geladen. **Liste aktualisieren** lädt
die Quellen und Anhangsmetadaten der geöffneten Tabelle neu. Die Seitenleiste
lädt keine Quellen zusätzlich; der Abruf folgt bei Bedarf über die Ergebnisseiten. Die Projektzuordnung erfolgt über **Bibliothek festlegen** im Kontextmenü einer Bibliothek oder Sammlung. Alternativ
die entsprechende Aktion in der Befehlspalette wählen.

### Warnungen beim Entwicklungsstart

Die Debug Console enthält auch Meldungen anderer Erweiterungen. Warnungen über
`punycode` oder `url.parse()` zeigen die Verwendung veralteter Node.js-Funktionen;
der Zotero-Code verwendet diese Funktionen nicht. Eine Meldung mit dem Pfad
`github.copilot-chat` betrifft Copilot und belegt keinen Zotero-Fehler.

Für einen Start ohne andere installierte Erweiterungen unter **Ausführen und
Debuggen** die Konfiguration **Zotero LaTeX Assistant isoliert starten** wählen
und **F5** drücken. Die entwickelte Zotero-Extension wird weiterhin geladen.
Das erleichtert die Zuordnung von Meldungen. Der normale Entwicklungsstart
steht weiterhin zur Verfügung, insbesondere für die spätere KI-Anbindung.

Zotero-Meldungen stehen unter **Ausgabe → Zotero LaTeX Assistant**.
Die Seitenleiste bzw. ein Zotero-Befehl aktiviert die Extension und erzeugt den Ausgabekanal.
Quellen: [VS-Code-Extension-Tests](https://code.visualstudio.com/api/working-with-extensions/testing-extension),
[Node.js-Warnungen](https://nodejs.org/download/release/latest-jod/docs/api/deprecations.html).

```sh
npm run check     # TypeScript-Typprüfung
npm run compile   # JavaScript nach dist/ kompilieren
npm run watch     # Bei Änderungen automatisch kompilieren
npm test          # Tests des lokalen Zotero-Clients
npm run test:live # Opt-in: echte VS-Code-/Zotero-Prüfung im temporären Testprojekt
npm run package   # VSIX mit gebündelter Extension und eigenständigem MCP-Server
```

Build, Typprüfung und Watch-Modus berücksichtigen sowohl die Extension als auch
das separate TypeScript-Skript der Quellenliste. Die Bibliografie-Verarbeitung
liegt unabhängig von der VS-Code-Oberfläche in `src/biblatex/update.ts`.

## Konfiguration

`zoteroLatexAssistant.apiUrl` ist standardmäßig `http://localhost:23119/api/`.
`zoteroLatexAssistant.requestTimeoutMs` ist standardmäßig `5000`.
Beide sind Maschineneinstellungen; der lokale Adapter akzeptiert nur Loopback-Adressen.

### Bibliothek, Bib-Datei und Zitierstil unabhängig festlegen

Es gibt drei getrennte Aktionen. Sie funktionieren in beliebiger Reihenfolge:

1. **Zotero: Bibliothek festlegen** wählt ausschließlich die Bibliothek und
   optional eine Projekt-Sammlung. Auch im Kontextmenü einer Bibliothek oder
   Sammlung verfügbar. Bib-Datei und Zitierstil werden dabei nicht abgefragt.
2. **Zotero: .bib-Datei festlegen** wählt eine vorhandene `.bib` oder legt ihren
   Namen / relativen Projektpfad fest. Die Bibliothekszuordnung bleibt erhalten.
   Eine einzelne Datei und eindeutige `\addbibresource`- bzw. `\bibliography`-
   Verweise werden erkannt. Bei mehreren passenden Dateien entscheidet der Benutzer.
   Kommentare und Codebeispiele in `\verb`, `verbatim`, `lstlisting` oder
   `minted` zählen dabei nicht als Ressourcenverweise. Unvollständiger TeX-Code
   verhindert nur die automatische Empfehlung; die Dateiauswahl bleibt verfügbar.
   Beim Wechsel werden die bisherigen Ressourcenverweise in lokalen `.tex`-,
   `.ltx`-, `.sty`- und `.cls`-Dateien angepasst; zusätzliche Ressourcen bleiben
   erhalten. Für einen neuen, noch nicht vorhandenen Pfad wird die bisherige
   Bib-Datei kopiert. Eine vorhandene Zieldatei wird mit ihrem Inhalt verwendet.
   Die alte Datei bleibt erhalten. Bei eingerichtetem BibLaTeX werden fehlende
   Ressourcenverweise und die Bibliografieausgabe ergänzt. „Stil zuerst“ und
   „Bib-Datei zuerst“ führen zur selben vollständigen Einrichtung.
3. **Zotero: Change BibLaTeX citation style** wählt einen lokal installierten
   BibLaTeX-Stil. Die Extension liest die Suchpfade der TeX-Installation über
   `kpsewhich` und bietet nur Stile mit auflösbarer `.bbx`- und `.cbx`-Datei an.
   Es werden keine Stile heruntergeladen oder Pakete installiert. Der Pfad zu
   `kpsewhich` lässt sich über `zoteroLatexAssistant.kpsewhichPath` einstellen.

Die erste Aktion erstellt `.zotero/config.json`. Noch nicht gewählte Angaben
werden mit `library: null` und `bibFile: ""` gespeichert. Die Quellenliste ist
mit festgelegter Bibliothek nutzbar; vor dem Import muss zusätzlich eine
Bib-Datei festgelegt sein. Bestehende vollständige Konfigurationen bleiben gültig.
Beispiel einer vollständig eingerichteten Konfiguration:

```json
{
  "version": 1,
  "library": { "type": "user", "id": 0 },
  "collectionKey": "",
  "bibFile": "literatur.bib",
  "citationStyle": "authoryear",
  "citationStyleType": "biblatex",
  "citationCommand": "autocite",
  "importedItemKeys": [],
  "citationKeys": {}
}
```

Ein leerer Sammlungsschlüssel verbindet die gesamte Bibliothek. Gruppen werden
mit `type: "group"` und ihrer tatsächlichen numerischen ID gespeichert. Zotero 10+
ergänzt die `serverId`, damit ein anderes Zotero-Datenverzeichnis erkannt wird.
Ohne Server-ID ist nur die Bibliotheks-/Sammlungszuordnung prüfbar. Eine `.bib`
allein verrät nicht zuverlässig, aus welcher Zotero-Bibliothek sie stammt;
diese Zuordnung wird deshalb ausdrücklich ausgewählt und gespeichert.
Bei mehreren Workspace-Ordnern gilt der aktive Editorordner; andernfalls wird
bei Aktionen der Projektordner abgefragt. Die Konfiguration enthält keine Schlüssel.

Über das Zahnrad oder den Zotero-Eintrag in der Statusleiste lassen sich Bibliothek,
Bib-Datei und Zitierstil jeweils unabhängig festlegen sowie die Konfiguration öffnen. Das
JSON-Schema bietet dabei Vervollständigung und Fehlerhinweise. Frühere
VS-Code-Projekteinstellungen werden nicht automatisch als bestätigte Zuordnung
übernommen; der dort eingestellte Zitierbefehl dient als Vorgabe bei der Einrichtung.
Sammlungen können innerhalb derselben Bibliothek und Zotero-Datenbank auch nach
dem Import gewechselt werden; ebenso kann wieder die gesamte Bibliothek gewählt
werden. Beim Wechsel bleiben nur bereits importierte Quellen erhalten, die auch
zur neu ausgewählten Sammlung gehören. Ihre Feldinhalte und Zitier-Schlüssel
bleiben unverändert. Andere Einträge werden aus der aktiven `.bib` entfernt,
zusammen mit den zugehörigen Zitationen im Projekt; gemischte Zitationen behalten
ihre verbleibenden Quellen. Bei einer leeren Sammlung enthält die `.bib` danach
keine Quelleneinträge. Neue Sammlungsquellen werden weiterhin gezielt importiert.
Bib-Datei, Zitate und Projektzuordnung werden gemeinsam mit Sicherung geändert;
ungespeicherte Änderungen, fehlerhafte Abrufe und zwischenzeitliche Dateiänderungen
verhindern den Wechsel. Der Wechsel
in eine andere Bibliothek oder Zotero-Datenbank bleibt bei importierten Quellen
gesperrt, damit bestehende Zuordnungen erhalten bleiben.

**BibLaTeX-Stile und Projektdateien:** Die Auswahl speichert den Stilnamen in
`.zotero/config.json` und setzt `style=…` in vorhandenen
`\usepackage`- bzw. `\RequirePackage`-Deklarationen für BibLaTeX. Dabei werden
abweichende `bibstyle`-/`citestyle`-Optionen entfernt; andere Optionen wie
`backend`, `sorting` und `autocite` bleiben erhalten. Auch vorangestellte
`\PassOptionsToPackage`-Stiloptionen werden bereinigt. Die Extension prüft
`.tex`, `.sty` und `.cls` im Projekt; generierte Verzeichnisse und Sicherungen
sind ausgenommen. Ein Hauptdokument ohne BibLaTeX-Paket erhält eine Deklaration,
sofern auch seine eingebundenen lokalen Dateien das Paket nicht laden. Ist eine
Projekt-`.bib` ausgewählt, werden fehlende `\addbibresource`-Verweise und eine
fehlende `\printbibliography`-Ausgabe in vollständigen Hauptdokumenten ergänzt.
Vorhandene Einträge in eingebundenen Dateien bleiben erhalten. Eine fehlende
`.zotero/config.json` wird angelegt; ohne LaTeX-Dateien wird nur die
Projektkonfiguration gespeichert. Die `.bib` selbst entsteht weiterhin beim Import.

Ungespeicherte Änderungen müssen vor dem Stilwechsel gespeichert werden.
Originaldateien liegen danach unter `.zotero/backups/style-…`; alle Dateien
werden vorab geprüft und bei einem Schreibfehler bereits geschriebene Änderungen
zurückgesetzt. Kommentare und wörtliche LaTeX-Beispiele werden nicht als aktive
Paketdeklarationen behandelt. Klassische `\bibliographystyle`-Projekte benötigen
zuerst eine Umstellung auf BibLaTeX. Dynamisch erzeugte Paketoptionen und externe
Dokumentklassen können nicht allgemein automatisch umgeschrieben werden.

Frühere CSL-Konfigurationen bleiben lesbar. Beim Auswählen eines BibLaTeX-Stils
wird die frühere CSL-Sprachvorgabe entfernt. Neue Seitenangaben werden als reine
Zahlen eingefügt, z. B. `\autocite[14–16]{quelle}`; BibLaTeX bestimmt die
Seitenbezeichnung anhand der Dokumentsprache. Der Stilwechsel verändert keine
Quellenschlüssel, bestehenden Zitate oder Literaturmetadaten. Der Zitierbefehl
wird weiterhin beim Einfügen über „Quelle zitieren“ verwendet.

### Was bedeutet „Zitierbefehl ändern“?

Der Zitierbefehl ist der LaTeX-Befehl für eine einzelne Quellenangabe im Text.
Er bestimmt, wie die Zitation in den Satz eingebunden wird. Der Zitierstil
bestimmt die genaue Darstellung. Beispiele für einen Autor-Jahr-Stil:

- `\parencite{quelle}`: Quellenangabe in Klammern, etwa **(Müller, 2024)**.
- `\textcite{quelle}`: Autor ist Teil des Satzes, etwa **Müller (2024)**.
- `\autocite{quelle}`: folgt der `autocite`-Einstellung des LaTeX-Dokuments,
  beispielsweise als Klammerangabe oder Fußnote.

Die Auswahl bestimmt den Befehl für **Quelle zitieren**. Sie verändert weder
bestehende Zitate noch die Bib-Datei oder den Zitierstil. Beispiele und Bedeutung
stehen auch direkt in der Auswahl in VS Code.
Quelle: [BibLaTeX-Dokumentation](https://mirrors.ctan.org/macros/latex/contrib/biblatex/doc/biblatex.pdf).

### Import und manuelle Aktualisierung

- Eine Bibliothek oder Sammlung anklicken: Die Quellenliste zeigt Titel, Ersteller
  und Eintragsart, Anhangstypen sowie eine Checkbox und **In Zotero öffnen** pro Zeile.
  Die Ersteller-Spalte zeigt höchstens drei Namen. Bei weiteren Autoren steht
  darunter z. B. **+14 weitere · 17 insgesamt**. Der Filter berücksichtigt alle Namen.
- Die Checkboxen spiegeln den tatsächlichen Inhalt der ausgewählten Projekt-`.bib`
  wider. Die Zuordnung erfolgt über gespeicherte, ältere technische oder lokal
  verfügbare Zotero-/Better-BibTeX-Zitier-Schlüssel; der Importbestand allein gilt
  nicht als Nachweis. Vorhandene Quellen sind angehakt und mit **In project .bib**
  gekennzeichnet. Mehrdeutige Zuordnungen werden nicht geraten.
- **Update project .bib** übernimmt die komplette Auswahl der geöffneten Liste:
  angehakte Quellen bleiben enthalten oder werden ergänzt; abgewählte Quellen
  werden aus der `.bib` und ihrer Projektzuordnung entfernt. Ihre Zitierverweise
  werden zugleich aus lokalen `.tex`-, `.ltx`-, `.sty`- und `.cls`-Dateien entfernt.
  Aus `\parencite[14]{A,B}` wird beim Abwählen von A `\parencite[14]{B}`;
  ein ausschließlich auf A verweisender Befehl wird vollständig entfernt.
  Mehrfachzitationen erhalten die anderen Quellen samt Seitenangaben und Zusätzen.
  Zitierter Text bleibt erhalten. Auch eine vollständig
  leere Auswahl ist möglich. Quellen außerhalb der geöffneten Liste sowie nicht
  zugeordnete Einträge bleiben erhalten. Der Textfilter schränkt nur die Anzeige
  ein, nicht die synchronisierte Auswahl.
- Beim Synchronisieren bleiben bestehende Feldinhalte und manuelle Ergänzungen
  angehakter Einträge erhalten. Direkte Löschungen in der `.bib` werden beim
  Speichern automatisch in den Häkchen der offenen Liste sichtbar. Dateiwechsel
  und fehlende Dateien werden ebenfalls berücksichtigt. Beschädigte Dateien
  zeigen eine Fehlermeldung. Vor dem Schreiben werden `.bib`, Konfiguration und
  geänderte LaTeX-Dateien gemeinsam gesichert; Schreibfehler setzen bereits
  geschriebene Änderungen zurück. Offene LaTeX-Änderungen vorher speichern.
  Dynamische Zitier-Schlüssel aus TeX-Makros lassen sich nicht eindeutig einer
  abgewählten Quelle zuordnen; solche Fälle brechen vor Dateiänderungen ab.
- **DOI / Titel suchen** und **Liste aktualisieren** stehen ebenfalls über der
  Liste und bleiben beim Scrollen sichtbar. **Refresh list** lädt den Zotero-Bestand
  neu und liest den aktuellen `.bib`-Inhalt. Noch nicht übernommene Änderungen an
  Häkchen bleiben erhalten, solange sich die zugehörige Dateizugehörigkeit nicht
  geändert hat. Ein Filter sucht nach Titel, Ersteller, Jahr und DOI.
- **Zotero: .bib manuell aktualisieren** exportiert die tatsächlich vorhandenen,
  eindeutig zugeordneten Quellen erneut. Liste, Zitieren und Metadatenexport
  verwenden dieselbe Erkennung über gespeicherte, Extra- oder lokale BBT-Schlüssel.
  Manuell gelöschte Einträge werden dabei nicht wiederhergestellt. Sind keine
  zugeordneten Einträge vorhanden, können mehrere Quellen
  aus der verbundenen Sammlung ausgewählt werden. Nicht jede Zotero-Quelle wird
  automatisch Projektliteratur.
- Neue Quellen und manuelle Metadatenaktualisierungen verwenden standardmäßig
  den vollständigen **Better BibLaTeX**-Translator des lokal installierten
  Better-BibTeX-Plugins. Die Extension ruft dessen lesende JSON-RPC-Methode
  `item.export` auf und übernimmt die vollständige Ausgabe einschließlich
  zusätzlicher BibLaTeX-Felder, Makros und Zeichenformatierung.
- Dafür muss **Better BibTeX for Zotero** installiert und aktiviert sein.
  Fehlt das Plugin oder schlägt der Translator fehl, wird vor dem Schreiben
  abgebrochen; es gibt keinen automatischen Wechsel zum nativen Export.
  Als ausdrücklich gewählte Alternative lässt sich die Projekteinstellung
  `zoteroLatexAssistant.bibliographyExporter` auf `native` setzen. Die Vorgabe
  ist `better-biblatex`; vorhandene Zitier-Schlüssel bleiben in beiden Modi stabil.
- Fehlt Better BibTeX beim Import oder Zitieren, bietet die Extension direkt
  **Use Zotero export** an. Diese ausdrückliche Auswahl speichert `native` nur
  für den betreffenden Workspace-Ordner und setzt denselben Vorgang fort:
  Quelle lokal exportieren, `.bib` und Zuordnung speichern, danach zitieren.
  Abbrechen schreibt keine neuen Bib-Einträge und fügt keine Zitation ein.
  Die Quellenliste bleibt danach bedienbar; Filter und Auswahl bleiben erhalten.
  Normale Translator-, Verbindungs- oder Dateifehler wechseln den Exporter nicht.
- Die Checkbox-Synchronisierung erhält vorhandene Feldinhalte und exportiert
  nur fehlende Einträge. Erhalten oder Entfernen bereits vorhandener Quellen
  benötigt keinen neuen Translator-Aufruf. **Update .bib manually** exportiert
  die Metadaten dagegen erneut über den ausgewählten Exporter.
- Persönliche Bibliothek und Gruppen werden getrennt aufgelöst. Bei Gruppen
  wird die interne BBT-Bibliotheks-ID anhand der verifizierten Quellen-URI und
  der Bibliotheksliste ermittelt; sie wird nicht mit der externen Gruppen-ID
  gleichgesetzt. Mehrdeutige Bibliotheksnamen oder Exportantworten brechen ab.
  Quelle: [Better-BibTeX JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/).
- Die Zuordnung wird einmal in `citationKeys` in `.zotero/config.json` gespeichert.
  Import, Aktualisieren und Zitieren verwenden danach denselben Schlüssel,
  auch wenn sich Titel, Datum oder der Zotero-Schlüssel später ändern.
- Bereits vor dieser Änderung importierte technische Schlüssel wie
  `zotero-user-0-TR2DJVAT` bleiben unverändert. Eine automatische Umbenennung
  vorhandener Zitate findet nicht statt. Neue Quellen bekommen die Zotero-/BBT-Namen.
- Doppelte oder für LaTeX ungeeignete Schlüssel werden vor dem Schreiben
  abgewiesen. Eindeutige Namen in Zotero / Better BibTeX festlegen.
- Nicht zugeordnete Einträge, Makros und Kommentare bleiben erhalten. Beim
  Einzelimport werden nur die ausgewählten Quellen neu exportiert; andere
  vorhandene Feldinhalte bleiben erhalten. Ein ausdrücklicher Metadatenexport
  ersetzt dagegen die Felder der erkannten Quellen. Direkte Löschungen werden
  auch innerhalb des markierten Bereichs berücksichtigt. Gespeicherte Namen
  gelöschter Quellen bleiben für späteres erneutes Zitieren stabil; das Abwählen
  in der Liste entfernt die Zuordnung ausdrücklich.
- Doppelte Schlüssel, beschädigte Einträge, Exportfehler und ungespeicherte
  Editoränderungen brechen die Aktualisierung ab. Einzelimport, Metadatenexport,
  Checkbox-Synchronisierung und Autoimport beim Zitieren sichern Bib-Datei und
  Konfiguration gemeinsam unter `.zotero/backups/bibliography-…/`; bei einem
  Schreibfehler werden bereits geschriebene Änderungen zurückgesetzt.
- Absolute Pfade, Pfade außerhalb des Projekts und dorthin führende Symlinks
  werden abgewiesen. Exportfehler liefern keinen Teilbestand. Dateien werden
  erst nach vollständigem Export ersetzt; zwischenzeitliche Änderungen werden geprüft.

### Dubletten beim Bib-Import prüfen

Neue Importe, Listen-Synchronisierung und Metadatenaktualisierung prüfen den
vorbereiteten Bib-Bestand, bevor Dateien geändert werden:

- **Gleiche DOI:** Unterschiedliche Einträge mit derselben normalisierten DOI
  brechen den Vorgang ab. `doi:`-/`doi.org`-Präfixe, Groß-/Kleinschreibung,
  URL-Kodierung und einfache TeX-Escapes werden berücksichtigt.
- **Titel, Autorennamen und Jahr:** Bei ausreichenden Angaben werden normalisierter
  Titel, Autorennachnamen und Publikationsjahr verglichen. Mögliche Dubletten
  zeigen einen Dialog mit beiden Schlüsseln und den bibliografischen Angaben.
  Erst **Import anyway** übernimmt sie; Abbrechen erhält den ursprünglichen Bestand.
- Zwei ausdrücklich unterschiedliche DOIs werden als unterschiedliche
  Veröffentlichungen behandelt. Fehlende Angaben und nicht auflösbare Makros
  werden nicht geraten. Lokale `@string`-Definitionen und Verkettungen werden
  berücksichtigt; `@xdata`- und `@set`-Einträge sind keine eigenständigen Publikationen.
- Bereits unverändert vorhandene Dubletten blockieren keine unabhängige Änderung.
  Wird eine Quelle beim Synchronisieren entfernt und durch eine andere ersetzt,
  wird der tatsächlich resultierende Bestand geprüft.

Die Prüfung betrifft die Projekt-`.bib`. Sie führt keine Quellen zusammen und
ändert keine Zotero-Metadaten. Die zusätzliche bibliotheksweite Dublettenprüfung für KI-Neuanlagen in Zotero
ist über `zotero_check_duplicates` und `zotero_create_item` implementiert.

Der MCP kann Quellen direkt über DOI oder ISBN anlegen:
`zotero_lookup_identifier` liefert eine Vorschau, `zotero_import_identifier`
übernimmt die Quelle in die ausgewählte Sammlung. DOI-Recherche nutzt Crossref
mit DataCite-Fallback; ISBN-Recherche nutzt Open Library und prüft die Buchausgabe.
Neuanlagen bekommen einen festen Zitierschlüssel, der beim späteren `.bib`-Import
erhalten bleibt. Gleiche DOI und ISBN-Buchausgaben werden bibliotheksweit geprüft.
**Nur Quellenart und Titel sind Pflichtangaben.** Weitere Felder bleiben optional;
fehlende empfohlene Angaben werden gemeldet, blockieren das Anlegen aber nicht.
`zotero_get_item_schema` zeigt zulässige Felder/Rollen je Typ,
`zotero_validate_metadata` prüft die Angaben. Details und Aufrufbeispiele stehen
in der [MCP-Dokumentation](docs/MCP.md#optionale-angaben-zitierschlüssel-und-identifier-import).

`zotero_attach_pdf` hängt eine lokale PDF als gespeicherte Kopie an eine bestehende
Quelle der Projektsammlung an. Benötigt werden der absolute Dateipfad, die gelesene
Quellenversion und eine stabile Anfrage-ID. Identische gespeicherte PDF-Anhänge
werden wiederverwendet, bestehende Dateien bleiben erhalten. Der MCP prüft den
gespeicherten Inhalt und setzt unterbrochene Uploads am selben Anhang fort.
[Aufruf und Grenzen](docs/MCP.md#lokale-pdfs-anhängen).

### Alle Zitationen löschen und die Bibliothek wechseln

**Zotero: Delete all citations** steht in der Befehlspalette und unter
**Configure project** zur Verfügung. Der Befehl öffnet zunächst eine vollständige
Vorher-/Nachher-Vorschau. Erst **Delete all citations** im Bestätigungsdialog
wendet die Änderungen auf den ausgewählten Projektordner an:

- Bekannte Zitierbefehle mit Seitenangaben, Zusätzen und Mehrfachzitationen werden
  aus `.tex`-, `.ltx`-, `.sty`- und `.cls`-Dateien entfernt. Lokal über
  `DeclareCiteCommand` / `DeclareMultiCiteCommand` definierte Befehle werden erkannt.
  Kommentare und Literalbeispiele bleiben erhalten; integrierte csquotes-Zitate
  werden in Zitatformatierung ohne Literaturverweis umgewandelt, damit der Text bleibt.
- Zugeordnete importierte Einträge und Einträge im verwalteten Zotero-Bereich
  werden aus der aktiven `.bib` entfernt. Unabhängige Bib-Einträge, Makros und
  Kommentare bleiben erhalten; Verweise auf entfernte Einträge werden bereinigt.
- Bibliothek, Sammlung, Datenbankbindung, Importbestand und Schlüsselzuordnung
  werden gemeinsam zurückgesetzt. Bib-Dateipfad, Stil und Zitierbefehl bleiben erhalten.
  Danach **Set library** wählen; auch eine andere Bibliothek oder Datenbank ist möglich.

Der Vorgang funktioniert offline und bei fehlender `.bib`; in Zotero wird nichts
gelöscht. Betroffene Originaldateien werden unter `.zotero/backups/reset-…/`
gesichert. Abbrechen, ungespeicherte Änderungen und Änderungen während der
Vorschau verhindern das Löschen; ein Schreibfehler setzt abgeschlossene Änderungen
einschließlich Bibliotheksbindung zurück. Beschädigte Argumente oder nicht auflösbare
Bib-Referenzen müssen vor einer sicheren Löschung korrigiert werden.

### Bestehende Zitier-Schlüssel ausdrücklich migrieren

**Zotero: Migrate existing citation keys** ist in der Befehlspalette und unter
**Configure project** verfügbar. Es gibt zwei Möglichkeiten:

1. **Rename one citation key:** Eine importierte Quelle auswählen und einen neuen
   Namen eingeben. Das funktioniert ohne laufendes Zotero oder BBT-Plugin.
2. **Use current Better BibTeX keys:** Aktuelle Namen lesend aus dem lokalen Plugin
   übernehmen und die gewünschten Änderungen auswählen. Es werden keine Schlüssel
   in Zotero regeneriert.

Danach öffnet die Extension eine vollständige Vorher-/Nachher-Vorschau unter
`.zotero/migration-preview-….md`. Erst **Migrate keys** schreibt die Änderungen:

- Schlüssel in der Projekt-`.bib` und die persistierte `citationKeys`-Zuordnung;
- literale Zitatargumente in `.tex`, `.ltx`, `.sty` und `.cls`, einschließlich
  `\cite`, `\autocite`, `\parencite`, `\textcite`, `\nocite`, Mehrfachzitationen,
  Sternvarianten und lokal mit `\DeclareCiteCommand` deklarierten Zitierbefehlen;
- bibliografische Verweise wie `crossref`, `xref`, `related`, `entryset` und `xdata`
  auch in weiteren lokalen `.bib`-Dateien.

Kommentare, wörtliche Beispiele, Prenotes/Postnotes und sonstige Feldinhalte bleiben
erhalten. Kollisionen mit bestehenden Schlüsseln oder Aliasnamen, mehrdeutige
Schlüssel in weiteren Bib-Dateien und nicht auflösbare Referenzen brechen ab.
Dynamische Zitierargumente und Makro-Wrapper müssen zuerst in literale Schlüssel
umgewandelt werden; sie werden nicht stillschweigend geraten.

Alle relevanten Dateien müssen gespeichert sein. Auch neue Dateien, ungespeicherte
Änderungen oder Dateiänderungen während der Vorschau machen den Plan ungültig.
Originale liegen unter `.zotero/backups/migration-…`; die Änderungen werden gemeinsam
angewendet und bei einem Schreibfehler zurückgesetzt. Der verwaltete Bib-Bereich
bekommt einen aktualisierten Prüfsummenwert. Bei späteren Metadatenexporten werden
interne Verweise auf die persistenten Projektschlüssel zurückgeführt, damit sie
nach der Migration weiter funktionieren.

Zotero selbst und andere Projekte werden durch diesen Befehl nicht geändert.

### Zitier-Schlüssel in Zotero / Better BibTeX festlegen

Der Zitier-Schlüssel steht nach dem Eintragstyp in der `.bib`, zum Beispiel
`@article{michell_it_1997, …}`. Better BibTeX verwaltet diese Namen in Zotero;
die Extension übernimmt sie über die lesende JSON-RPC-Schnittstelle. Bei explizit
gewähltem `native`-Export ohne das Plugin stammt der Name aus dem normalen
Zotero-Export. Dort kann auch im
Zotero-Feld **Extra** eine Zeile wie `Citation Key: MeinSchluessel2024` hinterlegt
werden. Format und Schlüssel werden in Zotero gepflegt, nicht in einer zweiten
Metadatenoberfläche. Quellen: [Better-BibTeX-Schlüssel](https://retorque.re/zotero-better-bibtex/citing/),
[Zotero-BibLaTeX-Exporter](https://github.com/zotero/translators/blob/master/BibLaTeX.js).

Nach dem Import zeigt die Quellenliste den im Projekt verwendeten Namen an.
Er kann auch im Tabellenfilter und in der oberen Zitier-Quellensuche gefunden
werden. Die gespeicherte `citationKeys`-Zuordnung nicht separat von Bib-Datei
und vorhandenen LaTeX-Zitaten ändern oder löschen.

Für neu übernommene Schlüssel ist außerdem das Zurückschreiben in Zotero
implementiert: Bei einer mit Zotero 10+ verbundenen Bibliothek wird nach dem
Bib-Import ausschließlich `Citation Key: …` in **Extra** ergänzt. Andere Felder
bleiben erhalten. Die lokale Schreibfreigabe wird bei Bedarf in Zotero angefragt;
nur dauerhaft erlaubte Zugangsdaten werden in VS-Code-SecretStorage gespeichert.
Schon gesetzte andere Schlüssel werden nicht ungefragt überschrieben. Bei
fehlender Schreibunterstützung / Freigabe bleibt die .bib samt Schlüsselzuordnung
im Projekt erhalten; weitere Freigabeversuche werden nach einem Fehler beendet.
Quelle: [Lokale Zotero-Schreibfreigabe](https://www.zotero.org/support/dev/web_api/v3/local_api).

### Quellen im LaTeX-Dokument zitieren

1. Bibliothek und Projekt-.bib festlegen und ein gespeichertes `.tex`-Dokument
   im Projekt öffnen. Den Cursor an die gewünschte Stelle setzen.
2. **Rechtsklick im LaTeX-Text → Zitieren …** wählen. Oben öffnet sich die
   Quellensuche. Titel, Autor, Jahr oder DOI eintippen und die Quelle auswählen.
3. Optional eine Seitenzahl / Fundstelle angeben, z. B. `14`, `14–16` oder `Kap. 3`.
   Für das gesamte Werk leer lassen und mit Enter bestätigen. Bei einer reinen
   Seitenzahl ergänzt der LaTeX-Stil die Bezeichnung üblicherweise selbst.
4. Optional einen Zusatz vor der Quellenangabe eingeben, z. B. `vgl.` oder `siehe`.
   Ohne Zusatz ebenfalls leer lassen und mit Enter bestätigen.

Die Extension fügt den konfigurierten Befehl ein, beispielsweise:

```latex
\parencite[vgl.][14–16]{zotero-user-0-ABCDEFGH}
```

Alternativ **Zotero: Zitieren …** in der Befehlspalette wählen. Über **Zitieren**
in einer Quellenzeile ist die Quelle bereits ausgewählt; dort werden nur noch
Seitenzahl / Fundstelle und Zusatz abgefragt. Die Angaben gelten für die konkrete
Textstelle und verändern keine Zotero-Metadaten. Beim Abbrechen eines Schritts
werden weder Quellen importiert noch Zitationen eingefügt. Sonderzeichen werden
als normaler Text eingefügt; die Felder sind nicht für rohe TeX-Befehle gedacht.

Fehlt der Eintrag in der Projekt-.bib, wird er vor dem Einfügen über den
bestehenden geschützten Import übernommen. Vorhandene Einträge werden über
dieselbe Bestandserkennung wie in der Liste erkannt. Gespeicherte und eindeutige
Extra-Schlüssel funktionieren ohne Zotero-Abruf; externe BBT-Schlüssel benötigen
eine lesende lokale Schlüsselabfrage. Vorhandene unzugeordnete Einträge werden
mit ihrem tatsächlichen Schlüssel übernommen, ohne ihre Bib-Felder zu exportieren.
Neue Imports müssen zur verbundenen Bibliothek und Sammlung gehören.
Notizen und Anhänge sind nicht zitierbar. Die Tabelle behält ihre Auswahl
und wird nach einer Zitation ohne erneuten Listenabruf dargestellt.

Markierter Text bleibt erhalten; eingefügt wird an der aktiven Cursorposition.
Mehrere Cursor werden unterstützt. Die Textänderung lässt sich mit der normalen
Rückgängig-Funktion zurücknehmen. Wenn das Zieldokument während der Vorbereitung
geändert oder geschlossen wird, erfolgt keine Einfügung an einer veralteten
Position. Ein gegebenenfalls bereits abgeschlossener Bib-Import bleibt erhalten.
Ungespeicherte Änderungen an Projektkonfiguration oder Bib-Datei müssen vorab
gespeichert werden. Änderungen am LaTeX-Text selbst bleiben wie üblich im Editor
und werden nicht automatisch gespeichert.

Die Stil- und Bib-Dateiauswahl verbinden vollständige Hauptdokumente mit
BibLaTeX und der Projektbibliografie. Dynamische Ressourcenpfade mit TeX-Makros
oder mehrdeutige Verweise in gemeinsam genutzten Dateien müssen vor einem
automatischen Dateiwechsel ausdrücklich aufgelöst werden.

### Quellenliste und DOI-Suche

Die Quellenliste ersetzt die bisherige Detailansicht mit Metadatenformular.
Titel und Checkbox wählen eine Quelle für die Projekt-.bib aus; am Ende jeder Zeile
öffnet **In Zotero öffnen** den entsprechenden Eintrag in Zotero. Dort können
Metadaten angezeigt und bearbeitet werden. In VS Code erscheint kein separates
Metadatenformular mehr. Die Liste lässt sich zusätzlich über **Zotero: Quellenliste
öffnen** und das Kontextmenü einer Bibliothek oder Sammlung aufrufen.

Ändert sich die Zotero-Datenbankbindung des Projekts, werden alte Quellenlisten
geschlossen. Die Liste danach erneut öffnen: Quellen und Schlüssel werden neu
geladen, die Auswahl aus der vorherigen Datenbank wird verworfen. Ein bereits
geöffneter Zitierdialog übernimmt bei geänderter Bindung keine alten Quellen.

**Zotero: DOI / Literaturtitel suchen** akzeptiert eine DOI, einen doi.org-Link
oder einen Publikationstitel. Es sendet ausschließlich die eingegebene Suchanfrage
an Crossref und zeigt die gefundenen Metadaten in VS Code. DOI kopieren und die
Publikation öffnen sind verfügbar. Die Suche legt keine Zotero-Einträge an;
Crossref deckt ausschließlich die dort registrierten DOIs ab.
Quelle: [Crossref REST API](https://github.com/CrossRef/rest-api-doc).

## Struktur

```text
src/
  extension.ts           Aktivierung und Lebenszyklus
  zotero/                Lokaler Client, Anfragekoordination und Anhangsmetadaten
  biblatex/              Nativer Export, sicherer Import und Zitationsablauf
  pdf/                   Historische Platzhalter; keine lokale Textextraktion
  research/              Crossref-DOI-/Titelsuche; weitere Anbieter vorbereitet
  views/                 Native Befehle und Zotero-TreeView
  config/                .zotero-Projektkonfiguration und sichere Projektdateien
  shared/                Gemeinsame Typen und Fehler
mcp/
  server.ts              Eigenständiger stdio-Server mit elf Werkzeugen
  tools/                 Werkzeugübersicht
test/                    Tests mit simulierten Zotero-Antworten
docs/                    Projektauftrag und Architekturentscheidungen
.vscode/                 F5-Start und Build-Aufgaben
PROJEKTSTATUS.md          Checkliste aller Entwicklungsphasen
```

Vorbereitete TypeScript-Module enthalten bewusst nur einen Kommentar und einen
leeren Export. Sie behaupten keine noch nicht implementierte Funktionalität.
Der Zotero-Client und gemeinsame Typen importieren kein `vscode` und können später
vom eigenständigen MCP-Server wiederverwendet werden.

## Prüfung und nächste Schritte

`npm run check` und `npm test` prüfen Typen, Client, Dateischutz, Exporte,
Stile, den vorbereiteten KI-Schreibadapter, Versionskonflikte, DOI-Recherche,
Mehrfachauswahl, Anhänge, Anfragebegrenzung, Zitationen und die Absicherung der Quellenliste. Die neue Oberfläche anschließend mit **F5**
neu starten und in einem LaTeX-Testprojekt verwenden.

`npm run test:live` startet die installierte VS-Code-Version mit einem eigenen
temporären Profil und erzeugten Testdateien. Nur in diesem Testprofil wird die
Workspace-Trust-Prüfung übersprungen. Der Test liest die lokale Zotero-Bibliothek,
verwendet den nativen BibLaTeX-Exporter und aktualisiert die Test-.bib über den
registrierten Extension-Befehl. Er prüft die Extension-Aktivierung, Befehle,
das Öffnen der echten Webview sowie Abbruch, Einfügen und Speichern einer
Zitation über die echte Editor-API. Bereits zugeordnete Testschlüssel vermeiden
Zotero-Rückschreibzugriffe. Der Runner wartet auf den Bericht des Extension Hosts
und gibt dessen Erfolg oder Fehler als Exit-Code zurück.

Dieser Live-Smoke wurde am 12. Oktober 2026 mit VS Code 1.141.0 erfolgreich
ausgeführt. Der [Ergebnisbericht](docs/live-smoke-report.json) dokumentiert die
sechs Prüfbereiche. Manuelle Buttons, Dialoge, Stilwechsel, mehrere Workspace-
Ordner und Zotero-Schreibfreigaben bleiben gesondert zu prüfen.

Der vollständige Better-BibLaTeX-Export ist implementiert und mit simulierten
Plugin-Antworten getestet. Die aktuell geprüfte lokale Zotero-Installation
liefert am BBT-Endpunkt 404; ein echter Translator-Durchlauf bleibt bis zur
Installation/Aktivierung des Plugins offen.

Der MCP-Server und bibliografische Neuanlagen sind implementiert. Weitere geplante
Funktionen: erweiterte externe Recherche und weitere Sammlungs-/Anhangsschreibwerkzeuge.
PDFs können über MCP bereits direkt an einen PDF-fähigen Agenten übergeben werden.
Details: [Architektur](docs/ARCHITEKTUR.md) und [Projektstatus](PROJEKTSTATUS.md).

## Quellenverwaltung und Anhangshinweise

Quellen, Metadaten, Sammlungen und Anhänge werden weiterhin in Zotero bearbeitet.
Die Extension ergänzt die Projektverbindung, .bib-Auswahl / Import, Zitierstil
und DOI-Recherche. Für die manuelle Quellenverwaltung gibt es keine zweite
Oberfläche. Der Tabellenfilter bleibt als schnelle Auswahlhilfe bestehen.

**Anhänge** zeigt pro Quelle ein Symbol mit Typbezeichnung, bei mehreren Dateien
auch eine Anzahl. Beim Darüberfahren erscheinen Dateiname oder Titel. Erkannt
werden PDF, Bild, Dokument, E-Book, Webseiten-Snapshot, Link, Audio, Video,
Archiv und sonstige Datei. **—** bedeutet kein Anhang; **?** bedeutet unbekannt,
wenn der Metadatenabruf fehlgeschlagen ist. Die Information sagt nicht aus, ob
die Datei auf diesem Rechner heruntergeladen oder verfügbar ist. Dateien werden
für diese Anzeige weder gelesen noch heruntergeladen; Öffnen und Verwalten
läuft über **In Zotero öffnen**. Die Metadaten werden gesammelt mit dem
`itemType=attachment`-Filter abgerufen, statt einzeln pro Quelle.
Quelle: [Zotero-Leseendpunkte und Filter](https://www.zotero.org/support/dev/web_api/v3/basics).

## Anfragen und mögliche Verbindungsprobleme

Ein Editorwechsel führt nicht mehr zum erneuten Bibliotheksabruf. Die Extension
führt Server-Anfragen nacheinander aus, bündelt gleichzeitige identische
Leseabrufe und hält JSON-Rohdaten höchstens 30 Sekunden im Cache (maximal 64
Antworten). **Liste aktualisieren** und **Bibliotheken aktualisieren** leeren
beim Aufruf den Cache. Der Tabellenfilter benötigt keine Zotero-Anfrage.

Nach einem Verbindungsabbruch oder Zeitlimit werden wartende Anfragen nicht
weitergeschickt. Für fünf Sekunden pausieren neue Abrufe, ohne automatischen
Neustart oder Wiederholungsversuche. Wiederholte Ergebnisseiten werden erkannt
und abgebrochen. Der Ausgabekanal **Zotero LaTeX Assistant** enthält Zeitstempel,
Listenaktionen, Laufzeiten und Fehlermeldungen für die Eingrenzung eines Problems.
Der mögliche gemeldete Zotero-Absturz konnte nicht reproduziert werden; diese
Änderungen reduzieren unnötige Last, belegen aber keine konkrete Absturzursache.

Statusmeldungen nach einer abgeschlossenen Aktion müssen nicht geschlossen werden,
bevor eine weitere Zotero-Aktion ausgeführt werden kann. Die Projektsperre schützt
nur laufende Einstellungs-/Dateivorgänge, nicht deren Benachrichtigungen.
