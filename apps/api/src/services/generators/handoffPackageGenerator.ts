/**
 * Phase 45.2 — Handoff Package generator.
 *
 * Produces an operations-oriented bundle for the SLA team taking
 * over a freshly-live engagement. Where the BUSINESS_PROFILE pack
 * is implementation-oriented (BRD, SDD, runbooks, training), this
 * pack focuses on what the support team needs to keep production
 * running:
 *
 *   System_Catalog.md                — all custom objects + integrations
 *   AAI_Map.md / Account_Mapping.md  — adaptor-aware mapping reference
 *   Integrations/                     — re-uses Phase 41.1 cadence-aware
 *                                       integration runbook bundle
 *   Support_Escalation_Matrix.md      — members × roles × on-call
 *   SLA_Terms.md                       — templated by tier (BRONZE/SILVER/GOLD)
 *   Production_Readiness_Checklist.md — auto-fills from CloseoutChecklistItem
 *   Knowledge_Transfer_Slides.md       — markdown deck for KT session
 *
 * The generator is a pure module: it takes a structured input and
 * returns a `Record<filepath, content>` map. The caller (services/
 * generation.ts) writes these to disk under outputs/<jobId>/.
 *
 * Test seam: every doc reads only from the input; no DB / network
 * calls inside this module.
 */

import { generateIntegrationRunbookBundle } from './integrationRunbookBundleGenerator.js';

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface HandoffPackageMember {
  name: string;
  email?: string | null;
  role?: string | null;
  team?: string | null;
}

export interface HandoffPackageChecklistItem {
  key: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'NA';
  notes?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
}

export interface HandoffPackageIntegrationsInput {
  /** Free-text catalog markdown — passed through to the runbook
   *  bundle generator, which already handles the parsing. */
  integrationCatalog?: string | null;
  integrationOwnersByName?: string | null;
  integrationAuthMethods?: string | null;
  integrationMonitoring?: string | null;
  integrationErrorPatterns?: string | null;
  integrationVendorContacts?: string | null;
  integrationReconciliation?: string | null;
  integrationCutoverSmokeTests?: string | null;
}

export type SlaTier = 'BRONZE' | 'SILVER' | 'GOLD';

export interface HandoffPackageInput {
  clientName: string;
  /** netsuite | odoo | custom:<slug>. Drives AAI map vs. Account
   *  Mapping and the Integrations folder content. */
  adaptorId: string;
  adaptorName: string;
  license: { edition?: string; modules?: ReadonlyArray<string> };
  /** Wizard answers — used to extract custom records / fields / etc. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  answers: Record<string, any>;
  members: ReadonlyArray<HandoffPackageMember>;
  checklist: ReadonlyArray<HandoffPackageChecklistItem>;
  /** Selected SLA tier — drives SLA_Terms.md content. Defaults to
   *  SILVER when omitted (most common pilot tier). */
  slaTier?: SlaTier;
  /** Date prepared, ISO. Defaults to now. */
  preparedAt?: string;
  /** Integration catalog / overlay strings (same shape Phase 41.1
   *  runbook bundle expects). When omitted, the Integrations folder
   *  renders the default catalog for the adaptor. */
  integrations?: HandoffPackageIntegrationsInput;
}

export type HandoffPackageOutput = Record<string, string>;

// ─── Per-doc renderers ───────────────────────────────────────────────────────

