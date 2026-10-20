# MCP mit Codex und Claude

Stand: 20. Oktober 2026. Der lokale stdio-Server unterstützt Lesen, bibliografische
Neuanlage, gezielte Quellenaktualisierung, Notizverwaltung, wissenschaftliche Recherche
mit zitatabhängigem Bib-Import, Verschieben in den Zotero-Papierkorb und Wiederherstellung,
Anhängen lokaler PDFs als gespeicherte Kopie und Weitergabe
angehängter PDFs an den Agenten.
Sammlungen können angelegt, dem Projekt zugeordnet und nach einem Wechsel gelöscht werden.
Es gibt keine lokale Textextraktion, OCR oder serverseitige Modellanalyse.
Zusätzlich rendert `tikz_render` lokal erstellten TikZ-Code im gewählten LaTeX-Projekt.

## Zotero eigenständig und optional mit Schreibprojekt

Der gebündelte MCP läuft ohne VS Code, LaTeX-Projekt, `.tex`, `.bib` oder
TeX-Installation. Er benötigt Node.js 20+ und ein laufendes Zotero mit aktivierter
lokaler API. Eine KI-Anwendung mit lokalem stdio-MCP startet ihn beispielsweise so:

```sh
node /absoluter/pfad/dist/mcp/server.cjs
```

Ohne Projekteinstellung liest er zunächst die persönliche Bibliothek (User 0).
`zotero_get_context` prüft rein lesend den Modus, den Einstellungsort und die
gewählte Bibliothek/Sammlung. `zotero_list_libraries` und `zotero_list_collections`
helfen bei der Auswahl; `zotero_set_project_collection` speichert diese auch ohne
Projekt. Der historische Werkzeugname bleibt kompatibel. Schreibaktionen in Zotero
benötigen weiterhin eine ausdrücklich gewählte Sammlung, die gespeicherte
Zotero-10-Datenbankkennung und Zotero-Freigabe.

Die eigenständigen Einstellungen und Wiederholungsprotokolle liegen unter
`~/.local/state/zotero-latex-assistant/.zotero/` auf Linux (bzw. unter
`$XDG_STATE_HOME/zotero-latex-assistant/.zotero/`), unter
`~/Library/Application Support/zotero-latex-assistant/.zotero/` auf macOS und
`%LOCALAPPDATA%/zotero-latex-assistant/.zotero/` auf Windows.
Mit `--state-dir /absoluter/ordner` lässt sich ein eigener Speicherort festlegen.
Reine Lesezugriffe ohne gespeicherte Auswahl legen keine Dateien an.

Wenn die KI in einem Schreibprojekt arbeitet, kann sie dessen **ausdrücklich
gewählten absoluten Ordnerpfad** bei jedem Projektaufruf als `projectPath` angeben.
Die unabhängige Zotero-Auswahl bleibt dabei erhalten. Das MCP rät keinen Ordner
aus seinem Arbeitsverzeichnis oder Quelleninhalten. Alternativ bindet
`--project /absolutes/projekt` den Server fest an genau dieses vorhandene Projekt;
dann werden abweichende `projectPath`-Angaben abgewiesen. `--project` und
`--state-dir` können nicht kombiniert werden.

1. `zotero_get_context({"projectPath":"/absolutes/projekt"})` prüft, ob
   `.zotero/config.json` eingerichtet ist und welche vorhandenen `.bib`-Dateien
   gefunden werden. Die Prüfung benötigt kein laufendes Zotero und schreibt nichts.
2. Bei fehlender Bibliotheksbindung legt `zotero_set_project_collection` mit
   `projectPath`, der gewählten `library` und `collectionKey` die Konfiguration
   selbst an. `collectionKey:null` erlaubt bibliotheksweites Lesen und Bib-Import,
   aber keine Quellen-Schreibaktionen in Zotero.
3. `zotero_add_to_bibliography` ergänzt ausdrücklich gewählte Zotero-Quellen in
   einer vorhandenen `.bib`, ohne `.tex` vorauszusetzen oder zu ändern:

```json
{
  "projectPath": "/absolutes/projekt",
  "itemKeys": ["ITEM2345"],
  "exporter": "native",
  "dryRun": true
}
```

Ohne `bibFile` verwendet der Import eine vorhandene konfigurierte Datei oder
erkennt einen eindeutigen Kandidaten. Bei `ambiguous` zeigt die KI die `candidates`
und fragt nach der gewünschten Datei; danach gibt sie deren relativen Pfad als
`bibFile` an. Ohne Treffer folgt `not-found`: keine `.bib` wird angelegt.
`dryRun:true` prüft auch den Export und zeigt die tatsächlichen Zitierschlüssel
und geplanten Dateien. Zum Anwenden folgt derselbe Aufruf mit `dryRun:false`.
Der Standardexporter ist `better-biblatex`; `native` ist die ausdrückliche Wahl
für Zotero ohne Better BibTeX. Es gibt keinen stillen Wechsel des Exporters.

Vorhandene Einträge, manuelle Metadaten und stabile Projektschlüssel bleiben
erhalten. Wiederholter Import bereits enthaltener Quellen ist idempotent.
Der Import sichert und aktualisiert ausschließlich die vorhandene `.bib` und
`.zotero/config.json`. Er prüft Quelldaten, Versionen, Scope, Datenbank sowie
Konfigurations-/Dateisnapshots erneut vor dem Schreiben. Mehrdeutige Exporte,
unaufgelöste Abhängigkeiten und neue bibliografische Dubletten werden abgewiesen.
Er schreibt weder in Zotero noch in die Konfiguration einer KI-Anwendung.

Auch `zotero_set_project_bib_file` und `zotero_sync_bibliography` akzeptieren
`projectPath`. Der bestehende Zitationsabgleich mit gespeicherten LaTeX-Dateien
bleibt als zusätzlicher Workflow verfügbar. Offene Änderungen vorher speichern;
der MCP sieht ausschließlich gespeicherte Dateien.

## TikZ-Grafiken im LaTeX-Projekt

