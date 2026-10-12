# Zotero LaTeX Assistant – Projektstatus

Stand: 12. Oktober 2026.

`[x]` = umgesetzt bzw. tatsächlich geprüft. `[ ]` = noch offen.
Die Liste wird manuell gepflegt. Vorbereitete Ordner und Dateien bedeuten nicht,
dass die zugehörigen Funktionen bereits implementiert sind.

Die folgende Bestandsaufnahme wurde mit dem aktuellen Code abgeglichen.
Das Prüfprotokoll am Ende dokumentiert frühere Zwischenstände; dessen alte
Testzahlen, CSL-Auswahl und inzwischen entferntes Detailformular beschreiben
nicht mehr den aktuellen Funktionsumfang.

## Aktueller Stand

- Die lokale Zotero-Verbindung, Bibliotheks-/Sammlungsnavigation, Projektzuordnung,
  Quellenliste mit Anhangsmetadaten und Crossref-DOI-/Titelsuche sind implementiert.
  Die Sammlung kann innerhalb derselben Bibliothek und Zotero-Datenbank nachträglich
  gewechselt werden. Bestehende Quellen und Zitier-Schlüssel bleiben dabei erhalten.
- **Delete all citations** entfernt nach vollständiger Vorschau und Bestätigung
  Projektzitationen und zugeordnete/verwaltete Bib-Einträge und setzt die alte
  Bibliotheks-, Sammlungs-, Datenbank- und Schlüsselbindung gemeinsam zurück.
  Danach kann eine andere Bibliothek gewählt werden. Sicherung/Rücksetzen,
  Offlinebetrieb und fehlende Bib-Dateien sind berücksichtigt; unabhängige
  Bib-Einträge, zitierter Text, Dateipfad und Stil bleiben erhalten.
- Die von der Extension erzeugten Fehlermeldungen und der Seitenleisten-Log-Präfix
  sind auf Englisch vereinheitlicht. Bibliografische Daten und sprachabhängige
  Seitenbezeichnungen folgen weiterhin den Quellen bzw. der Dokumentsprache.
- Die Zitierstil-Auswahl verwendet ausschließlich die lokale TeX-Installation
  über `kpsewhich`. Vollständige `.bbx`-/`.cbx`-Paare werden angeboten;
  `.zotero/config.json` und vorhandene `.tex`-/`.ltx`-/`.sty`-/`.cls`-Dateien werden
  angepasst. Fehlende BibLaTeX-Paketdeklarationen und, bei ausgewählter Bib-Datei,
  Ressourcenverweise und Bibliografieausgabe werden in vollständigen
  Hauptdokumenten ergänzt. Alte CSL-Konfigurationen bleiben lesbar.
- **Update project .bib** übernimmt die Checkbox-Auswahl der geöffneten Liste:
  angehakte Quellen bleiben erhalten oder werden ergänzt, abgewählte Quellen
  werden samt ihren LaTeX-Zitierverweisen entfernt. Gemischte Zitationen behalten
  andere Quellen, Seitenangaben und Zusätze; zitierter Text bleibt erhalten.
  Bib-Datei, Konfiguration und betroffene TeX-Dateien werden gemeinsam gesichert
  und bei Fehlern zurückgesetzt. Auch eine leere Auswahl ist möglich. Speichern einer direkt
  bearbeiteten `.bib` aktualisiert die Häkchen automatisch. Die Zuordnung erfolgt
  über tatsächliche Zitier-Schlüssel, nicht allein über den gespeicherten Importbestand.
- Bestehende Feldinhalte angehakter Quellen, nicht zugeordnete Einträge und Quellen
  außerhalb der geöffneten Liste bleiben bei der Synchronisierung erhalten.
  Stilwechsel, Bib-Dateiwechsel und alle Import-/Aktualisierungswege sichern
  betroffene Dateien und setzen bereits geschriebene Änderungen bei Schreibfehlern zurück.
- Liste, Zitierablauf und Metadatenexport verwenden dieselbe tatsächliche
  Bestandserkennung. Gespeicherte Namen, Extra- und lokale BBT-Schlüssel werden
  berücksichtigt. Direkte Löschungen werden beim Aktualisieren nicht automatisch
  rückgängig gemacht; erneutes Zitieren importiert gezielt die fehlende Quelle
  mit ihrem stabilen Namen. Einzelimports erhalten nicht ausgewählte Feldinhalte.
- Der Wechsel der Bib-Datei passt die bisherigen literalen LaTeX-Ressourcenverweise
  an und erhält zusätzliche Ressourcen. Für einen neuen Pfad wird die bestehende
  Bib-Datei kopiert; vorhandene Zieldateien bleiben erhalten. Stil und Bib-Datei
  können in beiden Reihenfolgen vollständig eingerichtet werden.
- Der vollständige Better-BibLaTeX-Translator ist der Standard für neue Exporte
  und manuelle Metadatenaktualisierungen. Das lokale BBT-Plugin ist erforderlich;
  `native` bleibt eine ausdrücklich wählbare Alternative. Ein echter BBT-Export
  ist noch nicht live geprüft, da der lokale Plugin-Endpunkt beim letzten Live-Test 404 lieferte.
- Bib-Import und Metadatenaktualisierung prüfen neue DOI-Dubletten und mögliche
  Übereinstimmungen bei Titel, Autorennamen und Publikationsjahr. Eindeutige DOI-
  Konflikte brechen ab; mögliche Dubletten benötigen eine ausdrückliche Übernahme.
- „Migrate existing citation keys“ migriert importierte Schlüssel manuell oder
  anhand aktueller BBT-Namen. Bib-Dateien, LaTeX-Verweise und Projektzuordnung werden
  erst nach Vorher-/Nachher-Vorschau und Bestätigung gemeinsam mit Sicherung geändert.
- Zotero-/Better-BibTeX-Schlüssel werden projektbezogen gespeichert. Das optionale
  Festhalten neuer Schlüssel in Zotero verwendet einen separaten Schreibadapter
  mit lokaler Autorisierung, SecretStorage und Versionsprüfung.
- MCP-Server, MCP-Werkzeuge, PDF-Extraktion/-Suche, OpenAlex und Unpaywall sind
  noch nicht implementiert. Die vorhandenen Dateien enthalten nur Platzhalter.
- Fehlt Better BibTeX beim Zitieren oder Importieren, kann direkt „Use Zotero
  export“ gewählt werden. Diese ausdrückliche Wahl speichert den lokalen nativen
  Exporter für den Projektordner und führt denselben Import-/Zitiervorgang fort.
  Abbrechen bleibt ohne neue Bib-Einträge oder Texteinfügung und gibt die Buttons
  der Quellenliste wieder frei; Filter und Auswahl bleiben erhalten. Sonstige Exportfehler
  lösen keinen Exporterwechsel aus.
- Es gibt aktuell **28 Testdateien mit 271 deklarierten Testfällen**. Automatisierte
  Prüfung, lokale LaTeX-/Biber-Beispiele und der isolierte Live-Smoke mit echtem
  VS-Code-Host und lokalem Zotero sind erfolgreich; der vollständige
  manuelle Durchlauf der jüngsten Funktionen im VS-Code-Editor bleibt offen.

## Nächste Schritte in Arbeitsreihenfolge

