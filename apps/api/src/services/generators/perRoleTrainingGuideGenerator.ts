/**
 * Per-Role Training Guide generator (Pack U — Training Collateral,
 * Component 2).
 *
 * Cross-platform — same generator works for NetSuite + Odoo + any
 * future adaptor. Reads:
 *   - training.curriculum.trainingPerRole (TEXTAREA, primary input)
 *   - ns.design.standardRoleCustomization (Pack C, supplementary —
 *     captures NetSuite roles not declared in the wizard's training
 *     answer)
 *   - training.curriculum.cascadeStrategy (SELECT, drives the
 *     "How this guide is delivered" section)
 *   - training.schedule.deliveryMode (SELECT, drives the per-module
 *     Format line)
 *   - training.assessment.assessmentRequired + assessmentFormat
 *     (drive the Assessment section)
 *
 * Per declared role, emits one Markdown file in Documentation/Training/:
 *   <Role_Slug>_Training_Guide.md
 *
 * Each guide carries:
 *   - Audience / Prerequisites
 *   - Curriculum (3-7 ### Module sections — auto-supplemented from the
 *     canonical role-family curriculum when the consultant's input is
 *     short)
 *   - Hands-On Lab block
 *   - Assessment (conditional on assessmentRequired)
 *   - Post-Training Resources (links to QRC + Training Manual + Sign-off
 *     Matrix from Pack T)
 *
 * Sources:
 *   - ADDIE instructional design (Develop step — modular content per role).
 *   - Kirkpatrick Level 1-2 (Reaction + Learning) — assessment formats.
 *   - SuiteSuccess Champion track / Odoo Functional Consultant
 *     certification — canonical curriculum mappings.
 */

import { classifyRoleFamily, slugifyRole, type RoleFamilySpec } from './trainingRoleFamilies.js';

export type CascadeStrategy = 'TRAIN_EVERYONE' | 'TRAIN_THE_TRAINER' | 'HYBRID';
export type DeliveryMode = 'IN_PERSON' | 'VIRTUAL_LIVE' | 'HYBRID' | 'SELF_PACED_VIDEO';
export type AssessmentFormat = 'QUIZ' | 'LIVE_DEMO' | 'WORK_PRODUCT_REVIEW' | 'NONE';

export interface PerRoleTrainingGuideInput {
  clientName: string;
  /** TEXTAREA training.curriculum.trainingPerRole — primary input.
   *  One line per role: "<role>: <topic1>, <topic2>, ...". */
  trainingPerRole?: string | null;
  /** TEXTAREA ns.design.standardRoleCustomization — supplementary
   *  source for NetSuite engagements. Roles declared here that aren't
   *  in trainingPerRole still get a guide (with auto-supplemented
   *  canonical curriculum). */
  standardRoleCustomization?: string | null;
  cascadeStrategy?: CascadeStrategy | string | null;
  deliveryMode?: DeliveryMode | string | null;
  /** BOOLEAN training.assessment.assessmentRequired. */
  assessmentRequired?: boolean;
  /** SINGLE_SELECT training.assessment.assessmentFormat. Defaults to
   *  LIVE_DEMO when assessment required + format omitted. */
  assessmentFormat?: AssessmentFormat | string | null;
  /** Adaptor identity drives platform-specific phrasing in the
   *  Prerequisites section ("Active NetSuite account" vs "Active Odoo
   *  account"). */
  adaptorName?: string;
}

export interface EmittedRoleGuide {
  /** Bundle-relative path, e.g. "Documentation/Training/AP_Clerk_Training_Guide.md". */
  filename: string;
  roleName: string;
  family: string;
  /** Final topic list AFTER auto-supplement. */
  topics: string[];
}

export interface PerRoleTrainingGuideOutput {
  files: Record<string, string>;
  emitted: EmittedRoleGuide[];
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedRoleEntry {
  role: string;
  topics: string[];
  /** True when the line came from trainingPerRole (declared); false
   *  when supplemented from standardRoleCustomization. */
  declared: boolean;
}

const ROLE_LINE = /^([^:]+):\s*(.*)$/;

function parseTrainingPerRole(raw: string): ParsedRoleEntry[] {
  const out: ParsedRoleEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(ROLE_LINE);
    if (!m) continue;
    const role = m[1].trim();
    const topicsRaw = m[2].trim();
    const topics = topicsRaw.length === 0
      ? []
      : topicsRaw.split(/,\s*/).map((t) => t.trim()).filter((t) => t.length > 0);
    out.push({ role, topics, declared: true });
  }
  return out;
}

