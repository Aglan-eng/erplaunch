/**
 * Phase 54.3 — Per-stage implementation focus.
 *
 * Each lifecycle stage gets:
 *   - `focusHeadline` — what matters most at this stage in 5–10 words.
 *   - `focusBody`     — one plain-English sentence on what to do.
 *   - `primaryAction` — the most useful next click. Either jumps to
 *                       another tab on the Customer page (e.g. the
 *                       Documents tab to generate a Proposal) or
 *                       routes to one of the existing engagement
 *                       workspace surfaces (Data Collection, status
 *                       report, etc.).
 *   - `relevantTools` — entry-point ids from the Implementation tab's
 *                       card grid that should surface first at this
 *                       stage (the others stay reachable but muted).
 *
 * The Implementation tab reads this map to render its "Your focus at
 * this stage" panel and re-order the 5 workspace cards.
 */
import type { CustomerStage } from '@/lib/api';

/** Ids matching the entries in CustomerDetailPage's ImplementationTab. */
export type WorkspaceEntryId =
  | 'data-collection'
  | 'documents'
  | 'status-report'
  | 'vertical-workspace'
  | 'jobs';

export interface PrimaryAction {
  label: string;
  /** When set, switches the Customer Detail tab. */
  targetTab?: 'overview' | 'documents' | 'implementation' | 'activity' | 'settings';
  /** When set, routes (relative to the customer page) — used for the
   *  Data Collection / Status Report shortcuts that live under
   *  /engagements/:id/*. The `:id` is substituted at render time. */
  targetRoute?: string;
}

export interface StageFocus {
  focusHeadline: string;
  focusBody: string;
  primaryAction: PrimaryAction;
  /** Entry-point ids that should surface first/highlighted. */
  relevantTools: ReadonlyArray<WorkspaceEntryId>;
  /** Optional muted note (e.g. for terminal stages). */
  tone?: 'default' | 'muted';
}

export const STAGE_FOCUS_MAP: Record<CustomerStage, StageFocus> = {
  LEAD: {
    focusHeadline: 'Pre-sales — no implementation work yet',
    focusBody:
      'Qualify the deal before anything else. Until they move to Qualified there is no engagement to set up.',
    primaryAction: { label: 'Open Documents', targetTab: 'documents' },
    relevantTools: ['documents'],
  },
  QUALIFIED: {
    focusHeadline: 'Pre-sales — keep moving toward a proposal',
    focusBody:
      'The deal is real. Capability statement, discovery call summary, get them to Proposal stage.',
    primaryAction: { label: 'Open Documents', targetTab: 'documents' },
    relevantTools: ['documents'],
  },
  PROPOSAL: {
    focusHeadline: 'Still pre-sales — generate and refine the proposal',
    focusBody:
      'Generate the branded proposal PDF, send it, iterate on commercials until they sign off.',
    primaryAction: { label: 'Generate Proposal PDF', targetTab: 'documents' },
    relevantTools: ['documents'],
  },
  NEGOTIATION: {
    focusHeadline: 'Closing the deal — refine the commercials',
    focusBody:
      'Iterate on price, scope, and terms. Issue a revised proposal when the customer asks for changes.',
    primaryAction: { label: 'Open Documents', targetTab: 'documents' },
    relevantTools: ['documents'],
  },
  WON: {
    focusHeadline: 'Deal won — kick off delivery',
    focusBody:
      'Generate the Statement of Work and Kickoff Deck, schedule the kickoff meeting, hand off from Sales to the Project Lead.',
    primaryAction: { label: 'Generate SOW + Kickoff', targetTab: 'documents' },
    relevantTools: ['documents', 'data-collection'],
  },
  DISCOVERY: {
    focusHeadline: 'Discovery — capture how the customer actually runs',
    focusBody:
      'Complete the discovery questionnaire. Every downstream generator (BRD, Solution Design, Configuration Workbook) reads from it.',
    primaryAction: { label: 'Open Discovery & Data Collection', targetTab: 'implementation' },
    relevantTools: ['data-collection', 'documents'],
  },
  SCOPING: {
    focusHeadline: 'Scoping — lock the solution',
    focusBody:
      'Generate the Scope Document, Fit-Gap Analysis, and Solution Design. Get scope sign-off before the build starts.',
    primaryAction: { label: 'Generate Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'data-collection'],
  },
  BUILD: {
    focusHeadline: 'Build — configure the system',
    focusBody:
      'Generate the Configuration Workbook and platform-specific (SDF / Odoo) artifacts. Weekly progress reports keep the sponsor informed.',
    primaryAction: { label: 'Generate Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'jobs', 'vertical-workspace'],
  },
  UAT: {
    focusHeadline: 'UAT — prove it works',
    focusBody:
      'Generate the UAT Test Plan and test scripts. Track defects to closure; nothing ships to go-live with open P1s.',
    primaryAction: { label: 'Generate Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'status-report'],
  },
  GOLIVE: {
    focusHeadline: 'Go-live — execute the cutover',
    focusBody:
      'Generate the Cutover Plan, Go-Live Runbook, Go-Live Checklist, and Data Migration Plan. Lock the runbook 48 hours before cutover.',
    primaryAction: { label: 'Generate Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'status-report', 'jobs'],
  },
  HYPERCARE: {
    focusHeadline: 'Hypercare — stabilize',
    focusBody:
      'Generate the Hypercare Plan and KPI dashboard. Triage incidents daily; exit hypercare cleanly with an exit report.',
    primaryAction: { label: 'Generate Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'status-report'],
  },
  LIVE_SLA: {
    focusHeadline: 'Live service — keep it healthy',
    focusBody:
      'Run quarterly health checks and continuous-improvement reviews. Watch the status report for emerging issues.',
    primaryAction: { label: 'Open Status Report', targetTab: 'implementation' },
    relevantTools: ['status-report', 'documents'],
  },
  RENEWAL_DUE: {
    focusHeadline: 'Renewal — secure the next term',
    focusBody:
      'Generate the renewal proposal, lock in commercials, complete the renewal before the contract end date.',
    primaryAction: { label: 'Generate Renewal Documents', targetTab: 'documents' },
    relevantTools: ['documents', 'status-report'],
  },
  RENEWED: {
    focusHeadline: 'Renewed — continue managed service',
    focusBody:
      'Treat exactly like Live SLA: quarterly health checks and ongoing service reports.',
    primaryAction: { label: 'Open Status Report', targetTab: 'implementation' },
    relevantTools: ['status-report', 'documents'],
  },
  LOST: {
    focusHeadline: 'Closed — deal lost',
    focusBody: 'No active implementation work. Archive when ready.',
    primaryAction: { label: 'Open Activity', targetTab: 'activity' },
    relevantTools: [],
    tone: 'muted',
  },
  CHURNED: {
    focusHeadline: 'Closed — customer churned',
    focusBody: 'No active implementation work. Capture lessons learned in the activity log.',
    primaryAction: { label: 'Open Activity', targetTab: 'activity' },
    relevantTools: [],
    tone: 'muted',
  },
};

/**
 * Look up the focus for a stage. Returns the LEAD entry as a defensive
 * fallback if the stage isn't recognised — this should never happen
 * given the type, but keeps the UI from blanking on bad data.
 */
export function focusForStage(stage: CustomerStage): StageFocus {
  return STAGE_FOCUS_MAP[stage] ?? STAGE_FOCUS_MAP.LEAD;
}
