# License inventory

The project's own code and documentation use the MIT license in `../LICENSE`.
Third-party licenses are preserved separately; in particular, the CSL locale
data in `src/zotero/localeTerms.ts` remain CC BY-SA 3.0.

`components.json` records the reviewed library versions and provenance of the
verbatim license texts in this directory. The SDK's own license includes an
Apache-2.0/MIT transition notice; it must not be shortened to Apache-2.0 alone.
The entries for content-type, Ajv, ajv-formats, fast-deep-equal, fast-uri and
json-schema-traverse cover dependencies already bundled by the SDK. Their
versions were identified in the SDK's published source maps. The SDK also
includes its own core-internal source code under its upstream license.

The installed packages' licenses were copied from their distributed LICENSE
files. The prebundled dependencies' original texts were retrieved from the
version-specific upstream URLs recorded in `components.json`.
`CC-BY-SA-3.0.txt` is the SPDX text copy retrieved from
https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-SA-3.0.txt;
the canonical license is https://creativecommons.org/licenses/by-sa/3.0/.

To check or regenerate the consolidated document without building anything:

```sh
npm run licenses:check
node scripts/licenses.cjs --write
```

On dependency updates, review upstream license and NOTICE files, update the
inventory and saved texts, then regenerate `THIRD-PARTY-NOTICES.md`.
The bundle step checks installed versions and license texts, rejects unreviewed
bundled components, and embeds the project's license plus all third-party
notices in both JavaScript bundles. The full texts remain available offline,
including when the standalone server is copied on its own. Upstream build
changes and the CSL extraction are identified in the notices.

The VSIX must include LICENSE, THIRD-PARTY-NOTICES.md, licenses/ and
media/CSL-LOCALES-NOTICE.md. Build tools that are not distributed and programs
installed independently by the user are outside this shipped-code inventory.
