/**
 * Phase 53.2 — Per-stage document catalog.
 *
 * The Documents tab on Customer Detail surfaces the document set
 * that actually belongs to the customer's current lifecycle stage
 * (Cutover Plan during Go-live, not a Proposal). This module is
 * the single source of truth for that mapping.
 *
 * Status semantics:
 *   - `available`  → the renderer is built; the frontend wires a
 *                    working Generate button to the matching export
 *                    endpoint.
 *   - `coming-soon` → the slot is real but the template hasn't been
 *                    built yet. The UI renders a muted listed card
 *                    with a "Coming soon" badge — never a dead button.
 *
 * Only `proposal` and `sow` are available today. Each remaining
 * document gets its own follow-up phase to build the Phase 51-style
 * HTML/CSS template + renderer.
 */
import type { CustomerStage } from '../../db/customer.js';

export type DocumentStatus = 'available' | 'coming-soon';

export type DocumentCategory =
  | 'sales'
  | 'delivery'
  | 'support'
  | 'renewal';

export interface DocumentDefinition {
  /** Stable kebab-case id — used by the export route + frontend dispatch. */
  id: string;
  /** Display name (Title Case, no jargon). */
  name: string;
  /** One-sentence plain-English description of what the doc contains. */
  description: string;
  /** Lifecycle stage this document belongs to. */
  stage: CustomerStage;
  category: DocumentCategory;
  status: DocumentStatus;
  /** Export endpoint suffix for `available` docs (e.g. 'proposal'),
   *  matching the existing `/api/v1/exports/<suffix>` route. Null for
   *  coming-soon. */
  exportRoute: string | null;
}

