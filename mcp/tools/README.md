# MCP-Werkzeuge (geplant, Phase 4–6)

Noch keine Werkzeuge implementiert. Der Server soll `src/zotero`, `src/pdf`
und `src/research` verwenden, ohne die VS-Code-API zu importieren.

Lesezugriff: `zotero_list_libraries`, `zotero_list_collections`,
`zotero_get_selected_collection`, `zotero_search`, `zotero_get_metadata`,
`zotero_list_attachments`, `zotero_get_fulltext`, `zotero_read_pdf_pages`.

Recherche: `zotero_search_external`, `zotero_lookup_doi`,
`zotero_check_duplicates`, `zotero_find_evidence`.

Schreibzugriff: `zotero_create_item`, `zotero_update_item`,
`zotero_add_to_collection`, `zotero_attach_pdf`, `zotero_import_bibtex`.

Die native Aktion **Zotero: Zitieren …** ist bereits implementiert.
Ein MCP-Werkzeug `zotero_insert_citation` und die Editorbrücke sind noch nicht vorhanden.
Ein eigenständiger stdio-Server hat ohne explizite Brücke keinen Zugriff auf den Editor.
Die Zuständigkeit von `zotero_import_bibtex` (Zotero-Import oder Projekt-`.bib`)
muss vor der Umsetzung eindeutig definiert werden.

Alle späteren Werkzeuge benötigen Eingabeschema, strukturierte Ergebnisse und
nachvollziehbare Fehler. Schreibwerkzeuge benötigen eine ausgewählte Sammlung,
Duplikatprüfung und explizite Freigabe; Zugangsdaten gehören in SecretStorage.