`tikz_render` kompiliert TikZ-Code und speichert die bearbeitbare Quelle unter
**`figures/<name>.tikz`**. `figures/` wird bei der ersten erfolgreichen
Speicherung angelegt. `\input{figures/ablauf.tikz}` bindet die Grafik in LaTeX
ein; dafür ist kein `input/`-Ordner nötig. Bildvorlagen interpretiert die
KI-Anwendung, die anschließend den TikZ-Code an den MCP übergibt.

Voraussetzungen: lokal installiertes TeX mit TikZ (`pgf`) und Popplers
`pdftoppm`, erreichbar über `PATH`. Unter macOS werden fehlende TeX-Compiler
zusätzlich unter `/Library/TeX/texbin/` gesucht.
Zusätzliche angeforderte Pakete müssen bereits installiert sein.
Das Werkzeug funktioniert unabhängig von Zotero und einer `.bib`-Datei.

```json
{
  "projectPath": "/absolutes/latex-projekt",
  "name": "ablauf",
  "libraries": ["positioning", "arrows.meta"],
  "code": "\\begin{tikzpicture}\\node[draw] {Start};\\end{tikzpicture}"
}
```

`name` ist ein Dateiname ohne Endung: höchstens 80 ASCII-Buchstaben, Zahlen,
Bindestriche oder Unterstriche, beginnend mit Buchstabe oder Zahl.
Reservierte Windows-Gerätenamen wie `CON` sind ausgeschlossen.
`code` enthält genau ein `tikzpicture`, ohne Dokumenthülle oder Präambel.
`libraries` ist optional; `packages` erlaubt zusätzlich `pgfplots`, `circuitikz`,
`tikz-cd` und `forest`. Der globale Server verlangt `projectPath`.
Bei einem Start mit `--project` ist der Server an diesen Ordner gebunden.

Die Schrift ist optional:

- `font: "Arial"` oder `font: "Times New Roman"` überschreibt die Dokumentschrift
  nur innerhalb der Grafik. Die Schrift muss lokal installiert sein.
- Ohne `font` liest der MCP die gespeicherte Hauptdatei: zuerst `main.tex`,
  andernfalls eine eindeutige `.tex` mit `\documentclass`. Bei mehreren Treffern
  die gewünschte Datei als relativen Pfad in `texFile` übergeben.
- Erkannt werden direkte `\setmainfont`, `\setsansfont`, `\setmonofont`,
  `\familydefault`-Änderungen und gängige Schriftpakete wie `mathptmx`, `newtxtext`,
  `helvet` oder TeX Gyre. Lokale Präambeldateien über `\input` und lokale
  Klassen/Stilpakete werden mitgelesen. Kommentare und Dokumenttext werden ausgelassen.
  Dynamische oder bedingte Schriftangaben benötigen ein ausdrückliches `font`.
  Relative Präambelpfade beziehen sich auf `projectPath` als Arbeitsverzeichnis.
  Pakete werden einmal geladen; wiederholtes `\input` wird erneut ausgewertet.
- `engine` erlaubt `pdflatex`, `lualatex` oder `xelatex`. Ohne ausdrückliche Wahl
  wird der `% !TeX program = ...`-Hinweis der Hauptdatei übernommen.
  Benannte Schriften verwenden ansonsten LuaLaTeX; die übrigen Grafiken pdfLaTeX.
  Ohne Hauptdatei und ohne `font` bleibt die Standardschrift erhalten.

Benannte Schriften benötigen `fontspec` und LuaLaTeX oder XeLaTeX. Die gespeicherte
Quelle enthält die lokale Schriftwahl und den Compilerhinweis; auch das einbindende
Dokument muss einen kompatiblen Compiler verwenden. Die Schriftwahl ändert
Textbeschriftungen, nicht automatisch die Mathematikschrift. Fehlende Schriften
liefern einen Fehler, ohne eine andere Schrift einzusetzen.

Das Ergebnis enthält:

- `sourcePath`, `relativePath` und `sha256` der gespeicherten `.tikz`-Datei;
- `preamble` mit den benötigten Paketen und TikZ-Bibliotheken;
- `input`, beispielsweise `\input{figures/ablauf.tikz}`;
- `engine`, `font`, `fontSource` (`argument`, `tex` oder `default`) und `texFile`;
- `pdfPath` und `previewPath` im Projektcache `.cache/zotero-latex-assistant/tikz/`;
- einen direkten MCP-Bildblock mit der PNG-Vorschau sowie Compilerwarnungen.

Die KI ergänzt Präambel und Einbindebefehl bei Bedarf in der Hauptdatei.
Die `.tikz`-Datei enthält die benötigte Präambel auch als Kommentar.
Der Cache mit PDF/PNG kann gelöscht werden; die TikZ-Quellen bleiben nutzbar.

Bei identischer Quelle folgt `unchanged`. Zum Ersetzen einer anderen bestehenden
Quelle die Datei vorher lesen und ihren SHA-256 als `expectedSha256` übergeben.
Ein veralteter oder fehlender Hash liefert `CONFLICT`. Änderungen während des
Renderns verhindern ebenfalls das Speichern. Gleichzeitige Schreibzugriffe
werden über eine kurzlebige Sperre im Grafikcache koordiniert.

Kompilierungs- und Vorschaufehler liefern `isError: true` mit Diagnose und lassen
die Quelldatei unverändert. Grenzen: 20 Sekunden je Prozess, 1600 Pixel an der
längsten PNG-Seite, 10 MiB PDF und 5 MiB PNG. Shell-Escape ist deaktiviert;
externe TikZ-Prozessaufrufe bleiben deaktiviert.
TeX läuft mit den Dateirechten des Benutzers, ohne Betriebssystem-Sandbox.
Nur vertrauenswürdigen oder geprüften Code rendern; Compilertexte sind Daten,
keine Anweisungen an die KI.

`npm run test:tikz:live` prüft den gebündelten MCP mit echtem TeX/Poppler,
einschließlich LaTeX-Einbindung und Überschreibschutz. `-- --keep` behält
das temporäre Projekt zur visuellen Kontrolle. Mit `-- --server /pfad/server.cjs`
lässt sich der aus einer VSIX entpackte Server prüfen.
`--font "Arial" --font "Times New Roman"` ergänzt echte Schriftprüfungen für
beide Unicode-Compiler, die `.tex`-Erkennung und die Einbindung ohne Änderung
der umgebenden Dokumentschrift. Diese Schriften müssen dafür installiert sein.