function parseStandardRoles(raw: string): string[] {
  // Re-uses the Pack C convention "<role>: <customization notes>".
  // Quote-strip pre-pass mirrors Pack C's role generator handling of
  // 'A/P Clerk: remove "Approve Bills" permission' style entries.
  const cleaned = raw.replace(/["'""''']/g, ' ');
  const out: string[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const role = trimmed.slice(0, colonIdx).trim();
    if (role.length > 0) out.push(role);
  }
  return out;
}

/**
 * Merge the two role sources. trainingPerRole wins when a role appears
 * in both (declared topics take precedence over auto-supplement).
 * Supplementary roles get an empty topics list which triggers the
 * canonical curriculum fallback at render time.
 */
function mergeRoleSources(
  declared: ParsedRoleEntry[],
  supplementary: string[],
): ParsedRoleEntry[] {
  const seen = new Set<string>();
  const out: ParsedRoleEntry[] = [];
  for (const entry of declared) {
    const key = entry.role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  for (const role of supplementary) {
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, topics: [], declared: false });
  }
  return out;
}

// ─── Module body inference ──────────────────────────────────────────────────

interface ModuleInferOutput {
  objective: string;
  practiceExercise: string;
  /** Slug used for the "Quick Reference: QRC-<task_slug>" cross-ref. */
  qrcSlug: string;
}

interface TopicTemplate {
  /** Lowercased substrings any of which match the topic phrase. */
  keywords: string[];
  objective: string;
  practiceExercise: string;
  qrcSlug: string;
}

const TOPIC_TEMPLATES: ReadonlyArray<TopicTemplate> = [
  {
    keywords: ['vendor bill', 'bill entry', 'enter bill', 'bills'],
    objective: 'Enter a vendor bill end-to-end and resolve any 3-way-match exceptions.',
    practiceExercise: 'Enter a sample bill against a real PO + receipt; verify GL impact.',
    qrcSlug: 'enter-vendor-bill',
  },
  {
    keywords: ['three-way match', '3-way match', 'three way match'],
    objective: 'Apply the 3-way-match policy and identify when a bill is on hold.',
    practiceExercise: 'Enter a bill with a price discrepancy; observe the hold + resolution path.',
    qrcSlug: 'three-way-match',
  },
  {
    keywords: ['payment run', 'payments', 'pay vendors'],
    objective: 'Schedule, review, and execute a payment batch including bank file export.',
    practiceExercise: 'Run a payment batch for 3 vendors; export the bank file in the configured format.',
    qrcSlug: 'run-payment-batch',
  },
  {
    keywords: ['vendor master', 'vendor setup', 'create vendor'],
    objective: 'Create a new vendor record with all compliance fields populated.',
    practiceExercise: 'Onboard a fictional vendor including tax ID, payment terms, currency.',
    qrcSlug: 'create-vendor-record',
  },
  {
    keywords: ['voucher approval', 'bill approval', 'approval workflow'],
    objective: 'Route a vendor bill through the approval workflow and respond as approver.',
    practiceExercise: 'Submit a bill above your auto-approve threshold; approve/reject per policy.',
    qrcSlug: 'approve-vendor-bill',
  },
  {
    keywords: ['customer master', 'customer setup', 'create customer'],
    objective: 'Create a new customer record with credit limit, pricing tier, and terms.',
    practiceExercise: 'Onboard a fictional customer including all classification fields.',
    qrcSlug: 'create-customer-record',
  },
  {
    keywords: ['invoice creation', 'create invoice', 'invoice'],
    objective: 'Create a customer invoice from a delivered SO + verify GL + tax.',
    practiceExercise: 'Generate an invoice from a fulfilled SO; confirm AR + revenue posting.',
    qrcSlug: 'create-customer-invoice',
  },
  {
    keywords: ['cash application', 'apply payment'],
    objective: 'Apply a customer payment against open invoices.',
    practiceExercise: 'Apply a $10k payment across 3 open invoices; verify aging update.',
    qrcSlug: 'apply-customer-payment',
  },
  {
    keywords: ['dunning', 'collections'],
    objective: 'Trigger dunning letters per the configured cadence.',
    practiceExercise: 'Identify all customers >60 days overdue; trigger second-notice letter.',
    qrcSlug: 'send-dunning-letter',
  },
  {
    keywords: ['ar aging', 'aging report', 'aging'],
    objective: 'Run + interpret the AR aging report by entity and customer tier.',
    practiceExercise: 'Run aging report; identify top-5 risk customers by balance.',
    qrcSlug: 'run-ar-aging',
  },
  {
    keywords: ['trial balance', 'tb'],
    objective: 'Generate trial balance per entity + consolidated; tie to GL.',
    practiceExercise: 'Run TB for the current period; identify any out-of-balance lines.',
    qrcSlug: 'run-trial-balance',
  },
  {
    keywords: ['multi-entity close', 'multi-currency close', 'period close', 'monthly close'],
    objective: 'Walk through the period-end close sequence per entity.',
    practiceExercise: 'Close a sandbox period for 1 entity; verify all sub-ledgers reconciled.',
    qrcSlug: 'period-close',
  },
  {
    keywords: ['financial statement', 'p&l', 'balance sheet'],
    objective: 'Generate financial statements + drilldown to source.',
    practiceExercise: 'Generate the consolidated P&L; drill down on Revenue to source SOs.',
    qrcSlug: 'run-financial-statements',
  },
  {
    keywords: ['multi-currency revaluation', 'currency revaluation', 'fx revaluation'],
    objective: 'Run multi-currency revaluation + verify GL impact.',
    practiceExercise: 'Trigger month-end revaluation; review the unrealized FX entries.',
    qrcSlug: 'multi-currency-revaluation',
  },
  {
    keywords: ['audit trail'],
    objective: 'Search the audit trail for any record + verify immutability.',
    practiceExercise: 'Pick a transaction; trace every field change + actor + timestamp.',
    qrcSlug: 'run-audit-trail',
  },
  {
    keywords: ['lead-to-quote', 'lead to quote', 'opportunity'],
    objective: 'Convert a lead through opportunity → quote → SO.',
    practiceExercise: 'Take a fictional lead through the full pipeline; verify CRM stage updates.',
    qrcSlug: 'convert-lead-to-quote',
  },
  {
    keywords: ['sales order', 'so entry', 'create sales order'],
    objective: 'Create a sales order with pricing tier + discount approval routing.',
    practiceExercise: 'Create an SO above the discount threshold; observe approval routing.',
    qrcSlug: 'create-sales-order',
  },
  {
    keywords: ['pricelist'],
    objective: 'Manage pricelists and per-customer overrides.',
    practiceExercise: 'Create a tier-2 pricelist; assign to a customer and verify SO pricing.',
    qrcSlug: 'manage-pricelist',
  },
  {
    keywords: ['discount approval'],
    objective: 'Route a deep-discount SO through the approval workflow.',
    practiceExercise: 'Create an SO at >15% discount; observe approval routing + sign-off.',
    qrcSlug: 'approve-discount',
  },
  {
    keywords: ['pipeline report', 'pipeline'],
    objective: 'Generate pipeline reports for sales leadership review.',
    practiceExercise: 'Run pipeline report for the quarter; identify aging deals + at-risk lines.',
    qrcSlug: 'run-pipeline-report',
  },
  {
    keywords: ['item master', 'item setup', 'create item'],
    objective: 'Create item records with inventory + costing settings.',
    practiceExercise: 'Add a new SKU including UoM, lot tracking, and standard cost.',
    qrcSlug: 'create-item-record',
  },
  {
    keywords: ['stock adjustment', 'inventory adjustment'],
    objective: 'Adjust on-hand inventory + post the variance to GL.',
    practiceExercise: 'Adjust quantity on hand for 5 SKUs; verify variance posting.',
    qrcSlug: 'stock-adjustment',
  },
  {
    keywords: ['cycle count'],
    objective: 'Run a cycle count + reconcile variances.',
    practiceExercise: 'Run a cycle count for the A-class SKU shelf; reconcile any variance.',
    qrcSlug: 'cycle-count',
  },
  {
    keywords: ['lot', 'serial', 'lot tracking', 'serial tracking'],
    objective: 'Receive + ship lot/serial-tracked items + run a recall query.',
    practiceExercise: 'Receive a pharma lot; ship under FEFO; run a lot trace report.',
    qrcSlug: 'manage-lots-serials',
  },
  {
    keywords: ['warehouse transfer', 'transfer order'],
    objective: 'Move stock between warehouses with full audit trail.',
    practiceExercise: 'Transfer 10 SKUs between two warehouses; verify both sides update.',
    qrcSlug: 'warehouse-transfer',
  },
  {
    keywords: ['rfq', 'request for quote', 'vendor rfq'],
    objective: 'Issue an RFQ to multiple vendors + tabulate responses.',
    practiceExercise: 'Issue an RFQ to 3 vendors; compare quotes; convert winner to PO.',
    qrcSlug: 'issue-rfq',
  },
  {
    keywords: ['po creation', 'create purchase order', 'po entry'],
    objective: 'Create a purchase order with full approval routing.',
    practiceExercise: 'Create a PO at each approval tier; observe correct routing.',
    qrcSlug: 'create-purchase-order',
  },
  {
    keywords: ['po approval'],
    objective: 'Approve or reject a PO per the approval matrix.',
    practiceExercise: 'Approve a tier-2 PO from the dashboard; record audit trail.',
    qrcSlug: 'approve-purchase-order',
  },
  {
    keywords: ['receipt', 'receive goods', 'inspection'],
    objective: 'Receive goods against a PO + handle quantity / quality variances.',
    practiceExercise: 'Receive a partial shipment; record short-ship variance.',
    qrcSlug: 'receive-goods',
  },
  {
    keywords: ['bom setup', 'bom', 'bill of material'],
    objective: 'Create + maintain a BOM with phantoms + components.',
    practiceExercise: 'Build a 2-level BOM; verify cost rollup to parent assembly.',
    qrcSlug: 'create-bom',
  },
  {
    keywords: ['work order release', 'work order', 'production order', 'mo release'],
    objective: 'Release a work order + consume components.',
    practiceExercise: 'Release an MO for a 2-level assembly; consume + verify WIP.',
    qrcSlug: 'release-work-order',
  },
  {
    keywords: ['production reporting'],
    objective: 'Report production output + log labor + scrap.',
    practiceExercise: 'Report 80 units of 100 produced; record scrap + labor hours.',
    qrcSlug: 'report-production',
  },
  {
    keywords: ['quality check', 'qc'],
    objective: 'Run a quality check + handle pass/fail dispositions.',
    practiceExercise: 'Trigger QC on incoming receipt; record fail + reroute to MRB.',
    qrcSlug: 'quality-check',
  },
  {
    keywords: ['backflush', 'backflushing'],
    objective: 'Configure + run backflush consumption on completion.',
    practiceExercise: 'Complete an MO with backflush enabled; verify component decrement.',
    qrcSlug: 'backflush-consume',
  },
  {
    keywords: ['user provisioning', 'user setup'],
    objective: 'Provision a new user account with role + entity scope.',
    practiceExercise: 'Provision 1 user with a custom role; verify login + permission boundaries.',
    qrcSlug: 'provision-user',
  },
  {
    keywords: ['saved search'],
    objective: 'Build + run a saved search with filters + columns.',
    practiceExercise: 'Build a saved search for AR > 60 days; run + export to CSV.',
    qrcSlug: 'saved-search-export',
  },
  {
    keywords: ['permission', 'permission set', 'permission audit'],
    objective: 'Audit role permissions + identify SoD risks.',
    practiceExercise: 'Run a permission audit; identify any conflicts in payable + payment perms.',
    qrcSlug: 'permission-audit',
  },
  {
    keywords: ['sandbox refresh', 'sandbox'],
    objective: 'Refresh a sandbox + validate post-refresh.',
    practiceExercise: 'Trigger a sandbox refresh; run smoke tests post-refresh.',
    qrcSlug: 'sandbox-refresh',
  },
  {
    keywords: ['custom script', 'script deployment', 'cli'],
    objective: 'Deploy a custom script + verify execution log.',
    practiceExercise: 'Deploy a sample User Event script; trigger + verify logs.',
    qrcSlug: 'deploy-custom-script',
  },
];

const GENERIC_TOPIC: ModuleInferOutput = {
  objective: 'Master this topic end-to-end as it applies to your role.',
  practiceExercise: 'Complete a representative exercise per the consultant\'s guidance.',
  qrcSlug: 'general',
};

function inferModuleBody(topic: string): ModuleInferOutput {
  const lc = topic.toLowerCase();
  for (const tpl of TOPIC_TEMPLATES) {
    if (tpl.keywords.some((kw) => lc.includes(kw))) {
      return {
        objective: tpl.objective,
        practiceExercise: tpl.practiceExercise,
        qrcSlug: tpl.qrcSlug,
      };
    }
  }
  return GENERIC_TOPIC;
}

// ─── Format strings per delivery mode ───────────────────────────────────────

function formatForMode(mode: DeliveryMode): string {
  switch (mode) {
    case 'IN_PERSON':
      return 'Slides + live demo in the training room with consultant present';
    case 'VIRTUAL_LIVE':
      return 'Shared deck + screen-share over the engagement Zoom/Teams bridge';
    case 'SELF_PACED_VIDEO':
      return 'Pre-recorded walkthrough with downloadable slide deck';
    case 'HYBRID':
    default:
      return 'Live session for consultant-led modules; recorded walkthrough for self-paced topics';
  }
}

function normaliseMode(raw: string | null | undefined): DeliveryMode {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'IN_PERSON') return 'IN_PERSON';
  if (upper === 'VIRTUAL_LIVE') return 'VIRTUAL_LIVE';
  if (upper === 'SELF_PACED_VIDEO') return 'SELF_PACED_VIDEO';
  return 'HYBRID';
}

