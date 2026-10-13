import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { newProjectConfig, readProjectConfig, readProjectText, saveProjectConfig } from "../src/config/project";

// The real bundled stdio server talks to a deterministic local-API test double
// in its own process. No network or Zotero installation is needed for this test.
const mock = String.raw`
const h={"Zotero-API-Version":"3","Zotero-Server-ID":"db-A"};
let saved;
let savedNote;
const collections=new Map([["COLL2345",{key:"COLL2345",version:1,data:{name:"Fixture",parentCollection:false}}]]);
let addedAttachment, uploadedBytes;
let rejectedSourceKey, rejectedPdfKey;
const uploadKey="U".repeat(32);
const attachment={key:"PDF12345",version:1,data:{itemType:"attachment",parentItem:"",title:"Attached PDF",filename:"fixture.pdf",contentType:"application/pdf",linkMode:"imported_file"}};
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input)); const p=u.pathname;
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:h});
 if(u.hostname==="pubcheck.net") {
   const query=JSON.parse(init.body).query;
   const title=query.match(/\btitle = \{([^}]*)\}/)?.[1]||"";
   const doi=query.match(/\bdoi = \{([^}]*)\}/)?.[1]||null;
   const isbn=query.match(/\bisbn = \{([^}]*)\}/)?.[1]||null;
   return json({verification:{verdict:title==="Mismatching candidate"?"METADATA_MISMATCH":"VERIFIED",citation:{title,doi,isbn},
     compared_fields:["title","authors","year","doi","isbn","journal"],reasons:["provider evidence"],resolved:{title,doi,isbn,source:"crossref"}}});
 }
 if(u.hostname==="api.crossref.org"){
   if(p.endsWith("isbn-format")) return json({message:{DOI:"10.1234/isbn-format",ISBN:["9783030854355","9783030854362"],"is-referenced-by-count":41}});
   if(u.searchParams.has("filter")) return json({message:{"total-results":1,items:[{DOI:"10.1234/isbn-book",type:"book",ISBN:["9780306406157"],title:[saved?.title||"External ISBN publication"],"is-referenced-by-count":17}]}});
   if(p.endsWith("stdio-thesis")) return json({message:{DOI:"10.1234/stdio-thesis",type:"dissertation",title:["Protocol thesis"],publisher:"Commercial Publisher",institution:[{name:"Actual University"}]}});
   if(p.endsWith("stdio-report")) return json({message:{DOI:"10.1234/stdio-report",type:"report",title:["Protocol report"],publisher:"External Repository"}});
   if(p.endsWith("stdio-datacite")) return json({},404);
   return json({message:{DOI:"10.1234/stdio",type:"book",title:["Imported protocol book"],author:[{family:"Tester"}],publisher:"Fixture",issued:{"date-parts":[[2026]]}}});
 }
 if(u.hostname==="api.datacite.org") return json({data:{attributes:{doi:"10.1234/stdio-datacite",types:{resourceTypeGeneral:"Dissertation"},titles:[{title:"Protocol DataCite thesis"}],publisher:{name:"External Repository"},contributors:[{name:"Hosting University",contributorType:"HostingInstitution"}]}}});
 if(u.hostname==="openlibrary.org") return json({"ISBN:9780306406157":{title:"ISBN protocol book",identifiers:{isbn_13:["9780306406157"]}}});
 const item=()=>({key:saved.key,version:saved.version,data:saved});
 if(p==="/api/") return new Response("",{headers:h});
 if(p==="/api/users/0/groups") return json([]);
 if(init?.method==="POST" && p==="/api/users/0/collections"){
   const data=JSON.parse(init.body)[0];const collection={key:data.key,version:1,data};collections.set(data.key,collection);
   return json({successful:{0:collection},failed:{},unchanged:{}});
 }
 if(p==="/api/users/0/collections") return json([...collections.values()]);
 if(p.startsWith("/api/users/0/collections/") && !p.endsWith("/top")){
   const key=p.split("/").at(-1);
   if(init?.method==="DELETE"){collections.delete(key);return new Response(null,{status:204,headers:h});}
   return json(collections.get(key)||{},collections.has(key)?200:404);
 }
 if(p==="/api/itemTypeFields"){
   const type=u.searchParams.get("itemType");
   return json(["title","date","url","extra",...(type==="thesis"?["university"]:type==="report"?["institution"]:["DOI","publisher","ISBN"])].map(field=>({field})));
 }
 if(p==="/api/itemTypeCreatorTypes") return json([{creatorType:"author"}]);
 if(p==="/api/local/authorize") return json({key:"A".repeat(32),remember:false});
 if(p==="/better-bibtex/json-rpc") return json({},404);
 if(p==="/api/local/uploads/"+uploadKey){uploadedBytes=Buffer.from(init.body);return new Response("",{status:201,headers:h});}
 if(init?.method==="POST" && p.endsWith("/file")){
   const params=new URLSearchParams(String(init.body));
   if(params.has("upload")){
     require("node:fs").writeFileSync(process.env.MCP_STORED_PDF,uploadedBytes);
     addedAttachment.data.md5=require("node:crypto").createHash("md5").update(uploadedBytes).digest("hex");addedAttachment.version++;
     return new Response(null,{status:204,headers:h});
   }
   return json({url:"http://localhost:23119/api/local/uploads/"+uploadKey,uploadKey,contentType:"application/pdf",prefix:"",suffix:""});
 }
 if(init?.method==="POST"){
   const data=JSON.parse(init.body)[0];
   if(data.itemType==="note"){
     savedNote={key:data.key,version:1,data};return json({successful:{0:savedNote},failed:{},unchanged:{}});
   }
   if(data.itemType==="attachment"){
     if(!rejectedPdfKey){rejectedPdfKey=data.key;return json({},403);}
     require("node:assert/strict").equal(data.key,rejectedPdfKey);
     addedAttachment={key:data.key,version:12,data};return json({successful:{0:addedAttachment},failed:{},unchanged:{}});
   }
   if(data.title==="MCP protocol test source"){
     if(!rejectedSourceKey){rejectedSourceKey=data.key;return json({},403);}
     require("node:assert/strict").equal(data.key,rejectedSourceKey);
   }
   saved=data;saved.version=11;return json({successful:{0:item()},failed:{},unchanged:{}});
 }
 if(init?.method==="PATCH"){
   if(savedNote && p.endsWith("/"+savedNote.key)){Object.assign(savedNote.data,JSON.parse(init.body));savedNote.version++;}
   else {Object.assign(saved,JSON.parse(init.body));if(saved.deleted===1)saved.deleted=true;saved.version++;}
   return new Response(null,{status:204,headers:h});
 }
 if(p.endsWith("/children")) {
   if(u.searchParams.get("itemType")==="note")return json(savedNote?[savedNote]:[]);
   attachment.data.parentItem=saved.key; return json([attachment,...addedAttachment?[addedAttachment]:[]]);
 }
 if(savedNote && p.endsWith("/"+savedNote.key))return json(savedNote);
 if(addedAttachment && p.endsWith("/"+addedAttachment.key+"/file/view/url")) return new Response(require("node:url").pathToFileURL(process.env.MCP_STORED_PDF).href,{headers:h});
 if(addedAttachment && p.endsWith("/"+addedAttachment.key)) return json(addedAttachment);
 if(p.endsWith("/PDF12345/file/view/url")) return new Response(require("node:url").pathToFileURL(process.env.MCP_FIXTURE_PDF).href,{headers:h});
 if(p.endsWith("/PDF12345")) {attachment.data.parentItem=saved.key; return json(attachment);}
 if(p.endsWith("/trash")) return json(saved?.deleted===true?[item()]:[]);
 if(saved && p.endsWith("/"+saved.key)) {
   if(u.searchParams.get("format")==="biblatex")return new Response("@book{provider,title={Protocol book}}",{headers:h});
   return json(item());
 }
 if(p.endsWith("/top") || p==="/api/users/0/items") return json(saved && !saved.deleted && (!p.includes("/collections/") || saved.collections.includes(p.split("/").at(-3)))?[item()]:[]);
 return json({},404);
};
`;