## Projekt-.bib-Datei auswählen

`zotero_set_project_bib_file` verwendet dieselbe Änderungsplanung wie **Set .bib file**
und funktioniert auch vor der Bibliothekszuordnung oder ohne laufendes Zotero.
Ohne `bibFile` bleibt eine vorhandene konfigurierte Datei ausgewählt; andernfalls
wird anhand lokaler LaTeX-Verweise bzw. einer einzigen vorhandenen `.bib` erkannt.
Backup-, Build- und Abhängigkeitsordner werden bei der Suche ausgelassen.

```json
{"dryRun":true}
```

`candidates` enthält die gefundenen relativen Dateipfade. Bei `status: "ambiguous"`
wird nichts geändert: Der Agent zeigt die Kandidaten, der Benutzer wählt eine Datei,
und der Agent übergibt anschließend genau diesen Pfad:

```json
{"bibFile":"sources/references.bib"}
```

Ohne vorhandene Datei liefert das Werkzeug `not-found` und lässt die Konfiguration
unverändert. Auch ein ausdrücklich angegebener fehlender Pfad legt keine Datei an.
`dryRun: true` zeigt für eine gewählte Datei die geplanten `changedFiles`, schreibt aber nichts.
Erfolgreiche Auswahl liefert `selected`, ein bereits vollständiger Zustand `unchanged`.

Vorhandene Bib-Inhalte, Bibliotheksbindung, Zitierstil und gespeicherte Schlüssel bleiben
erhalten. Bisherige literale LaTeX-Ressourcenverweise werden angepasst und eine bestehende
BibLaTeX-Einrichtung wird wie im Extension-Befehl vervollständigt. Ein konfigurierter
BibLaTeX-Stil muss lokal über `kpsewhich` verfügbar sein. Änderungen werden gemeinsam
gesichert und bei Schreibfehlern zurückgesetzt; geänderte gespeicherte Dateien verhindern
das Schreiben. Vorher Editorpuffer speichern: Der eigenständige Server sieht nur Dateien
auf der Festplatte. Pfade und Symlinks dürfen das Projekt nicht verlassen.

Aufrufe zum Setzen gehören zur beauftragten Projekteinstellung bzw. zum Schreiben mit
Zitationen. Zotero-Schreibfreigaben sind hierfür nicht erforderlich.

## Sammlungen anlegen, zuordnen und löschen

**Die zugeordnete Projekt-Sammlung darf nicht gelöscht werden.** Das gilt ebenso
für jede übergeordnete Sammlung, deren Löschung diese Sammlung mit entfernen würde.
Die Sperre lässt sich durch `includeDescendants` oder eine alte Versionsangabe nicht
umgehen. Zuerst die Projektzuordnung erfolgreich wechseln, danach die bisherige
Sammlung löschen. Eine reine Vorschau wechselt die Zuordnung noch nicht.

- `zotero_list_collections` zeigt Sammlungsnamen, Keys und Eltern. Optional eine
  ausdrückliche `library` aus `zotero_list_libraries` angeben, um schon vor der
  ersten Projektzuordnung deren Sammlungen zu sehen. Das gewährt keinen zusätzlichen
  Quellenzugriff und ändert die Projektbindung nicht.
- `zotero_get_collection({library,collectionKey})` liefert die Sammlung und ihre
  `version`, Unter-Sammlungskeys sowie `assignedToProject`/`deletionBlocked`.
  Sammlungsnamen sind nicht eindeutig; Auswahl und Löschung erfolgen nach Keys.
- `zotero_create_collection` legt eine Sammlung in der konfigurierten Bibliothek
  an. `parentCollectionKey: null` (Standard) bedeutet oberste Ebene; ein Key legt
  eine Unter-Sammlung an. Eine Bibliotheks-/Zotero-10-Bindung reicht aus, es muss
  noch keine Sammlung ausgewählt sein. Die Anlage ordnet das Projekt nicht automatisch zu.

```json
{"name":"Neue Arbeit","parentCollectionKey":null,"requestId":"collection-2026-001"}
```

Neuanlagen reservieren den Key unter `.zotero/mcp/collections/`. Nach Antwortverlust
dieselbe Anfrage-ID, denselben Namen und dieselbe Elternsammlung wiederverwenden:
ein gespeicherter passender Eintrag liefert `already-created`; ungeklärte Ergebnisse
werden nicht durch eine zweite Anlage ersetzt. Eindeutige HTTP-/Batch-Ablehnungen
können unter dem reservierten Key erneut versucht werden. Elternversion, Projektbindung
und Datenbank werden nach der Zotero-Freigabe nochmals geprüft, das Ergebnis rückgelesen.

### Projektzuordnung wie „Set library“

`zotero_set_project_collection` übernimmt die Regeln des Extension-Befehls und
verwendet denselben `planCollectionChange` für die Bereinigung:

```json
{"library":{"type":"user","id":0},"collectionKey":"NEWCOL01","dryRun":false}
```

Beim Wechsel innerhalb derselben Bibliothek und Zotero-Datenbank bleiben bereits
zugeordnete bzw. erkannte Quellen erhalten, die in der neuen Sammlung vorhanden sind.
Ihre manuell bearbeiteten Bib-Felder und Projektschlüssel bleiben stabil. Andere
Einträge der aktiven .bib einschließlich nicht zuordenbarer Einträge werden wie
bei **Set library** entfernt; ihre LaTeX-Zitate und Verweise in weiteren lokalen
Bib-Dateien werden bereinigt. Neue Quellen der Ziel-Sammlung werden nicht importiert.
Eine leere Ziel-Sammlung bereinigt den alten Literaturbestand vollständig.