function normaliseCascade(raw: string | null | undefined): CascadeStrategy {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'TRAIN_EVERYONE') return 'TRAIN_EVERYONE';
  if (upper === 'TRAIN_THE_TRAINER') return 'TRAIN_THE_TRAINER';
  return 'HYBRID';
}

function normaliseFormat(raw: string | null | undefined): AssessmentFormat {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'QUIZ') return 'QUIZ';
  if (upper === 'WORK_PRODUCT_REVIEW') return 'WORK_PRODUCT_REVIEW';
  if (upper === 'NONE') return 'NONE';
  return 'LIVE_DEMO';
}

// ─── Markdown emission ──────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  role: string;
  topics: string[];
  family: RoleFamilySpec;
  cascade: CascadeStrategy;
  delivery: DeliveryMode;
  assessmentRequired: boolean;
  assessmentFormat: AssessmentFormat;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'the ERP';
  const cascadeBlurb: Record<CascadeStrategy, string> = {
    TRAIN_EVERYONE:
      'Consultant-led: every user in this role attends the full curriculum directly with the implementation consultant.',
    TRAIN_THE_TRAINER:
      'Train-the-trainer: the implementation consultant trains designated business champions, who then cascade to end users in this role.',
    HYBRID:
      'Hybrid: consultant-led for core modules; train-the-trainer + champion cascade for ancillary topics.',
  };

  const formatLine = formatForMode(args.delivery);

  const moduleBlocks = args.topics
    .map((topic, idx) => {
      const body = inferModuleBody(topic);
      return [
        `### Module ${idx + 1}: ${topic}`,
        '',
        `- **Objective:** ${body.objective}`,
        `- **Duration:** ~30 min`,
        `- **Format:** ${formatLine}`,
        `- **Practice Exercise:** ${body.practiceExercise}`,
        `- **Quick Reference:** \`Documentation/Training/Quick_Reference_Cards/QRC-${body.qrcSlug}.md\``,
        '',
      ].join('\n');
    })
    .join('\n');

  const assessmentBlock = args.assessmentRequired
    ? assessmentMarkdown(args.assessmentFormat)
    : '_Assessment is not required for this engagement. Sign-off is recorded in `Documentation/Sign_Off_Matrix.md`._';

  return [
    `# ${args.role} Training Guide`,
    '',
    `**Engagement:** ${args.clientName}  `,
    `**Platform:** ${platform}  `,
    `**Role Family:** ${args.family.family}  `,
    `**Cascade Strategy:** ${args.cascade}  `,
    `**Delivery Mode:** ${args.delivery}  `,
    `**Estimated Total Duration:** ~${args.family.estimatedHours} hours`,
    '',
    '## Audience',
    '',
    `${args.role} users at ${args.clientName}.`,
    '',
    `${cascadeBlurb[args.cascade]}`,
    '',
    '## Prerequisites',
    '',
    `- Active ${platform} account with the **${args.role}** role assigned`,
    '- Sandbox access for hands-on practice',
    '- Training-environment login credentials issued by the engagement IT lead',
    '- Pre-reading: `Documentation/Solution_Design.html` (sections relevant to this role)',
    '',
    '## Curriculum',
    '',
    moduleBlocks || '_(No topics declared — populate `training.curriculum.trainingPerRole` in the wizard.)_',
    '## Hands-On Lab',
    '',
    `A 30-minute supervised exercise where a ${args.role} user completes a real end-to-end task in the sandbox under consultant observation. Lab scenario is selected from `,
    '`Documentation/Test_Scripts/` to ensure the lab matches the UAT shape. Trainer signs off in `Documentation/Sign_Off_Matrix.md`.',
    '',
    '## Assessment',
    '',
    assessmentBlock,
    '',
    '## Post-Training Resources',
    '',
    '- Quick Reference Cards: `Documentation/Training/Quick_Reference_Cards/`',
    '- Consolidated Training Manual: `Documentation/Training_Manual.md`',
    '- Training Matrix (who-trains-what): `Documentation/Training_Matrix.md`',
    '- Training Schedule: `Documentation/Training_Schedule.md`',
    '- Sign-off Matrix: `Documentation/Sign_Off_Matrix.md`',
    '- Defect Log Template: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack U (Training Collateral)._',
    '',
  ].join('\n');
}

