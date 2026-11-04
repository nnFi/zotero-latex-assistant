# Projektstatus

Stand: 4. November 2026 · Quellversion 1.0.0 · Release vorbereitet

## Release 1.0.0

- Versionsangaben in `package.json`, `package-lock.json` und `src/shared/version.ts`
  auf `1.0.0` gesetzt; Release-Notizen in der README ergänzt.
- Publisher-ID auf `finn-plassmeier` und Autor auf Finn Plaßmeier gesetzt.
  Der Extension-Host-Test liest die Extension-ID aus der Paketkonfiguration.
- Manuelle Release-Abnahme vom Benutzer bestätigt: Installation, Kernabläufe und
  MCP-Einrichtung passen; die zuvor offenen Windows-/macOS-Prüfungen sind erledigt.
- Eigener Code und Dokumentation unter MIT lizenziert. Vollständige Fremdlizenzen
  einschließlich bereits ins MCP-SDK eingebauter Bibliotheken und CSL-Daten erfasst.
  Lizenzprüfung und Einbettung der Hinweise in künftige Pakete vorbereitet.
- Sicherheitsmeldungen der Build-Abhängigkeiten bereinigt: `@vscode/vsce` auf
  `4.1.0`, `@azure/identity` auf `4.14.1`, `@azure/msal-node` auf `7.1.2` und `qs`
  auf `6.17.1` aktualisiert. Für `@vscode/vsce` wird gezielt `minimatch@11.0.4`
  vorgegeben, da dessen regulärer Versionsbereich noch die betroffene 10er-Reihe
  verwendet. Diese Vorgabe beim nächsten Upstream-Update erneut prüfen.
  Die Laufzeit-Abhängigkeiten bleiben unverändert.
- **Noch kein Build oder Release von 1.0.0.** Auf ausdrücklichen Benutzerwunsch
  bleiben `zotero-latex-assistant-latest.vsix` und `mcp-latest.cjs` unverändert auf
  `0.7.2`. Neubau erst nach ausdrücklicher Freigabe.

## Umgesetzt

- Zotero-Bibliotheken und Sammlungen durchsuchen, Projekt zuordnen und Quellen auswählen.
- BibLaTeX einrichten, zitieren und die `.bib` abgleichen; stabile Schlüssel, Dublettenprüfung, Vorschau und Sicherungen. Automatische MacTeX-Pfadsuche ergänzt.
- Lokaler MCP für Recherche, Quellen, Notizen, Sammlungen und PDFs; Einrichtung für VS Code / Copilot, Codex, Claude und Cursor mit selbst gewählter Serverdatei.
- DOI-/ISBN-Import, PubCheck und Zitationszahlen; PDF-Weitergabe ohne lokale Textextraktion oder OCR.
- Extension-Detailseite mit eingebundenen Anleitungen und internen Links; alle sechs Review-Befunde F1–F6 behoben.
- Neuer MCP-Endpunkt `tikz_render`: lokale TikZ-Kompilierung, automatische Ablage in `figures/`, PDF/PNG im Cache und direkte PNG-Vorschau; explizite Projektwahl und Hashschutz für Änderungen.
- Optionale TikZ-Schriftwahl oder Übernahme aus der `.tex`-Hauptdatei; LuaLaTeX und XeLaTeX ergänzt. Die Schriftauswahl bleibt auf die Grafik begrenzt.

## Vor der Veröffentlichung

- Nach Freigabe den vollständigen Testlauf und `npm run package` für den
  vorbereiteten Stand ausführen. VSIX und eigenständigen MCP-Server auf Version
  `1.0.0`, Paketinhalt und Lizenztexte prüfen und gemeinsam mit den Änderungen
  committen. Bis dahin bleiben die Pakete auf `0.7.2`.
- Für eine Marketplace-Veröffentlichung sicherstellen, dass die eingetragene
  Publisher-ID `finn-plassmeier` zum eigenen Marketplace-Publisher-Konto gehört.
  Die Kontoanlage bzw. Zuordnung wurde durch die lokale Konfiguration nicht geprüft.

## Spätere Erweiterungen

- Architekturdokumentation an den aktuellen Stand anpassen.
- OpenAlex und Unpaywall nach Prüfung der API-Bedingungen anbinden.
- PDF-Analyse mit nachvollziehbaren Fundstellen und transparenter Modellanbindung ausbauen.
- Weitere MCP-Werkzeuge bei Bedarf: bestehende Quellen Sammlungen zuordnen, BibTeX-Import, Editoraktionen und Änderungsprotokoll.

## Prüfstand

- **4. November, vor den Lizenz- und Versionsänderungen:** Vollständiger
  automatisierter Lauf mit **585 bestandenen Tests**, ohne übersprungene Tests.
  Paketbau und Dokumentationslinks erfolgreich; eingecheckte VSIX und
  eigenständiger MCP-Server entsprachen dem geprüften Build von `0.7.2`.
- **4. November:** Echter TikZ-Durchlauf mit dem eigenständigen MCP-Server,
  pdfLaTeX und Poppler unter Linux erfolgreich: automatische Ordneranlage,
  Inline-PNG, PDF, PGFPlots, Fehlermeldungen, Schutz bestehender Dateien,
  ausdrückliche Änderungen und Einbindung in ein LaTeX-Dokument.
- **Nach den Lizenzänderungen:** Sechs gezielte Lizenztests, Lizenzprüfung und
  beide TypeScript-Prüfungen ohne Dateiausgabe erfolgreich. Die Dateiliste des
  künftigen VSIX enthält alle 16 Lizenzdateien. Es wurde kein neues Paket gebaut.
- **Nach den Sicherheitsupdates:** `npm audit` meldet **0 bekannte Schwachstellen**
  im gesamten Abhängigkeitsbaum (zuvor fünf betroffene Pakete: zwei hoch, drei mittel).
  Beide TypeScript-Prüfungen, Lizenzprüfung und sechs Lizenztests erfolgreich.
  `vsce 4.1.0` startet; seine Paket-Dateiliste umfasst unverändert dieselben
  39 Dateien. Die bestehenden VSIX- und MCP-Dateien wurden nicht neu gebaut.
- Die manuelle Release-Abnahme einschließlich der zuvor offenen Plattformtests
  wurde am 4. November vom Benutzer bestätigt. Frühere manuelle Prüfungen der
  VSIX, Better BibTeX und KI-Clients sind seit dem 12. Oktober dokumentiert.
- Der vollständige Testlauf und die Prüfung der neu gebauten Pakete von `1.0.0`
  stehen bis zur Build-Freigabe aus.

Anleitungen: [README](README.md) · [MCP](docs/MCP.md) · [Referenz](docs/REFERENZ.md).
Die bisherige Historie liegt unverändert in `docs/archive/PROJEKTSTATUS-2026-10-12.md`.
