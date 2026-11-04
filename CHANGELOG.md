# Changelog

## 1.0.0 — 4. November 2026

- **Erweiterungsseite:** Eigener Changelog-Tab und kompakte Detailseite mit
  Schnellstart und Lizenz.
- **Literatur im Projekt:** Bibliotheken und Sammlungen durchsuchen, Quellen
  auswählen, direkt zitieren und die Projektbibliografie ausdrücklich aktualisieren.
- **Stabile Zitierschlüssel:** Vorschau, Dublettenprüfung, gesicherte Migration
  und Sicherungen bei Änderungen an Bibliografie und LaTeX-Dateien.
- **Optionale KI-Anbindung:** MCP-Einrichtung für VS Code / Copilot, Codex,
  Claude und Cursor; Recherche, Quellenbearbeitung, Notizen und PDF-Weitergabe.
- **TikZ im LaTeX-Projekt:** Grafiken lokal rendern, PDF und PNG-Vorschau erhalten
  und die Schrift aus dem Hauptdokument übernehmen oder ausdrücklich wählen.
- **Lizenzen ergänzt:** Eigener Code unter MIT; vollständige Fremdlizenztexte
  und CSL-Herkunftshinweise mit automatischer Prüfung beim Paketbau.
- **Build-Abhängigkeiten aktualisiert:** Gemeldete Sicherheitslücken im
  Paketierungswerkzeug und seinen Abhängigkeiten behoben.

## 0.7.2

- **VS Code / Copilot:** Projektbezogene MCP-Einrichtung über die Erweiterung.
- **MCP-Einrichtung vereinheitlicht:** Befehle für VS Code / Copilot, Codex,
  Claude und Cursor mit selbst gewählter Serverdatei.

## 0.7.1

- **Schrifterkennung korrigiert:** Lokale Schriftpakete werden einmal ausgewertet,
  ihre ursprünglichen Optionen bleiben erhalten. Präambelpfade werden aus dem
  Projektordner aufgelöst.
- Hauptdateisuche und Schriftauswertung getrennt, Werkzeugbeschreibung gekürzt.

## 0.7.0

- **Schriften für TikZ:** Optional `font` mitgeben oder die Schrifteinstellung
  aus der `.tex`-Hauptdatei übernehmen. `texFile` wählt die Hauptdatei ausdrücklich.
- **LuaLaTeX und XeLaTeX:** Benannte Schriften gelten nur für die Grafik;
  das Ergebnis nennt den verwendeten Compiler und die Herkunft der Schrifteinstellung.

## 0.6.0

- **TikZ über MCP:** `tikz_render` erstellt `figures/` automatisch, speichert
  bearbeitbare Grafiken und liefert PDF sowie PNG-Vorschau.
- **Bestehende Grafiken ändern:** Änderungen prüfen den vorher gelesenen
  Dateistand; fehlgeschlagene Kompilierungen lassen die Quelle unverändert.

## 0.5.0

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
