# Codeprüfung vom 12. Oktober 2026

Geprüft wurde der Arbeitsstand einschließlich uncommitteter und neuer Dateien sowie der tatsächlich gebündelten Extension im vorhandenen VSIX. Ergebnis der ursprünglichen Prüfung: **sechs reproduzierbare Fehler** — ein Befund mit hoher, vier mit mittlerer und einer mit niedriger Priorität.

Aktueller Status: **F1–F6 behoben**. Nach den Korrekturen bestehen 454 Tests, einschließlich des Extension-Bundle-Tests mit Stilwechsel, der Alias-Migration, der Schlüsselprüfung, sicherer Wiederholungen und der DOI-Institutionszuordnung über den tatsächlichen MCP-Transport.

## Umfang und Nachweise

- Extension-Aktivierung, Befehle, Quellenliste, Webview-Sicherheit und Bereitstellung ihrer Ressourcen.
- Projektkonfiguration, Dateipfade, Sicherungen, Rücksetzen, Sammlungswechsel, Import, Zitationen, Schlüsselmigration und BibLaTeX-/TeX-Parser.
- Zotero-Client, Caches, Serverbindung, Autorisierung, Versionsschutz und Better-BibTeX-Anbindung.
- Alle 16 MCP-Werkzeuge, Neuanlage, Updates, Papierkorb, DOI-/ISBN-Zuordnung, Anhangslesen und PDF-Schreibablauf.
- Eingabeschemas, optionale Felder, feste Zitierschlüssel, Dublettenprüfung, Uploadziele und Wiederaufnahme nach Fehlern.
- Build, TypeScript-Konfiguration, Paketinhalt und Abhängigkeiten.

`npm test` hat Build und beide TypeScript-Projekte ausgeführt: **344 Tests bestanden**. `git diff --check` ist erfolgreich. Sowohl `npm audit --omit=dev --json` als auch `npm audit --json` melden **0 bekannte Schwachstellen**. Das ist keine Garantie für Fehlerfreiheit.

Zusätzliche gezielte Reproduktionen haben die folgenden Lücken bestätigt. Zotero-Schreibvorgänge wurden dabei ausschließlich mit lokalen API-Testdoubles ausgeführt. Es wurden keine realen Bibliotheksobjekte angelegt, geändert oder gelöscht.

## F1 — P1: Die Quellenliste funktioniert im ausgelieferten Bundle nicht (behoben)

**Fundstelle:** [sourceListHtml.ts](../src/views/sourceListHtml.ts), Zeile 11; zusätzlich `package.json` und `scripts/bundle.cjs`.

`sourceListScript()` liest `../../webview/sourceList.js` relativ zu `__dirname`. Dieser Pfad stimmt für die getrennte TypeScript-Ausgabe unter `dist/src/views`, aber die tatsächliche Extension wird als `dist/extension.cjs` geladen. Dort zeigt derselbe Pfad außerhalb des Erweiterungsordners. Das Skript liegt im Paket unter `dist/webview/sourceList.js`.

**Reproduktion:** Das aktuelle Extension-Bundle wurde mit einer minimalen VS-Code-API im VM-Kontext geladen und `sourceListHtml()` aufgerufen. Ergebnis:

```text
ENOENT: no such file or directory, open '/home/finn/CodeProjekte/webview/sourceList.js'
```

Das geprüfte Extension-Bundle ist bytegleich mit dem Bundle im VSIX. Die Datei ist im Paket vorhanden; ihre Auflösung ist falsch. Das Öffnen der Quellenliste scheitert damit an einem normalen Benutzerpfad.

**Korrektur:** Die Ressource vom Extension-Verzeichnis aus auflösen oder das Webview-Skript beim Bundeln einbetten. Ein zusätzlicher Test muss das ausgelieferte Extension-Bundle und seine tatsächliche Ordnerstruktur verwenden.

