# Zotero-MCP: Einrichtung in VS Code und Cursor

Der MCP ist ein lokaler Server. Die KI-Anwendung startet ihn mit Node.js.
Du musst ihn nicht zusätzlich im Terminal starten.

## Wo finde ich die Serverdatei?

Im Projekt: **[`dist/mcp/server.cjs`](dist/mcp/server.cjs)**.
Auf deinem Rechner:

```text
/home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs
```

In VS Code mit **Strg+P** öffnen oder **dist → mcp → server.cjs** aufklappen.
Unsere Projekteinstellung hat bisher den gesamten `dist`-Ordner ausgeblendet.
Das ist jetzt für die Serverdatei behoben; gebaute Tests und Hilfsdateien bleiben
ausgeblendet. Die normale Textsuche durchsucht `dist` weiterhin nicht.

Die `server.cjs` enthält die benötigten Laufzeitbibliotheken. Du kannst sie in
einen anderen Ordner kopieren und den Pfad in deiner MCP-Konfiguration ändern.
Falls sie nach einem frischen Checkout fehlt: `npm ci` und `npm run compile`
im Repository ausführen. Im installierten Erweiterungspaket liegt sie ebenfalls
unter `dist/mcp/server.cjs` innerhalb des Erweiterungsordners.

## Welche Angaben brauche ich?

| Feld | Wert für deinen Rechner |
| --- | --- |
| Name | `zotero_latex_assistant` |
| Typ / Transport | **STDIO**, lokaler Befehlsserver |
| Command / Programm | `/usr/bin/node` |
| Args / Argumente | `["/home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs"]` |
| URL, Token, zusätzliche Umgebungsvariablen | Für diese Verbindung nicht erforderlich |

Falls der Dialog einen einzigen Startbefehl verlangt:

```sh
/usr/bin/node /home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs
```

Node.js 20+ ist nötig; auf diesem Rechner ist Version 22 installiert.
Für Bibliothekszugriff Zotero auf demselben Rechner starten und unter
**Einstellungen → Erweitert** die Kommunikation mit anderen Anwendungen erlauben.
Lokales Lesen braucht keinen Zotero-API-Key. Neue Kandidaten kann PubCheck auch
ohne laufendes Zotero prüfen.

## VS Code mit Copilot

Diese Einrichtung gilt für den **Copilot-Chat**. Für den Codex-Chat den nächsten
Abschnitt verwenden.

### Schritt für Schritt durch „MCP: Add Server“

1. **Strg+Umschalt+P** drücken, **MCP: Add Server** auswählen und **Enter** drücken.
2. Im Dialog **„Choose the type of MCP server to add“** die erste Zeile
   **„Command (stdio)“** auswählen und **Enter** drücken.
3. Im nächsten Feld für den Startbefehl **diese komplette Zeile** einfügen
   und mit **Enter** bestätigen:

   ```text
   /usr/bin/node /home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs
   ```

4. Wenn VS Code nach dem Servernamen bzw. der Server-ID fragt,
   **`zotero_latex_assistant`** eingeben und **Enter** drücken.
5. Als Speicherort die **globale bzw. Benutzerkonfiguration** wählen, damit der
   Server in allen Projekten verfügbar ist. Je nach VS-Code-Version heißt diese
   Auswahl beispielsweise **Copilot Global**, **Global** oder **User Settings**.
   Für die Beschränkung auf den geöffneten Ordner stattdessen **Workspace** wählen.
   Wenn sich die Konfigurationsdatei öffnet, sicherstellen, dass sie gespeichert ist.
6. Wieder **Strg+Umschalt+P → MCP: List Servers** aufrufen,
   **zotero_latex_assistant** auswählen und **Start / Start Server** wählen,
   sofern er noch nicht läuft. Eine angezeigte Vertrauensabfrage bestätigen.
7. **Zotero starten** und die lokale Kommunikation erlauben. Den **Copilot-Chat**
   öffnen, **Agent-Modus** wählen und die Zotero-Werkzeuge im Werkzeugmenü
   aktivieren, falls sie abgewählt sind. Dann schreiben:

   > Nutze den Zotero-MCP und zeige mir meine Bibliotheken und Sammlungen.

Wenn die KI die Bibliotheken auflistet, funktioniert die Verbindung. Scheitert
der Start, über **MCP: List Servers → zotero_latex_assistant → Show Output**
die Fehlermeldung öffnen.

### Alternative: Konfigurationsdatei selbst anlegen

Du kannst den Einrichtungsdialog auch durch die Datei `.vscode/mcp.json`
im Schreibprojekt ersetzen:

```json
{
  "servers": {
    "zotero_latex_assistant": {
      "type": "stdio",
      "command": "/usr/bin/node",
      "args": ["/home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs"]
    }
  }
}
```