test("official MCP client exercises local tools and identifier tools over real bundled stdio with structured schemas and safe errors", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-stdio-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveProjectConfig(root, { ...newProjectConfig(), library: { type: "user", id: 0 }, collectionKey: "COLL2345", serverId: "db-A" });
  const server = process.env.ZOTERO_MCP_TEST_SERVER ?? path.resolve(__dirname, "../../dist/mcp/server.cjs");
  const code = mock + String.fromCharCode(10) + `require(${JSON.stringify(server)}).main(["--project",${JSON.stringify(root)}]).catch((error)=>{console.error(error);process.exit(1)});`;
  const pdfPath = path.join(root, "fixture.pdf");
  const pdfBytes = Buffer.from("%PDF-1.7\nPDF file bytes returned unchanged\n%%EOF");
  await writeFile(pdfPath, pdfBytes);
  const uploadPath = path.join(root, "new-paper.pdf"); const storedPath = path.join(root, "stored-paper.pdf");
  const uploadedPdf = Buffer.from("%PDF-1.7\nAnother PDF to attach\x00\xff\n%%EOF", "latin1"); await writeFile(uploadPath, uploadedPdf);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["-e", code], env: { MCP_FIXTURE_PDF: pdfPath, MCP_STORED_PDF: storedPath }, stderr: "pipe" });
  const client = new Client({ name: "zotero-acceptance", version: "1.0.0" });
  t.after(() => client.close());
  let diagnostics = "";
  transport.stderr?.on("data", (data: Buffer) => { diagnostics += data.toString(); });
  try { await client.connect(transport); } catch (error) {
    throw new Error(diagnostics || (error instanceof Error ? error.message : "No diagnostics captured"), { cause: error });
  }
  const { tools } = await client.listTools();
  assert.equal(tools.length, 33);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object"); assert.equal(tool.outputSchema?.type, "object");
    assert.equal(tool.annotations?.openWorldHint, ["zotero_lookup_identifier", "zotero_import_identifier", "zotero_research", "zotero_check_sources", "zotero_check_candidate"].includes(tool.name));
  }
  assert.equal(tools.find((tool) => tool.name === "zotero_delete_item")!.annotations!.destructiveHint, true);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const response = await client.callTool({ name, arguments: args });
    assert(!response.isError, JSON.stringify(response));
    const output = response.structuredContent as { ok: boolean; result: Record<string, unknown> };
    assert.equal(output.ok, true);
    assert(!JSON.stringify(output).includes("A".repeat(32)));
    return output.result;
  };
  const context = await call("zotero_get_context");
  assert.equal(context.mode, "project"); assert.equal(context.project, root);
  assert.equal((await call("zotero_set_project_bib_file")).status, "not-found");
  await writeFile(path.join(root, "one.bib"), ""); await writeFile(path.join(root, "two.bib"), "");
  const ambiguousBib = await call("zotero_set_project_bib_file");
  assert.equal(ambiguousBib.status, "ambiguous"); assert.deepEqual(ambiguousBib.candidates, ["one.bib", "two.bib"]);
  assert.equal((await call("zotero_set_project_bib_file", { bibFile: "two.bib", dryRun: true })).status, "preview");
  assert.equal((await readProjectConfig(root))!.bibFile, "");
  assert.equal((await call("zotero_set_project_bib_file", { bibFile: "two.bib" })).status, "selected");
  assert.equal((await call("zotero_set_project_bib_file")).status, "unchanged");
  assert.equal((await call("zotero_list_libraries")).libraries instanceof Array, true);
  assert.equal((await call("zotero_list_collections")).collections instanceof Array, true);
  assert.equal((await call("zotero_get_selected_collection")).writeReady, true);
  const metadata = { itemType: "book", title: "MCP protocol test source", creators: [{ creatorType: "author", name: "Test Organization" }], fields: { date: "2026", publisher: "Fixture" } };
  const schema = await call("zotero_get_item_schema", { itemType: "book" });
  assert.deepEqual(schema.required, ["itemType", "title"]);
  assert((schema.fields as string[]).includes("publisher"));
  const guidance = await call("zotero_validate_metadata", { metadata: { itemType: "book", title: "Only a title" } });
  assert.equal((guidance.completeness as { complete: boolean }).complete, true);
  const lookup = await call("zotero_lookup_identifier", { identifier: "10.1234/stdio" });
  assert.equal(lookup.provider, "crossref");
  assert.equal((lookup.metadata as { itemType: string }).itemType, "book");
  assert.equal((await call("zotero_lookup_identifier", { identifier: "0306406152" })).provider, "openlibrary");
  const thesis = await call("zotero_lookup_identifier", { identifier: "10.1234/stdio-thesis" });
  assert.equal((thesis.metadata as { fields: { university: string; publisher?: string } }).fields.university, "Actual University");
  assert.equal((thesis.metadata as { fields: { publisher?: string } }).fields.publisher, undefined);
  assert.deepEqual(thesis.warnings, []);
  const report = await call("zotero_lookup_identifier", { identifier: "10.1234/stdio-report" });
  assert.equal((report.metadata as { fields: { institution?: string } }).fields.institution, undefined);
  assert.equal((report.completeness as { complete: boolean }).complete, true);
  assert((report.warnings as string[]).some((message) => message.includes("issuing institution")));
  const datacite = await call("zotero_lookup_identifier", { identifier: "10.1234/stdio-datacite" });
  assert.equal(datacite.provider, "datacite");
  assert.equal((datacite.metadata as { fields: { university?: string } }).fields.university, undefined);
  assert((datacite.warnings as string[]).some((message) => message.includes("degree-granting university")));
  await call("zotero_check_duplicates", { metadata });
  const rejectedSource = await client.callTool({ name: "zotero_create_item", arguments: { metadata, requestId: "stdio-request-1" } });
  assert.equal(rejectedSource.isError, true);
  assert.match((rejectedSource.structuredContent as { error: { message: string } }).error.message, /denied/);
  const created = await call("zotero_create_item", { metadata, requestId: "stdio-request-1" });
  const item = created.item as { key: string; library: { type: string; id: number } };
  assert.equal(created.status, "created"); assert.equal(created.version, 11);
  const metadataResult = await call("zotero_get_metadata", { library: item.library, itemKey: item.key });
  assert.equal(metadataResult.version, 11);
  assert.equal(tools.find((tool) => tool.name === "zotero_check_sources")!.annotations!.readOnlyHint, true);
  const checked = await call("zotero_check_sources", { itemKeys: [item.key], includeCitationCounts: false });
  const source = (checked.results as { itemKey: string; pubcheck: { verdict: string; metadataMatches: boolean }; citations: { count: number | null; status: string } }[])[0]!;
  assert.equal(source.itemKey, item.key); assert.equal(source.pubcheck.verdict, "VERIFIED"); assert.equal(source.pubcheck.metadataMatches, true);
  assert.equal(source.citations.count, null); assert.equal(source.citations.status, "not-requested");
  assert.equal(checked.contentVerified, false);
  assert.equal((await call("zotero_search", { query: "protocol" })).total, 1);
  const updated = await call("zotero_update_item", { library: item.library, itemKey: item.key, expectedVersion: 11, metadata: { fields: { publisher: "Corrected publisher" } } });
  assert.equal(updated.status, "updated"); assert.equal(updated.version, 12);
  const keyUpdate = await call("zotero_update_item", { library: item.library, itemKey: item.key, expectedVersion: 12,
    metadata: { fields: { extra: "Note\nCitation Key: LegacyExplicit2026" } } });
  assert.equal(keyUpdate.status, "updated"); assert.equal(keyUpdate.version, 13);
  assert.equal((keyUpdate.item as { citationKey: string }).citationKey, "LegacyExplicit2026");
  await writeFile(path.join(root, "refs.bib"), "@book{Reserved2026,title={Unmanaged source}}\n");
  assert.equal((await call("zotero_set_project_bib_file", { bibFile: "refs.bib" })).status, "selected");
  const collision = await client.callTool({ name: "zotero_update_item", arguments: { library: item.library, itemKey: item.key, expectedVersion: 13,
    metadata: { fields: { extra: "Citation Key: reserved2026" } }, allowPossibleDuplicate: true } });
  assert.equal(collision.isError, true);
  assert.match((collision.structuredContent as { error: { message: string } }).error.message, /already in use/);
  const unchangedKey = await call("zotero_get_metadata", { library: item.library, itemKey: item.key });
  assert.equal(unchangedKey.version, 13); assert.equal((unchangedKey.item as { citationKey: string }).citationKey, "LegacyExplicit2026");
  const research = await call("zotero_research", { query: "protocol" });
  assert.equal(research.externalSearched, false); assert.equal(research.contentVerified, false);
  const noteArgs = { library: item.library, itemKey: item.key, content: "Summary & own thoughts", requestId: "stdio-note-request", expectedVersion: 13 };
  const createdNote = await call("zotero_create_note", noteArgs);
  assert.equal(createdNote.status, "created"); assert.equal(createdNote.note, "<p>Summary &amp; own thoughts</p>");
  assert.equal((await call("zotero_create_note", noteArgs)).status, "already-created");
  assert.equal((await call("zotero_list_notes", { library: item.library, itemKey: item.key })).notes instanceof Array, true);
  assert.equal((await call("zotero_get_note", { library: item.library, itemKey: item.key, noteKey: createdNote.key })).version, 1);
  assert.equal((await call("zotero_update_note", { library: item.library, itemKey: item.key, noteKey: createdNote.key, expectedVersion: 1, content: "Revised summary" })).status, "updated");
  await writeFile(path.join(root, "main.tex"), "\\parencite{LegacyExplicit2026}\n% \\cite{NotCited}\n");
  const bibPreview = await call("zotero_sync_bibliography", { dryRun: true });
  assert.deepEqual(bibPreview.citedKeys, ["LegacyExplicit2026"]);
  assert.equal((await call("zotero_sync_bibliography", { exporter: "native" })).status, "imported");
  assert.match((await readProjectText(root, "refs.bib"))!, /@book\{LegacyExplicit2026/);
  const selectedBib = await call("zotero_add_to_bibliography", { itemKeys: [item.key], exporter: "native" });
  assert.equal(selectedBib.status, "unchanged");
  assert.equal((selectedBib.citationKeys as Record<string, string>)[item.key], "LegacyExplicit2026");
  const attachments = await call("zotero_list_attachments", { library: item.library, itemKey: item.key });
  assert.equal((attachments.attachments as unknown[]).length, 1);
  const file = await call("zotero_get_attachment", { library: item.library, itemKey: item.key, attachmentKey: "PDF12345" });
  assert.equal(file.localPath, pdfPath); assert.equal(file.sizeBytes, pdfBytes.length);
  const pdfResult = await client.callTool({ name: "zotero_get_attachment", arguments: { library: item.library, itemKey: item.key, attachmentKey: "PDF12345", includeContent: true } });
  assert(!pdfResult.isError);
  const resource = pdfResult.content.find((content) => content.type === "resource");
  assert(resource && "blob" in resource.resource);
  assert.equal(resource.resource.mimeType, "application/pdf");
  assert.deepEqual(Buffer.from(resource.resource.blob, "base64"), pdfBytes);
  assert(!JSON.stringify(pdfResult.structuredContent).includes("pdfBase64"));
  const attachArgs = { library: item.library, itemKey: item.key, filePath: uploadPath, expectedVersion: 13, requestId: "stdio-pdf-request" };
  const rejectedPdf = await client.callTool({ name: "zotero_attach_pdf", arguments: attachArgs });
  assert.equal(rejectedPdf.isError, true);
  assert.match((rejectedPdf.structuredContent as { error: { message: string } }).error.message, /denied/);
  const added = await call("zotero_attach_pdf", attachArgs);
  assert.equal(added.status, "attached"); assert.equal(added.verified, true);
  assert.equal(added.localPath, storedPath);
  assert.equal((await call("zotero_attach_pdf", { library: item.library, itemKey: item.key, filePath: uploadPath, expectedVersion: 13, requestId: "stdio-pdf-request" })).status, "already-attached");
  assert.equal((await call("zotero_delete_item", { library: item.library, itemKey: item.key, expectedVersion: 13 })).status, "trashed");
  assert.equal((await call("zotero_delete_item", { library: item.library, itemKey: item.key, expectedVersion: 11 })).status, "already-trashed");
  const trash = await call("zotero_list_trash");
  const trashItem = (trash.items as { version: number }[])[0]!;
  assert.equal((await call("zotero_restore_item", { library: item.library, itemKey: item.key, expectedVersion: trashItem.version })).status, "restored");
  assert.equal((await call("zotero_restore_item", { library: item.library, itemKey: item.key, expectedVersion: trashItem.version })).status, "already-restored");
  const foreign = await client.callTool({ name: "zotero_get_metadata", arguments: { library: { type: "group", id: 42 }, itemKey: item.key } });
  assert.equal(foreign.isError, true);
  const invalid = await client.callTool({ name: "zotero_delete_item", arguments: { itemKey: "ambiguous" } });
  assert.equal(invalid.isError, true);
  const imported = await call("zotero_import_identifier", { identifier: "10.1234/stdio", requestId: "stdio-identifier-1", citationKey: "stdioImported2026" });
  assert.equal(imported.status, "created"); assert.equal(imported.citationKey, "stdioImported2026");
  assert.equal((imported.provenance as { provider: string }).provider, "crossref");
  assert.equal((await call("zotero_import_identifier", { identifier: "10.1234/stdio", requestId: "stdio-identifier-1", citationKey: "stdioImported2026" })).status, "already-created");
  const importedReport = await call("zotero_import_identifier", { identifier: "10.1234/stdio-report", requestId: "stdio-report-import" });
  assert.equal(importedReport.status, "created");
  assert.equal((importedReport.data as { institution?: string }).institution, undefined);
  assert.deepEqual(importedReport.lookupWarnings, report.warnings);
  const reportRetry = await call("zotero_import_identifier", { identifier: "10.1234/stdio-report", requestId: "stdio-report-import" });
  assert.equal(reportRetry.status, "already-created"); assert.deepEqual(reportRetry.lookupWarnings, report.warnings);
  const collectionCreated = await call("zotero_create_collection", { name: "New project collection", requestId: "stdio-collection-001" });
  const createdCollection = collectionCreated.collection as { key: string };
  assert.equal(collectionCreated.status, "created");
  assert.equal((await call("zotero_create_collection", { name: "New project collection", requestId: "stdio-collection-001" })).status, "already-created");
  const collectionInfo = await call("zotero_get_collection", { library: item.library, collectionKey: createdCollection.key });
  assert.equal(collectionInfo.deletionBlocked, false);
  const switchPreview = await call("zotero_set_project_collection", { library: item.library, collectionKey: createdCollection.key, dryRun: true });
  assert.equal(switchPreview.status, "preview");
  const switched = await call("zotero_set_project_collection", { library: item.library, collectionKey: createdCollection.key });
  assert.equal(switched.status, "assigned"); assert.equal(switched.removedBibliographyCount, 2);
  assert.equal((await readProjectConfig(root))!.collectionKey, createdCollection.key);
  const protectedDelete = await client.callTool({ name: "zotero_delete_collection", arguments: { library: item.library, collectionKey: createdCollection.key, expectedVersion: 1 } });
  assert.equal(protectedDelete.isError, true);
  assert.equal((protectedDelete.structuredContent as { error: { code: string } }).error.code, "FORBIDDEN");
  await call("zotero_set_project_collection", { library: item.library, collectionKey: "COLL2345" });
  assert.equal((await call("zotero_delete_collection", { library: item.library, collectionKey: createdCollection.key, expectedVersion: 1 })).status, "deleted");
  assert.equal((await call("zotero_delete_collection", { library: item.library, collectionKey: createdCollection.key, expectedVersion: 1 })).status, "already-deleted");
  assert.equal(diagnostics, "");
});