function renderSystemCatalog(input: HandoffPackageInput): string {
  const lines: string[] = [];
  lines.push(`# System Catalog — ${input.clientName}`);
  lines.push('');
  lines.push(`**Platform:** ${input.adaptorName}  `);
  lines.push(`**Edition:** ${input.license.edition ?? '—'}  `);
  lines.push(`**Modules in scope:** ${input.license.modules?.join(', ') || '—'}  `);
  lines.push(`**Date prepared:** ${input.preparedAt ?? new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## 1. Custom records, fields, and lists');
  lines.push('');
  lines.push('Pulled from the Discovery answers. Cross-reference the SDF deploy package for definitive state.');
  lines.push('');
  // The answers blob has flow-prefixed keys; surface anything that
  // includes "custom" in the key as a flat list. Future enhancement
  // can structure this per recordtype.
  const customEntries = Object.entries(input.answers)
    .filter(([k]) => /custom|customField|customRecord|customList/i.test(k))
    .slice(0, 50);
  if (customEntries.length === 0) {
    lines.push('_No custom-object answers captured during discovery._');
  } else {
    lines.push('| Discovery key | Value |');
    lines.push('|---|---|');
    for (const [k, v] of customEntries) {
      const valStr = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
      lines.push(`| \`${k}\` | ${valStr} |`);
    }
  }
  lines.push('');
  lines.push('## 2. Roles + permissions');
  lines.push('');
  lines.push('See `Support_Escalation_Matrix.md` for the live team + on-call rotation.');
  lines.push('');
  lines.push('## 3. Integrations');
  lines.push('');
  lines.push('See `Integrations/` for one runbook per integration.');
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package)._`);
  return lines.join('\n');
}

function renderAaiOrAccountMapping(input: HandoffPackageInput): string {
  const isNetSuite = input.adaptorId === 'netsuite' || input.adaptorName.toLowerCase().includes('netsuite');
  const isOdoo = input.adaptorId === 'odoo' || input.adaptorName.toLowerCase().includes('odoo');
  const lines: string[] = [];
  if (isNetSuite) {
    lines.push(`# AAI Map — ${input.clientName}`);
    lines.push('');
    lines.push('The Auto-Apply Items (AAI) map captures NetSuite-side preference + posting-rule references that the support team needs at incident-response time.');
    lines.push('');
    lines.push('## 1. Posting setup');
    lines.push('| Area | Reference |');
    lines.push('|---|---|');
    lines.push('| Default expense posting | _[ASSIGN]_ |');
    lines.push('| Default revenue posting | _[ASSIGN]_ |');
    lines.push('| Default inventory adj posting | _[ASSIGN]_ |');
    lines.push('');
    lines.push('## 2. Allocation rules');
    lines.push('_[ASSIGN — pull from Setup → Accounting → Manage Accounting Periods → Allocations]_');
  } else if (isOdoo) {
    lines.push(`# Account Mapping — ${input.clientName}`);
    lines.push('');
    lines.push('Odoo posting + journal mapping reference for the support team.');
    lines.push('');
    lines.push('## 1. Default journals');
    lines.push('| Function | Journal | Notes |');
    lines.push('|---|---|---|');
    lines.push('| Sales | _[ASSIGN]_ | |');
    lines.push('| Purchases | _[ASSIGN]_ | |');
    lines.push('| Bank | _[ASSIGN]_ | |');
    lines.push('| Cash | _[ASSIGN]_ | |');
  } else {
    // Custom adaptor / unknown platform — generic mapping doc.
    lines.push(`# Account Mapping — ${input.clientName}`);
    lines.push('');
    lines.push(`Adaptor-agnostic mapping doc for ${input.adaptorName}. Replace the placeholder rows with the platform's posting + journal references.`);
    lines.push('');
    lines.push('| Function | Reference | Notes |');
    lines.push('|---|---|---|');
    lines.push('| Sales | _[ASSIGN]_ | |');
    lines.push('| Purchases | _[ASSIGN]_ | |');
    lines.push('| Bank | _[ASSIGN]_ | |');
    lines.push('| Inventory adj | _[ASSIGN]_ | |');
  }
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package)._`);
  return lines.join('\n');
}

function renderSupportEscalationMatrix(input: HandoffPackageInput): string {
  const lines: string[] = [];
  lines.push(`# Support Escalation Matrix — ${input.clientName}`);
  lines.push('');
  lines.push('| Tier | Channel | Owner |');
  lines.push('|---|---|---|');
  lines.push('| L1 — Triage | In-app ticket queue (Phase 45.6) | Support Engineer (assigned per ticket) |');
  lines.push('| L2 — Specialist | Slack + escalation email | Support Lead |');
  lines.push('| L3 — Escalation | War-room SOP | Account Manager + Support Lead |');
  lines.push('');
  lines.push('## Engagement team');
  lines.push('');
  if (input.members.length === 0) {
    lines.push('_No members on file — populate via Settings → Team or the engagement Members tab._');
  } else {
    lines.push('| Name | Role | Team | Email |');
    lines.push('|---|---|---|---|');
    for (const m of input.members) {
      lines.push(`| ${m.name} | ${m.role ?? '—'} | ${m.team ?? '—'} | ${m.email ?? '—'} |`);
    }
  }
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package)._`);
  return lines.join('\n');
}

const SLA_TIER_BLOCKS: Record<SlaTier, { p1: string; p2: string; p3: string; p4: string; coverage: string; description: string }> = {
  BRONZE: {
    p1: 'Best-effort; next-business-day response',
    p2: 'Best-effort; 3 business-day response',
    p3: 'Best-effort; 5 business-day response',
    p4: 'Best-effort; 10 business-day response',
    coverage: 'Mon-Fri 09:00-17:00 local',
    description: 'Entry-level tier suitable for non-critical workloads. No 24/7 coverage. Email-only.',
  },
  SILVER: {
    p1: '4-hour response, 1 business day resolution target',
    p2: '8-hour response, 3 business day resolution target',
    p3: 'Next business day response, 5 business day resolution target',
    p4: '5 business day response',
    coverage: 'Mon-Fri 09:00-21:00 local',
    description: 'Mid-tier coverage for production workloads. Includes Slack channel access during business hours.',
  },
  GOLD: {
    p1: '1-hour response, 4-hour resolution target — 24/7',
    p2: '4-hour response, 24-hour resolution target',
    p3: 'Next business day response, 5 business day resolution target',
    p4: '5 business day response',
    coverage: '24/7 with on-call rotation',
    description: 'Mission-critical coverage. Dedicated account manager, 24/7 on-call, quarterly business reviews.',
  },
};

function renderSlaTerms(input: HandoffPackageInput): string {
  const tier = input.slaTier ?? 'SILVER';
  const block = SLA_TIER_BLOCKS[tier];
  const lines: string[] = [];
  lines.push(`# SLA Terms — ${input.clientName}`);
  lines.push('');
  lines.push(`**Tier:** ${tier}  `);
  lines.push(`**Coverage:** ${block.coverage}  `);
  lines.push(`**Effective:** ${input.preparedAt ?? new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push(`> ${block.description}`);
  lines.push('');
  lines.push('## Response + resolution targets');
  lines.push('');
  lines.push('| Severity | Description | Target |');
  lines.push('|---|---|---|');
  lines.push(`| P1 | Production down / data loss / security incident | ${block.p1} |`);
  lines.push(`| P2 | Critical workflow degraded / no workaround | ${block.p2} |`);
  lines.push(`| P3 | Non-critical bug / workaround available | ${block.p3} |`);
  lines.push(`| P4 | Question / enhancement request | ${block.p4} |`);
  lines.push('');
  lines.push('## What\'s in scope');
  lines.push('- Bug investigation + fix on configurations delivered via this engagement');
  lines.push('- Triage of integration failures owned by ERPLaunch');
  lines.push('- Quarterly health review (Phase 45.7)');
  lines.push('');
  lines.push('## What\'s out of scope');
  lines.push('- New module implementations (separate SOW)');
  lines.push('- Vendor-side incidents (third-party SaaS, ISP, hosting provider)');
  lines.push('- User training (separate engagement)');
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package). Tier: **${tier}**._`);
  return lines.join('\n');
}