1. **Manuelle Oberflächenabläufe vervollständigen.** Der automatisierte Live-Smoke
   prüft bereits Aktivierung, nativen Export, Bib-Aktualisierung, Webview-Erzeugung
   und Zitation mit echter Editor-API. Zusätzlich Stilwechsel, Zitierdialoge, Anhaken,
   Abwählen, leere Auswahl, direktes Löschen in der `.bib`, Speichern, Neustart und
   mehrere Workspace-Ordner gemeinsam mit dem lokalen Zotero prüfen. Echte BBT-
   Integration separat prüfen, wenn das Plugin verfügbar ist. Automatisierte
   Tests ersetzen diesen noch offenen Oberflächentest nicht.
2. **Architekturdokumentation vervollständigen.** Die Fehlermeldungen sind inzwischen
   auf Englisch vereinheitlicht. `docs/ARCHITEKTUR.md` enthält noch Angaben zur
   früheren CSL-/Detailansicht und zum alten Schlüsselimport; die Beschreibung
   an die aktuelle Stilauswahl, Synchronisierung und Schlüsselverwaltung anpassen.
3. **Installierbares VSIX erstellen und unter Fedora prüfen.** Verpackung und
   Installation reproduzierbar machen; prüfen, ob die installierte Extension
   lokale TeX-Werkzeuge, Schema, Symbole und Projektdateien korrekt findet.
4. **MCP-Grundlage und Lesezugriff implementieren.** Zuerst die gemeinsame
   Projekt-/Zotero-Geschäftslogik von der VS-Code-Oberfläche trennen. Danach die
   dann aktuelle offizielle SDK-Dokumentation prüfen, stdio-Server, Eingabeschemas
   und Lese-Werkzeuge für Bibliotheken, Sammlungen, Metadaten und Anhänge umsetzen.
   Anschließend mit einem echten MCP-Client testen.
5. **PDF-Volltext und belegbare Fundstellen ergänzen.** Zotero-indexierten Volltext
   sowie lokale PDF-Textextraktion mit Anhangs-ID und tatsächlich gelesener
   PDF-Seite implementieren. Darauf bauen Suche, Fundstellen und KI-Auswertung auf;
   Scans und beschädigte PDFs brauchen gesonderte Behandlung.
6. **Kontrollierte KI-Schreibwerkzeuge ergänzen.** Auf MCP-Lesezugriff und
    Dublettenprüfung aufbauen. Neue Quellen vorschlagen, Änderungen vorab anzeigen,
    Freigabe einholen und Schreiben auf die ausgewählte Sammlung beschränken.
    Der vorhandene Adapter unterstützt bisher Metadaten-PATCH, noch keine
    MCP-Werkzeuge für Neuanlage, Sammlungszuordnung oder PDF-Anhänge.
7. **Externe Recherche ausbauen.** Nach Prüfung der jeweiligen API-Bedingungen
    OpenAlex und danach Unpaywall anbinden; bestehende Sammlung zuerst durchsuchen,
    Vorschläge verifizieren und erst nach Freigabe Quellen/PDFs übernehmen.

Die ausdrückliche Migration alter Zitier-Schlüssel ist implementiert. Der
Better-BibLaTeX-Translator ist ebenfalls angebunden; dessen Live-Test folgt nach
Installation/Aktivierung des lokalen BBT-Plugins.

## Aufgabenabgrenzung

Menschen bearbeiten Quellen, Metadaten, Sammlungen und Anhänge direkt in Zotero.
Die Extension bietet dafür keine zweite Verwaltungsoberfläche. Sie verbindet
Projekt und Bibliothek, zeigt eine lesende Quellenliste mit Anhangstypen,
gleicht ausgewählte Quellen mit der Projekt-.bib ab und ermöglicht Zitierstil-Auswahl
sowie DOI-/Titelsuche. Der einfache Filter in der Tabelle bleibt erhalten.
Dateien und PDFs werden für Menschen in Zotero geöffnet und verwaltet.
Auf ausdrücklichen Benutzerwunsch dürfen neu übernommene Zitier-Schlüssel
zusätzlich über die autorisierte API in Zotero festgehalten werden.

Die geplanten MCP-/KI-Funktionen für Recherche, PDF-Analyse und ausdrücklich
freigegebene Änderungen sind davon getrennt; sie sind keine zusätzlichen
Formulare für manuelle Literaturverwaltung.

## Grundstruktur

- [x] Modulare Projektstruktur entsprechend dem Projektauftrag angelegt.
- [x] VS-Code-Extension-Manifest mit TypeScript und npm angelegt.
- [x] Strenge TypeScript-Konfiguration und Build-Aufgaben angelegt.
- [x] Aktuelle NodeNext-Modulauflösung mit expliziter CommonJS-Ausgabe konfiguriert.
- [x] F5-Start für den Extension Development Host konfiguriert.
- [x] Separate Startoption ohne andere installierte Erweiterungen zur Fehlerdiagnose ergänzt.
- [x] Gemeinsame, von VS Code unabhängige Typen und Fehler angelegt.
- [x] Module für Zotero, BibLaTeX, PDF, Recherche, Oberfläche und MCP vorbereitet.
- [x] Projektbezogene Einstellungen für Sammlung, Bibliothek, `.bib` und Zitierbefehl deklariert.
- [x] README mit Startanleitung und Architekturübersicht erstellt.
- [x] Offizielle Dokumentation von Zotero, VS Code, Better BibTeX und MCP bei früheren Implementierungsschritten geprüft und verlinkt; vor neuen Integrationen erneut prüfen.

## Phase 1 – Grundgerüst und lokale Verbindung

- [x] Aktivierung und Ressourcenverwaltung der Extension implementiert.
- [x] Befehl „Zotero: Verbindung prüfen“ implementiert.
- [x] Lokalen Leseclient für `http://localhost:23119/api/` implementiert.
- [x] API-Version prüfen und ausschließlich Loopback-Adressen zulassen.
- [x] Persönliche Bibliothek und Gruppenbibliotheken über dokumentierte Endpunkte abrufen.
- [x] Befehl „Zotero: Bibliotheken anzeigen“ mit QuickPick implementiert.
- [x] Fehler für nicht gestartetes Zotero, deaktivierte API und Zeitlimits behandeln.
- [x] Verständliche Status- und Fehlermeldungen im Ausgabekanal anzeigen.
- [x] Tests mit simulierten Antworten und Fehlerfällen geschrieben.
- [x] npm-Abhängigkeiten installieren und Lockdatei erzeugen.
- [x] TypeScript-Typprüfung und Build erfolgreich ausführen.
- [x] Automatisierte Tests erfolgreich ausführen.
- [x] F5-Start im echten VS-Code-Extension-Host prüfen (vom Benutzer bestätigt).
- [x] Verbindung und Bibliotheksabruf mit der eigenen Zotero-Installation prüfen.

## Phase 2 – Projektzuordnung und lesende Quellenliste

