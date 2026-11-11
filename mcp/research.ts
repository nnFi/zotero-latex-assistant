import { z } from "zod";
import { BibliographyAudit } from "../src/research/bibliographyAudit";
import { getFulltext } from "../src/research/fulltext";
import { Literature } from "../src/research/literature";
import { researchStatuses } from "../src/research/providerRun";
import type { ZoteroProjectService } from "../src/zotero/projectService";
import type { ToolRegistrar } from "./server";

export const researchEvidenceSchema = z.object({ provider: z.string(), status: z.enum(researchStatuses), sourceUrl: z.string(),
  checkedAt: z.string(), reason: z.string() });
export const researchWorkSchema = z.object({ provider: z.enum(["openalex", "crossref"]), id: z.string(), sourceUrl: z.string(),
  doi: z.string().nullable(), title: z.string(), authors: z.array(z.string()), years: z.array(z.number().int()), type: z.string(),
  count: z.number().int().nonnegative().nullable() });

const referenceFields = {
  doi: z.string().trim().min(1).max(2000).optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
  year: z.number().int().min(1000).max(9999).optional(),
};
const referenceInput = z.object(referenceFields).strict().refine(({ doi, title }) => Boolean(doi || title), "Supply a DOI or title.");
const fieldComparison = z.enum(["match", "mismatch", "unknown"]);
export const referenceCheckSchema = z.object({
  results: z.array(researchEvidenceSchema.extend({ fields: z.object({ doi: fieldComparison, title: fieldComparison, authors: fieldComparison, year: fieldComparison }),
    work: researchWorkSchema.nullable() })),
  doiConflict: z.boolean(),
  contentVerified: z.literal(false),
});
const count = z.object({ value: z.number().int().nonnegative(), provider: z.enum(["openalex", "crossref"]), sourceUrl: z.string(), checkedAt: z.string() });
const citationComparison = z.object({ status: z.enum(["compared", "incomplete"]), scannedFiles: z.array(z.string()),
  missingFromBibliography: z.array(z.string()), notCited: z.array(z.string()), reason: z.string().nullable() });

export function registerResearchTools(tool: ToolRegistrar, service: ZoteroProjectService, pubcheck: z.ZodType) {
  const literature = () => new Literature(service.researchRun());
  const audit = new BibliographyAudit(() => service.researchRun());
  tool("zotero_check_reference", "Compare the original title, ordered authors and year. With a DOI, check Crossref then OpenAlex. Otherwise supply title and first author to check OpenAlex then Crossref. Results show field comparisons and evidence from both providers.",
    referenceInput, referenceCheckSchema, (reference) => literature().check(reference), { openWorld: true });

  tool("zotero_check_bibliography", "Check a project .bib (projectPath and optional project-relative bibFile) or pass bibtex with optional latex. Each page checks up to five entries with PubCheck, then Crossref and OpenAlex. A PubCheck outage triggers a local LaTeX citation-key comparison. Continue with nextToken alone within 30 minutes. If several .bib files are possible, ask the user to choose.",
    z.object({ projectPath: z.string().min(1).optional(), bibFile: z.string().min(1).optional(),
      bibtex: z.string().max(2_000_000).optional(), latex: z.string().max(2_000_000).optional(),
      nextToken: z.string().regex(/^[a-f0-9-]{36}:\d+$/).optional() }).strict(),
    z.object({ status: z.enum(["checked", "ambiguous", "not-found"]), bibFile: z.string().nullable(), candidates: z.array(z.string()),
      total: z.number().int(), offset: z.number().int(), nextToken: z.string().nullable(),
      results: z.array(z.object({ citationKey: z.string(), title: z.string(), problem: z.string().nullable(),
        pubcheck: z.object({ verification: pubcheck, evidence: researchEvidenceSchema }), reference: referenceCheckSchema.nullable() })),
      citationComparison: citationComparison.nullable() }),
    async ({ projectPath, bibFile, bibtex, latex, nextToken }) => {
      if (nextToken) {
        if ([projectPath, bibFile, bibtex, latex].some((value) => value !== undefined)) throw new Error("Pass nextToken by itself.");
        return audit.continue(nextToken);
      }
      if (bibtex !== undefined) {
        if (projectPath || bibFile) throw new Error("Choose either inline BibTeX or a project bibliography.");
        return audit.start({ bibtex, latex });
      }
      if (latex !== undefined) throw new Error("Inline LaTeX requires inline BibTeX.");
      const project = (await service.forProject(projectPath)).projectRoot;
      if (!project) throw new Error("Supply projectPath or inline bibtex.");
      return audit.start({ project, bibFile });
    }, { openWorld: true });

  tool("zotero_get_citations", "Get OpenAlex citation counts and citing works for a DOI or a unique title and first-author match. Use the Crossref count when OpenAlex data is incomplete or unavailable. Counts include source and timestamp. Follow nextPage with the same limit, up to 10,000 results.",
    z.object({ ...referenceFields, page: z.number().int().min(1).max(10000).default(1), limit: z.number().int().min(1).max(100).default(20) })
      .strict().refine(({ doi, title, page, limit }) => Boolean(doi || title) && page * limit <= 10000,
        "Supply a DOI or title and keep page × limit at or below 10,000."),
    z.object({ count: count.nullable(), counts: z.array(count), citing: z.array(researchWorkSchema).nullable(), citingSource: researchEvidenceSchema.nullable(),
      page: z.number().int(), nextPage: z.number().int().nullable(), evidence: z.array(researchEvidenceSchema) }),
    ({ page, limit, ...reference }) => literature().citations(reference, page, limit), { openWorld: true });

  tool("zotero_get_fulltext", "Retrieve public full text from OpenAlex, the DOI publication page or an archive. If OpenAlex yields no readable copy and the DOI is missing, look up title and first author in Crossref before checking the publication page. Read the returned PDF or article sections and cite the supporting page or section. An abstract leaves content verification open.",
    referenceInput, z.object({ status: z.enum(["available", "unresolved"]), doi: z.string().nullable(), publicationUrl: z.string().nullable(),
      document: z.object({ sourceUrl: z.string(), format: z.enum(["pdf", "xml", "html"]), localPath: z.string().nullable(), fileUri: z.string().nullable(),
        byteSize: z.number().int(), sha256: z.string().nullable(), sections: z.array(z.object({ heading: z.string().nullable(), text: z.string() })) }).nullable(),
      evidence: z.array(researchEvidenceSchema), contentVerified: z.literal(false), guidance: z.string() }),
    (reference) => getFulltext(literature(), reference), { openWorld: true, pdf: true });
}
