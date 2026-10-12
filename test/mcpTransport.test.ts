import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
 if(u.hostname==="api.crossref.org"){
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
   return json(["title","date","url","extra",...(type==="thesis"?["university"]:type==="report"?["institution"]:["DOI","publisher"])].map(field=>({field})));
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
  assert.equal(tools.length, 29);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object"); assert.equal(tool.outputSchema?.type, "object");
    assert.equal(tool.annotations?.openWorldHint, ["zotero_lookup_identifier", "zotero_import_identifier", "zotero_research"].includes(tool.name));
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