- [x] Eigene Seitenleistenansicht „Zotero“ als native TreeView erstellen.
- [x] Persönliche Bibliothek und Gruppen direkt in der Seitenleiste anzeigen.
- [x] Verbindung prüfen und Bibliotheken aktualisieren über die Seitenleiste anbieten.
- [x] Verbindungsfehler in der Seitenleiste anzeigen.
- [x] Erste Seitenleiste im Editor prüfen (vom Benutzer durch Screenshot bestätigt).
- [x] Bibliotheken um hierarchische Sammlungen erweitern.
- [x] „Alle Einträge“ einschließlich Quellen ohne Sammlung anzeigen.
- [x] Sammlungen und Quellen über alle API-Ergebnisseiten laden.
- [x] Bibliothek und Sammlung über „Bibliothek festlegen“ auswählen; Bib-Datei und Stil werden unabhängig festgelegt. Sammlungswechsel innerhalb derselben Bibliothek/Datenbank auch nach Imports erlauben und bestehende Quellen erhalten; andere Bibliotheken/Datenbanken bei vorhandenen Imports weiter sperren.
- [x] Zuordnung, Zitierstil, Zitierbefehl, Bib-Datei und Importbestand in `.zotero/config.json` speichern; beim Start erkennen und in Statusleiste / Baum markieren.
- [x] Quellen ausschließlich in der Tabelle laden; die Seitenleiste dient Bibliotheks- und Sammlungsnavigation. Sammlungen ohne echte Unterordner haben keinen Aufklapppfeil.
- [x] Einfachen lokalen Tabellenfilter nach Titel, Ersteller, Jahr und DOI beibehalten; weitergehende Literaturverwaltung und Suche nutzt Zotero.
- [x] Titel, die ersten drei Ersteller und Eintragsart anzeigen; weitere Ersteller und Gesamtzahl darunter kennzeichnen. Der lokale Filter berücksichtigt alle Namen sowie Datum und DOI.
- [x] Quellenliste mit Checkboxen, Titel, Ersteller, Eintragsart und „In Zotero öffnen“ pro Zeile.
- [x] Vorhandene Quellen anhand der Projekt-.bib erkennen, automatisch anhaken und Änderungen beim Speichern der Bib-Datei in der offenen Liste übernehmen.
- [x] Bisherige Detailansicht / Metadatenformular auf Benutzerwunsch aus der Oberfläche entfernen.
- [x] Vorhandene Anhänge anhand ihrer Metadaten in der Quellenliste kennzeichnen; keine Dateien für die Anzeige laden.
- [x] Dateitypen wie PDF, Bild, E-Book und Webseiten-Snapshot mit Symbol / Typ / Anzahl anzeigen; „In Zotero öffnen“ führt zur Quelle.
- [x] PDF-/Anhangsverwaltung und das manuelle Öffnen einzelner Dateien Zotero überlassen.
- [x] Farbschema, leere Ergebnisse und Verbindungsfehler in der Oberfläche berücksichtigen.
- [x] Tests für Sammlungshierarchien, Quellenmetadaten und mehrseitige Ergebnislisten ergänzen.

## Phase 3 – LaTeX und BibLaTeX

- [x] Better BibTeX erkennen und Zitier-Schlüssel über dokumentierte lesende JSON-RPC-Methoden übernehmen.
- [x] Vollständigen Better-BibLaTeX-Translator über lesendes JSON-RPC `item.export` als Standard anbinden; native Metadaten nur bei ausdrücklicher Exporter-Auswahl verwenden. Bibliotheksscope, vollständige Antworten und stabile Projekt-Schlüssel prüfen.
- [x] Lokale Voraussetzungen für den Better-BibLaTeX-Export geprüft: Zotero ist erreichbar (HTTP 200), das Better-BibTeX-Plugin fehlt im geprüften Profil und sein Endpunkt liefert HTTP 404. Der echte Translator-Durchlauf steht nach Installation/Aktivierung des Plugins weiterhin aus.
- [x] Neue Zitier-Schlüssel aus Better BibTeX / Zotero übernehmen und dauerhaft pro Projekt speichern.
- [x] Namen / Pfad zur `.bib`-Datei projektbezogen auswählen, eindeutige vorhandene Dateien und TeX-Referenzen erkennen und Pfade validieren.
- [x] Lokal installierte BibLaTeX-Stile über `kpsewhich` auswählen; nur vollständige `.bbx`-/`.cbx`-Paare anbieten. Projektkonfiguration und relevante `.tex`-/`.sty`-/`.cls`-Dateien mit Sicherung und Rücksetzen bei Schreibfehlern synchronisieren. Frühere CSL-Konfigurationen bleiben lesbar.
- [x] Seitenangaben für neue BibLaTeX-Zitationen als reine Zahlen einfügen; BibLaTeX formatiert Seitenbezeichnungen in der Dokumentsprache. Frühere CSL-Sprachvorgaben beim Stilwechsel entfernen.
- [x] Projekt-.bib manuell aktualisieren; nur tatsächlich vorhandene, eindeutig zugeordnete Quellen erneut exportieren. Ohne Bestand eine ausdrückliche Mehrfachauswahl anbieten.
- [x] Einzelne ausgewählte Quellen über Better BibLaTeX importieren; der native Zotero-BibLaTeX-Export bleibt als ausdrücklich gewählte Alternative erhalten.
- [x] Beim ersten manuellen Aktualisieren mehrere Quellen aus der verbundenen Sammlung auswählen und importieren.
- [x] Quellen nachträglich per Checkbox-Mehrfachauswahl gemeinsam in die Projekt-.bib importieren.
- [x] Checkbox-Auswahl über „Update project .bib“ in beide Richtungen synchronisieren: Ergänzen und Entfernen einschließlich leerer Auswahl, tatsächliche Bib-Einträge erkennen und Dateilöschungen beim Speichern in der Liste übernehmen. Feldinhalte und nicht zugeordnete Quellen erhalten; Datei und Konfiguration gemeinsam sichern und bei Schreibfehlern zurücksetzen.
- [x] Beim Abwählen und Aktualisieren auch die zugehörigen LaTeX-Zitationen entfernen; gemischte Quellenlisten, Multicite-Gruppen, Seitenangaben und Zitattext erhalten. Zugehörige Bib-Referenzen bereinigen; TeX-Dateien mit Bib und Konfiguration gemeinsam sichern und bei Fehlern zurücksetzen. Ungespeicherte/zwischenzeitliche Änderungen und nicht zuordenbare Key-Makros vor Änderungen abweisen.
- [x] Tatsächliche Bestandserkennung zwischen Quellenliste, Zitierablauf und manuellem Metadatenexport vereinheitlicht: gespeicherte, Extra-, Legacy- und lokale BBT-Schlüssel; direkte Löschungen erhalten, externe Einträge ohne erneuten Export zitieren und stabile Namen für erneutes Importieren bewahren.
- [x] Beim Wechsel der Bib-Datei bestehende literale LaTeX-Ressourcenverweise in lokalen TeX-/LTX-/Paket-/Klassendateien anpassen; zusätzliche Ressourcen und vorhandene Zieldateien erhalten, neue Pfade mit der bisherigen Literatur befüllen. Einrichtung in beiden Reihenfolgen vollständig verbinden; dynamische und mehrdeutige Verweise sicher abweisen.
- [x] Gemeinsame Dateitransaktion für Einzelimport, Metadatenexport und Autoimport beim Zitieren verwenden; Bib-Datei und Konfiguration gemeinsam sichern, konkurrierende/ungespeicherte Änderungen abweisen und abgeschlossene Schreiboperationen bei Fehlern zurücksetzen.
- [x] Bestehende Zitationsschlüssel erkennen, Kollisionen abweisen und stabile bibliotheksbezogene Zotero-Schlüssel verwenden.
- [x] Weitere Duplikatmerkmale beim Bib-Import prüfen: normalisierte DOI als eindeutiger Konflikt, Titel/Autorennamen/Jahr als mögliche Dublette mit ausdrücklichem Override; vorhandene unveränderte Dubletten und abgewählte Quellen korrekt berücksichtigen.
- [x] Bestehende importierte Schlüssel ausdrücklich samt LaTeX-Verweisen, Bib-Referenzen und Projektzuordnung migrieren: manueller Name oder aktuelle BBT-Namen, Vorher-/Nachher-Vorschau, Bestätigung, Kollisionsprüfung und gemeinsame Sicherung/Rücksetzen.
- [x] „Delete all citations“ als Befehl und Projekteinstellung anbieten: Zitierbefehle und zugeordnete/verwaltete Bib-Einträge nach Vorschau/Bestätigung löschen; Bibliotheks-/Sammlungs-/Serverbindung und Schlüssel gemeinsam zurücksetzen, Originaldateien sichern und Bibliothekswechsel anschließend ermöglichen. Ohne Zotero und bei fehlender Bib-Datei nutzbar; Abbruch, ungespeicherte/zwischenzeitliche Änderungen und Rücksetzen bei Fehlern geprüft.
- [x] Bestehende Einträge erhalten, verwalteten Zotero-Bereich prüfen, Sicherungen anlegen und fehlerhafte Imports abbrechen.
- [x] Vollständige BibLaTeX-Metadaten über den gewählten Exporter übernehmen; Standard Better BibLaTeX, einschließlich zusätzlicher Felder und Makros.
- [x] `autocite`, `parencite` und `textcite` an der Cursorposition im zuletzt aktiven LaTeX-Dokument des Projekts einfügen; fehlende Quellen vorher importieren.
- [x] Zotero-Sammlungsbestand und importierte Projektliteratur getrennt halten.
- [x] Tests für Dateischutz, Symlinks, fehlerhafte Metadaten, beschädigte Dateien und doppelte Zitationsschlüssel ergänzen.
- [x] Befehle, Quellenliste und wesentliche Dialoge auf Englisch umgestellt.
- [x] Verbleibende deutsche bzw. gemischte Fehlermeldungen und Seitenleisten-Log-Präfix vollständig ins Englische übertragen.