export const DOCUMENT_CATALOG: ReadonlyArray<DocumentDefinition> = [
  // ─── Sales-stage docs ────────────────────────────────────────────
  {
    id: 'capability-statement',
    name: 'Capability Statement',
    description: 'One-page summary of what your firm does, for cold introductions.',
    stage: 'LEAD',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'discovery-call-summary',
    name: 'Discovery Call Summary',
    description: 'Notes + next steps captured after the first conversation.',
    stage: 'LEAD',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'qualified-capability-statement',
    name: 'Capability Statement',
    description: 'One-page summary of what your firm does, tailored to a qualified prospect.',
    stage: 'QUALIFIED',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'qualified-discovery-call-summary',
    name: 'Discovery Call Summary',
    description: 'Updated notes after the qualifying conversation.',
    stage: 'QUALIFIED',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'proposal',
    name: 'Proposal',
    description: 'Scope, deliverables, timeline, and commercials — the document you send to win the deal.',
    stage: 'PROPOSAL',
    category: 'sales',
    status: 'available',
    exportRoute: 'proposal',
  },
  {
    id: 'revised-proposal',
    name: 'Revised Proposal',
    description: 'Updated proposal reflecting negotiation feedback.',
    stage: 'NEGOTIATION',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'commercial-comparison',
    name: 'Commercial Comparison',
    description: 'Side-by-side of the original vs revised commercials so both parties see what changed.',
    stage: 'NEGOTIATION',
    category: 'sales',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'sow',
    name: 'Statement of Work',
    description: 'Binding scope, milestones, fees, and acceptance criteria for the engagement.',
    stage: 'WON',
    category: 'sales',
    status: 'available',
    exportRoute: 'sow',
  },
  {
    id: 'kickoff-deck',
    name: 'Kickoff Deck',
    description: 'Project introduction slides for the kickoff meeting — team, plan, expectations.',
    stage: 'WON',
    category: 'delivery',
    status: 'available',
    exportRoute: 'kickoff-deck',
  },

  // ─── Delivery-stage docs ─────────────────────────────────────────
  {
    id: 'business-process-document',
    name: 'Business Process Document',
    description: 'How the customer\'s real-world processes work today — feeds the configuration.',
    stage: 'DISCOVERY',
    category: 'delivery',
    status: 'available',
    exportRoute: 'business-process-document',
  },
  {
    id: 'requirements-document',
    name: 'Requirements Document',
    description: 'Functional + non-functional requirements gathered during Discovery.',
    stage: 'DISCOVERY',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'scope-document',
    name: 'Scope Document',
    description: 'What will be built, what is explicitly out of scope, and the change-order process.',
    stage: 'SCOPING',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'fit-gap-analysis',
    name: 'Fit-Gap Analysis',
    description: 'Where the platform fits the requirements out-of-the-box vs where customisation is needed.',
    stage: 'SCOPING',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'solution-design',
    name: 'Solution Design',
    description: 'Module-by-module configuration spec — the build team\'s reference.',
    stage: 'SCOPING',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'configuration-workbook',
    name: 'Configuration Workbook',
    description: 'Per-module configuration choices, tracked + signed off as the build progresses.',
    stage: 'BUILD',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'build-progress-report',
    name: 'Build Progress Report',
    description: 'Weekly progress + blockers + decisions, sent to the customer sponsor.',
    stage: 'BUILD',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'uat-test-plan',
    name: 'UAT Test Plan',
    description: 'Every scenario the customer will exercise during User Acceptance Testing.',
    stage: 'UAT',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'uat-signoff',
    name: 'UAT Sign-Off Form',
    description: 'Customer sign-off that UAT passed and the system is ready for go-live.',
    stage: 'UAT',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'cutover-plan',
    name: 'Cutover Plan',
    description: 'The week-by-week countdown to go-live — data, training, communications.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'golive-checklist',
    name: 'Go-Live Checklist',
    description: 'Every item that must be done before the cutover weekend.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'golive-runbook',
    name: 'Go-Live Runbook',
    description: 'Hour-by-hour cutover-weekend plan with owners + rollback triggers.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'data-migration-plan',
    name: 'Data Migration Plan',
    description: 'How customer data gets from legacy systems into the new platform, with validation gates.',
    stage: 'GOLIVE',
    category: 'delivery',
    status: 'coming-soon',
    exportRoute: null,
  },

  // ─── Support-stage docs ──────────────────────────────────────────
  {
    id: 'hypercare-plan',
    name: 'Hypercare Plan',
    description: 'The 30-day post-go-live close-watch plan — response times, escalation paths, exit criteria.',
    stage: 'HYPERCARE',
    category: 'support',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'hypercare-exit-report',
    name: 'Hypercare Exit Report',
    description: 'Summary of incidents + resolutions during hypercare; confirms readiness for steady state.',
    stage: 'HYPERCARE',
    category: 'support',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'sla-agreement',
    name: 'SLA Agreement',
    description: 'Service-level agreement covering response times, uptime targets, and credits.',
    stage: 'LIVE_SLA',
    category: 'support',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'monthly-service-report',
    name: 'Monthly Service Report',
    description: 'Tickets resolved, SLA performance, system uptime — sent to the customer monthly.',
    stage: 'LIVE_SLA',
    category: 'support',
    status: 'coming-soon',
    exportRoute: null,
  },

  // ─── Renewal docs ────────────────────────────────────────────────
  {
    id: 'renewal-quote',
    name: 'Renewal Quote',
    description: 'Pricing for the next renewal term — line items + total.',
    stage: 'RENEWAL_DUE',
    category: 'renewal',
    status: 'coming-soon',
    exportRoute: null,
  },
  {
    id: 'renewal-proposal',
    name: 'Renewal Proposal',
    description: 'Renewal pitch including new scope items, success highlights, and pricing.',
    stage: 'RENEWAL_DUE',
    category: 'renewal',
    status: 'coming-soon',
    exportRoute: null,
  },
];

/** All stages that have at least one document defined. */
export function stagesWithDocuments(): ReadonlyArray<CustomerStage> {
  const seen = new Set<CustomerStage>();
  for (const doc of DOCUMENT_CATALOG) seen.add(doc.stage);
  return Array.from(seen);
}

/** All documents for a given stage, in catalog order. */
export function documentsForStage(stage: CustomerStage): DocumentDefinition[] {
  return DOCUMENT_CATALOG.filter((d) => d.stage === stage);
}

/** Look up by id (used by the route layer for validation). */
export function findDocument(id: string): DocumentDefinition | undefined {
  return DOCUMENT_CATALOG.find((d) => d.id === id);
}
