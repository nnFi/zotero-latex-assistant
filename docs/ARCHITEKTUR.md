# Architektur und API-Grundlagen

Stand: 12. Oktober 2026. Der Projektauftrag ist in
[PROJEKTAUFTRAG.md](PROJEKTAUFTRAG.md) abgelegt.

## Trennung der Verantwortlichkeiten

| Bereich | Aufgabe | Stand |
| --- | --- | --- |
| `src/extension.ts`, `src/views/` | VS-Code-Oberfläche und Befehle | Aktivierung, Zotero-Seitenleiste und Befehle vorhanden |
| `src/config/` | Maschineneinstellungen und `.zotero/config.json` | Validierte Projektzuordnung, Dateischutz und Bib-Erkennung |
| `src/zotero/` | Transportneutraler Zugriff auf Zotero | Leseclient, Detail-/Exportabruf, CSL-Dateiliste, Anhangsmetadaten, lokale Autorisierung, Neuanlage, partielles Update, Papierkorb und PDF-Dateiweitergabe |
| `src/biblatex/` | Export, sichere Dateizusammenführung und Zitationen | Nativer Export, geschützter Import und Einfügen von Zitationen |
| `src/pdf/` | Historische Platzhalter | Keine lokale Textextraktion auf Benutzerwunsch; Agent erhält PDF-Dateien |
| `src/research/` | Externe Recherche und Metadatenverifikation | Crossref-DOI-/Titelsuche mit Metadatenvorschau |
| `src/shared/` | Typen und einheitliche Fehler | Vorhanden |
| `mcp/` | Eigenständiger Prozess über stdio | 33 Werkzeuge für Codex, Claude und andere lokale MCP-Clients |

Die wissenschaftliche Orchestrierung liegt in `ZoteroProjectService.research`:
Bestandsprüfung in Zotero/Projekt-.bib vor optionaler externer Suche, danach
Identifier-Auflösung mit Herkunft. `src/biblatex/scientificWorkflow.ts` verbindet
den vorhandenen Zitationsparser mit Export, stabilen Projektschlüsseln und der
gesicherten Dateitransaktion. Es werden nur fehlende ausdrücklich referenzierte
Quellen importiert; manueller Bestand bleibt erhalten. Der Server verarbeitet
gespeicherte Dateien, ohne TeX-Kompilation oder Zugriff auf Editorpuffer.