## Phase 4 – MCP und PDF-Analyse

- [ ] Offizielles TypeScript-MCP-SDK einbinden und stdio-Server implementieren.
- [ ] Gemeinsame Zotero-Geschäftslogik im MCP-Server wiederverwenden.
- [ ] Projekteinstellung zur ausgewählten Sammlung an den Server übergeben.
- [ ] Eingabeschemas, strukturierte Ergebnisse und Fehler für alle Werkzeuge definieren.
- [ ] `zotero_list_libraries` implementieren.
- [ ] `zotero_list_collections` implementieren.
- [ ] `zotero_get_selected_collection` implementieren.
- [ ] `zotero_search` implementieren.
- [ ] `zotero_get_metadata` implementieren.
- [ ] `zotero_list_attachments` implementieren.
- [ ] `zotero_get_fulltext` für Zotero-indexierten Volltext implementieren.
- [ ] PDF.js oder geeignete Alternative prüfen und auswählen.
- [ ] `zotero_read_pdf_pages` mit tatsächlich ermittelten Seitenangaben implementieren.
- [ ] Textsuche mit Quellenschlüssel, Anhang, PDF-Seite und Fundstelle implementieren.
- [ ] Mehrere Anhänge und beschädigte PDFs berücksichtigen.
- [ ] PDF-Verarbeitung ohne unnötige Kopien und mit validierten lokalen Pfaden umsetzen.
- [ ] PDF-Analyseaktion in der Oberfläche mit der gewählten Modellanbindung verbinden.
- [ ] MCP-Anbindung in kompatibler VS-Code-KI-Umgebung konfigurieren und testen.
- [ ] Dokumentinhalte und Schlussfolgerungen unterscheidbar zurückgeben.

## Phase 5 – Kontrollierter KI-Schreibzugriff (keine manuelle Quellenverwaltung)

- [ ] Fähigkeiten der tatsächlich installierten Zotero-Version prüfen.
- [x] Zotero-10+-Schreibadapter und lokale Autorisierung implementiert / getestet. Das Metadatenformular wurde später auf Benutzerwunsch entfernt; Bearbeiten erfolgt über „In Zotero öffnen“.
- [ ] KI-Schreibwerkzeuge und bei Bedarf Web-API-Adapter ergänzen.
- [x] Dauerhafte lokale Freigaben in SecretStorage speichern und Server-ID/Objektversionen beachten; einmalige Freigaben nicht speichern.
- [x] Leseclient und vorbereiteten KI-Schreibadapter trennen; keine manuelle Bearbeitung in der Extension anbieten.
- [ ] Schreiben auf die ausgewählte Sammlung beschränken und bei fehlender Auswahl blockieren.
- [ ] Neue Quellen vor dem Import zur ausdrücklichen Freigabe anzeigen.
- [ ] Dublettenprüfung für spätere KI-Neuanlagen in Zotero über Bibliothek/Sammlung ergänzen; die Prüfung des Projekt-Bib-Bestands ist bereits implementiert.
- [ ] `zotero_check_duplicates` implementieren.
- [ ] `zotero_create_item` implementieren.
- [ ] `zotero_update_item` ohne ungefragtes Überschreiben implementieren.
- [ ] `zotero_add_to_collection` implementieren.
- [ ] `zotero_attach_pdf` implementieren.
- [ ] Zuständigkeit von `zotero_import_bibtex` definieren und Werkzeug implementieren.
- [x] Zitationen als native Editoraktion über Tabellenzeile, Befehlspalette und Editor-Kontextmenü implementieren; Quellensuche, Seitenzahl und Zusatz im oberen Eingabebereich.
- [ ] MCP-Brücke für Editoraktionen bei Bedarf ergänzen.
- [ ] Metadatenänderungen nachvollziehbar protokollieren und automatische Löschungen ausschließen.
- [x] Backend-Tests für lokale Autorisierung, SecretStorage, Instanzbindung, Versionskonflikte und fehlgeschlagene Metadatenänderungen vorhanden.
- [ ] Tests für spätere KI-/MCP-Freigaben, Sammlungsscope, Duplikate, Neuanlage und Anhänge ergänzen.

## Phase 6 – DOI-Recherche und spätere wissenschaftliche KI-Recherche

- [ ] Aktuelle API-Bedingungen, Authentifizierung und Rate Limits der Rechercheanbieter prüfen.
- [x] Crossref für DOI- und Titelsuche mit Metadatenvorschau in VS Code anbinden. Keine automatische Zotero-Neuanlage.
- [ ] OpenAlex für wissenschaftliche Publikationssuche anbinden.
- [ ] Unpaywall für rechtmäßig verfügbare Open-Access-Volltexte anbinden.
- [ ] `zotero_search_external` implementieren.
- [ ] `zotero_lookup_doi` implementieren.
- [ ] `zotero_find_evidence` mit belegbaren Fundstellen implementieren.
- [ ] Bestehende Sammlung zuerst durchsuchen und fehlende Quellen recherchieren.
- [ ] Metadaten verifizieren und Quellen nachvollziehbar vorschlagen.
- [ ] Quellen und verfügbare PDFs nach Freigabe importieren und der Sammlung zuordnen.
- [ ] Beim späteren KI-Schreibworkflow nur tatsächlich zitierte Quellen automatisch in die Projekt-`.bib` übernehmen; die menschliche Checkbox-Auswahl bleibt unabhängig davon erhalten.
- [ ] Durchgängigen wissenschaftlichen Workflow mit konsistenten Citation Keys testen.

## Übergreifende Qualität und Datenintegrität