Bib-Pfad, Zitierstil und Zitierbefehl bleiben erhalten. Bib-Dateien, betroffene
LaTeX-Dateien und Konfiguration werden gemeinsam unter `.zotero/backups/bibliography-…`
gesichert und bei Schreibfehlern zurückgesetzt. Dateibestand, Inhalte, Zielversion,
Sammlungsmitgliedschaften und Projektbindung werden vor dem Schreiben erneut geprüft.
`dryRun: true` zeigt entfernte Schlüssel, Anzahl entfernter Bib-Einträge, verbleibende
Item-Keys und betroffene Dateien vorab; es verändert die Zuordnung nicht.

Die Zuordnung funktioniert auch bei einem noch nicht konfigurierten Projekt oder
fehlender .bib. Eine ausdrückliche `collectionKey: null` wählt wie **Set library**
die gesamte Bibliothek; quellenbezogene Zotero-Schreibwerkzeuge bleiben dann gesperrt.
Ein Wechsel der Bibliothek oder Datenbank mit vorhandenen Imports wird wie in der
Extension blockiert: erst deren bestehenden **Delete all citations**-Ablauf verwenden.
Der Server greift ausschließlich auf gespeicherte Dateien zu; vor dem Wechsel
relevante Editoränderungen speichern. Es ist kein Zotero-Schreibdialog erforderlich,
weil die Zuordnung nur Projektdateien ändert.

### Sammlung nach dem Wechsel löschen

Nach abgeschlossener Zuordnung eine alte Sammlung mit `zotero_get_collection`
lesen und auf ausdrücklichen Auftrag löschen:

```json
{"library":{"type":"user","id":0},"collectionKey":"OLDCOL01","expectedVersion":10,"includeDescendants":false}
```

`zotero_delete_collection` prüft die Löschsperre vor jeder Autorisierung und erneut
danach. Dazu gehören aktuelle Projektbindung, Hierarchie und Versionen aller
betroffenen Sammlungen. Enthält die Sammlung Unter-Sammlungen, werden deren genaue
Keys vorab angezeigt; erst ein ausdrücklicher Auftrag darf `includeDescendants: true`
verwenden. Auch dann bleibt eine darin zugeordnete Projekt-Sammlung geschützt.

Der Server verwendet versionsgeschütztes `DELETE` und prüft anschließend, dass
alle betroffenen Sammlungen fehlen. Bereits fehlende, nicht geschützte Keys liefern
`already-deleted`. Die Sammlung wird endgültig entfernt, die Quellen bleiben in
Zotero; ihre übrigen Mitgliedschaften bleiben erhalten. .bib, LaTeX und Zuordnung
werden bei der Löschung nicht geändert. Insbesondere gibt es kein automatisches
Abwählen einer zugeordneten Sammlung als Teil des Löschvorgangs.

MCP und Extension-Projektaktionen teilen sich `.zotero/mcp/write.lock`, damit eine
gleichzeitige Zuordnung über **Set library** und MCP-Löschung nicht gegeneinander laufen.
Die Löschsperre gilt für die Projektbindung des mit `--project` gestarteten Servers;
Zotero stellt keinen projektübergreifenden Zuordnungsindex bereit.

