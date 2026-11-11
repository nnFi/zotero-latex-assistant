# Recherche und Quellenprüfung mit dem Zotero-MCP

Ziel: passende Literatur finden, bibliografische Angaben und Rückzugswarnungen
prüfen, die Publikationen inhaltlich ansehen und nur geeignete Quellen übernehmen.
Recherche, bibliografische Prüfung und Übernahme sind separate Schritte.

## Ablauf

1. **Auftrag und Sammlung festlegen.** Thema, Forschungsfrage, gewünschte
   Quellentypen, Zeitraum und Sprachen aus dem Auftrag übernehmen. Bibliothek und
   Sammlung eindeutig auswählen. Eine Recherche autorisiert noch keine Neuanlage.
2. **Vorhandene Literatur zuerst durchsuchen.** Mit `zotero_research` passende
   Zotero-Quellen und bei vorhandenem Projekt die Bibliografie durchsuchen.
   Geeignete Quellen wiederverwenden und bibliografische Dubletten vermeiden.
3. **Neue Kandidaten recherchieren.** `zotero_research` fragt extern OpenAlex
   ab und wechselt bei Ausfall oder ohne verwertbaren Treffer zu Crossref.
   OpenAlex liefert auch Arbeiten ohne DOI. Für eine geplante Übernahme DOI
   oder ISBN über `zotero_lookup_identifier` als Metadatenvorschau auflösen.
   Anbieter, Herkunft und tatsächlich gelieferte Angaben festhalten.
4. **Bibliografisch prüfen, bevor die Quelle übernommen wird.**
   `zotero_check_reference` gleicht Titel, geordnete Autoren und Jahr mit
   beiden Diensten ab. Mit DOI beginnt es bei Crossref, ohne DOI bei OpenAlex.
   `zotero_check_bibliography` prüft eine Projekt-.bib oder übergebenes BibTeX
   je Eintrag zuerst bei PubCheck und danach bei beiden Indizes. Bei PubCheck-Ausfall
   vergleicht es zusätzlich vorhandene LaTeX-Zitierschlüssel mit der .bib.
   Für Rückzugswarnungen und die Prüfung vor dem Import weiterhin
   `zotero_check_sources` oder `zotero_check_candidate` verwenden. Die ursprünglichen
   Referenzdaten zur Prüfung übergeben und Korrekturen kenntlich machen.
   `zotero_get_citations` liefert Zähler und zitierende Arbeiten aus OpenAlex
   und greift bei Bedarf auf den verfügbaren Crossref-Zähler zurück.
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
6. **Inhalt und Eignung bewerten.** `zotero_get_fulltext` versucht zuerst
   OpenAlex-PDF, XML und verlinkte Open-Access-Kopien. Danach öffnet es die
   Publikationsseite über die vorhandene DOI. Fehlt die DOI, sucht es in Crossref
   nach Titel und Erstautor und öffnet die Publikationsseite des eindeutigen
   Treffers. Bei Bedarf folgen verlinkte Archive, DBLP und Zenodo. Den zugänglichen
   Volltext lesen, die Aussage an der Fundstelle prüfen und Seite oder Abschnitt
   angeben. Bei fehlendem Volltext bleibt die inhaltliche Prüfung offen.
7. **Übernehmen und dokumentieren.** Auf ausdrücklichen Übernahmeauftrag geeignete
   Quellen über `zotero_import_identifier` bzw. validierte `zotero_create_item`
   aufnehmen. Dubletten vorher prüfen. Prüfergebnis, Zeitpunkt, Herkunft und
   inhaltliche Kurzbewertung in einer Zotero-Notiz festhalten. Auf gesonderten
   Auftrag vorhandene Projekt-`.bib` mit `zotero_add_to_bibliography` ergänzen;
   vorhandene Einträge erhalten und bei mehreren Dateien nachfragen.

## Ergebnisse festhalten

Vorübergehende Fehler werden einmal kurz wiederholt. Bei längerer Wartezeit
oder erneutem Ausfall wechselt der MCP zum nächsten Dienst und überspringt
den ausgefallenen Dienst für den Rest des Durchgangs. Ausfall, Fehltreffer und
abweichende Angaben sind separate Befunde. Bei einem Literaturverzeichnis
mit mehr als fünf Einträgen `nextToken` aus der Antwort weiterverwenden.

Für jede Quelle DOI oder ISBN, bibliografische Befunde, Rückzugswarnungen,
Zitationszahl mit Anbieter und Zeitpunkt, Fundstelle und Entscheidung
festhalten. Die [MCP-Werkzeugreferenz](MCP.md#recherche-referenzen-zitationen-und-volltext)
enthält die Eingabeformate und Grenzen.