Anschließend mit **Schritt 6 und 7 oben** fortfahren. Für eine manuelle Einrichtung
in allen Projekten **MCP: Open User Configuration** verwenden.

Aktuelle VS-Code-Versionen bieten auch `.mcp.json` mit `mcpServers` als bevorzugtes
portables Format an. Das oben gezeigte `.vscode/mcp.json` mit `servers` wird weiterhin
unterstützt. Bei vorhandenen Dateien andere Servereinträge erhalten.
[Offizielle VS-Code-Anleitung](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## VS Code mit der Codex-Erweiterung

Codex hat eigene MCP-Einstellungen. Unsere installierte Zotero-Erweiterung bietet
**Zotero: Set up Codex MCP connection** in der Befehlspalette und im Zahnradmenü
der Zotero-Seitenleiste. Dieser vorhandene Befehl richtet den Server für den
ausgewählten Projektordner ein.

Für die manuelle, projektübergreifende Einrichtung folgenden Abschnitt in
`/home/finn/.codex/config.toml` ergänzen bzw. einen gleichnamigen Abschnitt aktualisieren:

```toml
[mcp_servers.zotero_latex_assistant]
command = "/usr/bin/node"
args = ["/home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs"]
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Danach die Codex-Erweiterung neu starten. Aktuelle Versionen bieten auch
**Zahnrad → MCP servers → Add server** für die Angaben aus der Tabelle.
Die Copilot-Konfiguration allein richtet Codex nicht ein.
[OpenAI Docs zur Codex-MCP-Einrichtung](https://developers.openai.com/codex/mcp).

## Cursor

Die MCP-Verwaltung unter **Customize / MCP** öffnen und den Server als lokalen
**STDIO-/Command-Server** mit den Angaben aus der Tabelle hinzufügen.
Wenn Cursor eine Konfigurationsdatei öffnet, folgenden Eintrag verwenden.
Für alle Projekte: `/home/finn/.cursor/mcp.json`.
Für ein einzelnes Projekt: `.cursor/mcp.json` innerhalb des Projekts.

```json
{
  "mcpServers": {
    "zotero_latex_assistant": {
      "type": "stdio",
      "command": "/usr/bin/node",
      "args": ["/home/finn/CodeProjekte/zotero-latex-assistant/dist/mcp/server.cjs"]
    }
  }
}
```

Bei vorhandener Konfiguration nur den Servereintrag ergänzen. Server aktivieren
bzw. Cursor neu starten und im **lokalen Agent-Chat** verwenden.
**Cursor verwendet `mcpServers`; die VS-Code-Datei oben verwendet `servers`.**
`http://localhost:23119/api/` ist die Zotero-Schnittstelle und gehört nicht in
das MCP-URL-Feld. Unser Server braucht den lokalen Startbefehl.
[Offizielle Cursor-Anleitung](https://cursor.com/docs/mcp).

## Test und erste Nutzung

Im jeweiligen KI-Chat schreiben:

> Prüfe mit zotero_get_context den Zotero-MCP und zeige mir meine Bibliotheken und Sammlungen.

Danach beispielsweise:

> Nutze meine Sammlung Bachelorarbeit und recherchiere Quellen zum Thema X. Prüfe neue Kandidaten mit PubCheck vor dem Import. Stelle widersprüchliche und ungeklärte Quellen mit Begründung zurück.

Für die Literaturdatei:

> Verwende den geöffneten Schreibprojektordner, prüfe seine Zotero-Konfiguration und ergänze diese Quellen in der vorhandenen .bib. Verwende den nativen Zotero-Export, falls Better BibTeX fehlt.

Die Beispiele starten den MCP ohne feste Projektbindung. Die KI kann den
Schreibprojektordner bei Projektwerkzeugen als `projectPath` mitgeben. Alternativ
`"--project"` und den **absoluten vorhandenen Schreibprojektpfad** als weitere
Argumente ergänzen. Der Serverpfad ist unabhängig vom Schreibprojektordner.

## Wenn es nicht klappt

- **Datei nicht gefunden:** den vollständigen Serverpfad oben prüfen.
- **Kein MCP-Befehl:** eine aktuelle VS-Code-Version und einen aktiven KI-Chat
  verwenden; bei Codex dessen eigene MCP-Einstellungen öffnen.
- **Zotero nicht erreichbar:** Zotero starten und die lokale Kommunikation erlauben.
- **Neue Werkzeuge fehlen:** MCP neu starten; in VS Code gegebenenfalls
  **MCP: Reset Cached Tools** verwenden.
- **Im Terminal erscheint nichts:** der stdio-Server wartet auf die KI-Anwendung;
  die Verbindung im KI-Chat testen.

Mehr Details: [MCP-Werkzeuge](docs/MCP.md) · [Rechercheablauf](docs/RESEARCH_WORKFLOW.md).