**Umgesetzt:** `registerSourceList()` löst den Pfad über `context.extensionUri` auf und übergibt ihn dem HTML-Renderer. Der Skriptcache wird nach Dateipfad getrennt. `test/extensionBundle.test.ts` lädt das echte Bundle in einem isolierten Installationsordner mit Leerzeichen, aktiviert die Extension mit einer VS-Code-API-Testimplementierung und öffnet die Quellenliste über ihren registrierten Befehl. Geprüft werden das erfolgreiche HTML und der exakt enthaltene Browser-Code. Der Test scheitert gegen das ursprüngliche VSIX mit dem bestätigten `ENOENT` und besteht gegen den korrigierten Build sowie die aus dem neu erstellten VSIX entpackten Dateien. Die vollständige Suite besteht mit 345 Tests.

## F2 — P2: Schlüsselmigration lässt Alias-Zitate auf dem alten Schlüssel (behoben)

**Fundstelle:** [migration.ts](../src/biblatex/migration.ts), Zeilen 18–28 und 89–94.

Im ursprünglich geprüften Stand enthielt `citationCommands` den Befehl `defcitealias`, aber nicht `citetalias` und `citepalias`. Eine Migration änderte die Alias-Definition und den Bib-Eintrag, übersprang jedoch die Alias-Aufrufe. Die Löschlogik kannte diese Aufrufe bereits; die Migrationslogik war inkonsistent.

**Reproduktion:** `migrateTexReferences()` mit `oldKey → newKey`:

```tex
% Vorher
\defcitealias{oldKey}{Study I}
\citetalias{oldKey} and \citepalias{oldKey}

% Tatsächliches Ergebnis
\defcitealias{newKey}{Study I}
\citetalias{oldKey} and \citepalias{oldKey}
```

**Auswirkung:** Nach einer als erfolgreich gemeldeten Migration verweisen diese Zitate auf einen nicht mehr vorhandenen Schlüssel.

**Korrektur:** Beide Alias-Aufrufe in die Migrationsliste aufnehmen und eine Migration mit Alias-Definition und Alias-Aufrufen gemeinsam testen.

**Umgesetzt:** Beide Alias-Zitate gehören jetzt zu den erkannten Befehlen. Mehrfachzitate werden anhand der tatsächlichen `…cites`-Befehle bzw. `footcitetexts` erkannt, während die drei Alias-Befehle Einzelzitate bleiben. Das verhindert auch, dass ein Alias-Label als weiteres Schlüsselargument behandelt oder wegen enthaltener Formatierungsbefehle abgewiesen wird. Neue Tests prüfen Definition plus beide Aufrufe, Zählung/Vorschau, unveränderte Labels/Notizen, Kommentare/Verbatim/escaped Befehle und dynamische Schlüssel. Der registrierte Migrationsbefehl wurde mit echten temporären Projektdateien geprüft: `.bib`, Konfiguration und Alias-Zitate werden gemeinsam geändert und das Originalmanuskript gesichert. Die ergänzten Fälle reproduzierten den Fehler vor der Korrektur; die vollständige Suite besteht jetzt mit 349 Tests.

Das aktualisierte VSIX enthält den geprüften Build. Die Alias-Migration wurde zusätzlich direkt im entpackten Extension-Bundle bestätigt; der Quellenlisten-Bundle-Test aus F1 besteht ebenfalls mit diesem Paket.

## F3 — P2: Metadatenupdates können doppelte Zitierschlüssel speichern (behoben)

**Fundstelle:** [metadata.ts](../src/zotero/metadata.ts), Zeilen 40–47; [projectService.ts](../src/zotero/projectService.ts), Zeilen 250–282.

Im ursprünglich geprüften Stand durfte das native `citationKey`-Feld über `metadata.fields` geändert werden, wobei die Validierung lediglich die Zeichen prüfte. `assertCitationKeyAvailable()` wurde nur bei Neuanlagen aufgerufen; ein Update prüfte ausschließlich bibliografische Dubletten.

**Reproduktion:** Zwei Quellen mit `FirstKey` und `OccupiedKey` wurden im API-Testdouble angelegt. Ein Update der ersten Quelle mit `fields: { citationKey: "OccupiedKey" }` liefert `status: updated`. Anschließend besitzen beide Quellen denselben Schlüssel.

**Auswirkung:** Zotero kann widersprüchliche Schlüssel enthalten; spätere Exporte und Projektimporte können abbrechen oder Quellen nicht mehr eindeutig zuordnen.

