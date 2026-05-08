import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type * as dbModule from '../db/index.js';
import { generateBRD, generateBRDHtml, type AdaptorContext } from './generators/brdGenerator.js';
import { generateKickoff, generateKickoffHtml, type KickoffMember } from './generators/kickoffGenerator.js';
import { getAdaptorRegistry } from '@ofoq/adaptor-registry';
import { generateSDFPackage } from './generators/sdfGenerator.js';
import { generateSdfCustomRecords } from './generators/sdfCustomRecordsGenerator.js';
import { generateSdfManifest } from './generators/sdfManifestGenerator.js';
import { generateSdfDeploy } from './generators/sdfDeployGenerator.js';
import { generatePoApprovalScript } from './generators/sdfPoApprovalScriptGenerator.js';
import { generateSdfCustomFields } from './generators/sdfCustomFieldsGenerator.js';
import {
  generateSdfStructuredCustomFields,
  resolveLegacyCustomFieldsScope,
} from './generators/sdfStructuredCustomFieldsGenerator.js';
import {
  parseApprovalChain,
  chainToLegacyTextarea,
} from './generators/approvalChainHelpers.js';
import { generateSdfCustomList } from './generators/sdfCustomListGenerator.js';
import { generateTransactionForms } from './generators/sdfTransactionFormGenerator.js';
import { generateEntryForms } from './generators/sdfEntryFormGenerator.js';
import {
  generateSubsidiaries,
  extractCurrenciesFromSubsidiaries,
} from './generators/sdfSubsidiaryGenerator.js';
import { generateCurrencies } from './generators/sdfCurrencyGenerator.js';
import { generateWorkflows } from './generators/sdfWorkflowGenerator.js';
import { generateWorkflowActionScripts } from './generators/sdfWorkflowActionScriptGenerator.js';
import { generateSavedSearches } from './generators/sdfSavedSearchGenerator.js';
import { generateDashboards } from './generators/sdfDashboardGenerator.js';
import { generateRoles } from './generators/sdfRoleGenerator.js';
import {
  generateSdfStructuredRoles,
  resolveLegacyStandardRoleCustomization,
} from './generators/sdfStructuredRolesGenerator.js';
import { generateSdfStructuredTemplates } from './generators/sdfStructuredTemplatesGenerator.js';
import { generateAccountingPreferences } from './generators/sdfAccountingPreferencesGenerator.js';
import { generateCompanyInformation } from './generators/sdfCompanyInformationGenerator.js';
import { generateGeneralPreferences } from './generators/sdfGeneralPreferencesGenerator.js';
import { generateTaxTypes } from './generators/sdfTaxTypeGenerator.js';
import { generateTaxCodes } from './generators/sdfTaxCodeGenerator.js';
import { generateTaxSchedules } from './generators/sdfTaxScheduleGenerator.js';
import { validateSDFBundle, isValidationEnabled } from './generators/sdfValidator.js';
import { generateScripts } from './generators/scriptGenerator.js';
import { generateRiskRegister } from './generators/riskGenerator.js';
import { generateUATPlan, generateUATPlanHtml } from './generators/uatGenerator.js';
import { generateSolutionDocHtml } from './generators/solutionDocGenerator.js';
import { generateTrainingManualHtml } from './generators/trainingManualGenerator.js';
import { generateImplementationPlanHtml } from './generators/planGenerator.js';
import { generateOdooConfigurationPlan, generateOdooConfigurationPlanHtml } from './generators/odooConfigurationPlanGenerator.js';
// Pack T — Test Artifacts (cross-platform — runs for both NetSuite + Odoo).
import { generateTestScripts } from './generators/testScriptGenerator.js';
import {
  generateSignOffMatrix,
  type SignOffMember,
} from './generators/signOffMatrixGenerator.js';
import { generateDefectLogTemplate } from './generators/defectLogTemplateGenerator.js';
import { generatePerformanceTestPlan } from './generators/performanceTestPlanGenerator.js';
import { generateRegressionTestSuite } from './generators/regressionTestSuiteGenerator.js';
// Pack U — Training Collateral (cross-platform — runs for both NetSuite + Odoo).
import { generatePerRoleTrainingGuides } from './generators/perRoleTrainingGuideGenerator.js';
import { generateQuickReferenceCards } from './generators/quickReferenceCardGenerator.js';
import { generateTrainingMatrix } from './generators/trainingMatrixGenerator.js';
import { generateTrainingSchedule } from './generators/trainingScheduleGenerator.js';
import { generateKnowledgeTransferChecklist } from './generators/knowledgeTransferChecklistGenerator.js';
// Pack V — Cutover Runbook (cross-platform — runs for both NetSuite + Odoo).
import { generateCutoverRunbook } from './generators/cutoverRunbookGenerator.js';
import { generateGoNoGoMatrix } from './generators/goNoGoMatrixGenerator.js';
import { generateRollbackPlan } from './generators/rollbackPlanGenerator.js';
import { generatePostCutoverSmoke } from './generators/postCutoverSmokeGenerator.js';
import { generateCutoverCommPlan } from './generators/cutoverCommPlanGenerator.js';
import { generateDryRunPlan } from './generators/dryRunPlanGenerator.js';
import { generateCutoverTeamRoster } from './generators/cutoverTeamRosterGenerator.js';
// Pack X — Hypercare Program (cross-platform — runs for both NetSuite + Odoo).
import { generateHypercarePlan } from './generators/hypercarePlanGenerator.js';
import { generateDailyReadinessChecklist } from './generators/dailyReadinessChecklistGenerator.js';
import { generateIssueEscalationMatrix } from './generators/issueEscalationMatrixGenerator.js';
import { generateWarRoomSop } from './generators/warRoomSopGenerator.js';
import { generateTransitionToSupportPlan } from './generators/transitionToSupportPlanGenerator.js';
import { generateHypercareKpiDashboard } from './generators/hypercareKpiDashboardGenerator.js';
import { generatePowerUserOfficeHours } from './generators/powerUserOfficeHoursGenerator.js';
// Pack Y — Stabilization Roadmap (cross-platform — runs for both NetSuite + Odoo).
import { generateStabilizationRoadmap } from './generators/stabilizationRoadmapGenerator.js';
import { generateLessonsLearned } from './generators/lessonsLearnedGenerator.js';
import { generateBenefitsRealizationTracker } from './generators/benefitsRealizationTrackerGenerator.js';
import { generateProcessImprovementBacklog } from './generators/processImprovementBacklogGenerator.js';
import { generateContinuousImprovementGovernance } from './generators/continuousImprovementGovernanceGenerator.js';
import { generateKpiEvolutionPlan } from './generators/kpiEvolutionPlanGenerator.js';
import { generatePhaseTwoCharter } from './generators/phaseTwoCharterGenerator.js';
// Pack Z — Data Migration Assets (cross-platform — runs for both NetSuite + Odoo).
import { generateCsvImportTemplateBundle } from './generators/csvImportTemplateBundleGenerator.js';
import { generateFieldMappingWorkbook } from './generators/fieldMappingWorkbookGenerator.js';
import { generateReconciliationQueries } from './generators/reconciliationQueriesGenerator.js';
import { generateMigrationCleansingRules } from './generators/migrationCleansingRulesGenerator.js';
import { generateMigrationLoadSequencing } from './generators/migrationLoadSequencingGenerator.js';
import { generateMigrationRunbook } from './generators/migrationRunbookGenerator.js';
import { generateRejectHandlingPlaybook } from './generators/rejectHandlingPlaybookGenerator.js';
import { generateDataQualityScorecard } from './generators/dataQualityScorecardGenerator.js';
// Pack ZZ — Integration Runbooks (cross-platform — runs for both NetSuite + Odoo).
import { generateIntegrationCatalog } from './generators/integrationCatalogGenerator.js';
import { generateIntegrationRunbookBundle } from './generators/integrationRunbookBundleGenerator.js';
import { generateIntegrationHealthDashboard } from './generators/integrationHealthDashboardGenerator.js';
import { generateIntegrationReconciliationProcedures } from './generators/integrationReconciliationProceduresGenerator.js';
import { generateIntegrationVendorEscalationMatrix } from './generators/integrationVendorEscalationMatrixGenerator.js';
import { generateIntegrationTestPlan } from './generators/integrationTestPlanGenerator.js';
import { generateIntegrationsIndex } from './generators/integrationsIndexGenerator.js';
// Phase 39.2 — switched BRD.pdf to convertMarkdownToPdf so we never depend
// on Chromium for the legitimate-looking PDF output. The HTML path
// (convertHtmlToPdf) still exists for future generators that need true
// CSS rendering and run in environments where Puppeteer is wired up.
import { convertMarkdownToPdf } from './pdfService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DbModule = typeof dbModule;

/**
 * Resolve the engagement's adaptorId + selected edition into the prose
 * context every generator consumes. Built-in shape per adaptor:
 *
 *   netsuite  — preserves the existing "NetSuite Mid-Market" edition
 *               prefix the pilot deck has used and the SDF deployment
 *               package hand-off voice.
 *   odoo      — bare edition label ("Community" or "Enterprise") and
 *               a generic "configuration package" hand-off until the
 *               Odoo Configuration Plan generator lands (Phase 4 of
 *               the cross-platform fix).
 *   custom:*  — fall-through default. Adaptor name comes from the
 *               registry; if the adaptor isn't registered we Capitalize
 *               the adaptorId so the prose still reads cleanly.
 */
