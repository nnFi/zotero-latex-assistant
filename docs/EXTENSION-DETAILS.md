# Zotero LaTeX Assistant

**Deine Zotero-Literatur direkt im LaTeX-Projekt.**

Quellen auswählen, die Bibliografie pflegen und beim Schreiben zitieren –
direkt in VS Code, verbunden mit Zotero auf deinem Rechner.

## Funktionen

- **Literatur durchsuchen:** Persönliche Bibliothek, Gruppen und Sammlungen
  in der Zotero-Seitenleiste öffnen; nach Titel, Autor, Jahr oder DOI filtern.
- **Quellen übernehmen:** Die Auswahl mit der Projektbibliografie abgleichen
  und Metadaten aus Zotero bei Bedarf aktualisieren.
- **Direkt zitieren:** Quellen am Cursor einfügen, mit optionalen Seitenzahlen
  und Zusätzen. Fehlende Einträge werden in die `.bib` übernommen.
- **BibLaTeX einrichten:** Bibliothek, Literaturdatei und einen lokal
  installierten Zitierstil auswählen. Gespeicherte Zitierschlüssel bleiben stabil.
- **Publikationen finden:** DOI oder Titel bei Crossref suchen und die
  Literaturangaben ansehen.

```latex
\parencite[vgl.][14–16]{Mueller2024}
```

## Voraussetzungen

| Für Zotero und LaTeX | Zusätzlich für die optionale KI-Anbindung |
| --- | --- |
| VS Code ab 1.95 und Zotero Desktop | Node.js ab 20 und ein MCP-fähiger KI-Client |
| TeX mit BibLaTeX, Biber und `kpsewhich` | Zotero ab 10 für Schreibzugriffe |
| Better BibTeX für den Standardexport; alternativ der native Zotero-Export | Für TikZ: TeX mit `pgf` und Poppler (`pdftoppm`) |

Zum Bauen und zur PDF-Vorschau deiner LaTeX-Dokumente eignet sich
[LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop).

## Schnellstart

1. **Zotero starten.** Unter **Einstellungen → Erweitert** die Kommunikation
   mit anderen Anwendungen auf diesem Computer erlauben.
2. **Deinen LaTeX-Projektordner öffnen** und links auf das Zotero-Buchsymbol
   klicken.
3. Im Zahnradmenü **Set library**, **Set .bib file** und
   **Change BibLaTeX citation style** wählen.
4. Eine Bibliothek oder Sammlung öffnen, gewünschte Quellen anhaken und
   **Update project .bib** wählen.
5. Im LaTeX-Dokument den Cursor setzen und über **Rechtsklick → Cite …**
   eine Quelle zitieren.

Beim Abwählen und anschließenden Aktualisieren werden Quellen und ihre
Zitierverweise aus dem Projekt entfernt. Speichere offene Änderungen vorher.
Die betroffenen Dateien werden gesichert.

<details>
<summary><strong>Better BibTeX installieren</strong></summary>

1. Die passende `.xpi`-Datei aus den
   [Better-BibTeX-Releases](https://github.com/retorquere/zotero-better-bibtex/releases/latest)
   herunterladen.
2. In Zotero unter **Werkzeuge → Plugins** im Zahnradmenü
   **Plugin aus Datei installieren …** wählen.
3. Die Datei auswählen und Zotero neu starten, falls dazu aufgefordert.

Alternativ beim Import **Use Zotero export** wählen, um den nativen
BibLaTeX-Export für dieses Projekt zu verwenden.

</details>

## KI-Unterstützung · optional

Der lokale MCP-Server verbindet VS Code / Copilot, Codex, Claude oder Cursor
mit deiner Zotero-Bibliothek. Der Agent kann Quellen recherchieren,
Literaturangaben prüfen, Notizen bearbeiten und PDF-Anhänge erhalten.
TikZ-Grafiken lassen sich im Projekt rendern und als Vorschau zurückgeben.

1. Im Zotero-Zahnradmenü den passenden **Set up … MCP connection**-Befehl wählen.
2. Deine lokale MCP-Serverdatei auswählen, beispielsweise `mcp-latest.cjs`.
3. Den Server im gewählten KI-Client starten und die Verbindung prüfen:

   > Zeige mir mit dem Zotero-MCP meine Bibliotheken und Sammlungen.

Recherche allein importiert keine Quellen. Für Änderungen an Zotero ist eine
ausdrückliche Anweisung und die lokale Schreibfreigabe erforderlich.
Die Prüfung von Literaturangaben bestätigt keine wissenschaftlichen Aussagen.

## Hilfe

| Problem | Nächster Schritt |
| --- | --- |
| Zotero ist nicht erreichbar | Zotero starten, die lokale Kommunikation erlauben und **Zotero: Check connection** ausführen. |
| Ein Zitierstil fehlt | Prüfen, ob BibLaTeX und der gewünschte Stil installiert sind. Bei Bedarf `zoteroLatexAssistant.kpsewhichPath` in den Einstellungen setzen. |
| Eine Datei lässt sich nicht ändern | Offene Änderungen speichern und den Vorgang erneut starten. |
| Du brauchst die Fehlermeldung | **Ansicht → Ausgabe → Zotero LaTeX Assistant** öffnen. |

## Lizenz

[MIT License](https://opensource.org/license/mit) · Copyright © 2026 Finn Plaßmeier.

Der eigene Code und die Dokumentation dürfen unter den Bedingungen der
MIT-Lizenz verwendet, verändert und weitergegeben werden.
