import MarkdownIt from 'markdown-it';
import type { AdaptorContext, AdaptorQuestion } from './brdGenerator.js';
import {
  APPROVAL_FLOW_KEYS,
  parseApprovalChain,
  chainIsEmpty,
  renderApprovalChainSection,
} from './approvalChainHelpers.js';

/** Mirror of brdGenerator.formatAnswer — kept inline so this module
 *  stays standalone. Same input/output contract. */
function fmt(question: AdaptorQuestion, raw: unknown): string {
  if (raw === undefined || raw === null) return '—';
  if (question.inputType === 'BOOLEAN') return raw === true ? 'Yes' : raw === false ? 'No' : '—';
  if (question.inputType === 'SINGLE_SELECT' && question.options) {
    return question.options.find((o) => o.value === raw)?.label ?? String(raw);
  }
  if (question.inputType === 'MULTI_SELECT' && Array.isArray(raw)) {
    if (raw.length === 0) return 'None selected';
    return raw.map((v) => question.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  }
  if (question.inputType === 'TABLE' && Array.isArray(raw)) {
    return raw.length === 0 ? 'None configured' : (raw as string[]).map((r, i) => `${i + 1}. ${r}`).join('\n');
  }
  return String(raw);
}

const md = new MarkdownIt({ html: true, typographer: true });

/**
 * Phase 25 — parse ns.design.standardRolesStructured for solution-doc display.
 * Defensive: handles string, null, undefined, and malformed JSON gracefully.
 * Mirrors the parsing logic in sdfStructuredRolesGenerator but trims to only
 * the fields the solution doc renders (name + 3 overrides + notes).
 */
interface DocStructuredRole {
  name: string;
  centerOverride: string | null;
  restrictionOverride: string | null;
  customizationNotes: string;
}
/**
 * Phase 26 — parse ns.design.templatesStructured for solution-doc display.
 * Defensive — graceful on missing / null / malformed JSON.
 */
interface DocStructuredTemplate {
  name: string;
  kind: string;
  preferred: boolean;
  sections: string[];
  notes: string;
}
function parseStructuredTemplatesForDoc(raw: unknown): DocStructuredTemplate[] {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      name: typeof r.name === 'string' ? r.name : '',
      kind: typeof r.kind === 'string' ? r.kind : '',
      preferred: r.preferred === true,
      sections: Array.isArray(r.sections)
        ? (r.sections as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
      notes: typeof r.notes === 'string' ? r.notes : '',
    }))
    .filter((t) => t.name.trim().length > 0 && t.kind.trim().length > 0);
}

function parseStructuredRolesForDoc(raw: unknown): DocStructuredRole[] {
  if (raw === null || raw === undefined) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return [];
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      name: typeof r.name === 'string' ? r.name : '',
      centerOverride: typeof r.centerOverride === 'string' ? r.centerOverride : null,
      restrictionOverride: typeof r.restrictionOverride === 'string' ? r.restrictionOverride : null,
      customizationNotes: typeof r.customizationNotes === 'string' ? r.customizationNotes : '',
    }))
    .filter((r) => r.name.trim().length > 0);
}

export interface SolutionDocData {
  clientName: string;
  /** Adaptor context — required so prose flexes per platform. Same shape
   *  as BRDData.adaptor, built upstream in services/generation.ts. */
  adaptor: AdaptorContext;
  license: { edition: string; modules: string[] };
  answers: Record<string, any>;
  conflicts: any[];
  comments?: any[];
  images?: any[];
  aiAdvice?: any[];
}

