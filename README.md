# Zotero LaTeX Assistant

**Deine Zotero-Literatur direkt im LaTeX-Projekt.**
Quellen in VS Code auswählen, in die Projektbibliografie übernehmen und beim
Schreiben zitieren. Zotero läuft dafür auf deinem Rechner.

**MCP einrichten:** [Kurzanleitung für VS Code und Cursor](MCP-README.md) –
Serverdatei finden, Startangaben und Konfiguration zum Kopieren.

## Funktionen

| Funktion | Das kannst du damit machen |
| --- | --- |
| **Bibliotheken durchsuchen** | Persönliche Bibliothek, Gruppen und Sammlungen in der Zotero-Seitenleiste öffnen. |
| **Quellen auswählen** | Nach Titel, Autor, Jahr oder DOI filtern und Quellen per Häkchen in deine `.bib` übernehmen. |
| **Direkt zitieren** | Quellen am Cursor einfügen – auf Wunsch mit Seitenzahl und einem Zusatz wie „vgl.“. Fehlende Quellen werden dabei importiert. |
| **Bibliografie einrichten** | Bibliothek, `.bib`-Datei und einen lokal installierten BibLaTeX-Stil unabhängig auswählen. |
| **Literaturdaten aktualisieren** | Änderungen aus Zotero ausdrücklich in die Projektbibliografie übernehmen; Zitier-Schlüssel bleiben stabil. |
| **DOI und Titel suchen** | Publikationen über Crossref finden, Metadaten ansehen und die DOI kopieren. |
| **Mit KI arbeiten · optional** | Codex oder Claude über den lokalen MCP-Server mit Recherche, Quellennotizen und PDF-Weitergabe verbinden. |

Quellen und Anhänge bearbeitest du wie gewohnt in Zotero. **Open in Zotero**
öffnet den passenden Eintrag aus der Quellenliste.

### So sieht eine Zitation aus

Über **Cite …** wählst du eine Quelle und ergänzt bei Bedarf Seitenzahl und
Zusatz. Die Extension fügt beispielsweise Folgendes ein:

```latex
\parencite[vgl.][14–16]{Mueller2024}
```

Den Befehl für neue Zitationen wählst du im Zahnradmenü unter
**Change citation command**:

| Befehl | Verwendung |
| --- | --- |
| `\parencite{quelle}` | Quellenangabe in Klammern, z. B. (Müller, 2024). |
| `\textcite{quelle}` | Autor im Satz, z. B. Müller (2024). |
| `\autocite{quelle}` | Darstellung nach der `autocite`-Einstellung deines Dokuments, etwa in Klammern oder als Fußnote. |

Der **Zitierstil** bestimmt die Darstellung; der **Zitierbefehl** bestimmt, wie
sich die Angabe in deinen Text einfügt. Die Beispiele oben gelten für einen
Autor-Jahr-Stil.

---

## Installation

**Du brauchst:** VS Code ab 1.95, Zotero Desktop mit aktivierter lokaler API und
für dein LaTeX-Dokument eine TeX-Installation mit BibLaTeX.

1. In VS Code die Erweiterungsansicht öffnen (**Strg+Umschalt+X**).
   Im Menü **… → Install from VSIX…** die Datei
   `zotero-latex-assistant-0.1.0.vsix` auswählen.
2. Zotero starten. Unter **Einstellungen → Erweitert** die Kommunikation mit
   anderen Anwendungen auf diesem Computer erlauben.
3. Deinen LaTeX-Projektordner in VS Code öffnen und links auf das
   **Zotero-Buchsymbol** klicken.

**Export:** Standardmäßig verwendet die Extension **Better BibTeX for Zotero**.
Ist das Plugin nicht installiert, kannst du beim ersten Import oder Zitieren
**Use Zotero export** wählen. Damit nutzt dieses Projekt den nativen
Zotero-Export. Für lokale Lesezugriffe brauchst du keinen API-Schlüssel.

### Projekt in drei Schritten einrichten

Öffne das **Zahnrad** in der Zotero-Seitenleiste und wähle:

1. **Set library** → deine Bibliothek oder eine Sammlung verbinden.
2. **Set .bib file** → eine vorhandene Datei auswählen oder einen neuen
   Projektpfad angeben, z. B. `literatur.bib`.
3. **Change BibLaTeX citation style** → einen installierten Stil auswählen,
   z. B. `authoryear` oder `numeric`, sofern vorhanden.

Du kannst diese Einstellungen auch in anderer Reihenfolge festlegen. Die
Extension speichert sie für dein Projekt und ergänzt bei vollständigen
LaTeX-Hauptdokumenten fehlende BibLaTeX-Einbindungen und die Literaturausgabe.
Speichere offene Dateiänderungen vor der Einrichtung.

---

## Im Alltag

### Quellen in die Bibliografie übernehmen

1. In der Seitenleiste eine Bibliothek oder Sammlung anklicken.
2. Gewünschte Quellen in der Liste **anhaken**.
3. **Update project .bib** wählen, um die Auswahl zu übernehmen.

Bereits enthaltene Quellen sind angehakt. Der Textfilter verändert nur die
Anzeige; übernommen wird die gesamte Auswahl der geöffneten Liste.