test("external candidate MCP check runs before Zotero setup with the local API blocked and no project files", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-candidate-only-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = process.env.ZOTERO_MCP_TEST_SERVER ?? path.resolve(__dirname, "../../dist/mcp/server.cjs");
  const code = mock + `\nconst externalFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{if(new URL(String(input)).hostname==="localhost")throw new Error("Zotero must not be contacted for candidates");return externalFetch(input,init)};\nrequire(${JSON.stringify(server)}).main(["--state-dir",${JSON.stringify(path.join(root, "state"))}]).catch(()=>process.exit(1));`;
  const client = new Client({ name: "candidate-only-acceptance", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["-e", code], stderr: "pipe" }));
  const { tools } = await client.listTools();
  const candidateTool = tools.find((tool) => tool.name === "zotero_check_candidate")!;
  assert.equal(candidateTool.annotations!.readOnlyHint, true); assert.equal(candidateTool.annotations!.openWorldHint, true);
  const response = await client.callTool({ name: "zotero_check_candidate", arguments: { metadata: {
    itemType: "book", title: "External ISBN publication", fields: { ISBN: "0306406152", abstractNote: "Private text" },
  } } });
  assert(!response.isError, JSON.stringify(response));
  const result = (response.structuredContent as { result: { pubcheck: { metadataMatches: boolean }; citations: { count: number; matchedBy: string };
    zoteroChanged: boolean; projectFilesChanged: boolean } }).result;
  assert.equal(result.pubcheck.metadataMatches, true); assert.equal(result.citations.count, 17); assert.equal(result.citations.matchedBy, "isbn");
  assert.equal(result.zoteroChanged, false); assert.equal(result.projectFilesChanged, false);
  const formatted = await client.callTool({ name: "zotero_check_candidate", arguments: { metadata: {
    itemType: "book", title: "Recker ISBN format fixture", fields: { DOI: "10.1234/isbn-format", ISBN: "97830308543559783030854362" },
  } } });
  assert(!formatted.isError, JSON.stringify(formatted));
  const formatResult = (formatted.structuredContent as { result: { pubcheck: { metadataMatches: boolean; isbnValidation: { status: string; isbns: string[] } }; citations: { count: number } } }).result;
  assert.equal(formatResult.pubcheck.metadataMatches, true); assert.equal(formatResult.pubcheck.isbnValidation.status, "matched");
  assert.deepEqual(formatResult.pubcheck.isbnValidation.isbns, ["9783030854355", "9783030854362"]); assert.equal(formatResult.citations.count, 41);
  const mismatch = await client.callTool({ name: "zotero_check_candidate", arguments: { metadata: { itemType: "book", title: "Mismatching candidate" }, includeCitationCounts: false } });
  assert(!mismatch.isError);
  assert.equal((mismatch.structuredContent as { result: { pubcheck: { metadataMatches: boolean } } }).result.pubcheck.metadataMatches, false);
  const invalid = await client.callTool({ name: "zotero_check_candidate", arguments: { metadata: { itemType: "note", title: "Not a publication" } } });
  assert.equal(invalid.isError, true);
  assert.deepEqual(await readdir(root), []);
});