**Korrektur:** Schlüsseländerungen entweder im Metadatenupdate ausschließen oder dieselbe bibliotheksweite Schlüsselprüfung wie bei Neuanlagen durchführen, jeweils unter Ausschluss der bearbeiteten Quelle und erneut nach der Autorisierung. Den Extra-Fallback entsprechend berücksichtigen.

**Umgesetzt:** Explizite native Schlüsseländerungen und Änderungen an Extra-Schlüsseln werden vor dem Schreiben sowie erneut nach der Autorisierung gegen andere Bibliotheksquellen, Better BibTeX, Projektzuordnungen und `.bib`-Einträge geprüft, unabhängig von Groß-/Kleinschreibung. Implizite alte Projektschlüssel bleiben ebenfalls reserviert. Die eigene Quelle und der ihr zugeordnete Eintrag in der Projektbibliografie werden ausgeschlossen. Ein gemeinsamer Extra-Parser wird für Lesen, Anlegen und Prüfen verwendet. Widersprüchliche native/Extra-Schlüssel und mehrere unterschiedliche Extra-Schlüssel werden abgewiesen; normale Notizänderungen behalten ihre Semantik. Das Leeren eines nativen Schlüssels kann keinen belegten Extra-Fallback aktivieren. Projektzuordnung und LaTeX werden nicht ungefragt migriert.

Neue Fälle reproduzierten sieben bisher ungeschützte Konfliktszenarien vor der Korrektur. Geprüft werden auch eigene Schlüssel, eindeutige Umbenennungen, BBT-Kollisionen einschließlich Änderungen während der Freigabe, reservierte Projekt-/Bib-Schlüssel einschließlich impliziter alter Zuordnungen, ungültige Angaben und explizites Leeren. Der offizielle MCP-Client prüft über den echten stdio-Prozess eine erlaubte Extra-Umbenennung und einen abgewiesenen Konflikt; die Quelle bleibt bei Ablehnung unverändert. Build, beide TypeScript-Projekte und die vollständige Suite bestehen mit 360 Tests.

Das neue VSIX ist gebaut und enthält die aktuellen Bundles. Die MCP-Transportprüfung besteht auch mit dem daraus entpackten Server; der Quellenlisten-Bundle-Test aus F1 bleibt erfolgreich.

## F4 — P2: Eindeutige Schreibablehnung blockiert Wiederholungen dauerhaft (behoben)

**Fundstelle:** [projectService.ts](../src/zotero/projectService.ts), Zeilen 359–370; [pdfImport.ts](../src/zotero/pdfImport.ts), Zeilen 118–130.

Die Journale werden unmittelbar vor dem POST auf `submitted` bzw. `create-submitted` gesetzt. Auch eine eindeutige HTTP-403-Ablehnung der eigentlichen Neuanlage lässt diesen Zustand bestehen. Eine spätere Wiederholung findet den reservierten Key nicht und wird dauerhaft als unklarer Ausgang behandelt.

**Reproduktion für Quellen:** Der eigentliche `POST /api/users/0/items` liefert HTTP 403, ohne ein Objekt zu erzeugen. Nach Wiederherstellung der Schreibrechte scheitert derselbe Auftrag mit:

```text
The previous create outcome is unresolved for <key>.
Inspect Zotero; this request will not be sent again.
```

**Reproduktion für PDFs:** Derselbe Ablauf bei der Anhangsneuanlage scheitert beim zweiten Versuch mit:

```text
Creation outcome is unresolved for attachment <key>.
It will not be submitted again.
```

Es wurde in beiden Fällen kein Objekt erzeugt. Dieses Verhalten unterscheidet sich von einem tatsächlich verlorenen Antwortpaket. Der Hinweis, denselben Auftrag zu wiederholen, führt bei der PDF-Funktion in eine Sackgasse.

**Korrektur:** Bestätigte Ablehnungen ohne Schreibeffekt getrennt von Netzwerkabbrüchen oder unklaren Serverfehlern behandeln. Den Auftrag bei einer eindeutig fehlgeschlagenen Neuanlage wieder in einen sicher wiederholbaren Zustand setzen; bei unklaren Ausgängen den bestehenden Schutz erhalten.