- [x] Manuelle Literaturverwaltung Zotero überlassen; Projektzuordnung, Liste und Bib-Import sind ohne KI nutzbar.
- [x] Der implementierte Zotero-Zugriff verwendet APIs und schreibt nicht in die Zotero-SQLite-Datenbank; diese Vorgabe gilt auch für spätere Funktionen.
- [x] Zotero-Freigabeschlüssel ausschließlich über SecretStorage behandeln; keine Schlüssel in `.zotero/config.json` schreiben.
- [ ] Modellanbindung und Weitergabe lokaler PDF-Inhalte transparent konfigurieren.
- [ ] Keine erfundenen Zitate, Seitenzahlen oder Dokumentinhalte zurückgeben.
- [ ] PDF-Downloads auf zulässige Quellen beschränken.
- [x] Pfad-/Symlinkschutz, Dateisnapshots, Sicherungen und Importfehlerprüfungen implementiert; Stilwechsel und Listen-Synchronisierung mit Rücksetzen bei Schreibfehlern geprüft.
- [ ] Gemeinsames Rücksetzen für alle übrigen Importwege vervollständigen.
- [x] Lokale LaTeX-/Biber-Durchläufe mit `numeric` und `authoryear` erfolgreich; Zitate, Literaturverzeichnis und deutsche Seitenbezeichnungen im Ergebnis geprüft.
- [ ] Jüngsten Gesamtworkflow im echten VS-Code-Host mit Zotero und, soweit verfügbar, Better BibTeX prüfen.
- [x] Isolierten Live-Smoke mit echtem VS-Code-Host, nativer Zotero-API, Bib-Aktualisierung, Webview-Erzeugung und Editor-API ausführen; Bericht speichern.
- [ ] Nach Implementierung der MCP-Werkzeuge deren Integration mit einem echten MCP-Client prüfen.
- [ ] Installierbares VSIX erstellen und unter Fedora prüfen.

## Aktuelle Prüfung – 12. Oktober 2026

- Prozentzeichen in geklammerten und zitierten BibLaTeX-Feldwerten bleiben literal,
  auch in URL-Kodierungen und `@string`-Verkettungen. Parser, Feldleser und
  Schlüssel-Migration verwenden diese Regel konsistent; Kommentare außerhalb
  der Werte werden weiterhin erkannt.
- Die Quellenliste erhält nach jeder Aktion ein Abschluss-Signal. Auch der
  Export-Abbruch gibt Buttons und Filter frei, erhält die Auswahl und erzeugt
  keine Fehlermeldung. Echte Fehlermeldungen bleiben nach dem Abschluss sichtbar.
- Listenansichten und ihre gespeicherte Auswahl sind an die Zotero-Datenbank
  gebunden. Bei geänderter `serverId` werden alte Ansichten geschlossen; erneutes
  Öffnen lädt Quellen und BBT-Schlüssel neu. Prüfungen beim Laden und vor Aktionen
  verhindern die Verwendung alter Einträge auch bei verzögerten Dateibeobachtern.
  Der Zitierdialog und die Bib-Synchronisierung prüfen die ursprüngliche Bindung
  zusätzlich vor dem Schreiben. Sechs neue Regressionen prüfen diese Übergänge.
- Die automatische Bib-Dateierkennung verwendet denselben TeX-Scanner und dieselbe
  Argument-Auswertung wie die Ressourcenanpassung. Literale Beispiele, Kommentare,
  escapte Befehle und entfernte Ressourcen verfälschen die Empfehlung nicht mehr.
  Verschachtelte Optionen und Kommentare zwischen Befehl und Argument sind erlaubt;
  bei unvollständigem TeX bleibt die manuelle Dateiauswahl verfügbar. Fünf neue
  Regressionen prüfen die Erkennung und den tatsächlichen Bib-Dateidialog im Mock.
- Bibliografie-Verarbeitung in `src/biblatex/update.ts` vom Projektcontroller
  getrennt: Planung, Bestandserhalt, Schlüsselvergabe, Referenzabgleich und
  Dublettenprüfung benötigen keine VS-Code-Mocks. Fünf neue Tests prüfen diesen
  Planer direkt; die bisherigen Controller-Tests sichern den vollständigen Ablauf.
- Quellenlisten-JavaScript aus dem HTML-String in eine separat kompilierte
  TypeScript-Datei mit DOM-Typprüfung ausgelagert. Build, Typprüfung, Watch-Modus
  und Paketdateien berücksichtigen die Browser-Ausgabe; die bisherigen UI-Tests
  führen das tatsächlich kompilierte Skript aus. Beide Watch-Compiler starten
  fehlerfrei und lassen sich gemeinsam beenden.
- Typprüfung, Build, `npm test` und der direkte Lauf sämtlicher kompilierter
  Testdateien erfolgreich: 271 bestandene Testfälle in 28 Dateien.
- Gültige Bib-Dateien mit `%20` in URLs und `%` in Titeln mit Biber 2.22 im
  Tool-Modus gegengeprüft; auch die von der Extension synchronisierte Ausgabe
  wurde von Biber erfolgreich verarbeitet.
- `npm run test:live` mit VS Code 1.141.0 und echter lokaler Zotero-API erfolgreich:
  Extension-Aktivierung, registrierte Befehle, native Lese-/Exportzugriffe,
  Bib-Aktualisierung mit stabilem Projektschlüssel, Erzeugung der echten Webview
  sowie Abbruch, Einfügen und Speichern einer Zitation mit echter Editor-API.
  Der Test verwendet ein separates temporäres Profil und erzeugte Projektdateien;
  Zotero wird nur gelesen. Bericht: [live-smoke-report.json](docs/live-smoke-report.json).
  Der BBT-Endpunkt liefert weiterhin 404. Ein manueller Button-/Dialogdurchlauf,
  tatsächliche Schreibfreigaben und ein BBT-Translator-Lauf sind dadurch nicht belegt.

## Prüfung – 11. Oktober 2026

- Aktuelle Implementierung mit Aufgabenliste und vorhandenen Platzhaltern abgeglichen.
- TypeScript-Typprüfung, Build und automatisierter Gesamttestlauf erfolgreich.
  Der Test-Runner meldet 27 erfolgreiche Testdateien; im Quellcode sind 251
  Testfälle deklariert. Die früheren Zahlen unten gelten nur für die jeweiligen Zwischenstände.
- Neue Regressionen prüfen lokale BibLaTeX-Stile, LaTeX-Anpassung, tatsächliche
  Bib-Zugehörigkeit, automatische Häkchen, Dateibeobachtung, Entfernen und erneutes
  Ergänzen, leere Auswahl, Fremdbibliotheksschutz und Rücksetzen nach Schreibkonflikten.
- Die früher in dieser Sitzung geprüfte lokale TeX-Installation enthielt 86
  vollständige BibLaTeX-Stile. `numeric` und `authoryear` wurden mit LaTeX/Biber
  erfolgreich zu Beispieldokumenten mit Zitationen und Bibliografie verarbeitet.
- Dies ist kein neuer manueller VS-Code-/Zotero-/BBT-Oberflächentest und kein
  erneuter Live-Test von Zotero-Schreibfreigaben oder der externen Rechercheanbieter.

Sammlungswechsel und englische Fehlermeldungen am 11. Oktober 2026:

- Die neue Sammlung kann über „Set library“ bzw. das Sammlungs-Kontextmenü gewählt
  werden. Die Konfiguration ändert dabei nur die Sammlung; vorhandene Bib-Dateien
  und Zitier-Schlüssel bleiben erhalten. Wechsel in andere Bibliotheken oder
  Zotero-Datenbanken bleiben bei importierten Quellen gesperrt.
- Bereits importierte Quellen dürfen außerhalb der neu gewählten Sammlung liegen.
  Listen-Synchronisierung erhält deren Feldinhalte; Metadatenexport und Wiederherstellung
  fehlender Bib-Einträge verwenden weiterhin den Bibliotheks-/Eintragspfad.
  Neu ausgewählte Quellen müssen zur verbundenen Sammlung gehören.
