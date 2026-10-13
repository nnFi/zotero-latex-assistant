# Vorschlag für einen Research-Workflow

Ziel: passende Literatur finden, bibliografische Angaben und Rückzugswarnungen
prüfen, die Publikationen inhaltlich ansehen und nur geeignete Quellen übernehmen.
Dies ist ein Vorschlag für den Ablauf, keine bereits erzwungene Importregel.

## Ablauf

1. **Auftrag und Sammlung festlegen.** Thema, Forschungsfrage, gewünschte
   Quellentypen, Zeitraum und Sprachen aus dem Auftrag übernehmen. Bibliothek und
   Sammlung eindeutig auswählen. Eine Recherche autorisiert noch keine Neuanlage.
2. **Vorhandene Literatur zuerst durchsuchen.** Mit `zotero_research` passende
   Zotero-Quellen und bei vorhandenem Projekt die Bibliografie durchsuchen.
   Geeignete Quellen wiederverwenden und bibliografische Dubletten vermeiden.
3. **Neue Kandidaten recherchieren.** Falls nötig externe Suche ausdrücklich
   ergänzen. DOI oder ISBN über `zotero_lookup_identifier` auflösen und Anbieter,
   Herkunfts-URL und tatsächlich gelieferte Angaben festhalten. Die Originalseite
   des Verlags/Repositoriums ansehen. Titel, Autorenschaft, Jahr und bei Büchern
   Ausgabe bzw. bei Kapiteln das konkrete Kapitel abgleichen. Fehlende Werte
   offenlassen; weder Metadaten noch DOI erfinden.
4. **Bibliografisch prüfen, bevor die Quelle übernommen wird.** Bestehende
   Zotero-Quellen mit `zotero_check_sources` bei PubCheck prüfen. Für neue Kandidaten
   `zotero_check_candidate` mit den tatsächlichen recherchierten Metadaten aufrufen.
   Das Werkzeug prüft die Quelle ohne vorherige Zotero-Anlage und ohne laufendes
   Zotero. Verdächtige Angaben nicht vor der Prüfung still durch Anbieterwerte
   ersetzen; Korrekturen kenntlich machen und erneut prüfen.
   Zitationszahlen werden separat über DOI oder einen eindeutig passenden
   Crossref-ISBN-Treffer ermittelt. Eine hohe, niedrige oder unbekannte Zitationszahl
   entscheidet nicht über die Gültigkeit oder Eignung einer Quelle.
5. **Ergebnis einordnen.** Bestätigte bibliografische Angaben (`VERIFIED` und
   `metadataMatches:true`) ermöglichen die inhaltliche Sichtung. Bei
   `METADATA_MISMATCH` den Kandidaten mit den widersprüchlichen Angaben aus der
   Auswahl ausschließen, den Grund nennen und gegebenenfalls korrekte Angaben
   erneut prüfen. `RETRACTED` sperrt die Verwendung als unbeanstandeten Beleg;
   PubPeer-Kommentare sind Zusatzhinweise, die nach Inhalt zu beurteilen sind, und
   allein kein Ablehnungsgrund. Eine ausdrücklich beauftragte Untersuchung zurückgezogener Arbeiten ist ein
   gesonderter Anwendungsfall. `NOT_FOUND`, `UNVERIFIABLE`, `ERROR`, ungültige
   Kennungen oder ein unvollständiger Vergleich bedeuten **ungeklärt**. Nicht als
   erfunden ausgeben und nicht stillschweigend übernehmen. Bestehende Zotero-Quellen
   werden bei einem negativen Prüfergebnis nicht automatisch gelöscht.
6. **Inhalt und Eignung bewerten.** Originaltext oder verfügbares PDF lesen.
   Forschungsfrage, Methode, Ergebnisse und Grenzen prüfen. Für konkrete Aussagen
   die Fundstelle mit Seitenzahl/Abschnitt erfassen. Bei nur zugänglichem Abstract
   die eingeschränkte Grundlage nennen und keine Volltextprüfung behaupten.
   Eine bibliografische Bestätigung ist keine Bestätigung wissenschaftlicher Aussagen.
7. **Übernehmen und dokumentieren.** Auf ausdrücklichen Übernahmeauftrag geeignete
   Quellen über `zotero_import_identifier` bzw. validierte `zotero_create_item`
   aufnehmen. Dubletten vorher prüfen. Prüfergebnis, Zeitpunkt, Herkunft und
   inhaltliche Kurzbewertung in einer Zotero-Notiz festhalten. Auf gesonderten
   Auftrag vorhandene Projekt-`.bib` mit `zotero_add_to_bibliography` ergänzen;
   vorhandene Einträge erhalten und bei mehreren Dateien nachfragen.

## Verfügbare Werkzeuge und verbleibende Prüfgrenze

Recherche, DOI-/ISBN-Metadatenauflösung, Prüfung bestehender Zotero-Quellen und neuer Kandidaten,
DOI-/ISBN-basierte Zitationszahlen, Notizen und optionaler Bib-Import sind verfügbar.
Der ISBN-Treffer ist eine Zuordnung für die Zitationszahl; er ersetzt keine
PubCheck-Prüfung oder inhaltliche Bewertung.

`zotero_check_candidate` ermöglicht jetzt „finden → prüfen → verwerfen oder
übernehmen“, ohne ungeprüfte Kandidaten zuerst in Zotero anlegen zu müssen.
Es gibt genau die geprüften Eingabemetadaten zurück; PubCheck-Nachweise und
Zitationszahlen bleiben getrennt. Es benötigt keine Sammlungswahl und schreibt
weder Zotero noch Projektdateien.

Der Agent soll den Prüfstatus je Kandidat mitführen. Für eine technisch
verbindliche Importregel müssten auch die Importwerkzeuge ein aktuelles, an genau
diese Metadaten gebundenes Prüfergebnis verlangen. Bisher erzwingen sie keinen
positiven PubCheck-Status. Dienstfehler und spätere Metadatenänderungen müssen eine
erneute Prüfung oder eine ausdrücklich begründete Einzelentscheidung auslösen.

Als Rechercheergebnis empfiehlt sich eine Tabelle mit Quelle, DOI/ISBN, Prüfergebnis,
Rückzugswarnungen, Crossref-Zitationszahl samt Zeitpunkt, thematischer Eignung,
Inhaltsgrundlage und Entscheidung mit Begründung.