API-Grundlage: [Sammlungen erstellen/löschen](https://www.zotero.org/support/dev/web_api/v3/write_requests#collection_requests)
und [Zotero-Sammlungsmodell](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/collection.js).

## Quellen bei PubCheck prüfen und Zitationszahlen abrufen

Die PubCheck-Prüfung hat zwei Einstiege:

- `zotero_check_sources` prüft vorhandene Zotero-Quellen im ausgewählten Scope.
- `zotero_check_candidate` prüft eine gefundene Quelle **vor dem Zotero-Import**
  anhand übergebener Metadaten. Es benötigt weder laufendes Zotero noch Projekt,
  Bibliotheksbindung, Item-Key oder Dateien.

Eine `.bib`-Datei und Better BibTeX sind dafür nicht erforderlich. Einzelne Quellen:

```json
{"itemKeys":["ITEM2345","ITEM2346"],"includeCitationCounts":true}
```

Für einen neuen Kandidaten `metadata` aus `zotero_research` oder
`zotero_lookup_identifier` übernehmen bzw. tatsächlich recherchierte Angaben
übergeben. Beispiel für einen Aufruf ohne Zitationszählung:

```json
{
  "metadata": {
    "itemType": "journalArticle",
    "title": "Tatsächlicher Titel der gefundenen Publikation",
    "creators": [{"creatorType":"author","firstName":"Ada","lastName":"Lovelace"}],
    "fields": {"date":"2026","publicationTitle":"Tatsächlicher Zeitschriftentitel"}
  },
  "includeCitationCounts": false
}
```

Vorhandene DOI/ISBN als `fields.DOI`/`fields.ISBN` mitgeben. Nur Typ und Titel
sind Pflicht; fehlende Angaben bleiben leer. Die Funktion prüft die angegebenen
Fakten und ersetzt keinen verdächtigen Titel durch Anbieterangaben. ISBN-Schreibweisen
werden ausschließlich für die Prüfung normalisiert; die Zotero-/Eingabedaten bleiben erhalten.
Notizen, Abstracts, Tags und Zitierschlüssel können in den übergebenen Metadaten
stehen, werden aber nicht an die Prüfdienste gesendet. Anhänge/Notizen/Annotationen
sind keine bibliografischen Kandidaten und werden vor externen Anfragen abgewiesen.

Der neue Einstieg liefert `metadata`, `pubcheck`, `citations` und `guidance`.
Die Nachweise, Statuswerte, Vergleiche und DOI-/ISBN-Zitationsabfragen sind dieselben
wie bei gespeicherten Quellen. Er erfindet keine Zotero-Keys oder Versionen und
meldet `zoteroChanged:false`, `projectFilesChanged:false`, `contentVerified:false`.
Eine Prüfung legt keine Quelle an; die Übernahme bleibt eine separate Aktion.

Für alle Quellen mit `{"limit":5,"offset":0}` beginnen und mit dem zurückgegebenen
`nextOffset` fortsetzen, bis es `null` ist. Pro Aufruf sind höchstens zehn Quellen
möglich. Die Reihenfolge richtet sich nach dem Zotero-Item-Key. Einzelne Schlüssel
müssen eindeutig sein, zum Projektscope gehören und dürfen nicht im Papierkorb liegen.

Jedes Ergebnis enthält `itemKey`, `title`, die gelesene Zotero-Version und:

- `pubcheck.verdict`: `VERIFIED`, `METADATA_MISMATCH`, `RETRACTED`, `NOT_FOUND`,
  `INVALID_IDENTIFIER`, `UNVERIFIABLE` oder `ERROR`, mit Gründen, verglichenen
  Feldern, gefundenem Datensatz, Hinweisen und Rückzugsdaten-Snapshot.
- `pubcheck.metadataMatches`: `true` nur bei positivem Vergleich des Titels und
  aller übermittelten bibliografischen Vergleichsfelder; `false` bei gemeldeten
  Abweichungen; sonst `null`. Ein aufgelöster DOI allein bestätigt keine Metadaten.
- `citations.count`: Zitationen durch andere Publikationen, separat aus Crossrefs
  `is-referenced-by-count`, mit DOI, ISBN, Anbieter, Herkunfts-URL, Abrufzeitpunkt
  und `matchedBy` (`doi`, `isbn` oder bei ungeklärter Zuordnung `null`). Eine
  vorhandene DOI hat Vorrang. Ohne DOI werden gültige ISBNs über Crossrefs
  ISBN-Filter gesucht, einschließlich der entsprechenden ISBN-10 einer ISBN-13.
  Crossrefs Index ist unvollständig; Zahlen ändern sich. Bei fehlenden gültigen
  Kennungen, fehlendem Datensatz oder Dienstfehlern ist die Zahl `null`, nie ersatzweise `0`.
  `0` mit Status `available` ist ein tatsächlich gemeldeter Indexwert.

Der ISBN-Fallback unterstützt Zotero-Bücher und Buchabschnitte. ISBN, Quellentyp
und normalisierter Titel müssen passen; vorhandene Autoren/Herausgeber, Jahr,
Auflage und bei Kapiteln Buchtitel/Seiten werden ebenfalls verglichen. Abgekürzte
Vornamen können zu vollständigen Namen passen; unterschiedliche vollständige
Vornamen werden abgewiesen. Es wird genau ein DOI-Datensatz ausgewählt.
`ambiguous` bedeutet mehrere passende DOI, `invalid-isbn` eine nicht nutzbare
ISBN und `unsupported-type` einen Quellentyp, der über die ISBN nur auf ein
übergeordnetes Buch verweisen könnte. Kapitelzählungen werden nie zum Buchwert
addiert. Unvollständige Kandidaten oder Suchergebnisse ergeben `unavailable`.
ISBNs/Ausgaben mit verschiedenen passenden DOI werden nicht zusammengefasst.
Die Suche prüft höchstens fünf ISBN-Identitäten und ihre ISBN-10-Entsprechungen,
100 Treffer pro Seite, höchstens 500 pro Filter und insgesamt zwölf Anfragen
innerhalb von 20 Sekunden. Bei überschrittenen Grenzen bleibt die Zahl unbekannt;
ein Treffer aus einer unvollständigen Suche wird nicht als eindeutig ausgegeben.
Der MCP ergänzt eine gefundene DOI nicht automatisch in Zotero.


### DOI und mehrere ISBNs korrekt prüfen

PubCheck behandelt das ISBN-Feld bei Büchern als einzelne Kennung und kann es
gegenüber einer vorhandenen DOI bevorzugen. Zusammengeklebte ISBNs oder eine
kommaseparierte Liste konnten daher `NOT_FOUND` auslösen, obwohl der richtige
DOI-Datensatz existiert. Der MCP verwendet jetzt eine gültige DOI als primäre
PubCheck-Kennung und prüft **alle** angegebenen ISBNs separat gegen die ISBN-Liste
auf genau dieser Crossref-DOI. Derselbe DOI-Abruf wird innerhalb einer Prüfung für
ISBN-Abgleich und Zitationszählung gemeinsam verwendet.

`pubcheck.isbnValidation` zeigt die normalisierten `isbns`, Anbieter, Herkunfts-URL,
Grund und Status (`matched`, `unconfirmed`, `invalid`, `unavailable`). Nur wenn
PubCheck alle übrigen Angaben bestätigt und sämtliche ISBNs auf dem DOI-Datensatz
aufgeführt sind, wird `metadataMatches:true` gemeldet. Fehlende ISBNs im Register
sind kein Beweis für falsche Angaben; bei unvollständiger oder fehlgeschlagener
ISBN-Prüfung bleibt der Gesamtvergleich `null` und `isbn` steht in `uncomparedFields`.
Die Prüfschritte stehen zusätzlich in `warnings`; Zotero wird nicht korrigiert.

Vollständig gültige, aneinandergehängte ISBN-13-Werte werden anhand von Länge,
Präfix und Prüfziffer getrennt. Beispielsweise wird
`97830308543559783030854362` für die Prüfung zu
`9783030854355` und `9783030854362`. Ungültige Teile werden nicht still weggelassen.
Ohne gültige DOI werden mehrere ISBNs einzeln an PubCheck übergeben und in
`isbnChecks` samt Hinweisen und Rückzugsinformationen ausgewiesen. Der Gesamtstatus
bleibt `UNVERIFIABLE`, bis die konkrete Ausgabe eindeutig ausgewählt ist.

PubPeer-Kommentare sind `advisories`: Die Hinweise kommen von PubCheck und werden
vom MCP weitergereicht. Ihre Anzahl ist keine Zitationszahl und für sich genommen
kein Ablehnungsgrund. Der Agent soll den Inhalt bei Bedarf gesondert ansehen.
Quelle: [Crossref-ISBN-Filter](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/).

PubChecks `citation_count` zählt die geprüften Literaturangaben und wird **nicht**
als Zitationszahl verwendet. `includeCitationCounts:false` überspringt die
Zitationszählung. Bei DOI und vorhandenen ISBN-Angaben wird Crossref-Metadatenabgleich
für die ISBNs weiterhin ausgeführt, auch wenn die Zählung ausgeschaltet ist.
Fehler der beiden Dienste werden unabhängig pro Quelle gemeldet. Die Funktion
ändert weder Zotero noch Projektdateien und bestätigt keine wissenschaftliche
Richtigkeit oder Unterstützung konkreter Aussagen (`contentVerified:false`).
Titelsuchen ohne DOI sind näherungsweise und brauchen menschliche Prüfung.

Nur nach beauftragter externer Quellenprüfung verwenden: Titel, Autoren, Jahr,
Publikationsort und DOI/ISBN werden an PubCheck übermittelt, DOI oder ISBN zusätzlich an
Crossref. Notizen, Abstracts, PDFs und LaTeX-Inhalte werden nicht übertragen.
Verwendet wird PubChecks öffentliche, unversionierte Browser-Schnittstelle
`https://pubcheck.net/api/browser/lookup`; Änderungen daran können die Prüfung
vorübergehend verhindern und werden als Fehler gemeldet. Beschreibungen:
[PubCheck](https://pubcheck.net/about),
[Crossref-Zitationsmetrik](https://github.com/CrossRef/rest-api-doc/blob/master/api_format.md).

Ein vorgeschlagener Ablauf mit Prüfung vor dem Import und getrennten Entscheidungen
für bestätigte, widersprüchliche und ungeklärte Quellen steht im
[Research-Workflow](RESEARCH_WORKFLOW.md). Die Agentenanweisungen verlangen für
beauftragte externe Prüfung neuer Kandidaten `zotero_check_candidate` vor der
Übernahme. Ein positives PubCheck-Ergebnis wird von den Importwerkzeugen noch
nicht technisch erzwungen; Kandidatenprüfung und Import bleiben separate Aufrufe.

## Wissenschaftlicher Ablauf, Notizen und Wiederherstellung

Der Server stellt 34 Werkzeuge bereit, davon 33 für Zotero und eines für TikZ. Der wissenschaftliche Ablauf ist in seinen
Anweisungen verankert und über Recherche-, Prüf- und Bibliografiewerkzeuge ausführbar:

1. `zotero_research` sucht zuerst in der ausgewählten Zotero-Sammlung und der
   konfigurierten Projekt-.bib. Bei lokalen Treffern bleibt die Standardsuche lokal.
   `external: "always"` recherchiert nach dieser Bestandsprüfung weitere Quellen;
   `external: "never"` beschränkt sie ausdrücklich auf den Bestand.
2. Ohne vorhandene Treffer folgt eine Crossref-Titelsuche. Neue Treffer werden
   einzeln über ihre DOI mit Crossref/DataCite aufgelöst. Eine eingegebene ISBN
   wird mit Open Library geprüft. Ergebnisse enthalten Anbieter, Identifier,
   Herkunfts-URL und Hinweise; nicht verifizierte Kandidaten stehen in `failures`.
   Das bestätigt bibliografische Identität und Metadaten, keine wissenschaftlichen
   Aussagen oder Eignung für eine konkrete Behauptung (`contentVerified: false`).
   Dafür Publikation/PDF und belegbare Fundstellen selbst prüfen.
3. Neue Kandidaten mit `zotero_check_candidate` vor einer Übernahme prüfen;
   vorhandene Zotero-Quellen mit `zotero_check_sources`. Widersprüchliche Angaben
   und Rückzugswarnungen aus der normalen Belegauswahl ausschließen; fehlende,
   fehlerhafte oder unvollständige Vergleiche als ungeklärt zurückstellen.
   Metadatenprüfung, Zitationszahl und inhaltliche Eignung getrennt beurteilen.
4. Gewünschte neue Quellen über `zotero_import_identifier` nach Benutzerauftrag
   in Zotero speichern; geeignete vorhandene Quellen wiederverwenden.
   Recherche, Notizen und Zotero-Neuanlagen übernehmen nichts in die .bib.
5. Nach dem beauftragten Schreiben mit Zitationen LaTeX-Dateien speichern und
   `zotero_sync_bibliography` aufrufen. Der Server ermittelt selbst die ausdrücklich
   referenzierten Schlüssel aus gespeicherten `.tex`, `.ltx`, `.sty` und `.cls`
   im Projekt. Nur fehlende, eindeutig auflösbare Quellen werden automatisch
   übernommen. Kommentare, Verbatim-Beispiele und reine Alias-/Set-Definitionen
   zählen nicht. Die menschliche Checkbox-Auswahl und bestehende manuelle Felder
   bleiben erhalten; unzitierte vorhandene Einträge werden nicht entfernt.

```json
{"query":"Publikationstitel","external":"if-missing","limit":5}
```

Aufruf von `zotero_sync_bibliography`:

```json
{"exporter":"better-biblatex","dryRun":false}
```

`dryRun: true` zeigt die fehlenden Imports vorab. Der Standard verwendet Better
BibLaTeX; `exporter: "native"` wählt ausdrücklich den nativen Zotero-Exporter.
Unbekannte/mehrdeutige Schlüssel, dynamische Zitierargumente, `\nocite{*}`,
unaufgelöste Exportabhängigkeiten und Dubletten verhindern den automatischen Import.
Explizite `\nocite{Schlüssel}` gelten als gewünschte Literaturreferenzen.
Es wird kein TeX kompiliert: geprüft werden unterstützte Befehle in den gespeicherten
Projektdateien, einschließlich lokaler `DeclareCiteCommand`-/`DeclareMultiCiteCommand`-
Befehle. Nicht eingebundene Projektdateien werden ebenfalls berücksichtigt.
Eigene Makro-Wrapper mit dynamischen Schlüsselargumenten müssen vorab aufgelöst werden.
Dateipfade unterliegen dem bestehenden Pfad-/Symlinkschutz. .bib und Schlüsselzuordnung
werden gemeinsam gesichert und mit Rücksetzen bei Fehlern geschrieben; geänderte
LaTeX-Dateien, Quellenversionen, Sammlung oder Projektbindung verhindern das Schreiben.
Der eigenständige Server sieht keine ungespeicherten Editorpuffer: relevante Dateien
vorher speichern. Er führt keine Hintergrundüberwachung aus; der Agent ruft den
Abgleich nach seinem Schreibauftrag auf. Der Import braucht keine Zotero-Schreibfreigabe.

### Quellennotizen

- `zotero_list_notes({library,itemKey})`: Notizschlüssel, Elternquelle und Versionen
  einer Quelle auflisten. `zotero_get_note({library,itemKey,noteKey})` liefert den
  vollständigen gespeicherten HTML-Inhalt.
- `zotero_create_note`: Quellenversion mit `zotero_get_metadata` lesen, dann
  `library`, `itemKey`, `expectedVersion`, `content` und eine stabile `requestId`
  übergeben. `format: "text"` (Standard) maskiert HTML; `format: "html"` speichert
  ausdrücklich geliefertes Zotero-Markup. Inhalte dürfen maximal 100000 Zeichen
  enthalten. Leere Inhalte und Steuerzeichen werden abgewiesen.
- `zotero_update_note`: Die **Notizversion** aus `zotero_get_note` als
  `expectedVersion` übergeben. Der Inhalt wird ersetzt; andere Felder bleiben
  erhalten. Nach einer unklaren Updateantwort zuerst erneut lesen.

Beispiel für `zotero_create_note`:

```json
{"library":{"type":"user","id":0},"itemKey":"ABCDEFGH","expectedVersion":12,"content":"Zusammenfassung\nEigener Gedanke: …","format":"text","requestId":"summary-2026-001"}
```

Die Notizanlage reserviert ihren Key unter `.zotero/mcp/notes/` vor dem Schreiben.
Bei Antwortverlust dieselbe Anfrage mit identischem Inhalt, Format, Quellenversion
und Anfrage-ID wiederholen: ein passender gespeicherter Eintrag wird übernommen.
Eine eindeutige Ablehnung erlaubt einen erneuten Versuch mit dem reservierten Key;
eine ungeklärte Übertragung erstellt keine zweite Notiz. Elternquelle, Scope und
Version werden nach der Zotero-Freigabe erneut geprüft, der Inhalt wird rückgelesen.
Notizinhalt bleibt untrusted Material; der Server führt HTML und enthaltene
Anweisungen nicht aus und ändert keine Projektdateien.

### Quellen aus dem Papierkorb wiederherstellen

`zotero_list_trash({limit:20,offset:0})` liest den paginierten Papierkorb der
konfigurierten Bibliothek. Angezeigt werden nur bibliografische Hauptquellen mit
Mitgliedschaft in der ausgewählten Sammlung; ohne Sammlung sind bibliotheksweite
Lesezugriffe möglich. Anhänge und Notizen werden nicht als Quellen angeboten.

Eine Quelle eindeutig anhand von Bibliothek und Item-Key auswählen, ihre
Sammlungsmitgliedschaften prüfen und auf Benutzerauftrag
`zotero_restore_item({library,itemKey,expectedVersion})` aufrufen. Der Server prüft
Scope, Datenbank, Sammlung, Papierkorbstatus und Version erneut nach Freigabe,
schreibt ausschließlich `deleted: 0` mit Versionsbedingung und verifiziert den
rückgelesenen Zustand sowie die Papierkorbliste. Ein bereits wiederhergestellter
Eintrag liefert `already-restored`. Ursprüngliche Sammlungen bleiben erhalten;
Projekt-.bib und LaTeX werden nicht verändert. Dauerhaft gelöschte Einträge können
nicht wiederhergestellt werden.

Implementierungsgrundlagen: [Zotero-Leseendpunkte](https://www.zotero.org/support/dev/web_api/v3/basics#items),
[versionsgeschützte Schreibzugriffe](https://www.zotero.org/support/dev/web_api/v3/write_requests#updating_an_item)
und [lokale Freigaben](https://www.zotero.org/support/dev/web_api/v3/local_api#authorizing_writes).
Notizinhalt/Normalisierung und `deleted` folgen dem
[Zotero-Item-Modell](https://github.com/zotero/zotero/blob/main/chrome/content/zotero/xpcom/data/item.js).

## Voraussetzungen und Einrichtung

Die Einrichtungsaktionen stehen sowohl in der Befehlspalette als auch im
Zahnrad-Menü der Zotero-Seitenleiste (**Configure project**):
**Set up Codex MCP connection** und **Set up Claude MCP connection**.
**Set up Cursor MCP connection** richtet Cursor im aktuellen Projekt ein.
Alle drei Aktionen verlangen die ausdrückliche Auswahl einer vorhandenen,
lesbaren lokalen `.cjs`-Serverdatei. Der Installationspfad des gebündelten Servers
wird nicht automatisch übernommen oder im Dateidialog vorbelegt. Abbruch verändert
keine Konfiguration. Offene, ungespeicherte MCP-Konfigurationen zuerst speichern.

- Node.js 20 oder neuer auf derselben Maschine wie Zotero; bei Bedarf den absoluten
  Programmpfad in `zoteroLatexAssistant.nodePath` eintragen.
- Zotero starten und unter Einstellungen → Erweitert die Kommunikation mit anderen
  Anwendungen erlauben. Lesen ist ohne Schlüssel möglich. Schreiben benötigt Zotero 10+.
- Optional den lokalen Schreibprojektordner öffnen und über **Zotero: Set library** die
  Bibliothek und ausdrücklich die gewünschte Sammlung auswählen. Dadurch werden
  Bibliothek, Sammlung und bei Zotero 10 die Server-ID in `.zotero/config.json` gespeichert.
  Eine `.bib`-Datei ist für Zotero-Lese-/Schreibwerkzeuge nicht erforderlich;
  `zotero_sync_bibliography` braucht den konfigurierten Projekt-Bib-Pfad.
- Ein VSIX über `npm ci && npm run package` bauen und installieren oder mit F5 den
  Extension Development Host starten. Das Paket enthält `dist/mcp/server.cjs`
  einschließlich seiner Laufzeitabhängigkeiten. Der Rechner benötigt kein globales MCP-SDK.

### Codex-Erweiterung in VS Code

1. **Zotero: Set up Codex MCP connection** aufrufen. Bei mehreren Projektordnern
   gilt der aktive Editorordner oder die ausdrücklich gewählte Ordnerauswahl.
2. Die Aktion schreibt einen markierten Serverabschnitt in **dieses Projekts**
   `.codex/config.toml`, erhält andere Server und öffnet die fertige Konfiguration.
   Sie übergibt den ausdrücklich ausgewählten Serverpfad, Projektpfad, lokale API-URL und Zeitlimit als Argumente.
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

Bei einem Wechsel der gewünschten Serverdatei die Einrichtungsaktion erneut aufrufen
und die neue Datei selbst auswählen. Der markierte Abschnitt wird ersetzt. Ein gleichnamiger, nicht
von der Aktion verwalteter Server wird zum Schutz vorhandener Einstellungen abgewiesen.
Absolute lokale Pfade sind maschinenabhängig; die erzeugte Client-Konfiguration
nicht ungeprüft mit anderen Rechnern teilen.

### Claude Code und Claude-Erweiterung in VS Code

1. **Zotero: Set up Claude MCP connection** aufrufen.
2. Die gewünschte `.cjs`-Serverdatei selbst auswählen. Die Aktion ergänzt den Server in der projektbezogenen `.mcp.json` und öffnet
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

### Cursor über die Erweiterung einrichten

1. Das Schreibprojekt öffnen und **Zotero: Set up Cursor MCP connection** aufrufen,
   über Befehlspalette oder Zahnradmenü der Zotero-Seitenleiste.
2. Die gewünschte `.cjs`-Serverdatei selbst auswählen. Sie muss lokal, lesbar und
   eine vorhandene Datei sein. Der Befehl verwendet keinen automatischen Serverpfad.
3. Die Aktion ergänzt den Eintrag unter `mcpServers` in **`.cursor/mcp.json` dieses
   Projekts** und öffnet die Konfiguration. Der Projektpfad wird als `--project`
   übergeben; Node-Pfad, lokale API-URL und Timeout kommen aus den Einstellungen.
4. Den Server in Cursors MCP-Einstellungen aktivieren bzw. neu starten und
   `zotero_get_context` aufrufen. Falls die Bibliotheksbindung fehlt, sie per Chat
   auswählen. Die globale Cursor-Konfiguration bleibt unangetastet.

Andere Server und weitere Konfigurationsfelder bleiben erhalten. Ein gleichnamiger
Eintrag für dasselbe Projekt kann aktualisiert werden, auch wenn sein Projektargument
bisher `${workspaceFolder}` war. Fremde Projektbindungen und Remote-Server werden
nicht überschrieben. Ein bisher eigenständiger Cursor-Eintrag kann dem Projekt
zugeordnet werden, wenn er genau auf die jetzt ausdrücklich gewählte Serverdatei zeigt.
Quelle: [Cursor-MCP-Dokumentation](https://cursor.com/docs/mcp).

## Werkzeuge und Ergebnisse

Jedes Werkzeug liefert Text mit JSON sowie strukturierte Daten. Erfolg hat
`{ "ok": true, "result": … }`; Fehler hat `isError: true` und
`{ "ok": false, "error": { "code": …, "message": … } }`.
Werkzeuge haben Ein- und Ausgabeschemas, beschreibende Hinweise und MCP-Annotationen.
Leseoperationen sind als lesend markiert. Papierkorb ist als destruktive, wiederholbare
Operation markiert; es gibt kein Werkzeug für endgültiges Löschen.

| Werkzeug | Eingaben | Ergebnis / Zugriff |
| --- | --- | --- |
| `zotero_check_candidate` | `metadata`, optional `includeCitationCounts` | PubCheck und DOI-/ISBN-Zitationszahl für eine noch nicht gespeicherte Quelle; kein Zotero-/Dateizugriff |
| `zotero_get_context` | optional `projectPath` | Modus, Einstellungen, Bibliotheksbindung und vorhandene `.bib`-Kandidaten; ohne Änderungen |
| `zotero_add_to_bibliography` | `itemKeys` (1–100), optional `projectPath`, `bibFile`, `exporter`, `dryRun` | Ausgewählte Quellen ohne `.tex` in vorhandene `.bib` ergänzen; Konfiguration und Sicherung |
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
- `.zotero/mcp/write.lock` sperrt konkurrierende MCP-Schreibabläufe und Extension-Projektaktionen.
  Nach einem Prozessabsturz die Sperre nur entfernen, wenn alle zu diesem Projekt
  gehörenden Zotero-MCP-Prozesse und Extension-Projektaktionen beendet sind. Anfrageprotokolle zum Schutz vor
  Doppelanlagen erhalten. Außerhalb dieses Projekts gestartete MCP-Prozesse und
  manuelle Zotero-Änderungen sind nicht durch diese Projektsperre koordiniert.
- Quellenlöschen verwendet ausschließlich `PATCH { "deleted": 1 }` mit
  `If-Unmodified-Since-Version`; anschließend werden Einzelobjekt und
  `items/trash` mit Paginierung und lokalem Key-Vergleich geprüft. Die lokale
  Version 10.0.6 liefert beim `itemKey`-Filter keine Papierkorbtreffer;
  `deleted: true` und `deleted: 1` werden als Papierkorbstatus erkannt. HTTP `DELETE` wäre endgültiges Löschen und wird
  für Quellen nicht verwendet. Wiederholung gibt `already-trashed` zurück.
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
- Automatisierte Tests prüfen die 33 Zotero-Werkzeuge mit dem offiziellen MCP-Client
  über den gebündelten stdio-Prozess sowie Neuanlage, Zuordnung, Dubletten,
  Wiederholung nach verlorener Antwort, Papierkorb, Fremdscope, Datenbankwechsel,
  Versionskonflikte, verweigerte/abgelaufene Freigaben und Änderungen während des
  Autorisierungsdialogs. Beide TypeScript-Projekte werden geprüft.
- Sammlungsverwaltung: 488 Tests bestanden, einschließlich Zuordnen wie **Set library**,
  gesperrter Löschung der aktiven Sammlung/Vorfahren, erfolgreichem Wechsel vor
  Löschung und gemeinsamer Extension-/MCP-Projektsperre. Neue Sammlungs-Schreibabläufe
  wurden mit simuliertem Zotero geprüft; keine persönlichen Sammlungen live verändert.
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