function renderProductionReadinessChecklist(input: HandoffPackageInput): string {
  const lines: string[] = [];
  lines.push(`# Production Readiness Checklist — ${input.clientName}`);
  lines.push('');
  lines.push('Snapshot of the closeout checklist at the moment this package was generated. Live state lives at /engagements/:id/closeout-checklist.');
  lines.push('');
  if (input.checklist.length === 0) {
    lines.push('_Closeout checklist not initialised yet — engagement may not be in CLOSEOUT stage._');
  } else {
    lines.push('| Item | Status | Completed by | Completed at | Notes |');
    lines.push('|---|---|---|---|---|');
    for (const item of input.checklist) {
      const notes = (item.notes ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
      lines.push(`| ${item.key} | ${item.status} | ${item.completedBy ?? '—'} | ${item.completedAt ?? '—'} | ${notes} |`);
    }
  }
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package)._`);
  return lines.join('\n');
}

function renderKnowledgeTransferSlides(input: HandoffPackageInput): string {
  const modules = input.license.modules?.join(', ') || '—';
  const lines: string[] = [];
  lines.push(`# Knowledge Transfer — ${input.clientName}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 1 — Engagement overview');
  lines.push('');
  lines.push(`- **Client:** ${input.clientName}`);
  lines.push(`- **Platform:** ${input.adaptorName} (${input.license.edition ?? 'edition not set'})`);
  lines.push(`- **Modules implemented:** ${modules}`);
  lines.push(`- **Go-live:** ${input.preparedAt ?? 'recent'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 2 — Business processes implemented');
  lines.push('');
  lines.push('Refer to BRD.md for the full Discovery answer set. Highlights:');
  lines.push('');
  // Pull a small sample of meaningful answer keys.
  const sample = Object.entries(input.answers)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 5);
  for (const [k, v] of sample) {
    const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60);
    lines.push(`- \`${k}\` → ${val}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 3 — Decisions log');
  lines.push('');
  lines.push('See Decisions tab in the platform for the full log. Top items the support team needs:');
  lines.push('- _[populate from Decisions tab]_');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 4 — Custom configurations');
  lines.push('');
  lines.push('See `System_Catalog.md` for the inventory.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 5 — Integration touchpoints');
  lines.push('');
  lines.push('See `Integrations/` folder. Critical-path integrations (impacting period close) are flagged in each runbook.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 6 — Known limitations');
  lines.push('');
  lines.push('- _[populate from Issues tab — open + WONTFIX items]_');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Slide 7 — Training plan executed');
  lines.push('');
  lines.push('Training packages produced during BUSINESS_PROFILE generation are at /Documentation/Training/. KT session covered: power users, admin team, finance reviewer.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`_Generated by ERPLaunch — Phase 45.2 (Handoff Package)._`);
  return lines.join('\n');
}

// ─── Top-level ───────────────────────────────────────────────────────────────

export function generateHandoffPackage(input: HandoffPackageInput): HandoffPackageOutput {
  const out: HandoffPackageOutput = {};

  out['Documentation/System_Catalog.md'] = renderSystemCatalog(input);

  const isNetSuite = input.adaptorId === 'netsuite' || input.adaptorName.toLowerCase().includes('netsuite');
  const aaiName = isNetSuite ? 'AAI_Map.md' : 'Account_Mapping.md';
  out[`Documentation/${aaiName}`] = renderAaiOrAccountMapping(input);

  out['Documentation/Support_Escalation_Matrix.md'] = renderSupportEscalationMatrix(input);
  out['Documentation/SLA_Terms.md'] = renderSlaTerms(input);
  out['Documentation/Production_Readiness_Checklist.md'] = renderProductionReadinessChecklist(input);
  out['Documentation/Knowledge_Transfer_Slides.md'] = renderKnowledgeTransferSlides(input);

  // Re-use the Phase 41.1 cadence-aware integration runbook bundle.
  const runbookInput = {
    clientName: input.clientName,
    adaptorName: input.adaptorName,
    answers: input.answers,
    integrationOwnersByName: input.integrations?.integrationOwnersByName ?? null,
    integrationAuthMethods: input.integrations?.integrationAuthMethods ?? null,
    integrationMonitoring: input.integrations?.integrationMonitoring ?? null,
    integrationErrorPatterns: input.integrations?.integrationErrorPatterns ?? null,
    integrationVendorContacts: input.integrations?.integrationVendorContacts ?? null,
    integrationReconciliation: input.integrations?.integrationReconciliation ?? null,
    integrationCutoverSmokeTests: input.integrations?.integrationCutoverSmokeTests ?? null,
  };
  const bundle = generateIntegrationRunbookBundle(runbookInput);
  for (const [filename, body] of Object.entries(bundle.files)) {
    out[`Documentation/Integrations/${filename}`] = body;
  }

  return out;
}