> **Beim Abwählen beachten:** Nach **Update project .bib** werden abgewählte
> Quellen aus der Projektbibliografie und ihre Zitierverweise aus den
> LaTeX-Dateien entfernt. Speichere offene Änderungen vorher. Die Extension
> sichert die betroffenen Dateien unter `.zotero/backups/`.

### Beim Schreiben zitieren

1. Eine gespeicherte `.tex`-Datei im Projekt öffnen und den Cursor setzen.
2. **Rechtsklick → Cite …** wählen und die Quelle suchen.
3. Optional eine Seitenzahl oder Fundstelle eingeben, danach einen Zusatz.
   Ohne Angabe jeweils mit **Enter** fortfahren.

Alternativ öffnet **Zotero: Cite …** in der Befehlspalette die Suche.
Fehlt die Quelle in deiner `.bib`, wird sie beim Zitieren übernommen.

### Änderungen aus Zotero übernehmen

- **Refresh list** lädt Quellen und Anhangshinweise neu.
- **Zotero: Update .bib manually** übernimmt die aktuellen Metadaten der
  zugeordneten Quellen aus Zotero. Beim reinen Synchronisieren der Häkchen
  bleiben vorhandene Bib-Felder und manuelle Ergänzungen erhalten.
- **Open in Zotero** öffnet eine Quelle zur Bearbeitung in Zotero.

### KI-Unterstützung einrichten · optional

Im Zahnradmenü **Set up Codex MCP connection** oder
**Set up Claude MCP connection** wählen. Für den lokalen MCP-Server brauchst
du zusätzlich **Node.js ab Version 20** und die jeweilige KI-Erweiterung.

Der Agent kann unter anderem Quellen recherchieren, Notizen bearbeiten,
Literatur über DOI oder ISBN übernehmen und PDFs erhalten. Mit
`zotero_check_sources` prüft er Zotero-Quellen bei PubCheck auf passende Literaturangaben
und Rückzugswarnungen und ruft die Zahl der Zitationen durch andere Publikationen
separat bei Crossref über DOI oder einen eindeutigen ISBN-Treffer ab. Das prüft bibliografische Angaben, keine wissenschaftlichen
Aussagen; fehlende Zitationszahlen werden als unbekannt ausgewiesen.
`zotero_check_candidate` bietet dieselbe Prüfung für recherchierte Quellen vor
dem Import, auch ohne laufendes Zotero. Dadurch kann die KI widersprüchliche
Angaben erkennen, bevor sie eine Quelle übernimmt.
[Einrichtung, Freigaben und Beispiele](docs/MCP.md#voraussetzungen-und-einrichtung).

Der MCP kann auch **eigenständig mit Zotero** laufen, ohne VS Code oder
LaTeX-Projekt. Wenn ein Schreibprojekt angegeben ist, prüft er seine Einstellungen,
kann die Zotero-Zuordnung selbst speichern und ausgewählte Quellen in eine
vorhandene `.bib` übernehmen. Eine `.tex`-Datei ist dafür nicht erforderlich.
[Eigenständiger MCP und optionaler Bib-Import](docs/MCP.md#zotero-eigenständig-und-optional-mit-schreibprojekt).

## Hilfe

| Problem | Nächster Schritt |
| --- | --- |
| **Zotero ist nicht erreichbar** | Zotero starten, die lokale API erlauben und **Zotero: Check connection** ausführen. |
| **Import verlangt Better BibTeX** | Das Plugin aktivieren oder **Use Zotero export** auswählen, wenn die Option angeboten wird. |
| **Kein Zitierstil wird angezeigt** | Prüfen, ob BibLaTeX und `kpsewhich` in deiner TeX-Installation verfügbar sind. |
| **Eine Datei lässt sich nicht ändern** | Offene Änderungen speichern und den Vorgang erneut starten. |
| **Du brauchst die Fehlermeldung** | **Ansicht → Ausgabe → Zotero LaTeX Assistant** öffnen. |

Alle Zotero-Befehle findest du in der Befehlspalette (**Strg+Umschalt+P**).

**Mehr Details:** [Technische Referenz](docs/REFERENZ.md) ·
[MCP mit Codex und Claude](docs/MCP.md) ·
[Entwicklung starten](docs/REFERENZ.md#entwicklung-starten)

---

## Updates

### Version 0.1.0 · aktueller Entwicklungsstand

- **Flexible Einrichtung:** Bibliothek, Bib-Datei und Zitierstil separat
  auswählen; beim Bib-Dateiwechsel werden die LaTeX-Verweise angepasst.
- **Zitieren und Quellen synchronisieren:** Direkter Import beim Zitieren,
  Abgleich der Checkbox-Auswahl und Prüfung auf mögliche Dubletten.
- **Zitier-Schlüssel umbenennen:** **Migrate existing citation keys** zeigt
  die geplanten Änderungen vor dem Anwenden und sichert die Originaldateien.
- **KI-Anbindung erweitert:** Recherche, Quellennotizen, Wiederherstellung aus
  dem Papierkorb, Sammlungsverwaltung und Auswahl vorhandener Projekt-Bib-Dateien.
- **Neues Extension-Icon** für die Erweiterungsübersicht.

Die ausführlichen Entwicklungs- und Prüfberichte stehen im
[Projektstatus](PROJEKTSTATUS.md).