**Umgesetzt:** Der Schreibadapter meldet ausschließlich ausdrückliche Ablehnungen des eigentlichen Neuanlage-POSTs an das Journal zurück. Die HTTP-Fehler behalten ihren Statuscode; eine begrenzte Liste bestätigter Ablehnungen sowie eindeutig fehlgeschlagene Batch-Datensätze setzen den Zustand auf `prepared`. Anfrage-Digest und reservierter Key bleiben erhalten. Wiederholungen prüfen zunächst den vergebenen Key: Ein passender vorhandener Datensatz wird übernommen; eine neue Übertragung ist nur im wiederholbaren Zustand bei bestätigtem HTTP 404 möglich. Dubletten, Schlüssel, Projektbindung, Autorisierung sowie bei PDFs Elternversion und Dateiinhalte werden erneut geprüft. Ein abgelehnter Autorisierungsdialog vor dem Schreiben verwirft die Anfragezuordnung nicht mehr.

HTTP 408/5xx, Netzwerkabbrüche, unvollständige bzw. widersprüchliche Antworten und Fehler beim Rücklesen nach einer erfolgreichen Anlage bleiben unklar. Die Rücksetzung wird auch bei einer abgelaufenen Freigabe vor der erneuten Autorisierung gespeichert; beginnt danach ein weiterer POST, wird dessen Ausgang wieder separat als unklar geschützt. Bestehende alte unklare Journale werden nicht rückwirkend als Ablehnung behandelt. PDF-Upload und Dateiregistrierung setzen weiterhin denselben Anhang fort.

Die beiden HTTP-403-Regressionen für Quellen und PDF-Anhänge scheiterten vor der Korrektur und bestehen danach mit derselben Anfrage-ID und demselben Key, auch nach Prozessneustart. Weitere Tests prüfen alle freigegebenen Ablehnungscodes, Batch-Ablehnungen, verweigerte erneute Freigaben, verlorene Antworten nach erneuter Autorisierung, unbekannte Serverausgänge, fehlgeschlagenes Rücklesen, Originaleingaben, Kollisions- und Versionsschutz sowie eingefrorene DOI-Metadaten. Der offizielle MCP-Client prüft beide HTTP-403-Wiederholungen über den gebündelten stdio-Server. Build, beide TypeScript-Projekte und die vollständige Suite bestehen mit 415 Tests. Das aktualisierte VSIX ist gebaut; MCP-Transport und Quellenlisten-Bundle-Test bestehen auch mit den daraus entpackten Dateien. Die SHA-256-Prüfung bestätigt deren Übereinstimmung mit dem getesteten Build.

## F5 — P2: DOI-Import verwechselt Verlag und Hochschule/Institution (behoben)

**Fundstelle:** [identifiers.ts](../src/research/identifiers.ts), Zeilen 34–40 und 59–63.

Im ursprünglich geprüften Stand wurde für `thesis` der Anbieterwert `publisher` als `university` übernommen, für `report` als `institution`. Ein Verlag oder Repository ist aber nicht automatisch die Hochschule oder herausgebende Institution. Eigenständige Institutionsangaben im Crossref-Datensatz wurden dabei nicht gelesen. Dieselbe ungesicherte Zuordnung bestand im DataCite-Pfad.

**Reproduktion:** Ein Dissertation-Datensatz enthält `publisher: "Commercial Publishing Service"` und `institution: [{ name: "Actual University" }]`. Die ursprüngliche DOI-Auflösung lieferte `university: "Commercial Publishing Service"`.

**Auswirkung:** Der Import kann sachlich falsche Angaben speichern, obwohl die eigentliche Quellenidentität per DOI korrekt geprüft wurde. Dies ist besonders relevant, weil fehlende Felder optional bleiben dürfen und nicht durch eine ungesicherte Rollenannahme gefüllt werden sollten.

**Korrektur:** Quellentypbezogene Angaben aus dem passenden Anbieterfeld übernehmen. Wenn die Rolle nicht belegt ist, das optionale Feld leer lassen und einen Hinweis zurückgeben. Tests müssen Verlag, Repository und Hochschule als unterschiedliche Werte verwenden.