export function generateSolutionDoc(data: SolutionDocData): string {
  const { clientName, adaptor, license, answers, conflicts } = data;
  const now = new Date().toLocaleDateString();
  const blocks = conflicts.filter(c => c.severity === 'BLOCK');
  const warnings = conflicts.filter(c => c.severity === 'WARN');
  const isNetSuite = adaptor.id === 'netsuite';

  // ── Helpers ────────────────────────────────────────────────────────────────
  const yn = (key: string) => answers[key] === true ? 'Yes' : answers[key] === false ? 'No' : '—';
  const val = (key: string, fallback = '—') => answers[key] ?? fallback;
  const hasFlow = (prefix: string) => Object.keys(answers).some(k => k.startsWith(prefix));

  const appendRichContent = (prefix: string) => {
    let out = '';
    const flowComments = data.comments?.filter(c => c.sectionKey.startsWith(prefix));
    const flowImages = data.images?.filter(img => img.sectionKey.startsWith(prefix));
    const flowAdvice = data.aiAdvice?.filter(a => a.sectionKey.startsWith(prefix) && a.advice);

    if (flowComments?.length || flowImages?.length || flowAdvice?.length) {
      out += `#### Design Notes & AI Recommendations\n\n`;
      
      if (flowComments?.length) {
        out += `**Consultant Notes:**\n`;
        flowComments.forEach(c => out += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`);
      }

      if (flowAdvice?.length) {
        out += `**Configuration & Best Practices:**\n`;
        flowAdvice.forEach(a => {
          if (a.advice.suggestions?.length) {
            a.advice.suggestions.forEach((s: any) => out += `- **${s.title}**: ${s.description}\n`);
          }
        });
        out += `\n`;
      }

      if (flowImages?.length) {
        out += `**Attachments:**\n\n`;
        flowImages.forEach(img => out += `![${img.originalName}](/uploads/${img.engagementId}/${img.filename})\n\n`);
      }
    }
    return out;
  };

  let doc = '';

  // ── SECTION 1: Document Control ────────────────────────────────────────────
  doc += `# ${adaptor.name} Solution Design Document\n\n`;
  doc += `## Document Control\n\n`;
  doc += `| Field | Detail |\n| :--- | :--- |\n`;
  doc += `| **Client** | ${clientName} |\n`;
  doc += `| **Document Status** | Draft |\n`;
  doc += `| **Prepared By** | ERPLaunch |\n`;
  doc += `| **Date** | ${now} |\n`;
  doc += `| **License Edition** | ${adaptor.editionLabel} |\n`;
  doc += `| **Modules Provisioned** | ${license.modules.join(', ') || '—'} |\n\n`;

  doc += `### Revision History\n\n`;
  doc += `| Version | Date | Author | Change Description |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| 1.0 | ${now} | ERPLaunch | Initial auto-generated draft |\n\n`;

  doc += `---\n\n`;

  // ── SECTION 2: Project Overview ─────────────────────────────────────────────
  doc += `## 1. Project Overview\n\n`;
  doc += `### 1.1 Background\n\n`;
  doc += `This Solution Design Document (SDD) defines the agreed configuration of ${adaptor.name} for **${clientName}**. `;
  doc += `It serves as the single source of truth between the implementation team and the client, covering functional design decisions, `;
  doc += `system behaviour, and technical specifications for all in-scope workstreams.\n\n`;

  doc += `### 1.2 Scope of Implementation\n\n`;
  // Schema-driven scope list. A flow makes the cut when at least one of
  // its declared questions has an answer. Fallback to the legacy
  // hardcoded NetSuite-style flow detection when the adaptor schema
  // doesn't include the flow (custom adaptors that don't ship a
  // schema yet).
  const adaptorFlows = adaptor.flows ?? [];
  const flowAnswered = (flow: { sections: ReadonlyArray<{ questions: ReadonlyArray<{ id: string }> }> }): boolean =>
    flow.sections.some((s) =>
      s.questions.some((q) => {
        const v = answers[q.id];
        return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
      }),
    );

  const activeFlows: string[] = [];
  if (adaptorFlows.length > 0) {
    for (const f of adaptorFlows) {
      if (flowAnswered(f)) activeFlows.push(f.label);
    }
  } else {
    // Legacy fallback for engagement payloads with no adaptor.flows.
    if (hasFlow('r2r.')) activeFlows.push('Record to Report (R2R)');
    if (hasFlow('p2p.')) activeFlows.push('Procure to Pay (P2P)');
    if (hasFlow('o2c.')) activeFlows.push('Order to Cash (O2C)');
    if (hasFlow('mfg.')) activeFlows.push('Manufacturing (MFG)');
    if (hasFlow('rtn.')) activeFlows.push('Returns Management (RTN)');
  }

  doc += activeFlows.map(f => `- ${f}`).join('\n');
  doc += `\n\n`;

  doc += `### 1.3 Assumptions & Constraints\n\n`;
  doc += `- All configuration is based on answers captured during the discovery workshop.\n`;
  doc += `- ${adaptor.editionLabel} edition is confirmed.\n`;
  doc += `- Sandbox availability is assumed prior to configuration start.\n`;
  if (blocks.length > 0) doc += `- **${blocks.length} blocking configuration issue(s) remain open** — see Section 7.\n`;
  doc += `\n---\n\n`;

  // ── SECTION 2: Organisational Setup ────────────────────────────────────────
  // NetSuite-specific vocabulary (OneWorld, Departments/Classes/Locations as
  // NetSuite "segmentation" axes, hardcoded r2r.* answer keys). Gate the
  // entire section behind isNetSuite — non-NetSuite adaptors get this
  // content via the schema-driven Section 3 walk below, where Foundation /
  // Tax / etc. surface with their actual question labels.
  if (isNetSuite) {
    doc += `## 2. Organisational & Account Setup\n\n`;
    doc += `### 2.1 Entity Structure\n\n`;
    doc += `| Setting | Configuration |\n| :--- | :--- |\n`;
    doc += `| Multi-Entity / OneWorld | ${yn('r2r.entities.multiEntity')} |\n`;
    doc += `| Multi-Currency | ${yn('r2r.currencies.isMultiCurrency')} |\n`;
    doc += `| Base Currency | ${val('r2r.currencies.baseCurrency')} |\n`;
    doc += `| Fiscal Year Start | ${val('r2r.accountingPeriods.fiscalYearStart')} |\n`;
    doc += `| Accounting Basis | ${answers['r2r.accountingPeriods.cashBased'] === true ? 'Cash' : 'Accrual'} |\n\n`;

    doc += `### 2.2 Segmentation\n\n`;
    doc += `| Dimension | Enabled |\n| :--- | :--- |\n`;
    doc += `| Departments | ${yn('r2r.segmentation.useDepartments')} |\n`;
    doc += `| Classes | ${yn('r2r.segmentation.useClasses')} |\n`;
    doc += `| Locations | ${yn('r2r.segmentation.useLocations')} |\n\n`;
    doc += `---\n\n`;
  }

  // ── SECTION 3: Workstream Configuration Design ─────────────────────────────
  // Two voices:
  //   - NetSuite gets the existing hand-tuned R2R/P2P/O2C/MFG/RTN tables
  //     with platform-specific terminology (Pick-Pack-Ship, Phantom
  //     Assemblies, RMA, etc.).
  //   - Other adaptors get a schema-driven walk: iterate adaptor.flows ->
  //     sections -> questions and render question label + formatted
  //     answer for every populated question. The adaptor's own labels
  //     do the work that hardcoded NetSuite labels did for the legacy
  //     section.
  doc += `## 3. Workstream Configuration Design\n\n`;

  if (isNetSuite) {
    // R2R
    if (hasFlow('r2r.')) {
      doc += `### 3.1 Record to Report (R2R)\n\n`;
      doc += `#### Bank & Treasury\n`;
      doc += `- Bank Account Count: **${val('r2r.bankTransactions.bankAccountCount')}**\n`;
      doc += `- Auto Exchange Rate Updates: **${yn('r2r.currencies.autoExchangeRateUpdate')}**\n`;
      doc += `- Intercompany Journal Entries: **${yn('r2r.journalEntries.intercompanyJE')}**\n\n`;
      doc += `#### Period Close\n`;
      doc += `- Hard Period Close Enforced: **${yn('r2r.fiscalClose.hardClose')}**\n\n`;
      doc += `#### Reporting\n`;
      doc += `- Revenue Recognition: **${yn('r2r.reporting.revenueRecognition')}**\n\n`;
      doc += appendRichContent('r2r.');
    }

    // P2P
    if (hasFlow('p2p.')) {
      doc += `### 3.2 Procure to Pay (P2P)\n\n`;
      doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
      doc += `| Formal Purchase Orders | ${yn('p2p.purchasing.usePurchaseOrders')} |\n`;
      doc += `| PO Approval Required | ${yn('p2p.purchasing.poApprovalRequired')} |\n`;
      doc += `| Budget Check on POs | ${yn('p2p.purchasing.budgetCheck')} |\n`;
      doc += `| Formal Receiving | ${yn('p2p.receiving.formalReceiving')} |\n`;
      doc += `| 3-Way Matching | ${yn('p2p.receiving.threeWayMatch')} |\n`;
      doc += `| Bill Approval Required | ${yn('p2p.bills.billApprovalRequired')} |\n`;
      doc += `| Employee Expense Claims | ${yn('p2p.expenses.employeeExpenses')} |\n`;
      doc += `| Bank File Export | ${yn('p2p.payments.bankFileExport')} |\n\n`;
      doc += appendRichContent('p2p.');
    }

    // O2C
    if (hasFlow('o2c.')) {
      doc += `### 3.3 Order to Cash (O2C)\n\n`;
      doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
      doc += `| Customer Credit Limits | ${yn('o2c.customers.creditLimits')} |\n`;
      doc += `| Foreign Currency Pricing | ${yn('o2c.pricing.foreignCurrencyPricing')} |\n`;
      doc += `| SO Approval Required | ${yn('o2c.salesOrders.soApprovalRequired')} |\n`;
      doc += `| Pick-Pack-Ship | ${yn('o2c.fulfillment.pickPackShip')} |\n`;
      doc += `| Multi-Location Fulfillment | ${yn('o2c.fulfillment.multipleLocations')} |\n`;
      doc += `| Revenue Recognition | ${yn('o2c.invoicing.revenueRecognition')} |\n`;
      doc += `| Dunning Letters | ${yn('o2c.collections.dunningLetters')} |\n\n`;
      doc += appendRichContent('o2c.');
    }

    // MFG
    if (hasFlow('mfg.')) {
      doc += `### 3.4 Manufacturing (MFG)\n\n`;
      doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
      doc += `| Production Flow | ${val('mfg.productionFlow.type').replace('_', ' ')} |\n`;
      doc += `| Labor/Machine Cost Tracking | ${yn('mfg.productionFlow.trackLabor')} |\n`;
      doc += `| Multi-BOM | ${yn('mfg.bom.multiBom')} |\n`;
      doc += `| Phantom Assemblies | ${yn('mfg.bom.usePhantoms')} |\n`;
      doc += `| Outsourced Manufacturing | ${yn('mfg.outsourced.useOutsourced')} |\n`;
      doc += `| Demand Planning | ${yn('mfg.demand.useDemandPlanning')} |\n\n`;
      doc += appendRichContent('mfg.');
    }

    // RTN
    if (hasFlow('rtn.')) {
      doc += `### 3.5 Returns Management (RTN)\n\n`;
      doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
      doc += `| Customer RMA Required | ${yn('rtn.customerReturns.useRMA')} |\n`;
      doc += `| Refund Policy | ${val('rtn.customerReturns.refundPolicy', '—').replace('_', ' ')} |\n`;
      doc += `| Vendor Return Authorization | ${yn('rtn.vendorReturns.useVendorRMA')} |\n`;
      doc += `| Quality Inspection Required | ${yn('rtn.processing.inspectionRequired')} |\n`;
      doc += `| Restocking Fees | ${yn('rtn.processing.restockingFees')} |\n\n`;
      if (answers['rtn.processing.restockingFees'] === true) {
        doc += `> **Restocking Fee Rate:** ${val('rtn.processing.feePercentage', 'TBD')}%\n\n`;
      }
      doc += appendRichContent('rtn.');
    }

    // ── Schema-driven appendix for non-legacy NetSuite flows ─────────────
    // The hand-tuned tables above cover the legacy R2R/P2P/O2C/MFG/RTN
    // flows. After NS Pack 1+ added FOUNDATION / TAX / LOCALIZATION /
    // SOLUTION_DESIGN / KICKOFF, those flows were silently dropped here
    // because the NetSuite branch didn't walk adaptor.flows. This block
    // closes that gap: render any flow whose id is NOT in the legacy
    // hardcoded set, using the same schema-driven format the non-NetSuite
    // branch uses below. Lifecycle harness Phase 3 jumps from 4/10 to
    // ~9/10 with this fix once the SOLUTION_DESIGN flow is populated.
    const LEGACY_NS_FLOW_IDS = new Set(['R2R', 'P2P', 'O2C', 'PRODUCTION', 'MFG', 'RETURNS', 'RTN']);
    let nsAppendixIndex = 6; // continues numbering after 3.1–3.5
    for (const flow of adaptorFlows) {
      if (LEGACY_NS_FLOW_IDS.has(flow.id)) continue;
      const renderedSections = flow.sections
        .map((s) => ({
          section: s,
          answered: s.questions.filter((q) => {
            const v = answers[q.id];
            return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
          }),
        }))
        .filter((x) => x.answered.length > 0);
      if (renderedSections.length === 0) continue;

      doc += `### 3.${nsAppendixIndex} ${flow.label}\n\n`;
      if (flow.description) doc += `_${flow.description}_\n\n`;
      nsAppendixIndex++;

      for (const { section, answered } of renderedSections) {
        doc += `#### ${section.label}\n\n`;
        for (const q of answered) {
          doc += `- **${q.label}** — ${fmt(q, answers[q.id])}\n`;
        }
        doc += `\n`;
        const flowSectionKey = `${flow.id}.${section.id}`;
        const adaptorSectionKey = `${adaptor.id}.${section.id}`;
        const matchSec = (k: string): boolean =>
          k === flowSectionKey || k === adaptorSectionKey || k === section.id;
        const c = data.comments?.find((cm) => matchSec(cm.sectionKey));
        if (c?.text) doc += `> **Consultant Notes:** ${c.text.replace(/\n/g, ' ')}\n\n`;
        const ai = data.aiAdvice?.find((a) => matchSec(a.sectionKey))?.advice;
        if (ai?.suggestions?.length) {
          doc += `**Configuration & Best Practices:**\n`;
          ai.suggestions.forEach((s: { title: string; description: string }) =>
            doc += `- **${s.title}**: ${s.description}\n`,
          );
          doc += `\n`;
        }
      }
    }
  } else {
    // Schema-driven walk for non-NetSuite adaptors. Renders each flow
    // that has at least one answered question as a numbered subsection,
    // with one bullet per (label, formatted answer) pair. Sections within
    // a flow keep the order the adaptor declared.
    let flowIndex = 1;
    for (const flow of adaptorFlows) {
      const renderedSections = flow.sections
        .map((s) => ({
          section: s,
          answered: s.questions.filter((q) => {
            const v = answers[q.id];
            return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
          }),
        }))
        .filter((x) => x.answered.length > 0);
      if (renderedSections.length === 0) continue;

      doc += `### 3.${flowIndex} ${flow.label}\n\n`;
      if (flow.description) doc += `_${flow.description}_\n\n`;
      flowIndex++;

      for (const { section, answered } of renderedSections) {
        doc += `#### ${section.label}\n\n`;
        for (const q of answered) {
          doc += `- **${q.label}** — ${fmt(q, answers[q.id])}\n`;
        }
        doc += `\n`;
        // Match section comments / AI advice / images against flow.section
        // OR adaptor.section OR bare section keys, mirroring brdGenerator.
        const flowSectionKey = `${flow.id}.${section.id}`;
        const adaptorSectionKey = `${adaptor.id}.${section.id}`;
        const matchSec = (k: string): boolean =>
          k === flowSectionKey || k === adaptorSectionKey || k === section.id;
        const c = data.comments?.find((cm) => matchSec(cm.sectionKey));
        if (c?.text) doc += `> **Consultant Notes:** ${c.text.replace(/\n/g, ' ')}\n\n`;
        const ai = data.aiAdvice?.find((a) => matchSec(a.sectionKey))?.advice;
        if (ai?.suggestions?.length) {
          doc += `**Configuration & Best Practices:**\n`;
          ai.suggestions.forEach((s: { title: string; description: string }) =>
            doc += `- **${s.title}**: ${s.description}\n`,
          );
          doc += `\n`;
        }
      }
    }
  }

  doc += `---\n\n`;

  // ── SECTION 4: Technical Specifications ─────────────────────────────────────
  // Two voices: NetSuite has SDF + SuiteScript + UI-authored Workflow exports,
  // a platform-specific build pipeline. Non-NetSuite adaptors get a neutral
  // placeholder until the per-adaptor configuration generator lands (Phase 4
  // of the cross-platform fix introduces an Odoo-specific equivalent).
  doc += `## 4. Technical Specifications\n\n`;
  if (isNetSuite) {
    doc += `### 4.1 Custom Objects (SDF)\n\n`;
    doc += `The following custom records and fields will be generated as NetSuite SDF XML objects:\n\n`;
    doc += `| Object Type | Record ID | Purpose |\n| :--- | :--- | :--- |\n`;
    if (answers['mfg.productionFlow.type'] === 'WIP_ROUTINGS') {
      doc += `| Custom Record | customrecord_nsix_wip_log | WIP Production Log |\n`;
    }
    doc += `| Custom Form | Standard per workstream | To be defined during build phase |\n\n`;

    doc += `### 4.2 SuiteScript Customisations\n\n`;
    doc += `| Script Type | Trigger | Business Purpose |\n| :--- | :--- | :--- |\n`;
    doc += `| User Event | Before Submit | Validation and auto-population of standard fields |\n`;
    if (answers['p2p.purchasing.poApprovalRequired'] === true) {
      doc += `| Workflow | PO Approval | Route PO to approval based on threshold rules |\n`;
    }
    if (answers['o2c.salesOrders.soApprovalRequired'] === true) {
      doc += `| Workflow | SO Approval | Route Sales Orders to approval based on value or type |\n`;
    }
    doc += `\n`;

    // ── SECTION 4.3: Approval Workflows — manual implementation ─────────────
    // Phase 6: we no longer ship hand-written workflow XML (SDF rejects the
    // SOAP webservices namespace and the <sendemailaction> shape). Instead
    // the consultant authors these in the NetSuite UI, then exports via SDF
    // for source-controlled promotion to higher environments.
    //
    // Phase 24: when an approval flow has a structured chain captured via
    // ApprovalChainEditor (`<flow>.<section>.approvalChainStructured`),
    // render detailed per-currency tier tables + concrete SuiteFlow build
    // steps in addition to the generic-prose row. Empty chains fall back
    // to the generic prose only — no regression for engagements that
    // haven't filled the structured editor yet. JE + Expense flows are
    // ALSO surfaced here (pre-Phase-24 they were captured but never
    // rendered — silent gap closed).
    const poApproval = answers['p2p.purchasing.poApprovalRequired'] === true;
    const billApproval = answers['p2p.bills.billApprovalRequired'] === true;
    const soApproval = answers['o2c.salesOrders.soApprovalRequired'] === true;
    const jeApproval = answers['r2r.journalEntries.approvalRequired'] === true;
    const expenseApproval = answers['p2p.expenses.expenseApproval'] === true;
    if (poApproval || billApproval || soApproval || jeApproval || expenseApproval) {
      doc += `### 4.3 Approval Workflows — Manual Implementation Required\n\n`;
      doc += `The following approval workflows must be authored in the NetSuite UI `;
      doc += `(Customization → Workflow → Workflows → New). Oracle guidance is to `;
      doc += `build workflows in the UI and export them via SDF rather than hand-write `;
      doc += `the XML; the approval actions (email, state transitions, role routing) `;
      doc += `use platform objects the SDF validator will only accept when they come `;
      doc += `from a UI export.\n\n`;

      // Generic-prose summary table — always rendered when at least one
      // approval is required, regardless of whether the structured chain
      // is filled in. Provides the high-level overview; structured tier
      // tables (when present) drop in below per flow.
      doc += `| Workflow | Record Type | Trigger | Notes |\n| :--- | :--- | :--- | :--- |\n`;
      if (poApproval) {
        doc += `| PO Approval | Purchase Order | Before Submit | Route to Procurement Manager on threshold; escalate to CFO above the second tier. Use role-based recipients, not hard-coded user IDs. |\n`;
      }
      if (billApproval) {
        doc += `| Bill Approval | Vendor Bill | Before Submit | Pair with the \`custbody_nsix_three_way_match_status\` field so bills can only progress past Pending Approval once a 3-way match is recorded. |\n`;
      }
      if (soApproval) {
        doc += `| Sales Order Approval | Sales Order | Before Submit | Route by order value or customer credit tier. Wire a transition to a "Credit Hold" state when the customer has an overdue AR balance. |\n`;
      }
      if (jeApproval) {
        doc += `| Journal Entry Approval | Journal Entry | Before Submit | Route manual JEs by amount + posting period. Block posting into a closed period unless the workflow's CFO step explicitly re-opens it. |\n`;
      }
      if (expenseApproval) {
        doc += `| Expense Report Approval | Expense Report | Before Submit | Default route to the employee's direct manager; override to Finance for amounts over the per-currency threshold. Pair with per-diem rate rules where configured. |\n`;
      }
      doc += `\n**Checklist for the consultant:** (1) build the workflow in the UI of the lowest environment, `;
      doc += `(2) run end-to-end with a test record, (3) export via \`suitecloud object:import --type workflow\`, `;
      doc += `(4) commit the exported XML into the SDF bundle for promotion.\n\n`;

      // Phase 24 — per-flow structured tier tables + SuiteFlow build
      // instructions for any flow that has a populated structured chain.
      // Empty chains skip this block (generic-prose row above is the
      // fallback). Renderer is NetSuite-only by construction (banlist
      // safety) — but the outer `if (isNetSuite)` already enforces this.
      const baseCurrency = answers['r2r.currencies.baseCurrency'] as string | null | undefined;
      const additionalCurrencies = answers['r2r.currencies.additionalCurrencies'] as
        | string
        | null
        | undefined;
      const validationContext = { baseCurrency, additionalCurrencies };

      const renderedFlows: string[] = [];
      for (const flowKey of APPROVAL_FLOW_KEYS) {
        if (answers[flowKey.booleanKey] !== true) continue;
        const chain = parseApprovalChain(answers[flowKey.structuredKey]);
        if (chainIsEmpty(chain)) continue;
        const block = renderApprovalChainSection(chain, flowKey.flowLabel, {
          adaptorId: adaptor.id,
          netsuiteRecordType: flowKey.netsuiteRecordType,
          validationContext,
        });
        if (block.length > 0) renderedFlows.push(block);
      }
      if (renderedFlows.length > 0) {
        doc += `#### Detailed Approval Chains (Phase 24)\n\n`;
        doc += `For each flow below, the consultant has captured a structured tier `;
        doc += `chain via the wizard's Approval Chain editor. Build the corresponding `;
        doc += `SuiteFlow workflow with the exact tier boundaries, role assignments, `;
        doc += `and escalation hours documented per flow.\n\n`;
        doc += renderedFlows.join('\n');
      }
    }
  } else {
    // Platform-neutral placeholder. The Phase-4 follow-up replaces this with
    // an adaptor-specific generator (e.g. odooConfigurationPlanGenerator)
    // that lists module install plan, l10n_<country>, fiscal year setup,
    // multi-company config, and Studio XML export notes.
    doc += `### 4.1 Configuration Approach\n\n`;
    doc += `Detailed configuration steps for ${adaptor.name} will be provided in the platform-specific configuration plan accompanying this document. `;
    doc += `Section 7 (Deployment & Go-Live) summarises the build-phase hand-off; the configuration plan itself enumerates module install order, localisation packages, and any studio / customisation exports.\n\n`;
  }

  doc += `---\n\n`;

  // ── SECTION 6: Roles & Permissions ──────────────────────────────────────────
  // Phase 25 — when ns.design.standardRolesStructured is populated, render the
  // structured roles in addition to the canonical role table. The structured
  // payload drives the SDF customrole_*.xml emit; this surfaces the same
  // captured intent in the design document so consultants and clients see
  // exactly what's about to be deployed.
  doc += `## 5. User Roles & Access\n\n`;
  doc += `### 5.1 Canonical Roles\n\n`;
  doc += `| Role | Functional Area | Key Permissions |\n| :--- | :--- | :--- |\n`;
  doc += `| Finance Manager | R2R, P2P | Period close, journal entries, AP payments |\n`;
  doc += `| Procurement Manager | P2P | PO approval, vendor management |\n`;
  doc += `| Sales Manager | O2C | SO approval, pricing, credit management |\n`;
  if (hasFlow('mfg.')) doc += `| Production Manager | MFG | Work orders, BOM management, demand planning |\n`;
  if (hasFlow('rtn.')) doc += `| Warehouse Manager | RTN | RMA processing, returns inspection |\n`;
  doc += `| System Administrator | All | Full access for configuration and support |\n\n`;

  if (isNetSuite) {
    const structuredRoles = parseStructuredRolesForDoc(answers['ns.design.standardRolesStructured']);
    if (structuredRoles.length > 0) {
      doc += `### 5.2 Captured Custom Roles (Phase 25 structured editor)\n\n`;
      doc += `These roles will be emitted as Oracle SDF \`customrole_nsix_*.xml\` objects on Generate Package. The classifier auto-selects a starter permission set per role family; explicit overrides are noted in the Center / Restriction columns.\n\n`;
      doc += `| Role Name | Center Override | Restriction Override | Customization Notes |\n| :--- | :--- | :--- | :--- |\n`;
      for (const r of structuredRoles) {
        const center = r.centerOverride ?? '— (classifier)';
        const restriction = r.restrictionOverride ?? '— (classifier)';
        const notes = r.customizationNotes.trim().length > 0 ? r.customizationNotes : '—';
        doc += `| ${r.name} | ${center} | ${restriction} | ${notes} |\n`;
      }
      doc += `\n`;
      doc += `**Deploy notes:** after \`pnpm generate\`, review each \`SDF/Objects/customrole_nsix_*.xml\` for permission alignment against your SoD policy. The XML comment header inside each file enumerates the overlay rules that were applied (read-only, group-wide, subsidiary-scoped, remove-approve). Test role login + transaction creation in sandbox before promoting to production.\n\n`;
    } else if (typeof answers['ns.design.standardRoleCustomization'] === 'string' &&
               (answers['ns.design.standardRoleCustomization'] as string).trim().length > 0) {
      doc += `### 5.2 Captured Custom Roles (legacy textarea)\n\n`;
      doc += `Custom roles captured via the free-text TEXTAREA. Each line emits one \`customrole_nsix_*.xml\` on Generate Package. To migrate to the structured editor for richer per-role control, use the Customizations → Roles step in the wizard.\n\n`;
    }

    // Phase 26 — Custom Templates capture surfaces here too when populated.
    const structuredTemplates = parseStructuredTemplatesForDoc(answers['ns.design.templatesStructured']);
    if (structuredTemplates.length > 0) {
      doc += `### 5.3 Custom Templates (Phase 26 structured editor)\n\n`;
      doc += `These templates will be emitted as Oracle SDF \`advancedpdftemplate\` (PDF/HTML) or \`emailtemplate\` (DUNNING_EMAIL) objects on Generate Package. The XML body contains a stub with TODO markers per captured section; consultants edit the real FreeMarker / BFO content in NetSuite UI after deploy.\n\n`;
      doc += `| Template Name | Kind | Preferred | Sections | Notes |\n| :--- | :--- | :--- | :--- | :--- |\n`;
      for (const t of structuredTemplates) {
        const sections = t.sections.length > 0 ? t.sections.join(', ') : '—';
        const notes = t.notes.trim().length > 0 ? t.notes : '—';
        doc += `| ${t.name} | ${t.kind} | ${t.preferred ? 'Yes' : 'No'} | ${sections} | ${notes} |\n`;
      }
      doc += `\n`;
      doc += `**Deploy notes:** confirm \`<preferred>T</preferred>\` is set on only ONE template per recordtype before deploying. The XML comment header inside each emitted file lists the captured sections so consultants know which TODO markers to fill in.\n\n`;
    }
  }
  doc += `---\n\n`;

  // ── SECTION 7: Risks & Open Items ───────────────────────────────────────────
  doc += `## 6. Risks, Conflicts & Open Items\n\n`;
  if (blocks.length === 0 && warnings.length === 0) {
    doc += `> ✅ No implementation risks or conflicts detected at this time.\n\n`;
  } else {
    doc += `| Ref | Severity | Description | Resolution |\n| :--- | :--- | :--- | :--- |\n`;
    blocks.forEach((b, i) => doc += `| C-${i + 1} | CRITICAL | ${b.message} | ${b.resolution} |\n`);
    warnings.forEach((w, i) => doc += `| W-${i + 1} | MODERATE | ${w.message} | ${w.resolution} |\n`);
    doc += `\n`;
  }
  doc += `---\n\n`;

  // ── SECTION 8: Go-Live Plan ──────────────────────────────────────────────────
  doc += `## 7. Deployment & Go-Live Plan\n\n`;
  doc += `| Phase | Activity | Owner | Status |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| Discovery | Business requirements captured | ERPLaunch Consultant | ✅ Complete |\n`;
  doc += `| Design | Solution document reviewed & signed | Client + Consultant | ☐ Pending |\n`;
  doc += `| Build | Configuration in Sandbox | Implementation Team | ☐ Not Started |\n`;
  doc += `| UAT | User acceptance testing | Client Business Users | ☐ Not Started |\n`;
  doc += `| Go-Live | Production cutover | All | ☐ Not Started |\n\n`;
  doc += `---\n\n`;

  // ── SECTION 9: Sign-off ──────────────────────────────────────────────────────
  doc += `## 8. Document Sign-off\n\n`;
  doc += `By signing below, the parties confirm that this Solution Design Document accurately reflects the agreed implementation scope:\n\n`;
  doc += `| Role | Name | Signature | Date |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| Client Project Sponsor | | | |\n`;
  doc += `| Client Finance Lead | | | |\n`;
  doc += `| Implementation Lead (ERPLaunch) | | | |\n`;
  doc += `| ${adaptor.name} Project Manager | | | |\n\n`;

  return doc;
}

export function generateSolutionDocHtml(data: SolutionDocData): string {
  const content = md.render(generateSolutionDoc(data));
  const activeFlows = [
    data.answers['r2r.entities.multiEntity'] !== undefined ? 'R2R' : null,
    data.answers['p2p.purchasing.usePurchaseOrders'] !== undefined ? 'P2P' : null,
    data.answers['o2c.customers.creditLimits'] !== undefined ? 'O2C' : null,
    data.answers['mfg.productionFlow.type'] !== undefined ? 'MFG' : null,
    data.answers['rtn.customerReturns.useRMA'] !== undefined ? 'RTN' : null,
  ].filter(Boolean);

  const adaptorName = data.adaptor.name;
  const editionLabel = data.adaptor.editionLabel;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solution Design Document — ${data.clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 900px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1d4ed8 100%); color: white; padding: 48px 48px 36px; border-radius: 20px; margin-bottom: 40px; }
    .header-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; opacity: 0.6; text-transform: uppercase; margin-bottom: 12px; }
    .header h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .sub { opacity: 0.75; font-size: 15px; margin-bottom: 24px; }
    .badges { display: flex; gap: 10px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 5px 14px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 44px 0 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #1e40af; margin: 28px 0 12px; }
    h4 { font-size: 13px; font-weight: 600; color: #475569; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    p { color: #475569; line-height: 1.75; margin-bottom: 14px; font-size: 14px; }
    blockquote { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: 14px; color: #166534; }
    ul, ol { padding-left: 24px; margin-bottom: 14px; }
    li { color: #475569; line-height: 1.75; font-size: 14px; margin-bottom: 4px; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 40px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
    thead { background: #0f172a; color: white; }
    thead th { padding: 11px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:hover { background: #fafbfc; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 600; color: #0f172a; }
    strong { color: #0f172a; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #1e40af; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-badge">${adaptorName} Implementation</div>
      <h1>Solution Design Document</h1>
      <div class="sub">${data.clientName}</div>
      <div class="badges">
        <span class="badge">📋 ${editionLabel}</span>
        ${activeFlows.map(f => `<span class="badge">✓ ${f}</span>`).join('')}
        <span class="badge">📅 ${new Date().toLocaleDateString()}</span>
      </div>
    </div>
    ${content}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()} — Confidential</div>
  </div>
</body>
</html>`;
}
