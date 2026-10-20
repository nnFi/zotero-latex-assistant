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
| **TikZ-Grafiken mit KI erstellen** | Eine Bildvorlage im KI-Chat beschreiben lassen und den erzeugten TikZ-Code über `tikz_render` prüfen. Der MCP legt `figures/` automatisch an und liefert PDF und PNG-Vorschau. |

Quellen und Anhänge bearbeitest du wie gewohnt in Zotero. **Open in Zotero**
öffnet den passenden Eintrag aus der Quellenliste.

Für TikZ brauchst du lokal TeX mit dem Paket `pgf` sowie Popplers
`pdftoppm`. Benannte Schriften verwenden LuaLaTeX oder XeLaTeX mit `fontspec`.
Eine mitgegebene Schrift hat Vorrang; andernfalls liest der MCP die
Schrifteinstellungen aus der LaTeX-Hauptdatei. Die KI-Anwendung erkennt die
Bildvorlage; der MCP rendert den Code und speichert ihn als `figures/<name>.tikz` im ausdrücklich
gewählten LaTeX-Projekt. Ein `input/`-Ordner ist nicht erforderlich:
`\input{figures/ablauf.tikz}` bindet die Datei ein.
[Aufruf, Voraussetzungen und Dateiverhalten](docs/MCP.md#tikz-grafiken-im-latex-projekt).

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

### Vollständige Liste der benötigten Programme

| Bestandteil | Wann brauchst du ihn? |
| --- | --- |
| **Aktuelles VS Code** | Für die Extension; diese benötigt mindestens Version 1.95. Verwende für aktuelle weitere Erweiterungen ein aktuelles VS Code. |
| **Zotero Desktop** | Für deine Literatur und die lokale Verbindung. Für Schreibzugriffe durch die KI ist Zotero 10 oder neuer erforderlich. |
| **Zotero LaTeX Assistant** | Unsere VS-Code-Extension, installiert aus der `.vsix`-Datei. |
| **TeX-Distribution** | Zum Erstellen deiner LaTeX-PDFs; beispielsweise TeX Live unter Linux/Windows oder MacTeX unter macOS. |
| **BibLaTeX und Biber** | LaTeX-Paket und Programm für Literaturverzeichnisse; werden über die TeX-Distribution bzw. den Paketmanager installiert. |
| **`kpsewhich`** | Bestandteil der TeX-Distribution; die Extension benötigt es zum Finden installierter Zitierstile. |
| **LaTeX Workshop und `latexmk`** | Empfohlen für das Bauen und die PDF-Vorschau in VS Code. LaTeX Workshop ist eine VS-Code-Extension; `latexmk` gehört zur TeX-Installation. |
| **Better BibTeX for Zotero** | Zusätzliches Zotero-Plugin für den standardmäßig verwendeten Export. Es wird **nicht mit Zotero mitgeliefert**. Alternativ ist der native Zotero-Export möglich. |
| **Node.js und ein MCP-fähiger KI-Client** | Nur für die optionale KI-Anbindung: Node.js ab Version 20, bei Neuinstallation eine aktuelle LTS-Version; dazu beispielsweise Codex, Claude Code oder Cursor. |

### TeX und die LaTeX-Werkzeuge installieren

- **Fedora:** Die folgenden Pakete decken eine grundlegende LaTeX-Installation,
  BibLaTeX, Biber, `kpsewhich` und `latexmk` ab:

  ```sh
  sudo dnf install texlive-scheme-basic texlive-biblatex texlive-kpathsea biber latexmk
  ```

- **Andere Linux-Systeme / Windows:** [TeX Live installieren](https://tug.org/texlive/quickinstall.html).
- **macOS:** [MacTeX installieren](https://www.tug.org/mactex/).

**Windows mit MiKTeX:** Wenn du statt TeX Live MiKTeX verwendest, zusätzlich
[Strawberry Perl](https://strawberryperl.com/) installieren. MiKTeX liefert Perl
nicht mit; `latexmk` benötigt es für den üblichen PDF-Build mit LaTeX Workshop.
Nach der Installation VS Code vollständig neu starten und im VS-Code-Terminal
`perl --version` sowie `latexmk -v` prüfen.
[Hinweise von LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop/wiki/Install).

Zusätzliche Schriften, Sprach- oder Stilpakete hängen von deiner Dokumentvorlage ab.
Nach der Installation müssen die Programme im Terminal von VS Code erreichbar sein.
VS Code gegebenenfalls neu starten. Prüfen mit:

```sh
pdflatex --version
biber --version
latexmk -v
kpsewhich biblatex.sty
kpsewhich authoryear.bbx
kpsewhich authoryear.cbx
```

Die ersten drei Befehle sollen Versionsangaben ausgeben, die letzten drei
Dateipfade. Für einen anderen Zitierstil müssen dessen `.bbx`- und `.cbx`-Dateien
installiert sein. [TeX-Live-Grundpaket für Fedora](https://packages.fedoraproject.org/pkgs/texlive/texlive-scheme-basic/).

### Wenn keine Zitierstile angezeigt werden

Normalerweise findet die Extension installierte BibLaTeX-Stile automatisch.
Unter macOS versucht sie zusätzlich `/Library/TeX/texbin/kpsewhich`, wenn der
Standardbefehl `kpsewhich` nicht gefunden wird. Ein ausdrücklich eingestellter
Programmpfad hat Vorrang. Diese Erkennung gilt für die Zitierstilauswahl;
zum PDF-Bauen muss auch LaTeX Workshop die TeX-Programme erreichen können.
Du wählst sie unter **Zotero-Zahnrad → Change BibLaTeX citation style** aus;
einen TeX-Pfad musst du nur einstellen, wenn die automatische Suche scheitert.

1. Im VS-Code-Terminal `kpsewhich biblatex.sty` ausführen. Gibt der Befehl einen
   Dateipfad aus, ist BibLaTeX für dieses Terminal auffindbar. Für einen Stil
   müssen außerdem beide Dateien vorhanden sein, etwa `authoryear.bbx` und
   `authoryear.cbx` aus den Prüfkommandos oben.
2. Wird der Befehl nicht gefunden, die TeX-Installation und deren Programm-Pfad
   prüfen; VS Code nach der Installation vollständig neu starten.
3. Falls die Extension das Programm weiterhin nicht findet, die VS-Code-
   **Einstellungen** öffnen und nach **`zoteroLatexAssistant.kpsewhichPath`** suchen.
   Dort den vollständigen Pfad zur Programmdatei eintragen:
   - **macOS mit MacTeX:** normalerweise `/Library/TeX/texbin/kpsewhich`;
     dieser Standardpfad wird bei automatischer Suche bereits versucht.
   - **Windows:** die Datei `kpsewhich.exe` im Programmordner deiner
     TeX-Installation auswählen bzw. deren vollständigen Pfad kopieren.
   - **Linux:** den vollständigen Programmpfad verwenden, beispielsweise
     `/usr/bin/kpsewhich`.
4. Die Zitierstilauswahl erneut öffnen. Fehlt nur ein bestimmter Stil, dessen
   BibLaTeX-Paket über die TeX-Distribution nachinstallieren.

Wenn das Terminal das Programm bereits findet, liefert `command -v kpsewhich`
unter Linux/macOS bzw. `(Get-Command kpsewhich.exe).Source` in Windows-PowerShell
den vollständigen Pfad. Den Pfad ohne zusätzliche Anführungszeichen in das
Einstellungsfeld eintragen.
[MacTeX-Programmpfad](https://www.tug.org/mactex/multipletexdistributions.html).

### Zotero und Better BibTeX einrichten

1. Zotero Desktop installieren und starten. Unter **Einstellungen → Erweitert**
   die Kommunikation mit anderen Anwendungen auf diesem Computer erlauben.
   Zotero muss während der Nutzung der Extension laufen.
2. Auf der [Better-BibTeX-Downloadseite](https://github.com/retorquere/zotero-better-bibtex/releases/latest)
   unter **Assets** die zur Zotero-Version passende Datei
   **`zotero-better-bibtex-….xpi`** herunterladen.
   In Firefox **Rechtsklick → Ziel speichern unter …** verwenden.
3. In **Zotero → Werkzeuge → Plugins** oben rechts auf das **Zahnrad** klicken
   und **Plugin aus Datei installieren …** wählen.
4. Die heruntergeladene `.xpi`-Datei auswählen, die Installation bestätigen und
   Zotero neu starten, falls dazu aufgefordert.
5. In der Plugin-Liste prüfen, dass **Better BibTeX** aktiviert ist.

[Offizielle Better-BibTeX-Anleitung](https://retorque.re/zotero-better-bibtex/installation/)
und [Zotero-Einstellung für die lokale API](https://www.zotero.org/support/dev/web_api/v3/local_api).

Ohne Better BibTeX kannst du beim ersten Import oder Zitieren **Use Zotero export**
wählen. Damit nutzt dieses Projekt den nativen Zotero-Export. Für lokale
Lesezugriffe brauchst du keinen API-Schlüssel.

### VS-Code-Erweiterungen installieren

1. In VS Code die Erweiterungsansicht öffnen (**Strg+Umschalt+X**).
   Im Menü **… → Install from VSIX…** die Datei
   `zotero-latex-assistant-latest.vsix` auswählen. Diese Datei liegt immer als
   aktuelle installierbare Version im Repository.
2. In der Erweiterungsansicht **LaTeX Workshop** von **James Yu** installieren,
   wenn du LaTeX-Dateien in VS Code bauen und PDFs ansehen möchtest.
3. Deinen LaTeX-Projektordner in VS Code öffnen und links auf das
   **Zotero-Buchsymbol** klicken.

[Installationshinweise für LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop/wiki/Install).

### Nur bei KI-Nutzung: Node.js und KI-Client

1. Eine aktuelle LTS-Version von [Node.js](https://nodejs.org/en/download)
   installieren. Technisches Minimum für den gebündelten MCP-Server ist Node.js 20.
   Im Terminal muss `node --version` eine passende Version ausgeben.
2. Deinen gewünschten MCP-fähigen KI-Client installieren bzw. dessen Erweiterung
   und Zugang einrichten. **Ein Client genügt**; du brauchst nicht Codex, Claude
   und Cursor gemeinsam.
3. Im Zotero-Zahnradmenü den passenden **Set up … MCP connection**-Befehl wählen
   und die gewünschte `.cjs`-Serverdatei selbst auswählen.
   [Vollständige MCP-Einrichtung](MCP-README.md).

Für die Nutzung der fertigen VSIX musst du weder `npm install` ausführen noch
Python, OCR-Software oder einen separaten PDF-Extraktor installieren.

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

Lokale Dateipfade werden unter Windows, macOS und Linux verarbeitet: Die
`.bib` wählst du innerhalb deines Projekts aus, die MCP-Serverdatei über den
Dateidialog. Bei PDF-Anhängen verwendet der MCP den von Zotero gemeldeten
lokalen Speicherort. Die PDF muss auf diesem Rechner verfügbar und lesbar sein;
es wird nicht die ganze Festplatte nach Dateien durchsucht.

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

Im Zahnradmenü **Set up Codex MCP connection**, **Set up Claude MCP connection**
oder **Set up Cursor MCP connection** wählen. Danach die gewünschte **`.cjs`-Serverdatei
selbst auswählen**. Diese Dateiauswahl ist für alle drei Einrichtungsbefehle
verpflichtend; die Erweiterung setzt keinen gebündelten Serverpfad automatisch ein.
Für den lokalen MCP-Server brauchst du zusätzlich **Node.js ab Version 20**.
Cursor erhält die Verbindung im Projekt unter `.cursor/mcp.json`.

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
| **Kein Zitierstil wird angezeigt** | [TeX-Installation prüfen und bei Bedarf den Programmpfad einstellen](#wenn-keine-zitierstile-angezeigt-werden). |
| **Eine Datei lässt sich nicht ändern** | Offene Änderungen speichern und den Vorgang erneut starten. |
| **Du brauchst die Fehlermeldung** | **Ansicht → Ausgabe → Zotero LaTeX Assistant** öffnen. |

Alle Zotero-Befehle findest du in der Befehlspalette (**Strg+Umschalt+P**).

**Mehr Details:** [Technische Referenz](docs/REFERENZ.md) ·
[MCP mit Codex und Claude](docs/MCP.md) ·
[Entwicklung starten](docs/REFERENZ.md#entwicklung-starten)

---

## Updates

### Version 0.7.1

- **Schrifterkennung korrigiert:** Lokale Schriftpakete werden einmal ausgewertet,
  ihre ursprünglichen Optionen bleiben erhalten. Präambelpfade werden aus dem
  Projektordner aufgelöst.
- Hauptdateisuche und Schriftauswertung getrennt, Werkzeugbeschreibung gekürzt.

### Version 0.7.0

- **Schriften für TikZ:** Optional `font` mitgeben oder die Schrifteinstellung
  aus der `.tex`-Hauptdatei übernehmen. `texFile` wählt die Hauptdatei ausdrücklich.
- **LuaLaTeX und XeLaTeX:** Benannte Schriften gelten nur für die Grafik;
  das Ergebnis nennt den verwendeten Compiler und die Herkunft der Schrifteinstellung.

### Version 0.6.0

- **TikZ über MCP:** `tikz_render` erstellt `figures/` automatisch, speichert
  bearbeitbare Grafiken und liefert PDF sowie PNG-Vorschau.
- **Bestehende Grafiken ändern:** Änderungen prüfen den vorher gelesenen
  Dateistand; fehlgeschlagene Kompilierungen lassen die Quelle unverändert.

### Version 0.5.0

- **MCP-Einrichtung:** Cursor-Verbindung im Projekt; Serverdatei bei Cursor,
  Codex und Claude ausdrücklich auswählen, mit Prüfung und Abbruch ohne Änderungen.
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