- Fehlermeldungen in Zotero-Client, Schreibadapter, Validierung und BBT-Adapter sowie
  der Seitenleisten-Log-Präfix sind auf Englisch. Quellendaten und BibLaTeX-Lokalisierung
  werden dadurch nicht geändert.
- Sechs zusätzliche Regressionen prüfen Sammlungswechsel, Datenbankwechsel-Schutz,
  Bestandsschutz, Importgrenzen, Zitieren, Wiederherstellung und Exportfehler.
  Build und Tests erfolgreich; insgesamt 154 deklarierte Testfälle in 20 Dateien.

Gezieltes Entfernen von Zitationen bei Checkbox-Synchronisierung:

- Abgewählte Quellen werden samt ihren tatsächlich zugeordneten Zitier-Schlüsseln
  aus LaTeX-Dateien entfernt. Andere Quellen in derselben Zitation und außerhalb
  der geöffneten Liste bleiben erhalten; leere Befehle entfallen. Seitenangaben,
  Zusätze und zitierte Textpassagen der verbleibenden Quellen bleiben erhalten.
- Bib, Konfiguration und TeX-Dateien werden gemeinsam gesichert/geschrieben und
  nach spätem Schreibkonflikt zurückgesetzt. Gespeicherte Änderungen während
  des Exports oder ungespeicherte LaTeX-Texte verhindern die gesamte Änderung.
  Die Bibliotheksbindung bleibt bei einer Listenaktualisierung bestehen.
- Build und Gesamttestlauf erfolgreich: 251 deklarierte Fälle in 27 Testdateien.
  Lokaler LaTeX-/Biber-Durchlauf vor und nach Abwahl erfolgreich: entfernte Quelle
  und Einzelzitation fehlen, gemischte Zitation behält die andere Quelle samt
  Seitenangabe, Literaturverzeichnis kompiliert ohne unaufgelöste Zitate.
  Der manuelle Test im echten VS-Code-Host bleibt separat offen.

Delete all citations am 11. Oktober 2026:

- Neuer Befehl in Palette und Projektmenü; vollständige Vorher-/Nachher-Vorschau
  einschließlich Konfiguration und ausdrückliche Löschbestätigung.
- Zitierbefehle und zugeordnete/verwaltete Bib-Einträge entfernen; unabhängige
  Einträge und zitierte Textpassagen erhalten. Bibliotheks-/Sammlungs-/Server-
  sowie Schlüsselbindung zurücksetzen, danach neue Bibliothek anbieten.
- Offlinebetrieb, fehlende `.bib`, Abbrechen, ungespeicherte Änderungen, neue
  Quellen oder Konfigurationsänderungen während der Vorschau und Rücksetzen nach
  spätem Schreibkonflikt geprüft. Anschließender Wechsel auf andere Gruppe und
  Datenbank im Controller-Test erfolgreich.
- Build und Gesamttestlauf erfolgreich: 240 deklarierte Fälle in 27 Testdateien.
  Ein lokaler LaTeX-/Biber-Test kompiliert nach Reset und erneuter Zitation;
  zitierter Text bleibt erhalten und Bib-Referenzen zeigen nicht auf gelöschte Einträge.
  Ein vollständiger manueller VS-Code-Oberflächentest bleibt separat offen.

Autoimport beim Zitieren ohne Better-BibTeX-Plugin am 11. Oktober 2026:

- Fehlendes Plugin und nicht verfügbarer Translator liefern einen eigenen
  Fehlercode. Die Oberfläche bietet den vorhandenen lokalen Zotero-Exporter
  direkt an, speichert die ausdrückliche Wahl im Projektordner und setzt den
  begonnenen Import fort. Kein stiller Exporterwechsel bei allgemeinen Fehlern.
- Regressionen prüfen Import vor Zitation, stabile Schlüssel, Erhalt bestehender
  Literatur, gespeicherte Exporterauswahl, Abbrechen ohne Änderungen, Fehler im
  Translator bzw. nativen Export und Abbrechen ohne Fehlermeldung in der Liste.
- Build und Gesamttestlauf erfolgreich: 221 deklarierte Fälle in 25 Testdateien.
  Der native BibLaTeX-Exporter der laufenden lokalen Zotero-Installation wurde
  rein lesend geprüft: HTTP 200 und vollständiger Bibliografietext einer Quelle.
  Der tatsächliche Editorablauf bleibt separat manuell zu prüfen.

Vereinheitlichung der letzten drei offenen Phase-3-Punkte am 11. Oktober 2026:

- Gemeinsame lesende Bestandserkennung für Liste, Zitieren und Metadatenexport.
  Direkte Löschungen werden erhalten; externe Extra-/BBT-Einträge können ohne
  Metadatenexport zitiert werden. Alte Namen bleiben für spätere Zitationen stabil.
- Bib-Dateiwechsel aktualisiert literale Ressourcenverweise, kopiert Literatur
  für neue Pfade und erhält vorhandene Zieldateien und zusätzliche Ressourcen.
  Beide Einrichtungsreihenfolgen und lokale Klassen-/Paketabhängigkeiten geprüft.
- Einzelimport, Metadatenexport und Autoimport verwenden dieselbe gemeinsame
  Dateitransaktion. Späte Schreibkonflikte setzen Bib und Konfiguration zurück;
  fehlende, beschädigte, ungespeicherte und außerhalb liegende Dateien geprüft.
- TypeScript-Build und Gesamttestlauf erfolgreich: 215 deklarierte Fälle in 25
  Testdateien. Echter lokaler LaTeX-/Biber-Lauf vor und nach Ressourcenwechsel:
  Zitate aufgelöst, zusätzliche Ressource erhalten und PDF-Text unverändert.
- Live-Export über das BBT-Plugin und vollständiger manueller Editorablauf bleiben
  separat offen; die Implementierung und die beschriebenen Regressionen sind abgeschlossen.

Vollständiger Better-BibLaTeX-Export am 11. Oktober 2026:

- Standard-Exporter `better-biblatex` mit lesendem `item.export` und dem Translator
  „Better BibLaTeX“ eingebaut. Keine Autoexport-Aufträge oder Zotero-Dateischreibwege
  angelegt; alle Plugin-Anfragen bleiben auf der lokalen Loopback-API.
- BBT-Schlüssel werden gebündelt aufgelöst, einzelne Exporte eindeutig ihrem
  Zotero-Eintrag zugeordnet. Gruppen verwenden verifizierte interne Bibliotheks-IDs.
  Fehlende Plugins, doppelte Schlüssel, mehrdeutige Bibliotheken, beschädigte
  Ausgaben und Exportfehler liefern keinen Teilbestand für das Projekt.
- Vollständige Translator-Feldinhalte und Makros werden übernommen. Persistierte
  Projekt-Schlüssel bleiben bei aktualisierten BBT-Namen unverändert.
- Die explizite Ressourceneinstellung `bibliographyExporter: native` erhält den
  früheren Exportweg; es gibt keinen stillen Fallback im neuen Standardmodus.
- Zehn neue Tests prüfen vollständige Ausgaben, Gruppenscope, stabile Schlüssel,
  fehlendes Plugin, fehlerhafte Antworten und Fehler im zweiten Export. Insgesamt
  164 deklarierte Testfälle in 20 Dateien.
- Die lokale Zotero-API wurde lesend erreicht (Version 3). Der lokale BBT-Endpunkt
  lieferte HTTP 404; im geprüften Zotero-Profil ist kein BBT-Addon registriert.
  Deshalb ist die Anbindung implementiert, der echte Translator-Lauf aber noch offen.