`src/zotero/notes.ts` verwaltet Text-/HTML-Notizen und persistente Neuanlagejournale.
Der vorhandene Schreibadapter übernimmt Freigaben, bedingte PATCH-Anfragen und
Wiederherstellung per `deleted: 0`. Alle Aktionen behalten den Projektscope bei.
Details und Prüfgrenzen: [MCP-Workflow](MCP.md#wissenschaftlicher-ablauf-notizen-und-wiederherstellung).

Sammlungsanlage und Hierarchieschutz liegen in `src/zotero/collectionOperations.ts`.
`src/zotero/projectCollection.ts` übernimmt Projektzuordnungen mit denselben
`withProjectLibrary`-/`planCollectionChange`-Regeln wie **Set library**. Der Writer
ergänzt Sammlungs-POST und versionsgeschütztes DELETE. Der Service sperrt die aktive
Projekt-Sammlung und jeden Vorfahren vor sowie nach der Autorisierung; er löst die
Bindung beim Löschen niemals selbst. Neuanlagejournale reservieren wiederverwendbare Keys.

`src/config/projectLock.ts` stellt die gemeinsame Dateisperre für Extension-
Projektaktionen und MCP-Schreibaktionen bereit. Dadurch kann eine Collection-Zuordnung
im Editor nicht parallel zu einem MCP-Löschvorgang geschrieben werden. Die Prüfung
von Versions-/Hierarchie-/Dateisnapshots bleibt zusätzlich aktiv. Der standalone MCP-
Server sieht ausschließlich gespeicherte Dateien. [Sammlungsablauf](MCP.md#sammlungen-anlegen-zuordnen-und-löschen).

Extension und MCP-Server verwenden das offizielle MCP-SDK 2.3.1, Zod und einen
TOML-Parser für die Codex-Einrichtung. `scripts/bundle.cjs` bündelt alle benötigten
Laufzeitbibliotheken in `dist/extension.cjs` und `dist/mcp/server.cjs`; ausschließlich
VS Code bleibt beim Extension-Einstieg extern. Das VSIX enthält beide Programme,
Webview und Ressourcen. Entwicklungsabhängigkeiten werden über die Lockdatei fixiert.

TypeScript verwendet `module: NodeNext` und `moduleResolution: NodeNext` für die
aktuelle Node.js-Modulauflösung. `type: commonjs` im Extension-Manifest hält die
kompilierte Extension mit ihrem bisherigen CommonJS-Einstieg kompatibel.
Node.js- und VS-Code-Typen sind explizit über `types` eingebunden.
Quelle: [TypeScript-Modulauflösung](https://www.typescriptlang.org/tsconfig/moduleResolution).

`src/biblatex/update.ts` trennt die Bibliografie-Verarbeitung von der Oberfläche.
`bibliographyItemKeys` prüft die Auswahl und berechnet den gewünschten Bestand.
`planBibliographyUpdate` bestimmt erhaltene Einträge, notwendige Exporte und
Schlüsselzuordnungen. `completeBibliographyUpdate` verarbeitet bereitgestellte
Exporte, richtet bibliografische Referenzen aus, bereinigt entfernte Quellen
und prüft Kollisionen sowie Dubletten. Es liefert Bib-Text, neue Konfiguration,
entfernte Zitier-Schlüssel und Angaben für eine mögliche Dublettenprüfung zurück.
Diese Funktionen rufen weder Zotero noch VS Code auf und schreiben keine Dateien.
Der `ProjectController` führt Dialoge, Exportabrufe, Snapshot-Prüfungen und die
abschließende Dateitransaktion aus. Die Bibliotheksprüfung erfolgt weiterhin
vor dem ersten Zotero-Abruf. Alte Projektschlüssel und manuelle Feldinhalte
werden durch den Planer nach denselben Regeln erhalten.

Die Quellenlisten-Interaktion liegt in `src/views/webview/sourceList.ts` und
wird mit `tsconfig.webview.json` separat gegen Browser-/DOM-Typen geprüft.
Der Build erzeugt `dist/webview/sourceList.js` als eigenständiges Skript ohne
Node.js-Importe oder CommonJS-Exports. `sourceListHtml.ts` bindet diese lokale
Datei in das Nonce-geschützte HTML ein; die Listenkennung steht als escaped
HTML-Datenattribut im Header und wird nicht in JavaScript interpoliert.
`npm run compile` und `npm run check` berücksichtigen beide TypeScript-Projekte,
`npm run watch` startet deren Compiler gemeinsam. Die kompilierte Browserdatei
gehört auch zum Extension-Paket. Die UI-Tests führen dasselbe kompilierte Skript
aus wie die Webview; der Bibliografie-Planer wird zusätzlich ohne VS-Code-Mocks
auf Bestandserhalt, Synchronisierung, Referenzen, Kollisionen und Dubletten geprüft.

Der getrennte Opt-in-Live-Smoke (`npm run test:live`) startet die installierte
VS-Code-Anwendung über `scripts/live-smoke.cjs`. `test/live/run.ts` läuft im
echten Extension Host und verwendet dessen VS-Code-API sowie die echte lokale
Zotero-API. Profil und Workspace werden unter einem neuen temporären Verzeichnis
angelegt; die Workspace-Trust-Prüfung wird ausschließlich dort übersprungen.
Die Bibliografie ist bereits einem stabilen Testschlüssel zugeordnet, sodass
die reguläre Bib-Aktualisierung keine neuen Schlüssel nach Zotero zurückschreibt.
Das Ergebnis wird als JSON gespeichert. Weil der Desktop-CLI-Prozess vor dem
Extension Host enden kann, wartet der Launcher bis zu 60 Sekunden auf diesen
Bericht und übernimmt dessen Erfolg in den Exit-Code. Der Standardtestlauf
benötigt weder eine GUI noch Zotero und führt den Live-Smoke nicht aus.
Der erfolgreiche [Live-Bericht](live-smoke-report.json) ersetzt keine manuelle
Button-/Dialogprüfung oder Prüfung von Zotero-Schreibfreigaben und Better BibTeX.

## Offiziell dokumentierte Zotero-Endpunkte

Phase 1 verwendet ausschließlich `GET`:

- `/api/`: Erreichbarkeit und API-Version prüfen.
- `/api/users/0/items?format=json&limit=1`: persönliche Bibliothek erreichen;
  `Total-Results` liefert, falls vorhanden, die Anzahl einschließlich Anhängen und Notizen.
- `/api/users/0/groups?format=json&limit=100&start=…`: lokale Gruppen identifizieren.

Die lokale Benutzer-ID `0` bezeichnet die persönliche Bibliothek. Gruppen werden
über ihren tatsächlichen Gruppenschlüssel als numerische ID identifiziert.
Es wird kein eigener `/libraries`-Endpunkt angenommen.
Quellen: [Lokale Zotero-API](https://www.zotero.org/support/dev/web_api/v3/local_api),
[API-Grundlagen](https://www.zotero.org/support/dev/web_api/v3/basics).

Die Sammlungs- und Quellenansicht verwendet außerdem die dokumentierten
`collections/top`, `collections/<key>/collections`, `items/top` und
`collections/<key>/items/top` unter dem jeweiligen Bibliothekspräfix.
Unterordner und Quellen werden erst beim Aufklappen geladen. Die Listen werden
in Seiten mit jeweils maximal 100 Objekten vollständig abgerufen. `items/top`
vermeidet doppelte Darstellung untergeordneter Notizen und Anhänge in der Quellenliste;
eigenständige Einträge bleiben sichtbar. Metadaten werden validiert und in
gemeinsame Typen überführt. Quelle: [Zotero-Leseendpunkte](https://www.zotero.org/support/dev/web_api/v3/basics#resources).

Die geprüfte Dokumentation beschreibt lokale Schreibzugriffe **ab Zotero 10**.
Sie erfordern eine lokale Freigabe über `/api/local/authorize`, einen API-Schlüssel
und die Server-ID. Ein separater `ZoteroWriter` implementiert diese Funktionen
als getestetes Backend. Das frühere Detailformular ist entfernt; Neuanlage und Papierkorb sind nun an MCP-Werkzeuge angebunden. Für ältere
Versionen muss ein separater Web-API-Schreibadapter geprüft werden. Lokale und
Web-API-Schlüssel sowie Objektversionen dürfen nicht vermischt werden.
Quelle: [Lokale Schreibautorisierung](https://www.zotero.org/support/dev/web_api/v3/local_api#authorizing_writes).

## Grundentscheidungen für spätere Phasen

- **Oberfläche:** native Commands, QuickPick und TreeView. Die Zotero-Seitenleiste
  zeigt Bibliotheken, Sammlungen, Unterordner und Quellen. „Alle Einträge“ stellt
  den gesamten Bibliotheksbestand bereit. Autoren und Jahr stehen neben dem Titel;
  Datum, DOI und URL erscheinen im Tooltip. Leere Ergebnisse und Ladefehler sind
  sichtbar, Prüfen und Aktualisieren stehen als Aktionen bereit. Die separate
  Auswahl einer Projekt-Sammlung wird in `.zotero/config.json` gespeichert. F5 startet den
  Extension Development Host nach erfolgreicher Kompilierung.
  [VS-Code-Extension-Aufbau](https://code.visualstudio.com/api/get-started/extension-anatomy),
  [TreeView-API](https://code.visualstudio.com/api/extension-guides/tree-view).
- **Better BibTeX:** dokumentierten JSON-RPC-Export für einzelne Quellen prüfen;
  ein vollständiger Sammlungsexport soll keine vorhandene `.bib` überschreiben.
  [JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/index.html),
  [Pull-Export](https://retorque.re/zotero-better-bibtex/exporting/pull/).
- **MCP:** offizielles TypeScript-SDK und stdio verwenden. Die aktuelle Dokumentation
  führt SDK v2 mit getrennten Server- und Client-Paketen; die Umsetzung verwendet
  die geprüfte stabile Version 2.3.1. Der Server importiert keine VS-Code-Module.
  [Offizielles TypeScript-SDK](https://ts.sdk.modelcontextprotocol.io/v2/).
- **Editoraktionen:** Zitationen zunächst als native VS-Code-Befehle umsetzen.
  Ein separater MCP-Prozess benötigt dafür später eine ausdrücklich definierte Brücke.
- **PDFs:** Dateien direkt an den Agenten übergeben, ohne lokale Textextraktion oder OCR.
  Seitenbelege und Interpretation liegen beim PDF-fähigen Agenten. Der Server liefert
  Anhangs-ID, lokalen Dateipfad und optional unveränderte PDF-Bytes.
- **Schreibschutz:** separate Schreibadapter, ausgewählte Sammlung, bestätigter Import,
  Duplikatprüfung, Versionsprüfung und sichere Speicherung von Zugangsdaten.

## Prüfung und Grenzen

Die Tests simulieren API-Antworten und prüfen unter anderem Verbindungsfehler,
deaktivierten API-Zugriff, Zeitlimits, ungültige Metadaten, Gruppenseiten,
Sammlungshierarchien, Quellenlisten und mehrseitige Ergebnisse.
Sie verändern keine Zotero-Daten und benötigen keine laufende Zotero-Installation.

Die bisherigen Befehle und die erste Bibliotheksansicht wurden vom Benutzer
ausprobiert. Der neue Client wurde außerdem lesend mit der laufenden lokalen
Zotero-Installation und der Sammlung „SeminarWiemann“ geprüft. Der manuelle
Editor-Test der erweiterten Sammlungs- und Quellenansicht bleibt offen.

## Projektkonfiguration, Details und Import

Die Projektzuordnung ist dateibasiert und pro Workspace-Ordner isoliert.
`.zotero/config.json` enthält Version, Bibliothek, Sammlung, CSL-Stil,
Zitierbefehl, Bib-Pfad, importierte Quellenschlüssel und bei Zotero 10+ die
Datenbank-ID. Maschineneinstellungen enthalten nur lokale Verbindungs- und
Stilordnerpfade. Zugangsdaten gehören in SecretStorage (Extension) bzw. den flüchtigen
`MemorySecretStore` des eigenständigen MCP-Prozesses.
Bestehende Dateien werden beim Start erkannt; TeX-Verweise helfen bei der
Bib-Auswahl, ersetzen aber keine bestätigte Bibliothekszuordnung.

Die CSL-Liste wird aus öffentlichen `.csl`-Dateien des Zotero-Stilordners gelesen.
Es wird kein nicht dokumentierter `/styles`-Endpunkt angenommen. Die
Detailvorschau verwendet `GET items/<key>?format=bib&style=<id>&locale=de-DE`.
Der CSL-Stil beeinflusst diese Vorschau. Die BibLaTeX-Stildefinition des
LaTeX-Dokuments wird nicht aus einem CSL-Stil abgeleitet.

Der Standardexport verwendet den lokal installierten Better-BibTeX-Translator
**Better BibLaTeX** über lesendes JSON-RPC `item.export`. `item.citationkey` bzw.
URI-geprüfte `item.search`-Ergebnisse ordnen Zotero-Einträge ihren BBT-Schlüsseln
zu. Bei Gruppen liefert `user.groups` die interne Bibliotheks-ID, nachdem der
Bibliotheksname anhand der Quellen-URI geprüft wurde. Mehrdeutige Namen, doppelte
Schlüssel und nicht eindeutig passende Exportantworten werden abgewiesen.
Quelle: [BBT JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/).

Der vollständige Translator-Text bleibt erhalten; nur bereits persistierte
Projekt-Zitier-Schlüssel ersetzen gegebenenfalls einen inzwischen geänderten
BBT-Schlüssel. Neue Quellen übernehmen den aktuellen BBT-Schlüssel.
`zoteroLatexAssistant.bibliographyExporter` ist standardmäßig `better-biblatex`.
Das Plugin ist dafür erforderlich; fehlendes BBT und Exportfehler lösen keinen
stillen Fallback aus. Nur die explizite Auswahl `native` verwendet weiterhin
`GET items/<key>?format=biblatex` und den nativen Zotero-Metadatenexport.

Ein fehlendes Plugin bzw. nicht verfügbarer Translator liefert den separaten
Fehlercode `EXPORT_UNAVAILABLE`. Der Projektcontroller bietet daraufhin
„Use Zotero export“ an; nur die ausdrückliche Auswahl speichert `native` über
die VS-Code-Konfiguration für den Workspace-Ordner. Der laufende Import wird
vollständig über den lokalen nativen Export fortgesetzt. Allgemeine Export-
oder Netzwerkfehler lösen diese Auswahl nicht aus. `CANCELLED` beendet den
Befehl und Quellenlistenaktionen ohne zusätzliche Fehlermeldung. Eine Zitation
wird erst nach vollständig geschriebenem und überprüftem Bib-Eintrag eingefügt.

Ein markierter Bereich in der Projekt-.bib enthält die importierten Quellen.
Ein SHA-256-Wert dokumentiert den verwalteten Abschnitt. Die Controller verwenden
`synchronizeBibliography`, um tatsächliche Einträge statt eines veralteten
Importbestands zu bearbeiten; direkte Löschungen werden auch bei erneuten
Metadatenexporten berücksichtigt. Checkbox-Synchronisierung erhält bestehende
Feldinhalte, Einzelimport die nicht ausgewählten Quellen und alle Wege nicht
zugeordnete Einträge und Makros.
Beim Abwählen ermittelt der Controller die bisherigen Schlüssel der betroffenen
Quellen vor dem Entfernen ihrer Zuordnung. Nur Schlüssel, die im resultierenden
Bib-Bestand fehlen, werden über `planTexCitationRemoval` gezielt entfernt:
gemischte Key-Listen und Multicite-Gruppen behalten ihre verbleibenden Quellen
und Notizen; vollständig leere Zitierbefehle entfallen. Zitattext und Kommentare
bleiben erhalten. Abhängige Bib-Referenzen werden mit `removeBibliographyReferences`
bereinigt. Die LaTeX-Quellen werden vor der Vorbereitung eingelesen und vor dem
Commit erneut auf unveränderte, gespeicherte Inhalte geprüft. Bib, Konfiguration
und betroffene TeX-Dateien verwenden dieselbe Transaktion. Dynamische TeX-Key-
Argumente werden bei einer gezielten Entfernung als nicht sicher zuordenbar
abgewiesen; der explizite vollständige Reset bleibt davon unabhängig.
Neue Exporte werden vollständig vorbereitet und vor dem Schreiben auf Syntax,
Schlüsselkollisionen und Zuordnung geprüft. Jeder Import- und Aktualisierungsweg sichert
Bib-Datei und Konfiguration gemeinsam und setzt abgeschlossene Schreiboperationen
bei Fehlern zurück. Atomare Dateiaustausche, Dateisnapshots und Pfadprüfung
schützen vor konkurrierenden Änderungen und Zugriffen außerhalb des Projekts.

Die Quellenliste ist eine VS-Code-Webview mit restriktiver Content Security
Policy und escaped Metadaten. Einzelne Einträge werden zum Anzeigen und
Bearbeiten in Zotero geöffnet. Der vorbereitete Schreibadapter kann Metadaten
über einen minimalen `PATCH` ändern und erhält dabei andere Felder.
Der Schreibadapter verlangt eine Server-ID, fordert bei Bedarf eine Freigabe
über `POST /api/local/authorize` an und prüft die ursprüngliche Eintragsversion.
Bei `401` wird einmal neu autorisiert; bei `412` wird ohne Überschreibversuch
abgebrochen. Nur dauerhaft erlaubte Schlüssel werden gespeichert. Der
Schreibadapter ist über `ZoteroProjectService` an MCP-Neuanlage und Papierkorb angebunden.
Quellen: [Lokale API](https://www.zotero.org/support/dev/web_api/v3/local_api),
[PATCH und Versionsprüfung](https://www.zotero.org/support/dev/web_api/v3/write_requests).

Crossref erhält eine aktiv eingegebene DOI oder Titelanfrage; die beauftragte
Quellenprüfung ruft Zitationszahlen über DOI oder einen ISBN-Filter ab.
`crossrefIsbn.ts` vergleicht ISBN, Buch-/Kapiteltyp, Titel und vorhandene weitere
Metadaten. Mehrdeutige DOI und unvollständige Suche bleiben unbekannt;
Kapitelzählungen werden nicht zu Buchzählungen addiert. Der Client
verwendet ausschließlich `https://api.crossref.org`, hat ein Zeitlimit und
behandelt fehlende DOIs, Rate-Limits sowie unpassende Antworten. Die Ergebnisse
werden zur Prüfung angezeigt; es erfolgt keine automatische Zotero-Neuanlage.
Quelle: [Crossref REST API](https://github.com/CrossRef/rest-api-doc).

`sourceMetadata.ts` stellt eine bibliografische Eingabe ohne Zotero-Key oder
Bibliotheksbindung bereit. `PubcheckClient` verwendet dieselbe Nachweisprüfung und
DOI-/ISBN-Zitationsabfrage für gespeicherte Quellen und neue Kandidaten.
`zotero_check_candidate` benötigt keinen lokalen Zotero-API-Zugriff oder
Dateizugriff; die eingegebenen Metadaten werden unverändert geprüft und gemeinsam
mit den Nachweisen zurückgegeben. Prüfstatus und Import sind separate Aktionen;
ein positiver PubCheck-Status ist bisher keine technisch erzwungene Importbedingung.

## Quellenliste statt Detailformular

Auf Benutzerwunsch ersetzt eine Tabellen-Webview das Metadatenformular.
Die Bibliotheks-/Sammlungsauswahl öffnet die Quellenliste mit Checkboxen.
Der Import übergibt die gesamte Auswahl an den bestehenden geschützten
Bib-Import: zunächst Zugehörigkeit aller Quellen prüfen, dann vollständig
exportieren und einmal schreiben. Die Liste bindet ihren Import an den beim
Öffnen gewählten Workspace-Ordner. Vorhandene importierte Quellen werden erhalten.

„In Projekt-.bib importieren“, „DOI / Titel suchen“ und „Liste aktualisieren“
stehen über der Tabelle. Webview-State erhält Filter und Auswahl nach dem
Neuladen. Nicht mehr vorhandene Schlüssel werden nicht wieder ausgewählt.
Pro Workspace und Sammlung wird eine bestehende Listenansicht wiederverwendet.
Eintragsdaten bleiben escaped, und der Host akzeptiert ausschließlich Schlüssel
von Quellen aus der tatsächlich geladenen Liste. „In Zotero öffnen“ öffnet den
nativen Eintrag; die Extension zeigt kein einzelnes Metadatenformular mehr.
Der Schreibadapter bleibt als getestetes Backend-Modul erhalten.

## Aufgabenabgrenzung und Anfragekoordination

Manuelle Quellen-/Sammlungs-/Anhangsverwaltung ist Aufgabe von Zotero. Die
Extension zeigt deren Metadaten lesend, verbindet Projekte mit Bibliotheken,
importiert ausgewählte Quellen in die .bib und ergänzt Zitierstil sowie
DOI-Recherche. Eine separate Such-/PDF-/Anhangsverwaltungsoberfläche ist nicht
geplant. Geplante MCP-/KI-Werkzeuge sind davon getrennt.

Der Bibliotheksbaum lädt nur Bibliotheken und Unterordner; Editorwechsel löst
keinen Refresh mehr aus. Die Quellenliste ruft Anhangsmetadaten gesammelt über
`items?itemType=attachment` bzw. den entsprechenden Sammlungspfad ab. Der
Dateityp folgt MIME-Typ / Dateiendung / Linkmodus. Dateien werden nicht geöffnet;
bei fehlgeschlagenem Abruf ist der Status unbekannt. Quelle:
[Zotero-Ressourcen und Suchparameter](https://www.zotero.org/support/dev/web_api/v3/basics).

`RequestCoordinator` wird pro Fetch-Transport und lokalem Port geteilt. Er
serialisiert Anfragen einschließlich des kompletten Antwort-Bodys. Identische
JSON-Leseanfragen teilen einen Abruf. Gespeicherte Antwortdaten erzeugen
unabhängige Bodies, damit das Abbrechen eines Lesers keine anderen blockiert.
Der auf 64 Antworten begrenzte Cache gilt 30 Sekunden und wird bei manueller
Aktualisierung verworfen. Eine Generation verhindert, dass alte laufende
Abrufe einen zwischenzeitlich geleerten Cache wieder mit alten Daten füllen.
Server-ID und Endpunkt sind Teil der Cache-Identität.

Maximal 32 verschiedene Anfragen dürfen warten. Bei Verbindungsabbruch oder
Zeitlimit werden nachfolgende Abrufe für fünf Sekunden abgewiesen. Es gibt
keine automatischen Wiederholungen. Paginierung erkennt wiederholte Schlüssel
und begrenzt die Gesamtergebnisse, um endlose Abfragen zu verhindern. Diese
Maßnahmen reduzieren unnötige Last; eine Zotero-Absturzursache ist damit nicht
nachgewiesen. Der Nutzer hält versehentliches Schließen ebenfalls für möglich.

## Unabhängige Projekteinrichtung

Die Bibliothekszuordnung, Bib-Datei und lokale BibLaTeX-Stilauswahl werden separat gespeichert.
`newProjectConfig` erzeugt eine gültige, noch unvollständige Konfiguration mit
`library: null` und `bibFile: ""`. Jede Einstellungsaktion kann damit zuerst
aufgerufen werden. `withProjectLibrary` ändert ausschließlich die Bibliotheks-
und Sammlungsbindung samt Server-ID; Bib-Pfad und Zitieroptionen bleiben erhalten.
Bestehende vollständige Version-1-Konfigurationen bleiben lesbar.

`planBiblatexResources` aktualisiert literale Ressourcenpfade in lokalen TeX-,
LTX-, Paket- und Klassendateien. Abhängigkeiten der Hauptdokumente bestimmen
relative Pfade. Zusätzliche und entfernte Ressourcen sowie Kommentare und
Literalbeispiele bleiben erhalten. Makropfade und mehrdeutige gemeinsam genutzte
Referenzen werden vor dem Schreiben abgewiesen. Ein neuer Bib-Pfad übernimmt
die bestehende Datei als Kopie; vorhandene Zieldateien werden nicht überschrieben.
`planBiblatexStyle` und die Ressourcenauswahl teilen die Einrichtung fehlender
Ressourcen und Bibliografieausgabe. Beide Reihenfolgen der Einrichtung funktionieren.
TeX-Quellen werden vor dem Commit erneut auf gespeicherte, unveränderte Inhalte
geprüft. Alle Änderungen und die Konfiguration verwenden `writeProjectChanges`.

Ohne Bibliothek sind Sammlungsschlüssel, Server-ID und importierte Quellen
ungültig. Der Bib-Import benötigt zusätzlich eine gewählte Bib-Datei; eine
Bibliothekszuordnung allein erzeugt keine Datei oder automatische Zuweisung.
Der Zitierbefehl wird für die native Aktion „Quelle zitieren“ verwendet und
in der Auswahl entsprechend erklärt.

## Native Zitationsaktion

`planCitationDeletion` plant den bewussten Projektreset durch **Delete all
citations**. Die tatsächlichen bekannten und lokal deklarierten Zitierbefehle
werden einschließlich ihrer Argumente entfernt, csquotes-Text wird in Varianten
ohne Literaturverweis erhalten. Importierte und verwaltete Bib-Einträge werden
gelöscht, verbleibende Bib-Referenzen bereinigt. Die nächste Konfiguration enthält
keine Bibliotheks-/Sammlungs-/Serverbindung und keine importierten Schlüssel;
Dateipfad, Stil und Zitierbefehl bleiben erhalten. Eine fehlende aktive Bib-Datei
blockiert den Reset nicht. Der Controller öffnet die vollständige Vorschau,
fordert Bestätigung an und prüft danach alle Quellen erneut auf gespeicherte,
unveränderte Inhalte und unveränderten Dateibestand. `writeProjectChanges` sichert
und schreibt die Änderungen gemeinsam mit der Konfiguration unter dem Typ `reset`.
Erst nach dem Commit und Freigabe der Projektsperre wird **Set library** angeboten.
Der Reset benötigt weder Zotero noch BBT und verändert keine Zotero-Datensätze.

`CitationController` merkt sich das zuletzt aktive LaTeX-Dokument pro
Workspace-Ordner. Eine Tabellenaktion kann damit nach dem Fokuswechsel zur
Webview an der zuvor gewählten Stelle einfügen. Der Controller erfasst beim
Start Document-Version und Selections und stellt das Textdokument vor der
Editoränderung wieder her. Einfügungen überschreiben keinen markierten Text.
Mehrere Cursor werden anhand ihrer ursprünglichen Offsets in einer Editoraktion
bearbeitet; gleiche Positionen werden dedupliziert.

Der transportneutrale Ablauf `insertPreparedCitation` lässt zuerst die
Projekt-/Bib-Vorbereitung abschließen und prüft das Zieldokument erneut. Der
Projektcontroller verwendet wie Liste und Metadatenexport
`resolveBibliographyPresence`: gespeicherte Projektschlüssel haben Vorrang,
eindeutige Legacy-, Extra- und lokal aufgelöste BBT-Schlüssel erkennen externe
Einträge. Gespeicherte Zuordnungen allein beweisen keine Dateizugehörigkeit.
Vorhandene unzugeordnete Quellen werden ohne erneuten Metadatenexport mit ihrem
tatsächlichen Schlüssel in die Projektkonfiguration aufgenommen. Fehlende
Einträge werden mit dem geschützten Import übernommen. Gespeicherte oder Extra-
Schlüssel benötigen keinen weiteren API-Aufruf. Neue
Quellen werden gegen die Projekt-Sammlung geprüft. Erst dann werden die
stabilen Projekt-Zitier-Schlüssel mit dem gespeicherten LaTeX-Befehl eingefügt.
Bei Importfehler oder geänderter / geschlossener Zielversion wird kein Text eingefügt.
Ein erfolgreich abgeschlossener Bib-Import wird dabei nicht zurückgerollt.

Die Quellenliste liest nach dem Zitieren die tatsächliche Bib-Zugehörigkeit
erneut; ihre vorhandenen Quellen-/Anhangsmetadaten werden wiederverwendet.
Eine MCP-Editorbrücke bleibt separat geplant. Tests führen den Ablauf mit echten
temporären Projektdateien und einem simulierten VS-Code-Editor aus; ein echter
Extension-Host-Test ist noch offen. Lokale LaTeX-/Biber-Durchläufe sind erfolgreich.

## Quellensuche, Seiten und Zusatz

Der native Editor-Kontextbefehl „Zitieren …“ verwendet QuickPick mit Suche in
Titel, Beschreibung (Ersteller / Jahr) und Detail (DOI). Anschließend erfassen
zwei optionale InputBox-Schritte Postnote (Seiten / Fundstelle) und Prenote
(Zusatz). Die Zielversion und Selections werden vor dem Öffnen der Quellensuche
erfasst. Bei Abbruch werden keine schreibenden Schritte ausgelöst.

`citationText` baut passende optionale Argumente: nur Postnote ergibt `[post]`,
Prenote mit / ohne Postnote ergibt `[pre][post]` bzw. `[pre][]`. Freie Angaben
werden als Text escaped, einschließlich geschützter eckiger Klammern. Der
Tabellenknopf startet denselben Dialog ab der Postnote, weil die Quelle dort
bereits feststeht. Zotero-Metadaten werden nicht verändert.

## Projektbezogene Zitier-Schlüssel aus Zotero / BBT

Neue Importzuordnungen verwenden den nativen Export-Schlüssel oder, bevorzugt,
einen BBT-Schlüssel. `BetterBibtexClient` liest `api.ready`, persönliche Schlüssel
über `item.citationkey` und Gruppen-Schlüssel über `item.search` mit strikter
CSL-URI-Prüfung. Dadurch werden Gruppen-ID und interne BBT-libraryID nicht
vermischt. Der Adapter verwendet denselben lokalen RequestCoordinator. Die
RPC-POSTs sind ausschließlich lesend und werden wie Leseanfragen behandelt;
es werden keine Autoexports angelegt oder Keys im Plugin regeneriert.
Quelle: [BBT JSON-RPC](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/).

Die optionale Version-1-Eigenschaft `citationKeys` ordnet importierte
Zotero-Objektschlüssel den im Projekt verwendeten Bib-/LaTeX-Schlüsseln zu.
Ältere Projekte ohne Mapping behalten für ihre bisherigen Importe die
technischen Namen. Die Zuordnung wird bei der ersten neuen Übernahme eingefroren;
Metadatenänderungen und spätere Plugin-Installation ändern sie nicht. Kollisionen
und unsichere Schlüssel brechen vor dem Dateischreiben ab. Der ausgewählte
Metadatenexport (standardmäßig Better BibLaTeX) setzt den Eintragsnamen auf die
persistierte Zuordnung. Bibliografische Referenzfelder werden bei Bedarf
ebenfalls auf die Projektschlüssel ausgerichtet.

Nach erfolgreichem Dateiimport können ausschließlich neue Schlüssel über den
Zotero-10+-Writer im Extra-Feld festgehalten werden. Andere Extra-Zeilen bleiben
erhalten; ein anderer bereits gesetzter Citation Key wird nicht überschrieben.
API-Schlüssel liegen nur in SecretStorage. Fehler / verweigerte Autorisierung
lassen den Projektimport bestehen und stoppen weitere Rückschreibversuche.
Die Quellenliste und Zitier-Quellensuche zeigen den gespeicherten Projektnamen.
Eine Umbenennung alter Schlüssel wird ausdrücklich über „Migrate existing citation
keys“ angefordert. Der transportneutrale Planer in `src/biblatex/migration.ts`
prüft die vollständige Schlüsselzuordnung und alle betroffenen Bib-/LaTeX-Dateien.
Nach Vorher-/Nachher-Vorschau und Bestätigung werden Eintragsnamen, literale
Zitierargumente, bibliografische Referenzfelder, JSON-Mapping und verwaltete
Prüfsummen gemeinsam geändert. Die Dateitransaktion sichert Originale und setzt
abgeschlossene Änderungen bei Schreibfehlern zurück. Dynamische Zitierargumente,
mehrdeutige Ressourcen und zwischenzeitliche Datei-/Editoränderungen werden abgewiesen.

`src/biblatex/fields.ts` liest Einträge und auflösbare `@string`-Verkettungen, ohne
TeX-Feldinhalte umzuschreiben. `duplicates.ts` vergleicht normalisierte DOI sowie
Titel, Autorennachnamen und Publikationsjahr. Nur neu eingeführte Konflikte werden
beim Import behandelt: gleiche DOI blockiert, mögliche Dubletten erfordern
einen ausdrücklichen Override. Es erfolgt keine automatische Zusammenführung
und keine Dublettenbereinigung in Zotero.


## MCP-Server mit optionalem Projekt

`src/zotero/projectService.ts` ist die gemeinsame Geschäftslogik ohne VS-Code-API.
Der stdio-Einstieg funktioniert ohne Projekt; eine initiale persönliche Bibliothek
ermöglicht Lesen ohne Konfiguration. Eine ausdrückliche Sammlungswahl wird in einem
privaten Zustandsordner gespeichert. Ein absoluter `--project`-Pfad bindet optional
ein vorhandenes Schreibprojekt; ohne feste Bindung erlauben Projektwerkzeuge einen
expliziten `projectPath` je Aufruf. API-URL und Timeout sind separate Startargumente.
`zotero_get_context` prüft Konfiguration und Bib-Kandidaten rein lesend;
`zotero_add_to_bibliography` ergänzt ausdrücklich gewählte Quellen in eine vorhandene
`.bib` und speichert die Zuordnung mit transaktionalen Sicherungen, ohne TeX-Dateien
zu ändern. Jede Operation liest die geschützte Projekt- bzw. Zotero-Bindung
neu und verwendet die vorhandenen Client-Validierungen und `RequestCoordinator`.
Metadaten und Suche bleiben im gewählten Bibliotheks-/Sammlungsscope. Die
Dublettenprüfung vergleicht aktive bibliografische Quellen der gesamten gebundenen
Bibliothek und verwendet die gemeinsame DOI-/Textnormalisierung.

`metadata.ts` definiert Metadatenschema, Zotero-Feld-/Rollenvalidierung und
Dublettenvergleich. Das lokale `items/new` wird nicht angenommen; zulässige
Felder kommen aus `itemTypeFields`. Gespeicherte JSON-Objekte werden unabhängig
von der Feldreihenfolge verglichen. `ZoteroWriter` teilt den Autorisierungsablauf
für bestehendes Metadaten-PATCH, versionierte Neuanlage und `PATCH deleted=1`.
Nach Autorisierung prüft ein Preflight die unveränderte Konfiguration, Sammlung,
Server-ID und bei Papierkorb die aktuelle Objektversion; die API-Precondition
schützt zusätzlich gegen spätere Objektänderungen.

Neuanlagen haben eine stabile Anfrage-ID, einen persistenten Digest und einen
vor dem Schreiben gespeicherten Zotero-Key unter `.zotero/mcp/requests/`.
`version: 0` begrenzt den ersten POST auf ein neues Objekt. Wiederholungen lesen
diesen Key zurück und senden den POST nicht erneut. Eine Projektsperre über
`.zotero/mcp/write.lock` schützt mehrere MCP-Prozesse und Extension-Projektaktionen.
Ein Absturz kann eine Sperre hinterlassen, die erst nach Ende aller beteiligten
Prozesse und Projektaktionen manuell bereinigt werden darf.

Papierkorb prüft vorab zusätzliche Sammlungen und Zitationen mit dem vorhandenen
transportneutralen TeX-Planer, ohne dessen Dateiplan anzuwenden. Danach werden
Item-Daten und die paginierte Papierkorbliste mit lokalem Key-Vergleich verifiziert. Projekt-Bib und
LaTeX bleiben erhalten; gesonderte Bereinigung nutzt die existierenden Sicherungs-
und Transaktionsfunktionen. Ungespeicherte Editordaten benötigen weiterhin eine
separate Editorbrücke.

`src/config/mcp.ts` erstellt Client-Konfigurationen ohne VS Code.
`src/views/mcpCommands.ts` verbindet diese mit Projektordnerauswahl und
Extension-Installationspfad. Codex erhält projektbezogene `.codex/config.toml`,
Claude Code `.mcp.json`. Beide starten denselben gebündelten stdio-Server mit
explizitem Projektpfad. Die Aktion registriert nicht ausschließlich einen
VS-Code-MCP-Provider. Details, Quellen, Sicherheitsregeln und Prüfgrenzen:
[MCP mit Codex und Claude](MCP.md).


## Quellenupdates und direkte PDF-Weitergabe

`zotero_update_item` verwendet einen partiellen Metadatenauftrag ohne Standardwerte
für ausgelassene Felder. Typ-/Rollenvalidierung, Dublettenprüfung ohne den eigenen
Key, nach Autorisierung wiederholte Scope-/Versionsprüfungen, bedingtes PATCH und
Rücklesen schützen vorhandene Daten. Bib-Datei und LaTeX bleiben dabei unverändert.

`zotero_list_attachments` liest die paginierten Kind-Anhänge einer geprüften Quelle.
`zotero_get_attachment` prüft Parent-Key und Projektzugehörigkeit, fragt Zotero nach
der lokalen Datei-URL und liefert den kanonischen Pfad, Größe und SHA-256. Optional
werden die unveränderten PDF-Bytes als eingebettete MCP-Ressource zurückgegeben.
`src/zotero/attachmentFiles.ts` prüft Dateityp, Größe, PDF-Signatur und Änderungen
während des Lesens; es verarbeitet keinen Dokumenttext. Keine lokale Textextraktion,
OCR, externe Modellanbindung, Downloads oder temporären Dateikopien. Das Lesen und
die Interpretation der PDF übernimmt das Datei-/PDF-Werkzeug des Agenten.
Details und Clientgrenzen: [MCP](MCP.md).


## Bereinigung beim Sammlungswechsel

`ProjectController.connect` liest beim Wechsel innerhalb derselben Bibliothek und
Datenbank die aktuelle Quellenauswahl der neuen Sammlung ohne veralteten Cache.
`planCollectionChange` bildet die Schnittmenge mit den bereits importierten bzw.
über die gemeinsame Bestandserkennung zugeordneten Quellen. Persistierte Namen
und Bib-Felder der Schnittmenge bleiben erhalten. Andere Einträge der aktiven
Projekt-.bib, ihre Schlüsselzuordnungen und ihre LaTeX-Zitationen werden entfernt;
Bibliografie-Verweise werden bereinigt. Neue Sammlungsquellen werden nicht automatisch
importiert. Alle Änderungen werden vorab geplant und zusammen mit der neuen
Sammlungsbindung über `writeProjectChanges` gesichert/geschrieben. Ungespeicherte
Editoränderungen, zwischenzeitliche Dateiänderungen und Abruffehler brechen ab.
Ein Schreibfehler setzt die gesamte Transaktion zurück.
