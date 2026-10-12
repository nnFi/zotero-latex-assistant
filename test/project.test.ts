import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CONFIG_FILE, discoverBibFile, newProjectConfig, parseProjectConfig, projectPath, readProjectConfig, saveProjectConfig, validateBibFile, withProjectLibrary, writeProjectText } from "../src/config/project";
import type { ProjectConfig } from "../src/shared/types";
import { listInstalledStyles, parseStyle } from "../src/zotero/styles";

const config: ProjectConfig = { version: 1, library: { type: "group", id: 42 }, collectionKey: "ROOT0001",
  bibFile: "quellen/referenzen.bib", citationStyle: "http://www.zotero.org/styles/apa", citationCommand: "parencite", importedItemKeys: ["ITEM0001"], serverId: "database-A" };

async function inProject(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "zotero-project-"));
  try { await action(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("Versteckte Projektkonfiguration behält Gruppe, Sammlung, Stil, .bib und Importbestand über Neustarts", async () => {
  await inProject(async (root) => {
    assert.equal(await readProjectConfig(root), undefined);
    await saveProjectConfig(root, config);
    assert.deepEqual(await readProjectConfig(root), config);
    assert.match(await readFile(path.join(root, CONFIG_FILE), "utf8"), /referenzen.bib/);
  });
});

test("Beschädigte Konfiguration wird abgewiesen und nicht durch Defaults ersetzt", async () => {
  const invalid = [null, { ...config, version: 2 }, { ...config, library: { type: "group", id: 0 } },
    { ...config, importedItemKeys: ["../file"] }, { ...config, importedItemKeys: ["ITEM0001", "ITEM0001"] },
    { ...config, citationCommand: "exec" }, { ...config, collectionKey: "../../../" }];
  for (const value of invalid) assert.throws(() => parseProjectConfig(value));
  await inProject(async (root) => {
    await mkdir(path.join(root, ".zotero"));
    await writeFile(path.join(root, CONFIG_FILE), "{invalid");
    await assert.rejects(readProjectConfig(root));
    assert.equal(await readFile(path.join(root, CONFIG_FILE), "utf8"), "{invalid");
  });
});

test("Bib-Dateipfade erlauben Unterordner, aber keine absoluten Pfade oder Traversals", () => {
  assert.equal(validateBibFile("quellen/referenzen.bib"), "quellen/referenzen.bib");
  for (const value of ["../references.bib", "/tmp/a.bib", "C:\\a.bib", "a/../b.bib", "a//b.bib", ".zotero/a.bib", "a.txt", "a\0.bib", "a/./b.bib"]) {
    assert.throws(() => validateBibFile(value));
  }
});

test("Projektdateien dürfen nicht über Symlinks außerhalb des Projekts geschrieben werden", async () => {
  await inProject(async (root) => inProject(async (outside) => {
    await symlink(outside, path.join(root, ".zotero"), "dir");
    await assert.rejects(saveProjectConfig(root, config), /symlink/);
    await assert.rejects(projectPath(root, "../escaped.bib"));
    await symlink(outside, path.join(root, "references"), "dir");
    await assert.rejects(writeProjectText(root, "references/a.bib", "test", undefined), /symlink/);
  }));
});

test("Zwischenzeitliche Dateiänderungen verhindern ein Überschreiben", async () => {
  await inProject(async (root) => {
    await writeProjectText(root, "references.bib", "original", undefined);
    await writeFile(path.join(root, "references.bib"), "changed");
    await assert.rejects(writeProjectText(root, "references.bib", "export", "original"), /in the meantime/);
    assert.equal(await readFile(path.join(root, "references.bib"), "utf8"), "changed");
    await assert.rejects(saveProjectConfig(root, config, "unexpected old config"), /in the meantime/);
  });
});

test("Nicht auflösbare Symlinks dürfen keine neuen Dateien außerhalb des Projekts erzeugen", async () => {
  await inProject(async (root) => inProject(async (outside) => {
    await symlink(path.join(outside, "missing"), path.join(root, ".zotero"), "dir");
    await assert.rejects(saveProjectConfig(root, config), /unresolvable symlink/);
    await assert.rejects(readFile(path.join(outside, "missing/config.json")), { code: "ENOENT" });
  }));
});

test("Eine eindeutige Bib-Datei wird automatisch erkannt; mehrere Dateien brauchen eine Auswahl", () => {
  assert.equal(discoverBibFile(["refs.bib"], []), "refs.bib");
  assert.equal(discoverBibFile(["a.bib", "b.bib"], []), undefined);
  assert.equal(discoverBibFile([], []), undefined);
});

test("LaTeX-Importreferenzen bestimmen die passende Bib-Datei statt einer geratenen Standarddatei", () => {
  const files = ["a.bib", "quellen/referenzen.bib"];
  assert.equal(discoverBibFile(files, [{ path: "main.tex", text: "\\addbibresource[location=local]{quellen/referenzen.bib}" }]), "quellen/referenzen.bib");
  assert.equal(discoverBibFile(files, [{ path: "quellen/chapter.tex", text: "\\bibliography{referenzen}" }]), "quellen/referenzen.bib");
  assert.equal(discoverBibFile(files, [{ path: "main.tex", text: "% \\addbibresource{a.bib}\n\\addbibresource{quellen/referenzen.bib}" }]), "quellen/referenzen.bib");
  assert.equal(discoverBibFile(files, [{ path: "main.tex", text: "\\bibliography{a,quellen/referenzen}" }]), undefined);
});

test("Bib discovery ignores inline and block code examples while retaining real resource references", () => {
  const files = ["example.bib", "real.bib"];
  const examples = ['\\verb|\\addbibresource{example.bib}|', '\\verb*+\\bibliography{example}+',
    ...["verbatim", "verbatim*", "Verbatim", "Verbatim*", "lstlisting", "minted"].map((environment) =>
      `\\begin{${environment}}\n\\addbibresource{example.bib}\n\\end{${environment}}`)];
  for (const example of examples) {
    assert.equal(discoverBibFile(files, [{ path: "main.tex", text: example }]), undefined);
    assert.equal(discoverBibFile(files, [{ path: "main.tex", text: `${example}\n\\addbibresource{real.bib}` }]), "real.bib");
  }
});

test("Bib discovery respects escaped commands and percent signs instead of reading commented examples", () => {
  const files = ["example.bib", "real.bib"];
  for (const example of ['\\\\addbibresource{example.bib}', '\\\\% \\addbibresource{example.bib}', '\\addbibresourceExample{example.bib}']) {
    assert.equal(discoverBibFile(files, [{ path: "main.tex", text: `${example}\n\\bibliography{real}` }]), "real.bib");
  }
  assert.equal(discoverBibFile(files, [{ path: "main.tex", text: '\\% \\addbibresource{real.bib}' }]), "real.bib");
  assert.equal(discoverBibFile(files, [{ path: "main.tex", text: '\\\\\\addbibresource{real.bib}' }]), "real.bib");
});

test("Bib discovery parses commented command boundaries, nested options and literal comma filenames", () => {
  assert.equal(discoverBibFile(["example.bib", "real.bib"], [{ path: "main.tex",
    text: '\\addbibresource % resource options follow\n [label={x]y}] % filename follows\n {real.bib}' }]), "real.bib");
  assert.equal(discoverBibFile(["example.bib", "real.bib"], [{ path: "main.tex",
    text: '\\addbibresource[location=remote]{example.bib}\n\\addglobalbib{real.bib}' }]), "real.bib");
  assert.equal(discoverBibFile(["a.bib", "b.bib", "a,b.bib"], [{ path: "main.tex", text: '\\addsectionbib{a,b.bib}' }]), "a,b.bib");
  assert.equal(discoverBibFile(["a.bib", "b.bib"], [{ path: "main.tex", text: '\\bibliography{a,% second resource\n b}' }]), undefined);
});

test("Incomplete TeX leaves automatic discovery undecided so the user can still select a .bib explicitly", () => {
  for (const text of ['\\verb|\\addbibresource{real.bib}', '\\begin{verbatim}\n\\addbibresource{real.bib}',
    '\\addbibresource[label={unfinished]{real.bib}', '\\addbibresource{real.bib']) {
    assert.equal(discoverBibFile(["real.bib"], [{ path: "main.tex", text }]), undefined);
  }
});

test("Installierte CSL-Stile werden aus dem lokalen Stilordner einschließlich eigener Titel gelesen", async () => {
  await inProject(async (root) => {
    await writeFile(path.join(root, "custom.csl"), '<style><info><title>Eigener Stil &amp; mehr</title><id>http://example.org/custom</id></info></style>');
    await writeFile(path.join(root, "apa.csl"), '<style><info><title>APA</title><id>http://www.zotero.org/styles/apa</id></info></style>');
    await mkdir(path.join(root, "hidden"));
    await writeFile(path.join(root, "hidden/parent.csl"), '<style><info><title>Hidden</title><id>parent</id></info></style>');
    assert.deepEqual((await listInstalledStyles(root)).map((entry) => entry.title), ["APA", "Eigener Stil & mehr"]);
    assert.equal(parseStyle("<style></style>"), undefined);
  });
});

test("Bib-Datei kann vor der Bibliothekszuordnung gespeichert werden und bleibt beim späteren Verbinden erhalten", async () => {
  await inProject(async (root) => {
    const partial = { ...newProjectConfig("textcite"), bibFile: "quellen/referenzen.bib", citationStyle: "apa" };
    await saveProjectConfig(root, partial);
    const restored = (await readProjectConfig(root))!;
    assert.equal(restored.library, null);
    assert.equal(restored.bibFile, "quellen/referenzen.bib");
    const connected = withProjectLibrary(restored, { type: "group", id: 42 }, "ROOT0001", "database-A");
    await saveProjectConfig(root, connected, await readFile(path.join(root, CONFIG_FILE), "utf8"));
    assert.deepEqual(await readProjectConfig(root), { ...partial, library: { type: "group", id: 42 }, collectionKey: "ROOT0001", serverId: "database-A" });
  });
});

test("Bibliothek kann ohne Bib-Datei und ohne Stil gespeichert werden; die Bib-Auswahl verändert diese Zuordnung nicht", async () => {
  await inProject(async (root) => {
    const connected = withProjectLibrary(newProjectConfig(), { type: "user", id: 0 }, "ROOT0001");
    await saveProjectConfig(root, connected);
    const restored = (await readProjectConfig(root))!;
    assert.equal(restored.bibFile, "");
    assert.equal(restored.citationStyle, "");
    const selectedBib = { ...restored, bibFile: "references.bib" };
    await saveProjectConfig(root, selectedBib, await readFile(path.join(root, CONFIG_FILE), "utf8"));
    assert.deepEqual((await readProjectConfig(root))?.library, { type: "user", id: 0 });
    assert.equal((await readProjectConfig(root))?.collectionKey, "ROOT0001");
  });
});

test("Bibliothekswechsel behält Bib-Pfad und Zitieroptionen bei; importierte Zitationen bleiben geschützt", () => {
  const emptyImports = { ...config, importedItemKeys: [] };
  const switched = withProjectLibrary(emptyImports, { type: "user", id: 0 }, "");
  assert.equal(switched.bibFile, config.bibFile);
  assert.equal(switched.citationStyle, config.citationStyle);
  assert.equal(switched.citationCommand, config.citationCommand);
  assert.equal(switched.serverId, undefined);
  assert.throws(() => withProjectLibrary(config, { type: "user", id: 0 }, ""), /already contains imported sources/);
  assert.deepEqual(withProjectLibrary(config, config.library!, config.collectionKey, config.serverId), config);
});

test("Sammlungswechsel innerhalb derselben Bibliothek erhält importierte Quellen und alle Zitieroptionen", async () => {
  await inProject(async (root) => {
    const tracked = { ...config, citationKeys: { ITEM0001: "Mueller2024" } };
    await saveProjectConfig(root, tracked);
    await mkdir(path.join(root, "quellen"));
    const bibliography = "@book{Mueller2024,title={Keep existing fields}}\n";
    await writeFile(path.join(root, tracked.bibFile), bibliography);
    for (const collectionKey of ["CHILD001", "", "ROOT0001"]) {
      const current = (await readProjectConfig(root))!;
      const next = withProjectLibrary(current, tracked.library!, collectionKey, tracked.serverId);
      assert.deepEqual(next, { ...tracked, collectionKey });
      await saveProjectConfig(root, next, await readFile(path.join(root, CONFIG_FILE), "utf8"));
      assert.equal(await readFile(path.join(root, tracked.bibFile), "utf8"), bibliography);
    }
  });
});

test("Eine andere Zotero-Datenbank bleibt bei importierten Quellen auch innerhalb derselben Bibliothek gesperrt", () => {
  assert.throws(() => withProjectLibrary(config, config.library!, "CHILD001", "database-B"), /different library or Zotero database/);
  assert.throws(() => withProjectLibrary(config, config.library!, "CHILD001"), /different library or Zotero database/);
});

test("Unvollständige Einrichtung erlaubt keine verwaisten Sammlungen, Importbestände oder Server-IDs", () => {
  for (const value of [{ ...newProjectConfig(), collectionKey: "ROOT0001" },
    { ...newProjectConfig(), importedItemKeys: ["ITEM0001"] }, { ...newProjectConfig(), serverId: "database-A" }]) {
    assert.throws(() => parseProjectConfig(value), /library binding/);
  }
  assert.deepEqual(parseProjectConfig(newProjectConfig()), newProjectConfig());
});