Referenzen: Crossref beschreibt `publisher` als Verlag der Veröffentlichung in seinem [API-Format](https://github.com/CrossRef/rest-api-doc/blob/master/api_format.md). Hochschulangaben werden im [Dissertation-Schema](https://www.crossref.org/documentation/schema-library/markup-guide-record-types/dissertations/) gesondert modelliert.

**Umgesetzt:** Dissertationen und Berichte verwenden bei Crossref ausschließlich die separaten Institutionsnamen für `university` bzw. `institution`. Namen werden getrimmt und bei mehreren Institutionen zusammengeführt; fehlende, leere oder ungültige Angaben erzeugen keinen Ersatzwert. Andere Quellentypen behalten ihre Verlagszuordnung. DataCites [Publisher-Definition](https://datacite-metadata-schema.readthedocs.io/en/4.7/properties/publisher/) umfasst auch Archive und Repositories. Weder dieses Feld noch Autorenaffiliationen oder die [Beitragsrollen](https://datacite-metadata-schema.readthedocs.io/en/4.7/appendices/appendix-1/contributorType/) `HostingInstitution`/`Producer` belegen eine gradverleihende Hochschule oder herausgebende Berichtsinstitution; beide optionalen Felder bleiben dort leer.

Der Identifier-Client gibt dafür Zuordnungshinweise zurück. Der Projektservice erhält sie beim Filtern auf das Zotero-Schema und reicht sie bei der Abfrage als `warnings` sowie beim Import als `lookupWarnings` weiter. Hinweise und Metadaten werden gemeinsam eingefroren; Wiederholungen nach verlorenen Antworten verwenden beides ohne erneute Anbieterabfrage. Fehlende Institutionen bleiben optional, geprüfte Overrides sind weiterhin möglich. Bestehende Quellen und ältere eingefrorene Importaufträge werden nicht automatisch geändert.

Die beiden Regressionen für Crossref und DataCite reproduzierten die falsche Zuordnung vor der Korrektur. Weitere Tests prüfen Dissertationen und Berichte, fehlende/ungültige/multiple Institutionsnamen, abweichende Verlage/Repositories/Affiliationen, DataCite-Publisher als String oder Objekt, unveränderte Zuordnung anderer Typen, Zotero-Schemafilter, fehlende native DOI-Felder, optionale Angaben, manuelle Ergänzungen und persistierte Hinweise nach Prozessneustart. Der offizielle MCP-Client prüft passende Crossref-Institutionen, beide Anbieter bei unbelegten Rollen und den Import samt Wiederholung über den gebündelten stdio-Server. Build, beide TypeScript-Projekte und die vollständige Suite bestehen mit 438 Tests.

Das aktualisierte VSIX ist gebaut. MCP-Transport und Quellenlisten-Bundle-Test bestehen ebenfalls mit den entpackten Paketdateien. Deren SHA-256-Hashes sowie die enthaltene MCP-Dokumentation stimmen mit dem geprüften Arbeitsstand überein. Es wurden keine bestehenden Zotero-Quellen verändert; die Schreibfälle verwenden lokale API-Testdoubles.

## F6 — P3: Stilwechsel bearbeitet escaped TeX-Kommandos als echte Anweisungen (behoben)

**Fundstelle:** [texStyle.ts](../src/biblatex/texStyle.ts), Zeilen 34–37 und 57–59.

Im ursprünglich geprüften Stand verwendete `planBiblatexStyle()` direkte Regex-Matches auf `texCode()`. Das Maskieren von Kommentaren und Verbatim-Bereichen schließt einen doppelten Backslash außerhalb solcher Bereiche nicht aus. Der vorhandene Helfer `texCommandMatches()` erkennt dagegen, dass der zweite Backslash keine echte Anweisung beginnt.

**Reproduktion:** Die Eingabe mit zwei Backslashes vor `usepackage`:

```tex
\\usepackage[style=old]{biblatex}
```

wird zu:

```tex
\\usepackage[style=numeric]{biblatex}
```

Das ist eine Zeilenumbruch-Anweisung mit nachfolgendem Text, kein aktiver `usepackage`-Aufruf. Vergleichbare Treffer können eine falsche Dokumentwurzel oder eine vermeintliche klassische BibTeX-Konfiguration erzeugen.

**Korrektur:** Die bereits vorhandene Prüfung auf echte Kommandos auch im Stilplaner verwenden und escaped Anweisungen neben Kommentar-/Verbatim-Fällen testen.

**Umgesetzt:** Paket- und Optionsbefehle, Dokumentklassen und die klassische BibTeX-Erkennung verwenden jetzt `texCommandMatches()`. Ein escaped Beispiel wird weder bearbeitet noch als Dokumentwurzel, Paketladung oder BibTeX-Konflikt gezählt. Bei mehreren Treffern wird die erste echte Dokumentklasse verwendet. Backslash-Paare vor einem tatsächlichen Kommando bleiben erhalten; ein Kommando nach einer Zeilenumbruch-Anweisung wird weiter erkannt.

Die gleiche Prüfung gilt für die Dokumentgrenzen in `planBiblatexResources()`, das der Stilwechsel zur Ergänzung von Ressourcen und Bibliografieausgabe aufruft. Der zusätzliche Regressionstest reproduzierte vor der Korrektur, dass escaped `begin`/`end`-Beispiele die Einfügeposition verschieben und dadurch vorhandenen Text beschädigen konnten. Ein Dokument mit ausschließlich escaped Grenzen wird nicht als vollständiges Dokument behandelt.

Die gezielten Regressionen scheiterten vor der Korrektur und bestehen danach. Weitere Tests prüfen unvollständige escaped Argumente, Backslash-Parität, Kommentare, alle unterstützten Verbatim-Umgebungen sowie `verb`/`verb*`, aktive Optionsänderungen, eingeschlossene Präambeln und den weiterhin wirksamen Schutz vor echtem klassischem BibTeX. Der registrierte Stilbefehl wurde mit echten temporären Projektdateien geprüft: Aktive Angaben werden geändert, escaped Beispiele, CRLF-Zeilenenden, Bibliografie und Schlüsselzuordnung bleiben erhalten; Manuskript und Konfiguration werden gesichert. Ein tatsächlicher BibTeX-Konflikt bricht vor Dateiänderungen ab.

Der Extension-Bundle-Test führt zusätzlich den registrierten Stilbefehl aus dem tatsächlichen Bundle aus. Die lokale TeX-Erkennung verwendet dabei reale temporäre Stil-Dateien und einen kontrollierten `kpsewhich`-Adapter; eine externe TeX-Installation oder interaktive VS-Code-Sitzung ist dafür nicht erforderlich. Build, beide TypeScript-Projekte und die vollständige Suite bestehen mit 454 Tests.

Das abschließende VSIX ist gebaut. Der erweiterte Extension-Test für Quellenliste und Stilwechsel sowie der offizielle MCP-Transporttest bestehen ebenfalls mit den daraus entpackten Bundles. Die SHA-256-Prüfung bestätigt deren Übereinstimmung mit dem getesteten Build und der aktuellen MCP-Dokumentation.

## Empfohlene Reihenfolge und Prüfgrenzen

Alle sechs bestätigten Befunde F1–F6 sind behoben und durch Bundle-, Migrations-, Parser- bzw. MCP-Tests abgesichert. Nach weiteren Änderungen die vollständige Suite und den Pakettest wiederholen und ein neues VSIX bauen.

Die zum Prüfzeitpunkt vorhandenen 344 Tests deckten die bestätigten Beispiele nicht ausreichend ab. Insbesondere prüft der vorhandene Extension-Live-Test nach `openSourceList` lediglich, ob ein Webview-Tab existiert, nicht ob sein HTML samt Skript erfolgreich erzeugt wurde. Der ergänzte Bundle-Test prüft jetzt genau diese Ressourcenausgabe. Der MCP-Transport wird ebenfalls gegen das tatsächlich gebündelte Serverprogramm geprüft.

Ein neuer Live-Schreibtest mit echter Zotero-Dateiregistrierung sowie eine vollständige interaktive Prüfung in Codex/Claude/VS Code waren nicht Teil dieser rein prüfenden Ausführung. Die bestätigten Befunde beruhen auf dem aktuellen Code und reproduzierten lokalen Testfällen, nicht auf unbestätigten Vermutungen.