- Schnittstelle anhand der offiziellen [BBT-JSON-RPC-Dokumentation](https://retorque.re/zotero-better-bibtex/exporting/json-rpc/)
  und der zugehörigen Plugin-Implementierung geprüft.

Dublettenprüfung und ausdrückliche Schlüssel-Migration am 11. Oktober 2026:

- Normalisierte DOI sowie Titel/Autorennachnamen/Publikationsjahr vor dem Schreiben
  prüfen. Eindeutige neue DOI-Konflikte liefern keinen Teilbestand; mögliche
  Dubletten erfordern „Import anyway“. Bib-Makros und einfache TeX-Formatierungen
  werden berücksichtigt; unvollständige Merkmale werden nicht geraten.
- Neue Befehlsaktion „Migrate existing citation keys“ mit manuellem Umbenennen oder
  lesendem BBT-Namensabgleich. Eine vollständige Vorher-/Nachher-Vorschau wird vor
  der Bestätigung geöffnet. Bib-Schlüssel, literal verwendete LaTeX-Schlüssel,
  lokale deklarierte Zitierbefehle, Bib-Referenzen und JSON-Mapping werden gemeinsam
  mit Sicherung geändert. Zotero-Metadaten bleiben dabei unverändert.
- Kommentare, Beispiele, Noten und übrige Bib-Feldinhalte erhalten. Kollisionen,
  neue Dateien, ungespeicherte Editoränderungen, Dateilistenschwankungen,
  Änderungen während der Vorschau und dynamische Zitierargumente führen zu keiner Migration.
- Auch spätere Metadatenexporte und neu ergänzte Quellen richten ihre internen
  Referenzen an persistenten Projekt-Schlüsseln aus. Tests prüfen native und
  Better-BibLaTeX-Wege, auch wenn der referenzierte Eintrag beim Synchronisieren
  seine bisherigen manuellen Feldinhalte behält.
- Build und automatisierter Testlauf erfolgreich: 194 deklarierte Fälle in 23
  Testdateien. Die neuen Fälle prüfen DOI-Varianten, Makros, mögliche Dubletten,
  Abbrechen/Override, Schlüsselwechsel, Kollisionen, Noten/Kommentare, Mehrfach-
  zitate, Vorschau, Editoränderungen und Wiederherstellung der Originale.
- Lokal mit LaTeX/Biber geprüft: Parent-Eintrag, direktes Zitat und `crossref`
  gemeinsam migriert; vor und nach der Migration wurden gültige PDFs erstellt.
  Der extrahierte Dokumenttext war identisch. Manueller VS-Code-Oberflächentest
  sowie ein echter BBT-Namensabgleich bleiben offen.

## Historisches Prüfprotokoll

Die folgenden Abschnitte bleiben als Verlauf erhalten. Frühere Funktionsnamen,
Testzahlen und offene Prüfungen sind im aktuellen Stand oben eingeordnet.

Am 11. Oktober 2026 erfolgreich geprüft:

- `npm install`: Entwicklungsabhängigkeiten installiert, `package-lock.json` erzeugt.
- `npm run check`: TypeScript-Typprüfung ohne Fehler.
- `npm test`: Build und automatisierter Testlauf erfolgreich.
- Direkter Lauf der kompilierten Testdatei: alle 14 Testfälle bestanden.
- Kompilierter Extension-Einstieg aus `package.json` vorhanden.
- Nach Umstellung auf NodeNext-Modulauflösung: Typprüfung, Build und Tests erneut erfolgreich.
- Zusätzliche Typprüfung mit dem in VS Code enthaltenen TypeScript 6.0.3 erfolgreich.

Der Benutzer hat bestätigt, dass der bisherige Entwicklungsstart funktioniert.
Der Screenshot bestätigt die bisherige Bibliotheksanzeige in der Seitenleiste.

Prüfung der erweiterten Sammlungs- und Quellenansicht am 11. Oktober 2026:

- TypeScript-Typprüfung, Build und alle 26 automatisierten Testfälle erfolgreich.
- Lokaler Abruf mit dem implementierten Zotero-Client erfolgreich:
  4 oberste Sammlungen, 29 Quellen in „SeminarWiemann“ und 94 Bibliothekseinträge.
- Der Abruf umfasst ausschließlich Leseoperationen; es wurden keine Zotero-Daten geändert.

Der Test der erweiterten Sammlungs- und Quellenansicht im Editor ist noch offen.

Prüfung der Projektintegration am 11. Oktober 2026:

- `.zotero/config.json`, Projektaktionen, Stil-Auswahl, nativer BibLaTeX-Import,
  geschützter Aktualisierungsbereich, Detailformular und Crossref-Recherche implementiert.
- TypeScript-Prüfung, Build und 54 automatisierte Testfälle erfolgreich; neue Fälle prüfen
  Projektpersistenz, automatische Erkennung, Symlink-/Dateischutz, Importfehler,
  Zitationsschlüssel, Crossref-Fehler, HTML-Escaping und lokale Schreibfreigaben.
- Mit der laufenden Zotero-Installation lesend geprüft: vollständige Eintragsdaten,
  nativer BibLaTeX-Export, APA-Vorschau und 15 installierte CSL-Stile.
- Die laufende Zotero-Installation liefert keine Server-ID und unterstützt damit
  noch nicht die dokumentierte lokale Schreibschnittstelle. Schreibabläufe,
  Freigaben, Widerruf und Versionskonflikte wurden mit simulierten Antworten geprüft.
- Neue Oberfläche im Extension Development Host prüfen; echte Schreibzugriffe
  werden erst für die spätere kontrollierte KI-Anbindung benötigt.

Änderung der Quellenoberfläche am 11. Oktober 2026:

- Die Quellenliste ersetzt das Metadatenformular. Checkboxen erlauben den Import
  mehrerer Quellen in einem Vorgang; vorhandene Bib-Einträge bleiben erhalten.
- „In Projekt-.bib importieren“ und „DOI / Titel suchen“ bleiben über der Liste;
  „Liste aktualisieren“ ergänzt die Leiste. Filter und Auswahl bleiben beim
  Aktualisieren erhalten, soweit die Quellen weiterhin existieren.
- Jede Zeile zeigt Titel, Ersteller, Eintragsart und „In Zotero öffnen“.
- Typprüfung, Build und 60 Testfälle erfolgreich; Auswahl, Filter, Sammelimport
  und Wiederherstellung nach dem Neuladen wurden zusätzlich mit dem Webview-Script geprüft.
  Der manuelle VS-Code-Oberflächentest der Quellenliste steht noch aus.

Anhangsanzeige und Entlastung von Zotero am 11. Oktober 2026:

- Manuelle Quellen-/Anhangsverwaltung und erweiterte Suche aus dem Funktionsplan
  gestrichen; der Tabellenfilter bleibt. Anhangsmetadaten werden gesammelt und
  nach Quelle / Typ dargestellt. Fehlende Metadaten erscheinen als unbekannt,
  statt fälschlich „kein Anhang“ anzuzeigen.
- Mit dem laufenden Zotero lesend geprüft: 37 Quellenanhänge, davon 30 PDFs und
  7 Webseiten-Snapshots. Es wurden keine Dateien geöffnet oder Daten geändert.
- Editorwechsel lädt den Bibliotheksbaum nicht mehr neu. Quellen werden nicht
  mehr zusätzlich in der Seitenleiste abgefragt. Ein gemeinsamer Anfragekanal
  begrenzt gleichzeitige Server-Anfragen auf eine und bündelt gleiche Leseabrufe.
- Rohdaten werden kurz zwischengespeichert. Manuelles Aktualisieren verwirft den
  Cache. Warteschlangen sind begrenzt; nach Verbindungsabbruch / Zeitlimit werden
  wartende Anfragen gestoppt und weitere Abrufe für fünf Sekunden ausgesetzt.
- Wiederholte Ergebnisseiten und übergroße Abrufe werden abgebrochen. Die Liste
  protokolliert Aktionen, Laufzeit und Fehler im Ausgabekanal für die Fehlersuche.
- Der gemeldete mögliche Zotero-Absturz ist nicht reproduziert und seine Ursache
  nicht nachgewiesen. Der Benutzer hält auch versehentliches Schließen für möglich.
- Typprüfung, Build und 73 Testfälle erfolgreich; neue Tests prüfen
  Anhänge, Icons, gebündelte Abrufe, Parallelitätsbegrenzung, Cache-Aktualisierung,
  Verbindungsabbrüche und wiederholte Seiten. Manueller Oberflächentest offen.

Getrennte Einrichtung am 11. Oktober 2026:

- „Bibliothek festlegen“ und „.bib-Datei festlegen“ sind getrennte Befehle und
  funktionieren in beliebiger Reihenfolge. Die Bibliotheksauswahl startet keinen
  Bib-Datei- oder Zitierstil-Assistenten. Vorhandene andere Einstellungen bleiben erhalten.
- `.zotero/config.json` darf die Einrichtung schrittweise speichern:
  `library: null` und `bibFile: ""` bedeuten noch nicht gewählt. Import wird bei
  fehlender Bibliothek oder Bib-Datei mit dem jeweils passenden Hinweis blockiert.
- „Zitierbefehl ändern“ zeigt Bedeutung / Beispiele für autocite, parencite und
  textcite sowie den Hinweis, dass bisher nur die Vorgabe gespeichert wird.
  Bestehende Zitate, Zitierstil und Bib-Datei werden dadurch nicht verändert.
- Typprüfung, Build und 77 Testfälle erfolgreich. Neue Fälle prüfen beide
  Einrichtungsreihenfolgen, erhaltene Einstellungen und den Schutz bereits
  importierter Quellen. Manueller Oberflächentest offen.

LaTeX-Zitationen am 11. Oktober 2026:

- „Zitieren“ pro Quellenzeile sowie „Zotero: Quelle zitieren“ in Befehlspalette
  und LaTeX-Editor-Kontextmenü ergänzt. Der gespeicherte Zitierbefehl ist jetzt aktiv.
- Das zuletzt aktive LaTeX-Dokument und dessen Cursor werden pro Workspace-Ordner
  berücksichtigt. Markierter Text bleibt erhalten; mehrere Cursor und Rückgängig
  werden unterstützt. Notizen / Anhänge können nicht zitiert werden.
- Fehlende Bib-Einträge werden vor dem Einfügen importiert. Bestehende importierte
  Einträge brauchen keinen erneuten Zotero-Abruf. Importfehler und zwischenzeitlich
  geänderte / geschlossene Zieldokumente führen zu keiner Texteinfügung.
- Kein zusätzlicher Listen- oder Anhangsabruf nach einer Zitation; die Quellenliste
  wird mit den vorhandenen Daten und aktuellen Importmarkierungen dargestellt.
- Typprüfung, Build und 91 Testfälle erfolgreich. Neue Tests prüfen alle
  Zitierbefehle, echte Projektdateien / Autoimport, Importfehler, Editorwechsel,
  markierten Text, mehrere Cursor und Änderungen während der Vorbereitung.
- Manueller Oberflächentest und vollständiger LaTeX-/Biber-Durchlauf noch offen.

Rechtsklick-Zitierdialog am 11. Oktober 2026:

- „Zitieren …“ im LaTeX-Kontextmenü öffnet die native Quellensuche oben.
  Sie berücksichtigt Titel, Ersteller / Jahr und DOI; kein Quellen-Rechtsklickmenü.
- Nach der Quellenwahl werden optionale Seitenzahlen / Fundstellen und ein
  Zusatz wie „vgl.“ abgefragt. Die Werte werden als BibLaTeX-Postnote / Prenote
  an der gewählten Textstelle eingefügt und nicht in Zotero gespeichert.
- Die Quellenzeilen-Aktion verwendet denselben Ablauf ab der Seitenabfrage.
  Abbrechen vor Abschluss der Eingaben löst keinen Import und keine Textänderung aus.
- Die ursprüngliche Zielposition wird schon vor der Quellensuche erfasst.
  Text- und Argument-Sonderzeichen werden korrekt behandelt.
- Typprüfung, Build und 95 Testfälle erfolgreich, einschließlich Sucheinstellungen,
  Seitenbereichen, Zusatz ohne Seitenzahl und Abbrechen an beiden Eingabeschritten.
  Manueller Test des Kontextmenüs im Extension Development Host noch offen.

Fehlerkorrektur der Projektsperre am 11. Oktober 2026:

- Erfolgsmeldungen nach Bibliothekszuordnung und Bib-Import wurden innerhalb der
  Projektsperre abgewartet. Solange die Benachrichtigung nicht geschlossen war,
  wurde eine weitere Aktion fälschlich als laufende Projektaktion abgewiesen.
- Reine Status-/Fehlerbenachrichtigungen werden jetzt angezeigt, ohne den
  Befehlsablauf oder die Listen-/Projektsperre auf das Schließen warten zu lassen.
  Echte Auswahlfragen sowie die Sperre während tatsächlicher Dateioperationen bleiben erhalten.
- Typprüfung, Build und 97 Testfälle erfolgreich. Die Regression prüft einen
  zweiten Import bei weiterhin offener erster Erfolgsmeldung sowie das Ende eines
  Fehlerablaufs ohne Schließen seiner Benachrichtigung.

Übernahme und Festhalten der Zitier-Schlüssel am 11. Oktober 2026:

- Neue Importe übernehmen BBT-Schlüssel, wenn dessen API verfügbar ist; sonst
  den nativen Zotero-Export-Schlüssel. Namen und bestehende Zitate werden bei
  späteren Aktualisierungen nicht neu berechnet. `citationKeys` speichert die Zuordnung.
- Vor dem Upgrade importierte technische Schlüssel werden beibehalten.
  Schlüssel erscheinen in der Quellenliste und sind in beiden Suchfeldern auffindbar.
- BBT-Lookups werden gebündelt. Gruppenschlüssel werden anhand der CSL-URI
  zugeordnet; externe Gruppen-ID und interne BBT-libraryID werden nicht gleichgesetzt.
- Neue Keys dürfen nach Benutzerautorisierung in Zotero **Extra** als
  `Citation Key: …` festgehalten werden. Lokale Schreibfreigabe / Server-ID und
  Objektversion werden geprüft; andere Extra-Felder und andere manuell gesetzte
  Keys bleiben erhalten. Bei fehlender Unterstützung oder abgelehnter Freigabe
  bleibt der erfolgreiche Projektimport bestehen.
- Lesend mit dem genannten Zotero-Eintrag geprüft: nativer Schlüssel
  `michell_it_1997`; Better-BibTeX-Schnittstelle dort nicht verfügbar.
- Typprüfung, Build und 110 Testfälle erfolgreich. Fälle prüfen Zuordnung,
  Stabilität, Altbestände, Kollisionen, BBT-Bibliotheksscope, Rückschreibung und
  verweigerte Freigabe. Echte BBT- und Schreib-Integration noch manuell prüfen.
