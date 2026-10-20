# Projektstatus

Stand: 20. Oktober 2026 · Version 0.7.1

## Umgesetzt

- Zotero-Bibliotheken und Sammlungen durchsuchen, Projekt zuordnen und Quellen auswählen.
- BibLaTeX einrichten, zitieren und die `.bib` abgleichen; stabile Schlüssel, Dublettenprüfung, Vorschau und Sicherungen. Automatische MacTeX-Pfadsuche ergänzt.
- Lokaler MCP für Recherche, Quellen, Notizen, Sammlungen und PDFs; Einrichtung für Codex, Claude und Cursor mit selbst gewählter Serverdatei.
- DOI-/ISBN-Import, PubCheck und Zitationszahlen; PDF-Weitergabe ohne lokale Textextraktion oder OCR.
- Extension-Detailseite mit eingebundenen Anleitungen und internen Links; alle sechs Review-Befunde F1–F6 behoben.
- Neuer MCP-Endpunkt `tikz_render`: lokale TikZ-Kompilierung, automatische Ablage in `figures/`, PDF/PNG im Cache und direkte PNG-Vorschau; explizite Projektwahl und Hashschutz für Änderungen.
- Optionale TikZ-Schriftwahl oder Übernahme aus der `.tex`-Hauptdatei; LuaLaTeX und XeLaTeX ergänzt. Die Schriftauswahl bleibt auf die Grafik begrenzt.

## Offen

- Architekturdokumentation an den aktuellen Stand anpassen.
- OpenAlex und Unpaywall nach Prüfung der API-Bedingungen anbinden.
- PDF-Analyse mit nachvollziehbaren Fundstellen und transparenter Modellanbindung ausbauen.
- Weitere MCP-Werkzeuge bei Bedarf: bestehende Quellen Sammlungen zuordnen, BibTeX-Import, Editoraktionen und Änderungsprotokoll.

## Prüfstand

Letzter protokollierter Gesamtlauf: **583 Tests bestanden** (20. Oktober 2026), einschließlich TikZ-Datei-, Fehler-, Pfad-, Parallelzugriffs-, Prozess- und Schrifterkennungsprüfungen.
Manuelle Prüfungen der damaligen VSIX, Better BibTeX und KI-Clients wurden am 12. Oktober vom Benutzer bestätigt.
Am 15. Oktober: Build, Dokumentationslinks und gezielte Stil-/Bundle-Tests; MacTeX-Erkennung simuliert unter Linux geprüft. Echte macOS-/Windows-Tests offen.
Am 20. Oktober: TikZ mit echtem gebündeltem stdio-MCP, pdfLaTeX und Poppler unter Linux geprüft; automatische Ordneranlage, Inline-Vorschau, PGFPlots, explizite Änderungen und Einbindung in ein LaTeX-Dokument erfolgreich. Vorschauen visuell geprüft.
Refactoring der Schrifterkennung: Projektpfade und einmaliges Paketladen mit echten LaTeX-Prozessen bestätigt; Regressionstests prüfen auch wiederholtes `\input` und Paketoptionen.

Anleitungen: [README](README.md) · [MCP](docs/MCP.md) · [Referenz](docs/REFERENZ.md).
Die bisherige Historie liegt unverändert in `docs/archive/PROJEKTSTATUS-2026-10-12.md`.