function assessmentMarkdown(format: AssessmentFormat): string {
  switch (format) {
    case 'QUIZ':
      return [
        '**Format:** Multiple-choice quiz, 10-15 questions covering each module.',
        '',
        '**Pass mark:** 80% — retakes allowed within 48h of failure.',
        '',
        '**Sign-off:** Trainer records pass on `Documentation/Sign_Off_Matrix.md` Per-Role row before the user is granted production access.',
      ].join('\n');
    case 'WORK_PRODUCT_REVIEW':
      return [
        '**Format:** User completes one real, in-scope task under observation. Trainer reviews the resulting record and audit trail.',
        '',
        '**Pass criterion:** Task completed correctly with no manual rework needed by the trainer + clean audit trail entry.',
        '',
        '**Sign-off:** Trainer records pass on `Documentation/Sign_Off_Matrix.md` Per-Role row.',
      ].join('\n');
    case 'NONE':
      return '_Assessment format = NONE: this engagement does not gate production access on a pass/fail. Sign-off in `Documentation/Sign_Off_Matrix.md` is the only gate._';
    case 'LIVE_DEMO':
    default:
      return [
        '**Format:** Live demo — user demonstrates a representative transaction end-to-end with the trainer observing.',
        '',
        '**Pass criterion:** Transaction completed without trainer prompting; user can name the next-step downstream record.',
        '',
        '**Sign-off:** Trainer records pass on `Documentation/Sign_Off_Matrix.md` Per-Role row before the user is granted production access.',
      ].join('\n');
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generatePerRoleTrainingGuides(
  input: PerRoleTrainingGuideInput,
): PerRoleTrainingGuideOutput {
  const declared = parseTrainingPerRole((input.trainingPerRole ?? '').toString());
  const supplementary = parseStandardRoles((input.standardRoleCustomization ?? '').toString());
  const merged = mergeRoleSources(declared, supplementary);

  const cascade = normaliseCascade(input.cascadeStrategy);
  const delivery = normaliseMode(input.deliveryMode);
  const assessmentFormat = normaliseFormat(input.assessmentFormat);
  const assessmentRequired = input.assessmentRequired === true;
  const adaptorName = (input.adaptorName ?? '').toString();

  const files: Record<string, string> = {};
  const emitted: EmittedRoleGuide[] = [];

  for (const entry of merged) {
    const family = classifyRoleFamily(entry.role);
    // Auto-supplement when consultant input is empty or short — Pack U
    // contract: every guide carries 3-7 modules. Below 3 we top up
    // from the canonical curriculum.
    const finalTopics = entry.topics.length >= 3
      ? entry.topics
      : [
          ...entry.topics,
          ...family.canonicalCurriculum.filter(
            (t) => !entry.topics.some((existing) => existing.toLowerCase() === t.toLowerCase()),
          ),
        ].slice(0, 7);

    const slug = slugifyRole(entry.role);
    const filename = `Documentation/Training/${slug}_Training_Guide.md`;

    const markdown = buildMarkdown({
      clientName: input.clientName,
      adaptorName,
      role: entry.role,
      topics: finalTopics,
      family,
      cascade,
      delivery,
      assessmentRequired,
      assessmentFormat,
    });

    files[filename] = markdown;
    emitted.push({
      filename,
      roleName: entry.role,
      family: family.family,
      topics: finalTopics,
    });
  }

  return { files, emitted };
}