function buildAdaptorContext(adaptorId: string, editionId: string): AdaptorContext {
  const adaptor = getAdaptorRegistry().find(adaptorId);
  const adaptorName = adaptor?.manifest.name ?? capitalize(adaptorId.replace(/^custom:/, ''));
  const editionDef = adaptor?.license?.editions.find((e) => e.id === editionId);
  const bareEdition = editionDef?.label ?? editionId;

  // Adaptor-driven flow tree — each generator iterates this to render
  // wizard answers grouped by flow + section. Replaces the hardcoded
  // r2r/p2p/o2c/mfg/rtn list that only worked for NetSuite-style keys
  // and produced an empty Workstream Requirements section for every
  // Odoo engagement.
  const flows = (adaptor?.schema?.flows ?? []).map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    sections: f.sections.map((s) => ({
      id: s.id,
      label: s.label,
      order: s.order,
      questions: s.questions.map((q) => ({
        id: q.id,
        label: q.label,
        inputType: q.inputType,
        options: q.options,
      })),
    })),
  }));

  if (adaptorId === 'netsuite') {
    return {
      id: 'netsuite',
      name: 'NetSuite',
      // Pilot voice: prefix the platform name onto the edition so the
      // header reads "NetSuite Mid-Market". Other adaptors get the bare
      // label — that's the convention the BRD test contract enforces.
      editionLabel: `NetSuite ${bareEdition}`,
      consultantQualifier: 'NetSuite',
      nextStepLanguage:
        'the NetSuite build phase using the SDF deployment package generated by ERPLaunch',
      flows,
    };
  }

  if (adaptorId === 'odoo') {
    return {
      id: 'odoo',
      name: 'Odoo',
      editionLabel: bareEdition,
      consultantQualifier: 'Odoo',
      // Refined wording (PO sign-off): Odoo doesn't ship a single deployment
      // artifact like NetSuite SDF. The post-Discovery hand-off is a module
      // install plan + l10n_<country> localization + (optional) Studio XML
      // exports. This phrasing previews the Phase-4 odooConfigurationPlan
      // generator while staying honest about what comes next on Odoo.
      nextStepLanguage:
        'the Odoo configuration phase using the module install plan and localization package generated by ERPLaunch',
      flows,
    };
  }

  // Fall-through for custom: adaptors. Capitalize(adaptorId) covers the
  // case where the registry hasn't been queried yet (offline test path);
  // adaptor.manifest.name is preferred when available.
  return {
    id: adaptorId,
    name: adaptorName,
    editionLabel: bareEdition,
    consultantQualifier: adaptorName,
    nextStepLanguage: `the ${adaptorName} build phase using the configuration package generated by ERPLaunch`,
    flows,
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Generation pipeline — Phase 6: adaptor-aware
 *
 * Branches on the engagement's adaptor:
 *   - NetSuite (built-in): emits the full pack the pilot always produced —
 *     BRD + Risk Register + UAT + Solution Design + Training + Plan PLUS
 *     the NetSuite-only SDF package and SuiteScript scaffolds.
 *   - Everything else (Odoo, published custom adaptors): emits the
 *     platform-neutral document pack only. SDF / SuiteScript are NetSuite
 *     artifacts and would be meaningless against an Odoo or in-house system,
 *     so the runner skips them and lets the catalog decide which other
 *     documents land in the bundle.
 *
 * This is a pragmatic first cut — the six "document" generators already
 * work off clientName + answers + comments + images + aiAdvice with no
 * NetSuite-specific data, so they can run against any adaptor. A later
 * phase can replace the static calls with a dispatch table keyed on
 * generator id when more adaptor-native generators (Odoo .po modules,
 * Dynamics extensions, etc.) arrive.
 */
export async function processJob(jobId: string, db: DbModule) {
  try {
    await db.updateJob(jobId, { status: 'RUNNING' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB row is structurally typed but nested keys (`profile.answers["ns.design.x"]`) are looser than TS strict indexing tolerates; AnyShape narrowing here would mean threading types through every generator call. Tracked under §6.1 (NetSuite adaptor extraction).
    const job = await db.findJobById(jobId) as Record<string, any> | null;
    if (!job) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see job-cast comment above.
    const eng = await db.findEngagementById(job.engagementId as string) as Record<string, any> | null;
    if (!eng) return;

    const adaptorId = (eng.adaptorId as string | undefined) ?? 'netsuite';
    const isNetSuite = adaptorId === 'netsuite';

    const rootOutputDir = path.join(__dirname, '..', '..', 'outputs', jobId);
    const docDir = path.join(rootOutputDir, 'Documentation');
    await fs.mkdir(docDir, { recursive: true });

    // Phase 46.4 — SOW renders a single comprehensive PDF that goes
    // out for e-signature. Pricing is re-derived from the same
    // Discovery Lite + firm-defaults inputs as the proposal so the
    // SOW always agrees with the most recent proposal numbers (until
    // a future phase lets the firm freeze/lock a specific version).
    if ((job.type as string) === 'SOW') {
      const { generateSowPdf } = await import('./generators/sowGenerator.js');
      const { computeProposalPricing } = await import('./generators/proposalGenerator.js');
      const dl = await db.findDiscoveryLite(eng.id as string);
      const dlAnswers = (dl?.answers ?? {}) as Record<string, unknown>;
      const license = (eng.license ?? {}) as Record<string, any>;

      const dlModules = Array.isArray(dlAnswers['modules.interest'])
        ? (dlAnswers['modules.interest'] as string[])
        : (license.modules as string[] | undefined) ?? [];
      let modulesOfInterest: Array<{ id: string; label: string }> = [];
      try {
        const adaptor = (await import('@ofoq/adaptor-registry')).getAdaptorRegistry().find(adaptorId);
        const catalog = adaptor?.license?.modules ?? [];
        const labelOf = new Map<string, string>(
          catalog.map((m: { id: string; label?: string }) => [m.id, m.label ?? m.id]),
        );
        modulesOfInterest = dlModules.map((id) => ({
          id,
          label: labelOf.get(id) ?? id,
        }));
      } catch {
        modulesOfInterest = dlModules.map((id) => ({ id, label: id }));
      }

      const firm = await db.findFirmById((eng as Record<string, unknown>).firmId as string);
      const firmName = (firm as { name?: string } | null)?.name ?? 'Provider';

      // Re-use proposal pricing math so SOW totals agree with the
      // most-recent proposal generation.
      const pricingInput = {
        clientName: eng.clientName as string,
        adaptorId,
        adaptorName: isNetSuite ? 'NetSuite' : adaptorId,
        pains: Array.isArray(dlAnswers['painPoints']) ? (dlAnswers['painPoints'] as string[]) : [],
        modulesOfInterest,
        estimatedUsers:
          typeof dlAnswers['scope.users'] === 'number' ? (dlAnswers['scope.users'] as number) : 25,
        estimatedLocations:
          typeof dlAnswers['scope.locations'] === 'number'
            ? (dlAnswers['scope.locations'] as number)
            : 1,
        geographyMultiEntity:
          (dlAnswers['geography.multiEntity'] as 'single' | 'single-country-multi-entity' | 'multi-country' | undefined) ??
          'single',
        targetGoLive:
          typeof dlAnswers['timeline.targetGoLive'] === 'string'
            ? (dlAnswers['timeline.targetGoLive'] as string)
            : 'tbd',
        perUserPricing: {} as Record<string, number>,
        defaultPerUserPrice: 1200,
        firmName,
        preparedAt: new Date().toISOString().slice(0, 10),
      };
      const pricing = computeProposalPricing(pricingInput);

      // Estimated duration from Discovery Lite's targetGoLive code,
      // falling back to 90 days. The route layer / Phase 46.6 will
      // supply a proper override.
      const targetGoLive = pricingInput.targetGoLive;
      const durationByCode: Record<string, number> = {
        asap: 90,
        '3-6m': 150,
        '6-12m': 270,
        '12m+': 365,
        tbd: 180,
      };
      const estimatedDurationDays = durationByCode[targetGoLive] ?? 180;

      // Version: next monotonically increasing per engagement.
      const version = await db.nextSowVersion(eng.id as string);
      const previousLatest = version > 1 ? version - 1 : null;

      const pdf = await generateSowPdf({
        clientName: eng.clientName as string,
        adaptorId,
        adaptorName: isNetSuite ? 'NetSuite' : adaptorId,
        firmName,
        modulesOfInterest,
        estimatedUsers: pricingInput.estimatedUsers,
        estimatedLocations: pricingInput.estimatedLocations,
        geographyMultiEntity: pricingInput.geographyMultiEntity,
        totalAnnualLicense: pricing.totalAnnualLicense,
        implementationServices: pricing.implementationServices,
        totalFirstYear: pricing.totalFirstYear,
        pricingPhases: pricing.phases,
        validUntil: pricing.validUntil,
        effectiveDate: pricingInput.preparedAt,
        estimatedDurationDays,
        version,
        supersedesVersion: previousLatest,
        preparedAt: pricingInput.preparedAt,
      });

      const pdfDir = path.join(rootOutputDir, 'SOW');
      await fs.mkdir(pdfDir, { recursive: true });
      await fs.writeFile(path.join(pdfDir, `Statement_of_Work_v${version}.pdf`), pdf);

      try {
        await db.recordSowVersion({
          engagementId: eng.id as string,
          jobId,
          version,
          supersedesVersion: previousLatest,
        });
      } catch (err) {
        // Non-fatal — the PDF is on disk, the version row can be
        // reconstructed from the GenerationJob if needed.
      }

      try {
        await db.logActivity(
          eng.id as string,
          (eng as Record<string, unknown>).firmId as string,
          previousLatest ? 'SOW_SUPERSEDED' : 'SOW_GENERATED',
          previousLatest
            ? `SOW v${version} generated (supersedes v${previousLatest}).`
            : `SOW v${version} generated for ${eng.clientName as string}.`,
        );
      } catch {
        // Non-fatal.
      }
      await db.updateJob(jobId, { status: 'COMPLETE', completedAt: new Date().toISOString() });
      return;
    }

    // Phase 46.3 — PROPOSAL is the pre-sales 7-doc bundle (cover
    // letter, executive summary, solution overview, implementation
    // approach, pricing schedule, why-us, T&Cs). Inputs are pulled
    // from EngagementDiscoveryLite + FirmSettings + a small set of
    // pricing defaults; the generator stays pure.
    if ((job.type as string) === 'PROPOSAL') {
      const { generateProposal } = await import('./generators/proposalGenerator.js');
      const dl = await db.findDiscoveryLite(eng.id as string);
      const dlAnswers = (dl?.answers ?? {}) as Record<string, unknown>;
      const license = (eng.license ?? {}) as Record<string, any>;

      // Resolve modules of interest. Discovery Lite's
      // 'modules.interest' is an array of module ids; if the prospect
      // skipped DL, fall back to whatever's on the license.
      const dlModules = Array.isArray(dlAnswers['modules.interest'])
        ? (dlAnswers['modules.interest'] as string[])
        : (license.modules as string[] | undefined) ?? [];
      let modulesOfInterest: Array<{ id: string; label: string }> = [];
      try {
        const adaptor = (await import('@ofoq/adaptor-registry')).getAdaptorRegistry().find(adaptorId);
        const catalog = adaptor?.license?.modules ?? [];
        const labelOf = new Map<string, string>(
          catalog.map((m: { id: string; label?: string }) => [m.id, m.label ?? m.id]),
        );
        modulesOfInterest = dlModules.map((id) => ({
          id,
          label: labelOf.get(id) ?? id,
        }));
      } catch {
        modulesOfInterest = dlModules.map((id) => ({ id, label: id }));
      }

      const firm = await db.findFirmById((eng as Record<string, unknown>).firmId as string);
      const firmName = (firm as { name?: string } | null)?.name ?? 'Our firm';

      // Pricing defaults — until Phase 46.3 frontend lets the firm
      // configure these, every adaptor uses the same per-module price.
      const defaultPerUserPrice = 1200;
      const perUserPricing: Record<string, number> = {};

      const proposalOutputs = generateProposal({
        clientName: eng.clientName as string,
        decisionMakerName:
          typeof dlAnswers['decisionMaker.name'] === 'string'
            ? (dlAnswers['decisionMaker.name'] as string)
            : null,
        adaptorId,
        adaptorName: isNetSuite ? 'NetSuite' : adaptorId,
        pains: Array.isArray(dlAnswers['painPoints'])
          ? (dlAnswers['painPoints'] as string[])
          : [],
        modulesOfInterest,
        estimatedUsers:
          typeof dlAnswers['scope.users'] === 'number' ? (dlAnswers['scope.users'] as number) : 25,
        estimatedLocations:
          typeof dlAnswers['scope.locations'] === 'number'
            ? (dlAnswers['scope.locations'] as number)
            : 1,
        geographyMultiEntity:
          (dlAnswers['geography.multiEntity'] as 'single' | 'single-country-multi-entity' | 'multi-country' | undefined) ??
          'single',
        targetGoLive:
          typeof dlAnswers['timeline.targetGoLive'] === 'string'
            ? (dlAnswers['timeline.targetGoLive'] as string)
            : 'tbd',
        perUserPricing,
        defaultPerUserPrice,
        firmName,
        firmWhyUs: null,
        firmCoverLetterTemplate: null,
        firmTermsAndConditions: null,
        preparedByName: null,
        preparedByEmail: null,
        preparedAt: new Date().toISOString().slice(0, 10),
      });
      for (const [filepath, content] of Object.entries(proposalOutputs)) {
        const full = path.join(rootOutputDir, filepath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
      }
      try {
        await db.logActivity(
          eng.id as string,
          (eng as Record<string, unknown>).firmId as string,
          'PROPOSAL_GENERATED',
          `Proposal bundle generated for ${eng.clientName as string}.`,
        );
      } catch {
        // Non-fatal — generation already succeeded.
      }
      await db.updateJob(jobId, { status: 'COMPLETE', completedAt: new Date().toISOString() });
      return;
    }

    // Phase 45.7 — QUARTERLY_HEALTH_CHECK is the SLA-stage analogue of
    // HANDOFF_PACKAGE: a focused 5-doc bundle summarising the past
    // quarter's ticket performance, open issues, and recommended
    // next actions.
    if ((job.type as string) === 'QUARTERLY_HEALTH_CHECK') {
      const { generateQuarterlyHealthCheck } = await import(
        './generators/quarterlyHealthCheckGenerator.js'
      );
      const { computeTicketSla } = await import('./ticketSla.js');
      const tickets = await db.listTicketsByEngagement(eng.id as string);
      const issues = await db.listIssues(eng.id as string).catch(() => [] as Array<Record<string, unknown>>);
      const activity = await db.listActivity(eng.id as string, 50).catch(() => [] as Array<Record<string, unknown>>);
      const license = (eng.license ?? {}) as Record<string, any>;

      const resolvedTickets: Array<{ severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; createdAt: string; firstResolvedAt: string | null; breached: boolean }> = [];
      const openTickets: Array<{ severity: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; title: string; daysOpen: number }> = [];
      const nowMs = Date.now();
      for (const t of tickets) {
        const firstSupportReplyAt = await db.findFirstSupportReplyAt(t.id);
        const sla = computeTicketSla({
          severity: t.severity,
          status: t.status,
          createdAt: t.createdAt,
          firstSupportReplyAt,
          firstResolvedAt: t.firstResolvedAt,
        });
        const breached = sla.firstResponseBreached || sla.resolutionBreached;
        if (t.status === 'RESOLVED' || t.status === 'CLOSED') {
          resolvedTickets.push({
            severity: t.severity,
            createdAt: t.createdAt,
            firstResolvedAt: t.firstResolvedAt,
            breached,
          });
        } else {
          const daysOpen = Math.floor((nowMs - new Date(t.createdAt).getTime()) / 86_400_000);
          openTickets.push({
            severity: t.severity,
            title: t.title,
            daysOpen,
          });
        }
      }

      const qhcOutputs = generateQuarterlyHealthCheck({
        clientName: eng.clientName as string,
        adaptorId,
        adaptorName: isNetSuite ? 'NetSuite' : adaptorId,
        license: {
          edition: license.edition as string | undefined,
          modules: (license.modules as string[] | undefined) ?? [],
        },
        preparedAt: new Date().toISOString().slice(0, 10),
        resolvedTickets,
        openTickets,
        openIssues: (issues as Array<Record<string, unknown>>).map((i) => ({
          title: String(i.title ?? ''),
          priority: String(i.priority ?? 'MEDIUM'),
          owner: (i.owner as string | null | undefined) ?? null,
        })),
        recentActivity: (activity as Array<Record<string, unknown>>).map((a) => ({
          action: String(a.action ?? ''),
          details: String(a.details ?? ''),
          createdAt: String(a.createdAt ?? ''),
        })),
      });
      for (const [filepath, content] of Object.entries(qhcOutputs)) {
        const full = path.join(rootOutputDir, filepath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
      }
      await db.updateJob(jobId, { status: 'COMPLETE', completedAt: new Date().toISOString() });
      return;
    }

    // Phase 45.2 — HANDOFF_PACKAGE is a focused 7-doc bundle for the
    // SLA team. Branch early so the BUSINESS_PROFILE 100+-file pipeline
    // doesn't run for this type. Lazy-imported so the generator
    // module isn't loaded for every BUSINESS_PROFILE job.
    if ((job.type as string) === 'HANDOFF_PACKAGE') {
      const { generateHandoffPackage } = await import('./generators/handoffPackageGenerator.js');
      const license = (eng.license ?? {}) as Record<string, any>;
      const profile = (eng.profile ?? {}) as Record<string, any>;
      const memberRows = await db.getMembers(eng.id as string);
      const checklistRows = await db.listCloseoutChecklist(eng.id as string).catch(() => []);
      const handoffOutputs = generateHandoffPackage({
        clientName: eng.clientName as string,
        adaptorId,
        adaptorName: isNetSuite ? 'NetSuite' : adaptorId,
        license: {
          edition: license.edition as string | undefined,
          modules: (license.modules as string[] | undefined) ?? [],
        },
        answers: profile.answers ?? {},
        members: (memberRows as Array<Record<string, unknown>>).map((m) => ({
          name: String(m.name ?? ''),
          email: (m.email as string | null | undefined) ?? null,
          role: (m.role as string | null | undefined) ?? null,
          team: (m.team as string | null | undefined) ?? null,
        })),
        checklist: checklistRows.map((c) => ({
          key: c.key,
          status: c.status,
          notes: c.notes,
          completedBy: c.completedBy,
          completedAt: c.completedAt,
        })),
        slaTier: 'SILVER',
        preparedAt: new Date().toISOString().slice(0, 10),
        integrations: {
          integrationOwnersByName: profile.answers?.['integrations.catalog.integrationOwners'] as string | undefined,
          integrationAuthMethods: profile.answers?.['integrations.catalog.authMethods'] as string | undefined,
        },
      });
      for (const [filepath, content] of Object.entries(handoffOutputs)) {
        const full = path.join(rootOutputDir, filepath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
      }
      // Phase 45.1 auto-detect — flip SYSTEM_CATALOG_REVIEWED to
      // IN_PROGRESS now that the system catalog has been emitted.
      try {
        await db.updateCloseoutChecklistItem({
          engagementId: eng.id as string,
          key: 'SYSTEM_CATALOG_REVIEWED',
          status: 'IN_PROGRESS',
          byUserId: 'SYSTEM',
        });
      } catch {
        // Non-fatal — engagement may not be in CLOSEOUT yet.
      }
      await db.updateJob(jobId, { status: 'COMPLETE', completedAt: new Date().toISOString() });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- license/profile are JSON-blob columns; nested indexing prevents narrower typing without a generator-wide refactor (§6.1).
    const license = (eng.license ?? {}) as Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see license-cast comment above.
    const profile = (eng.profile ?? {}) as Record<string, any>;
    const answers = profile.answers ?? {};

    // Phase 25 — compute the effective ns.design.standardRoleCustomization
    // value once for the whole generation pass. When the structured editor
    // (ns.design.standardRolesStructured) is populated, the legacy textarea
    // is treated as empty so:
    //   1. sdfRoleGenerator (Pack C) skips emit (structured generator emits
    //      its own customrole_*.xml set instead).
    //   2. signOffMatrix / perRoleTrainingGuide / trainingMatrix doc generators
    //      see "no NetSuite roles" rather than stale legacy data — keeps
    //      docs and SDF in sync per Phase 23 precedence pattern.
    // When the structured key is empty, this passes through the legacy
    // textarea unchanged.
    const effectiveStandardRoleCustomization = resolveLegacyStandardRoleCustomization(
      answers['ns.design.standardRoleCustomization'] as string | null | undefined,
      answers['ns.design.standardRolesStructured'] as string | null | undefined,
    );

    // Load rich content (comments, images, AI advice)
    const comments = await db.getSectionComments(eng.id);
    const images = await db.getSectionImages(eng.id);
    const aiAdvice = await db.getAllAIAdvice(eng.id);

    // ── 1. Platform-neutral document pack (runs for every adaptor) ──────────
    const editionId = (license.edition as string | undefined)
      ?? (isNetSuite ? 'MID_MARKET' : 'DEFAULT');
    const adaptorCtx = buildAdaptorContext(adaptorId, editionId);

    const brdData = {
      clientName: eng.clientName as string,
      adaptor: adaptorCtx,
      license: {
        edition: editionId,
        modules: license.modules ?? [],
      },
      answers,
      comments,
      images,
      aiAdvice,
    };

    const brdMarkdown = generateBRD(brdData);
    await fs.writeFile(path.join(docDir, 'BRD.md'), brdMarkdown);
    const brdHtml = generateBRDHtml(brdData);
    await fs.writeFile(path.join(docDir, 'BRD.html'), brdHtml);
    // Phase 39.2 — render the PDF directly from the markdown source so the
    // pipeline doesn't depend on Chromium. Produces a real, paginated,
    // typographically reasonable PDF instead of the previous 837-byte
    // placeholder.
    await convertMarkdownToPdf(brdMarkdown, path.join(docDir, 'BRD.pdf'), { title: `BRD — ${eng.clientName}` });

    // Project Kickoff — universal pack (runs for every adaptor). Pulls
    // engagement project members for stakeholder map + RACI auto-fill.
    const memberRows = await db.getMembers(eng.id as string);
    const members: KickoffMember[] = (memberRows as Array<Record<string, unknown>>).map((m) => ({
      name: String(m.name ?? ''),
      role: String(m.role ?? ''),
      team: String(m.team ?? 'CLIENT'),
      email: m.email == null ? null : String(m.email),
      phone: m.phone == null ? null : String(m.phone),
    }));
    const kickoffData = {
      clientName: eng.clientName as string,
      adaptor: adaptorCtx,
      answers,
      members,
    };
    await fs.writeFile(path.join(docDir, 'Project_Kickoff.md'), generateKickoff(kickoffData));
    await fs.writeFile(path.join(docDir, 'Project_Kickoff.html'), generateKickoffHtml(kickoffData));

    const riskContent = generateRiskRegister({
      clientName: eng.clientName as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conflicts is JSON-blob; keep loose for now per §6.1 plan.
      conflicts: eng.conflicts?.filter((c: any) => c.severity === 'BLOCK') ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conflicts is JSON-blob; keep loose for now per §6.1 plan.
      warnings: eng.conflicts?.filter((c: any) => c.severity === 'WARN') ?? [],
    });
    await fs.writeFile(path.join(docDir, 'Risk_Register.md'), riskContent);

    const uatData = { clientName: eng.clientName as string, adaptor: adaptorCtx, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'UAT_Plan.md'), generateUATPlan(uatData));
    await fs.writeFile(path.join(docDir, 'UAT_Plan.html'), generateUATPlanHtml(uatData));

    // ── Pack T — Test Artifacts (CROSS-PLATFORM) ─────────────────────────────
    // Five generators run unconditionally on every adaptor — test
    // artefacts are platform-agnostic. Reads the TESTING flow's wizard
    // answers (testing.scope.scenariosPerWorkstream / testRoles /
    // acceptanceCriteriaTemplate / performanceBenchmarks / loadProfile /
    // regressionSmokeScenarios / defectSeverityLevels). Emits to
    // Documentation/Test_Scripts/ + Documentation/Sign_Off_Matrix.{md,html}
    // + Documentation/Defect_Log_Template.md +
    // Documentation/Performance_Test_Plan.{md,html} +
    // Documentation/Regression_Test_Suite.{md,html}.
    const testScriptsResult = generateTestScripts({
      scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string | undefined,
      testRoles: answers['testing.scope.testRoles'] as string | undefined,
      acceptanceCriteriaTemplate: answers['testing.scope.acceptanceCriteriaTemplate'] as
        | string
        | undefined,
      adaptorName: adaptorCtx.name,
    });
    // testScriptGenerator emits files keyed by their full bundle-relative
    // path (Documentation/Test_Scripts/TC-*.md) — we have to peel off
    // the Documentation/ prefix and write them under docDir.
    const testScriptsDir = path.join(docDir, 'Test_Scripts');
    if (testScriptsResult.emitted.length > 0) {
      await fs.mkdir(testScriptsDir, { recursive: true });
    }
    for (const [bundlePath, content] of Object.entries(testScriptsResult.files)) {
      const rel = bundlePath.replace(/^Documentation\//, '');
      const fullPath = path.join(docDir, rel);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // Sign-off matrix — wired to engagement members (CLIENT + CONSULTANT
    // teams) so per-workstream + per-role rows have real names where
    // possible.
    const signoffMembers: SignOffMember[] = (memberRows as Array<Record<string, unknown>>).map(
      (m) => ({
        name: String(m.name ?? ''),
        role: String(m.role ?? ''),
        team: String(m.team ?? 'CLIENT'),
      }),
    );
    const signOffResult = generateSignOffMatrix({
      clientName: eng.clientName as string,
      scenariosPerWorkstream: answers['testing.scope.scenariosPerWorkstream'] as string | undefined,
      testRoles: answers['testing.scope.testRoles'] as string | undefined,
      // Pack C standardRoleCustomization supplements the role list when
      // present (NetSuite engagements). Other adaptors don't have this
      // answer; the generator handles the empty case gracefully.
      // Phase 25 — uses the precedence-resolved value so structured-editor
      // engagements don't re-emit stale legacy textarea data here.
      standardRoleCustomization: effectiveStandardRoleCustomization,
      members: signoffMembers,
      adaptorName: adaptorCtx.name,
    });
    await fs.writeFile(path.join(docDir, 'Sign_Off_Matrix.md'), signOffResult.markdown);
    await fs.writeFile(path.join(docDir, 'Sign_Off_Matrix.html'), signOffResult.html);

    const defectLogResult = generateDefectLogTemplate({
      clientName: eng.clientName as string,
      defectSeverityLevels: answers['testing.regression.defectSeverityLevels'] as string | undefined,
      adaptorName: adaptorCtx.name,
    });
    await fs.writeFile(path.join(docDir, 'Defect_Log_Template.md'), defectLogResult.markdown);

    const perfPlanResult = generatePerformanceTestPlan({
      clientName: eng.clientName as string,
      performanceBenchmarks: answers['testing.performance.performanceBenchmarks'] as string | undefined,
      loadProfile: answers['testing.performance.loadProfile'] as string | undefined,
      adaptorName: adaptorCtx.name,
    });
    await fs.writeFile(path.join(docDir, 'Performance_Test_Plan.md'), perfPlanResult.markdown);
    await fs.writeFile(path.join(docDir, 'Performance_Test_Plan.html'), perfPlanResult.html);

    const regressionResult = generateRegressionTestSuite({
      clientName: eng.clientName as string,
      regressionSmokeScenarios: answers['testing.regression.regressionSmokeScenarios'] as
        | string
        | undefined,
      adaptorName: adaptorCtx.name,
    });
    await fs.writeFile(path.join(docDir, 'Regression_Test_Suite.md'), regressionResult.markdown);
    await fs.writeFile(path.join(docDir, 'Regression_Test_Suite.html'), regressionResult.html);

    // ── Pack U — Training Collateral (CROSS-PLATFORM) ───────────────────────
    // Five generators run unconditionally on every adaptor. Reads the
    // TRAINING flow's wizard answers + cross-pack inputs:
    //   - training.curriculum.* (Pack U)
    //   - training.schedule.*   (Pack U)
    //   - training.assessment.* (Pack U)
    //   - ns.design.standardRoleCustomization (Pack C — supplementary
    //     role list for engagements that didn't repeat them in
    //     trainingPerRole)
    //   - kickoff.mandate.targetGoLiveDate (KICKOFF — drives schedule
    //     reverse-from-go-live logic)
    //   - Pack W approval flags + foundation flags (drive QRC scope)
    //   - ns.design.customRecords (Pack K — drives per-record QRCs)
    //   - ns.design.inboundIntegrations / outboundIntegrations
    //     (Pack 3 — drive KT checklist integration walk-through lines)
    //
    // Emits to Documentation/Training/<Role>_Training_Guide.md (one per
    // role) + Documentation/Training/Quick_Reference_Cards/QRC-*.md +
    // Documentation/Training_Matrix.{md,html} +
    // Documentation/Training_Schedule.{md,html} +
    // Documentation/KT_Checklist.md.
    const perRoleResult = generatePerRoleTrainingGuides({
      clientName: eng.clientName as string,
      trainingPerRole: answers['training.curriculum.trainingPerRole'] as string | undefined,
      // Phase 25 — uses the precedence-resolved value so structured-editor
      // engagements don't show stale legacy textarea roles in training docs.
      standardRoleCustomization: effectiveStandardRoleCustomization,
      cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string | undefined,
      deliveryMode: answers['training.schedule.deliveryMode'] as string | undefined,
      assessmentRequired: answers['training.assessment.assessmentRequired'] === true,
      assessmentFormat: answers['training.assessment.assessmentFormat'] as string | undefined,
      adaptorName: adaptorCtx.name,
    });
    if (perRoleResult.emitted.length > 0) {
      await fs.mkdir(path.join(docDir, 'Training'), { recursive: true });
    }
    for (const [bundlePath, content] of Object.entries(perRoleResult.files)) {
      const rel = bundlePath.replace(/^Documentation\//, '');
      const fullPath = path.join(docDir, rel);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // Quick Reference Cards — workstream-canonical + per-custom-record.
    // Scope flags drive which conditional QRCs emit; same flag policy
    // as the Pack T test scripts.
    const qrcResult = generateQuickReferenceCards({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      poApprovalInScope:
        answers['ns.approvals.poApprovalInScope'] === true ||
        (typeof answers['p2p.purchasing.poApprovalTiers'] === 'string' &&
          (answers['p2p.purchasing.poApprovalTiers'] as string).trim().length > 0),
      multiCurrencyInScope:
        answers['ns.foundation.multiCurrencyInScope'] === true ||
        answers['odoo.foundation.multiCurrency'] === true,
      mfgInScope:
        Object.keys(answers).some((k) => k.startsWith('mfg.') || k.startsWith('odoo.mfg.')),
      inventoryInScope:
        answers['o2c.fulfillment.pickPackShip'] === true ||
        Object.keys(answers).some((k) => k.startsWith('odoo.inventory.')),
      customRecords: answers['ns.design.customRecords'] as string | undefined,
    });
    for (const [bundlePath, content] of Object.entries(qrcResult.files)) {
      const rel = bundlePath.replace(/^Documentation\//, '');
      const fullPath = path.join(docDir, rel);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
    }

    // Training Matrix — per-role × per-workstream coverage grid.
    const matrixResult = generateTrainingMatrix({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      trainingPerRole: answers['training.curriculum.trainingPerRole'] as string | undefined,
      // Phase 25 — uses the precedence-resolved value so structured-editor
      // engagements don't show stale legacy textarea roles in the matrix.
      standardRoleCustomization: effectiveStandardRoleCustomization,
      // Workstream scope flags — when none provided the matrix renders
      // all 9 columns (best-guess complete). When any explicit flag is
      // provided the matrix filters to in-scope columns only.
      r2rInScope: Object.keys(answers).some((k) => k.startsWith('r2r.')),
      p2pInScope: Object.keys(answers).some((k) => k.startsWith('p2p.')),
      o2cInScope: Object.keys(answers).some((k) => k.startsWith('o2c.')),
      invInScope: Object.keys(answers).some(
        (k) => k.startsWith('odoo.inventory.') || k === 'o2c.fulfillment.multipleLocations',
      ),
      mfgInScope: Object.keys(answers).some(
        (k) => k.startsWith('mfg.') || k.startsWith('odoo.mfg.'),
      ),
      rtnInScope: Object.keys(answers).some((k) => k.startsWith('rtn.') || k.startsWith('odoo.returns.')),
      crmInScope: answers['odoo.operations.crmInScope'] === true,
      hrInScope: answers['odoo.operations.hrInScope'] === true,
      itInScope: answers['ns.foundation.ssoInScope'] === true,
    });
    await fs.writeFile(path.join(docDir, 'Training_Matrix.md'), matrixResult.markdown);
    await fs.writeFile(path.join(docDir, 'Training_Matrix.html'), matrixResult.html);

    // Training Schedule — auto-staggered from KICKOFF go-live date.
    const scheduleResult = generateTrainingSchedule({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      trainingSessions: answers['training.schedule.trainingSessions'] as string | undefined,
      deliveryMode: answers['training.schedule.deliveryMode'] as string | undefined,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(path.join(docDir, 'Training_Schedule.md'), scheduleResult.markdown);
    await fs.writeFile(path.join(docDir, 'Training_Schedule.html'), scheduleResult.html);

    // KT Checklist — final transition gate. Workstreams + integrations
    // drive the run-book + configuration walk-through bullet lists.
    const ktWorkstreams: string[] = [];
    if (Object.keys(answers).some((k) => k.startsWith('r2r.'))) ktWorkstreams.push('R2R');
    if (Object.keys(answers).some((k) => k.startsWith('p2p.'))) ktWorkstreams.push('P2P');
    if (Object.keys(answers).some((k) => k.startsWith('o2c.'))) ktWorkstreams.push('O2C');
    if (
      Object.keys(answers).some(
        (k) => k.startsWith('odoo.inventory.') || k === 'o2c.fulfillment.multipleLocations',
      )
    )
      ktWorkstreams.push('INV');
    if (Object.keys(answers).some((k) => k.startsWith('mfg.') || k.startsWith('odoo.mfg.')))
      ktWorkstreams.push('MFG');
    if (Object.keys(answers).some((k) => k.startsWith('rtn.') || k.startsWith('odoo.returns.')))
      ktWorkstreams.push('RTN');
    if (answers['odoo.operations.crmInScope'] === true) ktWorkstreams.push('CRM');
    if (answers['odoo.operations.hrInScope'] === true) ktWorkstreams.push('HR');

    // Combine inbound + outbound integrations into a single text block;
    // the generator parses each line and emits a walk-through tickbox.
    const inbound = (answers['ns.design.inboundIntegrations'] as string | undefined) ?? '';
    const outbound = (answers['ns.design.outboundIntegrations'] as string | undefined) ?? '';
    const integrationsList = [inbound, outbound].filter((s) => s.trim().length > 0).join('\n');

    const ktResult = generateKnowledgeTransferChecklist({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      cascadeStrategy: answers['training.curriculum.cascadeStrategy'] as string | undefined,
      workstreamsInScope: ktWorkstreams,
      integrationsList: integrationsList.length > 0 ? integrationsList : undefined,
    });
    await fs.writeFile(path.join(docDir, 'KT_Checklist.md'), ktResult.markdown);

    // ── Pack V — Cutover Runbook (CROSS-PLATFORM) ────────────────────────────
    // Seven generators emit to Documentation/Cutover/. Reuses migration
    // inputs (cutoverStyle / cutoverWindowHours / preFreezeDays) across
    // both adaptors via the namespaces NS uses (ns.foundation.* +
    // p2p.* etc) and Odoo uses (odoo.migration.*). All Pack V wizard
    // answers live under cutover.{team,decisions,communication}.*.
    const cutoverDir = path.join(docDir, 'Cutover');
    await fs.mkdir(cutoverDir, { recursive: true });

    // cutoverStyle resolution — Odoo has the explicit answer; NS demos
    // typically use BIG_BANG by default (no NS-equivalent answer today).
    const cutoverStyleAnswer =
      (answers['odoo.migration.cutoverStyle'] as string | undefined) ??
      (answers['cutover.style'] as string | undefined) ??
      'BIG_BANG';
    const cutoverWindowHours =
      (typeof answers['odoo.migration.cutoverWindowHours'] === 'number'
        ? (answers['odoo.migration.cutoverWindowHours'] as number)
        : undefined) ?? 36;
    const preFreezeDays =
      (typeof answers['odoo.migration.preFreezeDays'] === 'number'
        ? (answers['odoo.migration.preFreezeDays'] as number)
        : undefined) ?? 3;
    const parallelRunDays =
      typeof answers['odoo.migration.parallelRunDays'] === 'number'
        ? (answers['odoo.migration.parallelRunDays'] as number)
        : undefined;

    // Phase 41.1 — pipe migration objects + license modules through so
    // the runbook's BIG_BANG extract row and PHASED_MODULE wave table
    // are derived from the engagement, not hardcoded SaaS-speak. Lazy
    // import so the migrationHelpers dep doesn't get pulled into tests
    // that exercise other parts of generation.ts.
    const { objectsInScope } = await import('./generators/migrationHelpers.js');
    const cutoverMigrationObjects = objectsInScope({
      adaptorName: adaptorCtx.name,
      answers: answers as Record<string, unknown>,
    }).map((o) => ({ id: o.id, label: o.label }));

    const runbookResult = generateCutoverRunbook({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      cutoverStyle: cutoverStyleAnswer,
      cutoverWindowHours,
      preFreezeDays,
      parallelRunDays,
      cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string | undefined,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
      dryRunDates: answers['cutover.team.dryRunDates'] as string | undefined,
      migrationObjects: cutoverMigrationObjects,
      licenseModules: license.modules ?? [],
    });
    await fs.writeFile(path.join(cutoverDir, 'Cutover_Runbook.md'), runbookResult.markdown);
    await fs.writeFile(path.join(cutoverDir, 'Cutover_Runbook.html'), runbookResult.html);

    const goNoGoResult = generateGoNoGoMatrix({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      goNoGoCriteria: answers['cutover.decisions.goNoGoCriteria'] as string | undefined,
      goNoGoOwners: answers['cutover.decisions.goNoGoOwners'] as string | undefined,
      cutoverWindowHours,
    });
    await fs.writeFile(path.join(cutoverDir, 'Go_No_Go_Matrix.md'), goNoGoResult.markdown);

    const rollbackResult = generateRollbackPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      rollbackTriggers: answers['cutover.decisions.rollbackTriggers'] as string | undefined,
      cutoverStyle: cutoverStyleAnswer,
    });
    await fs.writeFile(path.join(cutoverDir, 'Rollback_Plan.md'), rollbackResult.markdown);

    // Post-cutover smoke pulls roles from Pack U trainingPerRole if
    // populated; falls back to ns.design.standardRoleCustomization.
    const cutoverRoles: string[] = [];
    const trpr = (answers['training.curriculum.trainingPerRole'] as string | undefined) ?? '';
    for (const line of trpr.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx < 0) continue;
      cutoverRoles.push(trimmed.slice(0, colonIdx).trim());
    }
    const smokeResult = generatePostCutoverSmoke({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      regressionSmokeScenarios:
        answers['testing.regression.regressionSmokeScenarios'] as string | undefined,
      poApprovalInScope: answers['ns.approvals.poApprovalInScope'] === true,
      vbApprovalInScope: answers['ns.approvals.vbApprovalInScope'] === true,
      ssoInScope: answers['ns.foundation.ssoInScope'] === true,
      multiCurrencyInScope:
        answers['ns.foundation.multiCurrencyInScope'] === true ||
        answers['odoo.foundation.multiCurrency'] === true,
      roles: cutoverRoles,
    });
    await fs.writeFile(path.join(cutoverDir, 'Post_Cutover_Smoke.md'), smokeResult.markdown);

    const commPlanResult = generateCutoverCommPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      cutoverMilestones: answers['cutover.communication.cutoverMilestones'] as string | undefined,
      escalationContacts: answers['cutover.communication.escalationContacts'] as string | undefined,
      cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string | undefined,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
      cutoverWindowHours,
    });
    await fs.writeFile(path.join(cutoverDir, 'Communication_Plan.md'), commPlanResult.markdown);

    const dryRunResult = generateDryRunPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      dryRunCount:
        typeof answers['cutover.team.dryRunCount'] === 'number'
          ? (answers['cutover.team.dryRunCount'] as number)
          : undefined,
      dryRunDates: answers['cutover.team.dryRunDates'] as string | undefined,
      cutoverStyle: cutoverStyleAnswer,
    });
    await fs.writeFile(path.join(cutoverDir, 'Dry_Run_Plan.md'), dryRunResult.markdown);

    const teamRosterResult = generateCutoverTeamRoster({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      cutoverTeamRoster: answers['cutover.team.cutoverTeamRoster'] as string | undefined,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(cutoverDir, 'Cutover_Team_Roster.md'),
      teamRosterResult.markdown,
    );

    // ── Pack X — Hypercare Program (CROSS-PLATFORM) ─────────────────────────
    // Seven generators emit to Documentation/Hypercare/. Reuses
    // hypercare.* wizard answers + targetGoLiveDate + integrations
    // from Pack 3. Workstream scope drives power-user-office-hours
    // topic list. Adaptor-conditional vendor channel (L4 escalation
    // tier) + KPI data sources branch on adaptorName.
    const hypercareDir = path.join(docDir, 'Hypercare');
    await fs.mkdir(hypercareDir, { recursive: true });

    const hypercareDurationDays =
      typeof answers['hypercare.sla.hypercareDurationDays'] === 'number'
        ? (answers['hypercare.sla.hypercareDurationDays'] as number)
        : 30;

    // Combine inbound + outbound integrations (NetSuite) — Odoo doesn't
    // have an equivalent answer today; the helpers handle empty input.
    const inboundForHypercare =
      (answers['ns.design.inboundIntegrations'] as string | undefined) ?? '';
    const outboundForHypercare =
      (answers['ns.design.outboundIntegrations'] as string | undefined) ?? '';
    const hypercareIntegrations = [inboundForHypercare, outboundForHypercare]
      .filter((s) => s.trim().length > 0)
      .join('\n');

    const hypercarePlanResult = generateHypercarePlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      hypercareTeamRoster: answers['hypercare.team.hypercareTeamRoster'] as string | undefined,
      sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string | undefined,
      hypercareDurationDays,
      severityDefinitions: answers['hypercare.sla.severityDefinitions'] as string | undefined,
      responseTimeBySeverity: answers['hypercare.sla.responseTimeBySeverity'] as
        | string
        | undefined,
      businessHoursDefinition: answers['hypercare.sla.businessHoursDefinition'] as
        | string
        | undefined,
      dailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string | undefined,
      weeklyReviewTime: answers['hypercare.cadence.weeklyReviewTime'] as string | undefined,
      warRoomHours: answers['hypercare.cadence.warRoomHours'] as string | undefined,
      hypercareExitCriteria: answers['hypercare.cadence.hypercareExitCriteria'] as
        | string
        | undefined,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Hypercare_Plan.md'),
      hypercarePlanResult.markdown,
    );

    const dailyReadinessResult = generateDailyReadinessChecklist({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareDurationDays,
      integrationsList: hypercareIntegrations.length > 0 ? hypercareIntegrations : undefined,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Daily_Readiness_Checklist.md'),
      dailyReadinessResult.markdown,
    );

    const escalationMatrixResult = generateIssueEscalationMatrix({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      severityDefinitions: answers['hypercare.sla.severityDefinitions'] as string | undefined,
      responseTimeBySeverity: answers['hypercare.sla.responseTimeBySeverity'] as
        | string
        | undefined,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Issue_Escalation_Matrix.md'),
      escalationMatrixResult.markdown,
    );

    const warRoomResult = generateWarRoomSop({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareDurationDays,
      warRoomHours: answers['hypercare.cadence.warRoomHours'] as string | undefined,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      dailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as string | undefined,
    });
    await fs.writeFile(path.join(hypercareDir, 'War_Room_SOP.md'), warRoomResult.markdown);

    const transitionResult = generateTransitionToSupportPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      sustainmentOwner: answers['hypercare.team.sustainmentOwner'] as string | undefined,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      hypercareDurationDays,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Transition_To_Support_Plan.md'),
      transitionResult.markdown,
    );

    const kpiDashboardResult = generateHypercareKpiDashboard({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      integrationsList: hypercareIntegrations.length > 0 ? hypercareIntegrations : undefined,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Hypercare_KPI_Dashboard.md'),
      kpiDashboardResult.markdown,
    );

    // Power-user office hours — workstream scope reuses the same
    // detection logic as Pack U / KT checklist.
    const hypercareWorkstreams: string[] = [];
    if (Object.keys(answers).some((k) => k.startsWith('r2r.'))) hypercareWorkstreams.push('R2R');
    if (Object.keys(answers).some((k) => k.startsWith('p2p.'))) hypercareWorkstreams.push('P2P');
    if (Object.keys(answers).some((k) => k.startsWith('o2c.'))) hypercareWorkstreams.push('O2C');
    if (
      Object.keys(answers).some(
        (k) => k.startsWith('odoo.inventory.') || k === 'o2c.fulfillment.multipleLocations',
      )
    )
      hypercareWorkstreams.push('INV');
    if (Object.keys(answers).some((k) => k.startsWith('mfg.') || k.startsWith('odoo.mfg.')))
      hypercareWorkstreams.push('MFG');
    if (Object.keys(answers).some((k) => k.startsWith('rtn.') || k.startsWith('odoo.returns.')))
      hypercareWorkstreams.push('RTN');
    if (answers['odoo.operations.crmInScope'] === true) hypercareWorkstreams.push('CRM');
    if (answers['odoo.operations.hrInScope'] === true) hypercareWorkstreams.push('HR');
    if (answers['ns.foundation.ssoInScope'] === true) hypercareWorkstreams.push('IT');

    const officeHoursResult = generatePowerUserOfficeHours({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      hypercareDurationDays,
      hypercareLeadName: answers['hypercare.team.hypercareLeadName'] as string | undefined,
      workstreamsInScope: hypercareWorkstreams,
    });
    await fs.writeFile(
      path.join(hypercareDir, 'Power_User_Office_Hours.md'),
      officeHoursResult.markdown,
    );

    // ── Pack Y — Stabilization Roadmap (CROSS-PLATFORM) ──────────────────────
    // Seven generators emit to Documentation/Stabilization/. Reuses
    // stabilization.* wizard answers + targetGoLiveDate (KICKOFF) +
    // hypercare cadence (Pack X) + integrations (Pack 3).
    const stabilizationDir = path.join(docDir, 'Stabilization');
    await fs.mkdir(stabilizationDir, { recursive: true });

    const stabilizationOwner =
      (answers['stabilization.governance.stabilizationOwner'] as string | undefined) ?? '';
    const governanceCommittee =
      (answers['stabilization.governance.governanceCommittee'] as string | undefined) ?? '';
    const decisionCadence =
      (answers['stabilization.governance.decisionCadence'] as string | undefined) ?? '';
    const changeRequestProcess =
      (answers['stabilization.governance.changeRequestProcess'] as string | undefined) ?? '';
    const businessCaseSummary =
      (answers['stabilization.benefits.businessCaseSummary'] as string | undefined) ?? '';
    const benefitsReviewCadence =
      (answers['stabilization.benefits.benefitsReviewCadence'] as string | undefined) ?? '';
    const benefitsReviewOwner =
      (answers['stabilization.benefits.benefitsReviewOwner'] as string | undefined) ?? '';
    const deferredFeatures =
      (answers['stabilization.backlog.deferredFeatures'] as string | undefined) ?? '';
    const knownLimitations =
      (answers['stabilization.backlog.knownLimitations'] as string | undefined) ?? '';
    const phaseTwoScope =
      (answers['stabilization.backlog.phaseTwoScope'] as string | undefined) ?? '';
    const retroFormat =
      (answers['stabilization.learning.retroFormat'] as string | undefined) ?? '';
    const retroDate = (answers['stabilization.learning.retroDate'] as string | undefined) ?? '';
    const lessonsLearnedSeed =
      (answers['stabilization.learning.lessonsLearnedSeed'] as string | undefined) ?? '';

    const stabRoadmapResult = generateStabilizationRoadmap({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      stabilizationOwner,
      governanceCommittee,
      decisionCadence,
      phaseTwoScope,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Stabilization_Roadmap.md'),
      stabRoadmapResult.markdown,
    );

    const lessonsResult = generateLessonsLearned({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      retroFormat,
      retroDate,
      lessonsLearnedSeed,
      stabilizationOwner,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Lessons_Learned_Register.md'),
      lessonsResult.markdown,
    );

    const benefitsResult = generateBenefitsRealizationTracker({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      businessCaseSummary,
      benefitsReviewCadence,
      benefitsReviewOwner,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Benefits_Realization_Tracker.md'),
      benefitsResult.markdown,
    );

    const processBacklogResult = generateProcessImprovementBacklog({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      deferredFeatures,
      knownLimitations,
      phaseTwoScope,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Process_Improvement_Backlog.md'),
      processBacklogResult.markdown,
    );

    const governanceResult = generateContinuousImprovementGovernance({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      governanceCommittee,
      decisionCadence,
      changeRequestProcess,
      stabilizationOwner,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Continuous_Improvement_Governance.md'),
      governanceResult.markdown,
    );

    const kpiEvolutionResult = generateKpiEvolutionPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      businessCaseSummary,
      hypercareDailyStandupTime: answers['hypercare.cadence.dailyStandupTime'] as
        | string
        | undefined,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'KPI_Evolution_Plan.md'),
      kpiEvolutionResult.markdown,
    );

    const phaseTwoResult = generatePhaseTwoCharter({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      phaseTwoScope,
      deferredFeatures,
      stabilizationOwner,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(stabilizationDir, 'Phase_Two_Charter.md'),
      phaseTwoResult.markdown,
    );

    // ── Pack Z — Data Migration Assets (CROSS-PLATFORM) ──────────────────────
    // Eight generators emit to Documentation/Data_Migration/ + nested
    // Templates/ for the per-object CSV files. Adaptor-conditional —
    // NetSuite catalog is 16 objects; Odoo catalog is 10. Headers are
    // byte-for-byte aligned with the adaptor's CSV importer.
    const dataMigrationDir = path.join(docDir, 'Data_Migration');
    const dataMigrationTemplatesDir = path.join(dataMigrationDir, 'Templates');
    await fs.mkdir(dataMigrationTemplatesDir, { recursive: true });

    const sourceSystemsByObject =
      (answers['migration.details.sourceSystemsByObject'] as string | undefined) ?? '';
    const cleansingRulesByObject =
      (answers['migration.details.cleansingRulesByObject'] as string | undefined) ?? '';
    const rejectSlaByObject =
      (answers['migration.details.rejectSlaByObject'] as string | undefined) ?? '';
    const historicalDataDepth =
      (answers['migration.details.historicalDataDepth'] as string | undefined) ?? '';
    const dryRunPassThreshold =
      (answers['migration.readiness.dryRunPassThreshold'] as string | undefined) ?? '';
    const dataQualityOwners =
      (answers['migration.readiness.dataQualityOwners'] as string | undefined) ?? '';
    const migrationCutoffDate =
      (answers['migration.readiness.migrationCutoffDate'] as string | undefined) ?? '';

    // 1. CSV import template bundle — multi-file emit via spread.
    const csvBundleResult = generateCsvImportTemplateBundle({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
    });
    for (const [relativePath, content] of Object.entries(csvBundleResult.files)) {
      // Each entry is "Templates/<NN>_<obj>.csv". Path is relative to
      // Documentation/Data_Migration/ — write under that dir.
      const fullPath = path.join(dataMigrationDir, relativePath);
      await fs.writeFile(fullPath, content);
    }
    await fs.writeFile(
      path.join(dataMigrationTemplatesDir, 'README.md'),
      csvBundleResult.readme,
    );

    // 2. Field mapping workbook.
    const fieldMappingResult = generateFieldMappingWorkbook({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      sourceSystemsByObject,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Field_Mapping_Workbook.md'),
      fieldMappingResult.markdown,
    );

    // 3. Reconciliation queries.
    const reconQueriesResult = generateReconciliationQueries({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Reconciliation_Queries.md'),
      reconQueriesResult.markdown,
    );

    // 4. Cleansing rules.
    const cleansingRulesResult = generateMigrationCleansingRules({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      cleansingRulesByObject,
      dataQualityOwners,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Cleansing_Rules.md'),
      cleansingRulesResult.markdown,
    );

    // 5. Load sequencing (Mermaid DAG).
    const loadSequencingResult = generateMigrationLoadSequencing({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Load_Sequencing.md'),
      loadSequencingResult.markdown,
    );

    // 6. Migration runbook (cross-refs Cutover_Runbook from Pack V).
    const migrationRunbookResult = generateMigrationRunbook({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      historicalDataDepth,
      dryRunPassThreshold,
      migrationCutoffDate,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Migration_Runbook.md'),
      migrationRunbookResult.markdown,
    );

    // 7. Reject handling playbook.
    const rejectPlaybookResult = generateRejectHandlingPlaybook({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      rejectSlaByObject,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Reject_Handling_Playbook.md'),
      rejectPlaybookResult.markdown,
    );

    // 8. Data quality scorecard (T-30/14/7/3/1 readiness gate).
    const dqScorecardResult = generateDataQualityScorecard({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      dryRunPassThreshold,
      dataQualityOwners,
      migrationCutoffDate,
      targetGoLiveDate: answers['kickoff.mandate.targetGoLiveDate'] as string | undefined,
    });
    await fs.writeFile(
      path.join(dataMigrationDir, 'Data_Quality_Scorecard.md'),
      dqScorecardResult.markdown,
    );

    // ── Pack ZZ — Integration Runbooks (CROSS-PLATFORM) ──────────────────────
    // Seven generators emit to Documentation/Integrations/. The runbook
    // bundle is multi-file (one .md per integration in scope under
    // ./Runbooks/). Adaptor-conditional content branches on adaptor name
    // (NetSuite saved-search refs vs Odoo Studio dashboards / SQL views).
    const integrationsDir = path.join(docDir, 'Integrations');
    const integrationsRunbooksDir = path.join(integrationsDir, 'Runbooks');
    await fs.mkdir(integrationsRunbooksDir, { recursive: true });

    const integrationOwnersByName =
      (answers['integrations.catalog.integrationOwnersByName'] as string | undefined) ?? '';
    const integrationAuthMethods =
      (answers['integrations.reliability.integrationAuthMethods'] as string | undefined) ?? '';
    const integrationMonitoring =
      (answers['integrations.reliability.integrationMonitoring'] as string | undefined) ?? '';
    const integrationErrorPatterns =
      (answers['integrations.reliability.integrationErrorPatterns'] as string | undefined) ?? '';
    const integrationVendorContacts =
      (answers['integrations.support.integrationVendorContacts'] as string | undefined) ?? '';
    const integrationReconciliation =
      (answers['integrations.support.integrationReconciliation'] as string | undefined) ?? '';
    const integrationCutoverSmokeTests =
      (answers['integrations.support.integrationCutoverSmokeTests'] as string | undefined) ?? '';

    const integrationsIndexResult = generateIntegrationsIndex({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationOwnersByName,
      integrationVendorContacts,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'README.md'),
      integrationsIndexResult.markdown,
    );

    const integrationCatalogResult = generateIntegrationCatalog({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationOwnersByName,
      integrationVendorContacts,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'Integration_Catalog.md'),
      integrationCatalogResult.markdown,
    );

    const integrationHealthResult = generateIntegrationHealthDashboard({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationMonitoring,
      integrationOwnersByName,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'Integration_Health_Dashboard.md'),
      integrationHealthResult.markdown,
    );

    const integrationReconResult = generateIntegrationReconciliationProcedures({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationReconciliation,
      integrationOwnersByName,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'Reconciliation_Procedures.md'),
      integrationReconResult.markdown,
    );

    const integrationVendorEscResult = generateIntegrationVendorEscalationMatrix({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationVendorContacts,
      integrationOwnersByName,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'Vendor_Escalation_Matrix.md'),
      integrationVendorEscResult.markdown,
    );

    const integrationTestPlanResult = generateIntegrationTestPlan({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationCutoverSmokeTests,
    });
    await fs.writeFile(
      path.join(integrationsDir, 'Integration_Test_Plan.md'),
      integrationTestPlanResult.markdown,
    );

    // Per-integration runbooks via spread.
    const integrationRunbooksResult = generateIntegrationRunbookBundle({
      clientName: eng.clientName as string,
      adaptorName: adaptorCtx.name,
      answers,
      integrationOwnersByName,
      integrationAuthMethods,
      integrationMonitoring,
      integrationErrorPatterns,
      integrationVendorContacts,
      integrationReconciliation,
      integrationCutoverSmokeTests,
    });
    for (const [filename, content] of Object.entries(integrationRunbooksResult.files)) {
      await fs.writeFile(path.join(integrationsRunbooksDir, filename), content);
    }

    const sddData = {
      clientName: eng.clientName as string,
      adaptor: adaptorCtx,
      license: brdData.license,
      answers,
      conflicts: eng.conflicts ?? [],
      comments,
      images,
      aiAdvice,
    };
    await fs.writeFile(path.join(docDir, 'Solution_Design.html'), generateSolutionDocHtml(sddData));

    const trainingData = { clientName: eng.clientName as string, adaptor: adaptorCtx, answers, comments, images, aiAdvice };
    await fs.writeFile(path.join(docDir, 'Training_Manual.html'), generateTrainingManualHtml(trainingData));

    await fs.writeFile(
      path.join(docDir, 'Implementation_Plan.html'),
      generateImplementationPlanHtml({
        clientName: eng.clientName as string,
        adaptor: adaptorCtx,
        license: brdData.license,
        answers,
        conflicts: eng.conflicts ?? [],
      }),
    );

    // ── 2. NetSuite-only artifacts: SDF + SuiteScript ───────────────────────
    if (isNetSuite) {
      const sdfDir = path.join(rootOutputDir, 'SDF');
      const ssDir = path.join(rootOutputDir, 'SuiteScript');
      await fs.mkdir(sdfDir, { recursive: true });
      await fs.mkdir(ssDir, { recursive: true });

      const { files: sdfFiles } = generateSDFPackage({
        modules: license.modules ?? [],
        answers,
        clientName: eng.clientName as string,
      });

      // Real Code Generation — wizard-driven custom records.
      // Reads ns.design.customRecords (NS SD Depth Pack TEXTAREA) and
      // emits one Objects/customrecord_<slug>.xml per declared record.
      // Output goes into the same sdfFiles map so the validator below
      // gates these too. Empty / missing input yields zero files —
      // pre-NS-SD-pack engagements don't have this answer and are
      // unaffected.
      // Pack K — customrecord generator now takes both the records
      // answer (one record per line) and the extras answer (per-record
      // business fields beyond the smart starter set). Empty extras
      // answer → generator behaves as Pack B did (baseline + smart
      // starters only).
      const customRecordsResult = generateSdfCustomRecords({
        customRecordsAnswer: answers['ns.design.customRecords'] as string | undefined,
        customRecordExtraFieldsAnswer: answers['ns.design.customRecordExtraFields'] as string | undefined,
      });
      Object.assign(sdfFiles, customRecordsResult.files);

      // Pack B — BRD custom-field generator. Parses
      // ns.design.customFieldsScope into 1 XML per declared field
      // (custbody / custentity / custitem) with fieldtype inferred via
      // a keyword classifier. Auto-adds custbody_nsix_required_approver
      // when the PO approval User Event script will also be emitted —
      // without that field, the script's setValue() blows up at
      // runtime. Object.assign-merging into sdfFiles puts these next
      // to the heavy generator's output for a single validator pass.
      // Phase 24 precedence: when the structured approval chain answer is
      // populated for PO, synthesise a legacy `poApprovalTiers` TEXTAREA
      // from it in-memory and feed that to the PO User Event script
      // generator. Mirrors Phase 23's precedence pattern — structured wins
      // when present. The persisted answers map is NOT mutated; this is a
      // read-only synthesis at orchestration time so the consultant doesn't
      // have to fill both keys.
      const rawPoApprovalAnswer = answers['p2p.purchasing.poApprovalTiers'];
      const poApprovalChain = parseApprovalChain(
        answers['p2p.purchasing.approvalChainStructured'],
      );
      const synthesisedPoTiers = chainToLegacyTextarea(
        poApprovalChain,
        answers['r2r.currencies.baseCurrency'] as string | null | undefined,
      );
      const poApprovalAnswer = synthesisedPoTiers ?? rawPoApprovalAnswer;
      const willEmitPoScript =
        typeof poApprovalAnswer === 'string' && poApprovalAnswer.trim().length > 0;
      // Phase 23 precedence: when the structured editor answer is
      // populated, the legacy TEXTAREA is gated off so Pack B + Pack H
      // stop emitting — preventing double-emission of fields with
      // disjoint scriptid prefixes (cust*_<slug> vs cust*_nsix_<slug>)
      // landing on the same NetSuite tenant during the migration window.
      // The synthetic includePoApprovalRequiredField auto-add still runs
      // either way — it's required by the PO approval User Event script.
      const effectiveCustomFieldsScope = resolveLegacyCustomFieldsScope(
        answers['ns.design.customFieldsScope'] as string | undefined,
        answers['ns.design.customFieldsStructured'] as string | undefined,
      );

      const customFieldsResult = generateSdfCustomFields({
        customFieldsScopeAnswer: effectiveCustomFieldsScope,
        includePoApprovalRequiredField: willEmitPoScript,
      });
      Object.assign(sdfFiles, customFieldsResult.files);

      // For each SELECT-classified field, emit a placeholder customlist
      // so the SELECT field has a list to point at. Audit Fix #4
      // contract — every customlist must carry at least one
      // customvalue, satisfied here by an inactive placeholder the
      // consultant un-inactivates after review.
      for (const field of customFieldsResult.emitted) {
        if (field.fieldtype !== 'SELECT' || !field.selectListScriptid) continue;
        const listXml = generateSdfCustomList({
          listScriptid: field.selectListScriptid,
          label: field.originalLabel,
        });
        sdfFiles[`Objects/${field.selectListScriptid}.xml`] = listXml;
      }

      // Phase 23 — Structured Custom Fields. Reads the new structured
      // answer key `ns.design.customFieldsStructured` (JSON-stringified
      // Map<recordType, StructuredCustomField[]>) and emits XML with
      // explicit per-field type/required/searchable/showInList/default/
      // helpText. Coexists additively with Pack B — structured uses
      // `cust*_nsix_<slug>` filenames, Pack B uses `cust*_<slug>`. The
      // generator self-gates on adaptorId === 'netsuite' so Odoo bundles
      // get nothing even if the answer is somehow populated.
      const structuredCustomFieldsResult = generateSdfStructuredCustomFields({
        adaptorId,
        structuredAnswer: answers['ns.design.customFieldsStructured'] as
          | string
          | undefined,
      });
      Object.assign(sdfFiles, structuredCustomFieldsResult.files);

      // Same SELECT companion-list contract as Pack B — emit a
      // placeholder customlist for every structured SELECT field.
      for (const field of structuredCustomFieldsResult.emitted) {
        if (field.fieldtype !== 'SELECT' || !field.selectListScriptid) continue;
        const listXml = generateSdfCustomList({
          listScriptid: field.selectListScriptid,
          label: field.originalLabel,
        });
        sdfFiles[`Objects/${field.selectListScriptid}.xml`] = listXml;
      }

      // Pack H — Custom Forms (Transaction + Entry). Purely derivative
      // from Pack B's custom field map: re-parses the same wizard
      // answer and emits one transactionform / entryform XML per
      // parent record that has at least one Pack B custom field. Each
      // form embeds those fields under a "Custom Fields" fieldgroup so
      // the consultant doesn't have to drag them onto stock forms
      // manually after deploy.
      // Phase 23 precedence applies to Pack H too — both transaction
      // and entry form generators read the same TEXTAREA answer to drag
      // fields onto custom forms. When structured wins, Pack H gets
      // empty input → no auto-form-embedding. Documented Phase 23.5
      // follow-up to bridge structured fields into form layout.
      const txnFormsResult = generateTransactionForms({
        customFieldsScope: effectiveCustomFieldsScope,
        clientName: eng.clientName as string,
        poApprovalInScope: willEmitPoScript,
      });
      Object.assign(sdfFiles, txnFormsResult.files);

      const entryFormsResult = generateEntryForms({
        customFieldsScope: effectiveCustomFieldsScope,
        clientName: eng.clientName as string,
      });
      Object.assign(sdfFiles, entryFormsResult.files);

      // Pack A — OneWorld Foundation. Subsidiary + currency XMLs
      // (without these, the bundle fails SDF deploy on a real
      // OneWorld tenant — every customrecord/form/script downstream
      // references subsidiary IDs the tenant can't resolve). Currency
      // XMLs are derived from the parsed subsidiary list so they
      // match exactly what the subsidiaries reference.
      const subsidiariesResult = generateSubsidiaries({
        subsidiaryList: answers['ns.foundation.subsidiaryList'] as string | undefined,
        eliminationEntity: answers['ns.foundation.eliminationEntity'] as string | undefined,
      });
      Object.assign(sdfFiles, subsidiariesResult.files);

      const currencyCodes = extractCurrenciesFromSubsidiaries(subsidiariesResult.emitted);
      const currenciesResult = generateCurrencies({ currencies: currencyCodes });
      Object.assign(sdfFiles, currenciesResult.files);

      // Pack W — SuiteFlow workflows + Workflow Action scripts.
      // Reads the APPROVALS flow's wizard answers (PO/JE/VB/Expense/SO
      // scope flags + tiers + record state machines + notification
      // cadence + escalation days). For each in-scope approval, emits
      // one customworkflow_*.xml. Amount-tiered approvals (PO/JE/VB)
      // also get a companion NSIX_WFA_*_Approval.js that computes
      // NEXT_APPROVER at runtime based on the parsed tiers.
      //
      // The PO UE script from Pack 3 is repositioned as a fallback /
      // legacy implementation pattern (header comment in the emitted
      // script flags this); both UE + workflow artefacts emit when
      // poApprovalInScope is true so the consultant picks at deploy.
      const workflowsResult = generateWorkflows({ answers });
      Object.assign(sdfFiles, workflowsResult.files);

      const wfaScriptsResult = generateWorkflowActionScripts({
        answers,
        firmName: 'NSIX',
        clientName: eng.clientName as string,
      });
      // WFA scripts go under SDF/SuiteScripts/, same shelf as the PO UE
      // script. Object.assign-merge into sdfFiles uses the script's
      // already-prefixed filename ("SuiteScripts/NSIX_WFA_*.js").
      Object.assign(sdfFiles, wfaScriptsResult.files);

      // Pack F — Saved Searches + Dashboards. The starter library
      // (12 universal NS reports) emits unconditionally; the wizard's
      // KPI catalog adds engagement-specific KPIs; each customrecord
      // gets a default list-view savedsearch. Dashboards then bind
      // matching savedsearches as Search portlets per role.
      const savedSearchesResult = generateSavedSearches({
        kpiCatalogAnswer: answers['ns.design.kpiCatalog'] as string | undefined,
        customRecordsAnswer: answers['ns.design.customRecords'] as string | undefined,
      });
      Object.assign(sdfFiles, savedSearchesResult.files);

      const dashboardsResult = generateDashboards({
        roleDashboardsAnswer: answers['ns.design.roleDashboards'] as string | undefined,
        savedSearches: savedSearchesResult.emitted,
      });
      Object.assign(sdfFiles, dashboardsResult.files);

      // Pack C — Roles + Permissions + Account Preferences. Role
      // generation reads ns.design.standardRoleCustomization and emits
      // one customrole_*.xml per declared role with starter perms +
      // customization-notes overlay. Three AccountConfiguration files
      // (companyinformation / accountingpreferences / generalpreferences)
      // ride alongside under SDF/AccountConfiguration/.
      //
      // Phase 25 — structured editor parallel emit. When the structured
      // answer key `ns.design.standardRolesStructured` is populated, the
      // legacy textarea is treated as empty (effectiveStandardRoleCustomization
      // resolves to undefined), preventing double-emission. The structured
      // generator runs alongside and emits its own customrole_*.xml set
      // with per-row override semantics. Same shape as Phase 23 custom
      // fields. Variable hoisted to top of function so doc-gen consumers
      // (signOffMatrix / training guides / training matrix) stay in sync.
      const rolesResult = generateRoles({
        standardRoleCustomization: effectiveStandardRoleCustomization,
      });
      Object.assign(sdfFiles, rolesResult.files);

      const structuredRolesResult = generateSdfStructuredRoles({
        adaptorId: 'netsuite',
        structuredAnswer: answers['ns.design.standardRolesStructured'] as
          | string
          | null
          | undefined,
      });
      Object.assign(sdfFiles, structuredRolesResult.files);

      // Phase 26 — structured templates emit. Reads
      // ns.design.templatesStructured and emits one advancedpdftemplate or
      // emailtemplate XML per row (kind drives the SDF root element).
      // No legacy bridge — templates were never captured before Phase 26.
      const structuredTemplatesResult = generateSdfStructuredTemplates({
        adaptorId: 'netsuite',
        structuredAnswer: answers['ns.design.templatesStructured'] as
          | string
          | null
          | undefined,
      });
      Object.assign(sdfFiles, structuredTemplatesResult.files);

      // Base currency for companyinformation derives from the FIRST
      // parsed subsidiary (the root tenant subsidiary). Fall back to
      // USD when no subsidiary parsed (single-tenant / no foundation
      // subsidiary list).
      const firstSubsidiary = subsidiariesResult.emitted.find((s) => !s.isElimination);
      const baseCurrency = firstSubsidiary?.currency ?? 'USD';

      sdfFiles['AccountConfiguration/accountingpreferences.xml'] = generateAccountingPreferences({
        multiBookAccounting: answers['ns.foundation.multiBookAccounting'] === true,
        advancedRevRecInScope: answers['ns.foundation.advancedRevRecInScope'] === true,
        sodMatrixRequired: answers['ns.design.sodMatrixRequired'] === true,
      });
      sdfFiles['AccountConfiguration/companyinformation.xml'] = generateCompanyInformation({
        clientName: eng.clientName as string,
        primaryCountry: (answers['ns.foundation.primaryCountry'] as string | undefined) ?? '',
        fiscalYearStart: (answers['ns.foundation.fiscalYearStart'] as string | undefined) ?? '01-01',
        baseCurrency,
      });
      sdfFiles['AccountConfiguration/generalpreferences.xml'] = generateGeneralPreferences({
        ssoInScope: answers['ns.foundation.ssoInScope'] === true,
        customRolesRequired: answers['ns.foundation.customRolesRequired'] === true,
        auditLogRetentionMonths:
          typeof answers['ns.design.auditLogRetentionMonths'] === 'number'
            ? (answers['ns.design.auditLogRetentionMonths'] as number)
            : undefined,
      });

      // Pack D — Tax engine. Three generators run in dependency order:
      //   1. Tax types (always emit VAT + Sales Tax + flag-conditional
      //      withholding/use-tax/reverse-charge + matrix-detected GST).
      //   2. Tax codes (parse matrix; auto-supplement starter library
      //      for nexusList countries; reference tax type scriptids
      //      from step 1).
      //   3. Tax schedules (parse matrix; resolve display-name +
      //      jurisdiction → tax code scriptid from step 2; emit
      //      taxschedule XMLs binding code to transaction type).
      const taxTypesResult = generateTaxTypes({
        taxCodeMatrix: answers['ns.tax.taxCodeMatrix'] as string | undefined,
        nexusList: answers['ns.tax.nexusList'] as string | undefined,
        withholdingInScope: answers['ns.tax.withholdingInScope'] === true,
        useTaxInScope: answers['ns.tax.useTaxInScope'] === true,
        reverseChargeInScope: answers['ns.tax.reverseChargeInScope'] === true,
      });
      Object.assign(sdfFiles, taxTypesResult.files);

      const taxCodesResult = generateTaxCodes({
        taxCodeMatrix: answers['ns.tax.taxCodeMatrix'] as string | undefined,
        nexusList: answers['ns.tax.nexusList'] as string | undefined,
      });
      Object.assign(sdfFiles, taxCodesResult.files);

      const taxSchedulesResult = generateTaxSchedules({
        taxScheduleMatrix: answers['ns.tax.taxScheduleMatrix'] as string | undefined,
        taxCodes: taxCodesResult.emitted,
      });
      Object.assign(sdfFiles, taxSchedulesResult.files);

      // Pack A — Manifest now derives features from wizard answers
      // (was hardcoded to {CUSTOMRECORDS, SERVERSIDESCRIPTING}). The
      // heavy generateSDFPackage upstream still emits its own
      // feature-aware manifest, so we only override that output when
      // it doesn't already carry the OneWorld-tier features the
      // wizard answers indicate. Belt-and-braces: the heavy generator's
      // manifest is more granular per-license-module; the lean
      // generator's manifest is more granular per-foundation-flag.
      // Pack A's lean output is the source of truth for the demo
      // driver path; production keeps its existing behaviour where
      // the heavy generator wins.
      const hasSuiteScriptsForManifest = willEmitPoScript;
      const uiLanguagesRaw = answers['ns.localization.uiLanguages'];
      const uiLanguagesArray =
        typeof uiLanguagesRaw === 'string' && uiLanguagesRaw.trim().length > 0
          ? uiLanguagesRaw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0)
          : [];
      if (!sdfFiles['manifest.xml']) {
        sdfFiles['manifest.xml'] = generateSdfManifest({
          firmName: 'NSIX',
          clientName: eng.clientName as string,
          edition: answers['ns.foundation.edition'] as string | undefined,
          multiCurrencyInScope: answers['ns.foundation.multiCurrencyInScope'] === true,
          multiBookAccounting: answers['ns.foundation.multiBookAccounting'] === true,
          advancedRevRecInScope: answers['ns.foundation.advancedRevRecInScope'] === true,
          customRolesRequired: answers['ns.foundation.customRolesRequired'] === true,
          ssoInScope: answers['ns.foundation.ssoInScope'] === true,
          taxEngine: answers['ns.tax.engine'] as string | undefined,
          hasCustomRecords: customRecordsResult.emitted.length > 0,
          hasSuiteScripts: hasSuiteScriptsForManifest,
          hasWorkflows: workflowsResult.emitted.length > 0,
          poApprovalInScope: willEmitPoScript,
          uiLanguages: uiLanguagesArray,
        });
      }
      if (!sdfFiles['deploy.xml']) {
        sdfFiles['deploy.xml'] = generateSdfDeploy();
      }

      // Phase 8: structural SDF validation gate. Fails the job loudly if any
      // generated XML file would be rejected by Oracle's schema — catches
      // regressions to Fixes #1–#6 before they ever hit disk. Default on;
      // opt out with SDF_VALIDATE=0 for local debugging only.
      if (isValidationEnabled()) {
        const validation = validateSDFBundle(sdfFiles);
        if (!validation.ok) {
          const payload = JSON.stringify(validation.errors, null, 2);
          throw new Error(`SDF validation failed with ${validation.errors.length} error(s):\n${payload}`);
        }
      }

      for (const [relPath, content] of Object.entries(sdfFiles)) {
        const fullPath = path.join(sdfDir, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
      }

      // Real-logic SuiteScript — PO approval User Event. First .js file
      // with actual business logic (vs. the legacy generateScripts() path
      // which emits placeholder scaffolds). Reads the free-text wizard
      // answer p2p.purchasing.poApprovalTiers and emits a deployable
      // User Event with parsed thresholds hardcoded. Empty answer skips
      // emission; unparseable answer falls back to a TODO placeholder
      // (the script still emits so the bundle is consistent — consultant
      // hand-fills the tiers). `willEmitPoScript` was computed above
      // for the Pack B custom-fields auto-add branch — same predicate,
      // reused here so both code paths agree.
      if (willEmitPoScript && typeof poApprovalAnswer === 'string') {
        const scriptBody = generatePoApprovalScript({
          approvalTiers: poApprovalAnswer,
          firmName: 'NSIX',
          clientName: eng.clientName as string,
        });
        const sdfScriptDir = path.join(sdfDir, 'SuiteScripts');
        await fs.mkdir(sdfScriptDir, { recursive: true });
        await fs.writeFile(
          path.join(sdfScriptDir, 'NSIX_UE_PurchaseOrderApproval.js'),
          scriptBody,
        );
      }

      const scriptFiles = generateScripts({
        clientName: eng.clientName as string,
        answers,
        modules: license.modules ?? [],
      });
      for (const [filename, content] of Object.entries(scriptFiles)) {
        await fs.writeFile(path.join(ssDir, filename), content);
      }
    } else {
      // ── 2b. Non-NetSuite build artefact: Configuration Plan ────────────────
      // Replaces the NetSuite-only SDF + SuiteScript bundle for Odoo and any
      // future / firm-authored adaptor (custom:*). Module install plan,
      // l10n_<country> localisation, fiscal year setup, and multi-company
      // checklist — the concrete steps the consultant takes after Discovery
      // sign-off on a non-NetSuite platform.
      const configPlanData = {
        clientName: eng.clientName as string,
        adaptor: adaptorCtx,
        license: brdData.license,
        answers,
        comments,
        images,
        aiAdvice,
      };
      await fs.writeFile(
        path.join(docDir, 'Configuration_Plan.md'),
        generateOdooConfigurationPlan(configPlanData),
      );
      await fs.writeFile(
        path.join(docDir, 'Configuration_Plan.html'),
        generateOdooConfigurationPlanHtml(configPlanData),
      );
    }

    // ── 3. Manifest: record which artifacts actually landed ─────────────────
    const manifest = {
      jobId,
      engagementId: eng.id as string,
      adaptorId,
      clientName: eng.clientName as string,
      completedAt: new Date().toISOString(),
      artifacts: {
        documentation: [
          'BRD.md', 'BRD.html', 'BRD.pdf',
          'Risk_Register.md',
          'UAT_Plan.md', 'UAT_Plan.html',
          'Solution_Design.html',
          'Training_Manual.html',
          'Implementation_Plan.html',
          // Pack T — Test Artifacts (cross-platform).
          'Sign_Off_Matrix.md', 'Sign_Off_Matrix.html',
          'Defect_Log_Template.md',
          'Performance_Test_Plan.md', 'Performance_Test_Plan.html',
          'Regression_Test_Suite.md', 'Regression_Test_Suite.html',
          // Pack U — Training Collateral (cross-platform).
          'Training_Matrix.md', 'Training_Matrix.html',
          'Training_Schedule.md', 'Training_Schedule.html',
          'KT_Checklist.md',
          ...(isNetSuite ? [] : ['Configuration_Plan.md', 'Configuration_Plan.html']),
        ],
        testScripts: {
          count: testScriptsResult.emitted.length,
          path: 'Documentation/Test_Scripts/',
        },
        training: {
          perRoleGuides: perRoleResult.emitted.length,
          quickReferenceCards: qrcResult.emitted.length,
          path: 'Documentation/Training/',
        },
        cutover: {
          // Pack V — 7 artefacts under Documentation/Cutover/.
          artefactCount: 7,
          path: 'Documentation/Cutover/',
          cutoverStyle: runbookResult.resolvedStyle,
        },
        hypercare: {
          // Pack X — 7 artefacts under Documentation/Hypercare/.
          artefactCount: 7,
          path: 'Documentation/Hypercare/',
          durationDays: hypercareDurationDays,
        },
        stabilization: {
          // Pack Y — 7 artefacts under Documentation/Stabilization/.
          artefactCount: 7,
          path: 'Documentation/Stabilization/',
        },
        dataMigration: {
          // Pack Z — 7 markdown artefacts + 1 templates folder containing
          // N CSVs (16 NetSuite / 10 Odoo, possibly fewer if BOMs / fixed
          // assets are out of scope) + 1 templates README under
          // Documentation/Data_Migration/.
          artefactCount: 7,
          templateCount: csvBundleResult.objectCount,
          path: 'Documentation/Data_Migration/',
          templatesPath: 'Documentation/Data_Migration/Templates/',
        },
        integrations: {
          // Pack ZZ — 6 markdown artefacts at the folder root + N
          // per-integration runbooks under ./Runbooks/. N = catalog
          // count (11 default for NetSuite, 6 default for Odoo, can vary
          // per overlay). README.md is the master index.
          artefactCount: 6,
          runbookCount: integrationRunbooksResult.runbookCount,
          path: 'Documentation/Integrations/',
          runbooksPath: 'Documentation/Integrations/Runbooks/',
        },
        ...(isNetSuite ? { sdf: 'SDF/', suiteScript: 'SuiteScript/' } : {}),
      },
    };
    await fs.writeFile(path.join(rootOutputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // ── 4. Mark job complete ────────────────────────────────────────────────
    await db.updateJob(jobId, {
      status: 'COMPLETE',
      outputUrl: `/outputs/${jobId}`,
      completedAt: new Date().toISOString(),
    });

    if (process.env.NODE_ENV !== 'production') {
      console.log(`Job ${jobId} complete (adaptor=${adaptorId}). Artifacts generated in ${rootOutputDir}`);
    }
  } catch (error) {
    console.error(`[generation] Job ${jobId} failed:`, error);
    await db.updateJob(jobId, { status: 'FAILED', error: String(error) });
  }
}