test("bundled stdio works with Zotero alone and initializes a fresh project without TeX", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mcp-independent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = process.env.ZOTERO_MCP_TEST_SERVER ?? path.resolve(__dirname, "../../dist/mcp/server.cjs");
  const connect = async (args: string[]) => {
    const code = mock + `\nrequire(${JSON.stringify(server)}).main(${JSON.stringify(args)}).catch(()=>process.exit(1));`;
    const client = new Client({ name: "standalone-acceptance", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["-e", code],
      env: { XDG_STATE_HOME: path.join(root, "default-state"), LOCALAPPDATA: path.join(root, "default-state") }, stderr: "pipe" });
    t.after(() => client.close());
    await client.connect(transport);
    return { client, call: async (name: string, arguments_: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: arguments_ });
      assert(!response.isError, JSON.stringify(response));
      return (response.structuredContent as { result: Record<string, unknown> }).result;
    } };
  };
  const defaults = await connect([]);
  assert.equal((await defaults.call("zotero_get_context")).mode, "standalone");
  assert.equal((await defaults.call("zotero_search", { query: "" })).total, 0);
  await defaults.client.close();
  const state = path.join(root, "standalone-state");
  const standalone = await connect(["--state-dir", state]);
  assert.equal((await standalone.call("zotero_get_context")).mode, "standalone");
  assert.equal((await standalone.call("zotero_get_selected_collection")).project, null);
  assert.equal((await standalone.call("zotero_search", { query: "" })).total, 0);
  assert.equal(await readProjectConfig(state), undefined);
  const selection = await standalone.call("zotero_set_project_collection", { library: { type: "user", id: 0 }, collectionKey: "COLL2345" });
  assert.equal(selection.projectFilesChanged, false); assert.equal(selection.settingsChanged, true);
  const disabled = await standalone.client.callTool({ name: "zotero_add_to_bibliography", arguments: { itemKeys: ["ITEM2345"] } });
  assert.equal(disabled.isError, true);
  await standalone.client.close();
  const restarted = await connect(["--state-dir", state]);
  assert.equal((await restarted.call("zotero_get_context")).collectionKey, "COLL2345");
  await restarted.client.close();

  const project = await connect(["--project", root]);
  assert.equal((await project.call("zotero_get_context")).configured, false);
  await project.call("zotero_set_project_collection", { library: { type: "user", id: 0 }, collectionKey: "COLL2345" });
  const args = { metadata: { itemType: "book", title: "Independent bibliography source", fields: { ISBN: "0306406152" } }, requestId: "independent-create-001" };
  // The fixture rejects the first source write, then permits the same operation.
  await project.client.callTool({ name: "zotero_create_item", arguments: args });
  const source = await project.call("zotero_create_item", args);
  const itemKey = (source.item as { key: string }).key;
  assert.equal((await project.call("zotero_add_to_bibliography", { itemKeys: [itemKey], exporter: "native" })).status, "not-found");
  await writeFile(path.join(root, "literature.bib"), "@book{Manual,title={Keep}}\n");
  const imported = await project.call("zotero_add_to_bibliography", { itemKeys: [itemKey], exporter: "native" });
  assert.equal(imported.status, "imported"); assert.equal(imported.bibFile, "literature.bib");
  assert.match((await readProjectText(root, "literature.bib"))!, /title=\{Keep\}/);
  assert.equal(await readProjectText(root, "main.tex"), undefined);
  assert.equal((await readProjectConfig(root))!.bibFile, "literature.bib");
  await project.client.close();

  const workspace = path.join(root, "another-workspace");
  await mkdir(workspace);
  const global = await connect(["--state-dir", state]);
  const inspected = await global.call("zotero_get_context", { projectPath: workspace });
  assert.equal(inspected.project, workspace); assert.equal(inspected.configured, false);
  await global.call("zotero_set_project_collection", { projectPath: workspace, library: { type: "user", id: 0 }, collectionKey: null });
  await global.client.callTool({ name: "zotero_create_item", arguments: args });
  const globalSource = await global.call("zotero_create_item", args);
  const globalKey = (globalSource.item as { key: string }).key;
  const checked = await global.call("zotero_check_sources", { itemKeys: [globalKey] });
  const isbnCount = (checked.results as { citations: { count: number; matchedBy: string; isbn: string; doi: string } }[])[0]!.citations;
  assert.equal(isbnCount.count, 17); assert.equal(isbnCount.matchedBy, "isbn");
  assert.equal(isbnCount.isbn, "9780306406157"); assert.equal(isbnCount.doi, "10.1234/isbn-book");
  await writeFile(path.join(workspace, "refs.bib"), "");
  assert.equal((await global.call("zotero_add_to_bibliography", { projectPath: workspace, itemKeys: [globalKey], exporter: "native" })).status, "imported");
  assert.equal((await global.call("zotero_get_context")).mode, "standalone");
  assert.equal((await global.call("zotero_get_context")).collectionKey, "COLL2345");
  assert.equal((await readProjectConfig(workspace))!.collectionKey, "");
  assert.equal(await readProjectText(workspace, ".cursor/mcp.json"), undefined);
  const pinned = await connect(["--project", root]);
  const wrongProject = await pinned.client.callTool({ name: "zotero_get_context", arguments: { projectPath: workspace } });
  assert.equal(wrongProject.isError, true);
  assert.match((wrongProject.structuredContent as { error: { message: string } }).error.message, /outside/);
});
