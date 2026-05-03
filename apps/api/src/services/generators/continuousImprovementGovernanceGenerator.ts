/**
 * Continuous Improvement Governance generator (Pack Y — Component 5).
 *
 * Cross-platform — emits Documentation/Stabilization/Continuous_Improvement_Governance.md.
 *
 * Steady-state governance body + RACI matrix + change-request lifecycle
 * + cadence + release calendar (adaptor-conditional: NetSuite biannual
 * releases vs. Odoo annual major + OdooSH staging-prod promotion).
 */

import {
  parseCommittee,
  DEFAULT_COMMITTEE_ROWS,
  type ParsedCommitteeRow,
} from './stabilizationHelpers.js';

export interface ContinuousImprovementGovernanceInput {
  clientName: string;
  /** "NetSuite" / "Odoo" — drives release-calendar section. */
  adaptorName?: string;
  /** TEXTAREA stabilization.governance.governanceCommittee. */
  governanceCommittee?: string | null;
  /** TEXT stabilization.governance.decisionCadence. */
  decisionCadence?: string | null;
  /** TEXTAREA stabilization.governance.changeRequestProcess. */
  changeRequestProcess?: string | null;
  /** TEXT stabilization.governance.stabilizationOwner — used in committee. */
  stabilizationOwner?: string | null;
}

export interface ContinuousImprovementGovernanceOutput {
  markdown: string;
}

interface ReleaseCalendarProfile {
  sectionTitle: string;
  description: string;
  cadenceTable: string;
  freezeGuidance: string;
}

function releaseCalendarFor(adaptorName: string): ReleaseCalendarProfile {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      sectionTitle: 'NetSuite Release Calendar',
      description:
        'NetSuite ships **2 vendor releases per year** (e.g., 2026.1 and 2026.2). Each release has a sandbox preview window, a phased rollout to production, and a final deadline by which all accounts must be on the new release. Plan engagement-side change waves around the vendor schedule.',
      cadenceTable: [
        '| Window | Vendor activity | Engagement activity |',
        '|--------|------------------|---------------------|',
        '| **Pre-release (-8 to -2 weeks)** | Release Preview available in sandbox | Run regression on Release Preview sandbox; identify SuiteScript/WFA breakages early |',
        '| **Release week (T+0)** | Production upgraded in cohort waves | Freeze any non-trivial config changes; monitor day-1 health closely |',
        '| **Post-release (+1 to +4 weeks)** | New features stabilising | Deploy any Quick Wins / Enhancements built on new features; refresh saved searches affected by schema changes |',
        '| **Steady (+5+ weeks)** | Vendor focuses on next release | Normal change-request cadence resumes; queue items for next release wave |',
      ].join('\n'),
      freezeGuidance:
        '**Freeze windows:** -1 week before vendor release through +1 week after. No customisation deploys, no integration changes, no master-data restructures during freeze. Hot-fixes only via Hypercare/Issue_Escalation_Matrix.md L3 authorisation.',
    };
  }
  if (lower === 'odoo') {
    return {
      sectionTitle: 'Odoo Release Calendar',
      description:
        'Odoo ships **1 annual major version** (e.g., 19.0, 20.0) plus continuous patch releases on OdooSH between majors. Production environments stay on a chosen major for stability; OdooSH uses a staging→production promotion model for any change.',
      cadenceTable: [
        '| Stage | OdooSH activity | Engagement activity |',
        '|-------|------------------|---------------------|',
        '| **Build** | Branch on OdooSH | Develop change in feature branch; runs full CI on push |',
        '| **Staging** | Promote to staging | Manual QA + UAT against production data clone; sign-off from functional lead |',
        '| **Production** | Promote staging → production | Deploy via OdooSH dashboard; monitor `ir.logging` for first 24h |',
        '| **Annual major upgrade** | New major version (annual) | Plan engagement upgrade window (typically 6-12 months after vendor release) — full regression + custom-module compatibility check |',
      ].join('\n'),
      freezeGuidance:
        '**Freeze windows:** During annual major upgrade evaluation + execution (typically 4-6 weeks). Quick Wins continue via patch releases on OdooSH; deeper enhancements wait for the major version cutover.',
    };
  }
  return {
    sectionTitle: 'Platform Release Calendar',
    description:
      '_[ASSIGN platform release cadence — populate adaptorName for auto-fill.]_',
    cadenceTable: '_[ASSIGN cadence table]_',
    freezeGuidance: '_[ASSIGN freeze guidance]_',
  };
}

function committeeTable(rows: ReadonlyArray<ParsedCommitteeRow>): string {
  if (rows.length === 0) {
    return DEFAULT_COMMITTEE_ROWS.map(
      (r) => `| ${r.name} | ${r.role} | ${r.function} |`,
    ).join('\n');
  }
  return rows
    .map(
      (r) =>
        `| ${r.name} | ${r.role || '_[ASSIGN role]_'} | ${r.function || '_[ASSIGN function]_'} |`,
    )
    .join('\n');
}

function parseChangeRequestSteps(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

const DEFAULT_CR_STEPS: ReadonlyArray<string> = [
  'Submit — End user / power user opens a change request via the engagement\'s ticket system, with all required fields',
  'Triage — Weekly IT-functional huddle reviews new CRs; assigns workstream lead + sets initial priority',
  'Estimate — Workstream lead + consultant lead estimate effort + risk; routes high-effort items for design review',
  'Prioritize — Monthly steering committee approves backlog priority + commits items to the next release wave',
  'Build — Development + unit test + UAT in sandbox; functional lead signs off',
  'Release — Promote to production with mandatory regression test pack; CR closed when 24h post-release health green',
];

export function generateContinuousImprovementGovernance(
  input: ContinuousImprovementGovernanceInput,
): ContinuousImprovementGovernanceOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const cadence = input.decisionCadence?.trim().length
    ? input.decisionCadence.trim()
    : 'Monthly steering committee, quarterly business review, annual board readout (default cadence)';
  const owner = input.stabilizationOwner?.trim().length
    ? input.stabilizationOwner.trim()
    : '_[ASSIGN stabilization owner]_';

  const committee = parseCommittee((input.governanceCommittee ?? '').toString());
  const declaredCrSteps = parseChangeRequestSteps((input.changeRequestProcess ?? '').toString());
  const crSteps = declaredCrSteps.length > 0 ? declaredCrSteps : DEFAULT_CR_STEPS;
  const crSource =
    declaredCrSteps.length > 0
      ? '_(Source: parsed `stabilization.governance.changeRequestProcess` overlay.)_'
      : '_(Source: canonical default 6-stage flow. Customise via `stabilization.governance.changeRequestProcess` overlay.)_';

  const release = releaseCalendarFor(platform);

  const markdown = [
    `# Continuous Improvement Governance — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Sustainment Owner:** ${owner}  `,
    `**Cadence:** ${cadence}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Steady-state governance body + decision-rights matrix + change-request lifecycle ',
    `+ release calendar for ongoing ${platformLabel} stewardship after hypercare exit.`,
    '',
    '## 1. Steady-State Governance Body',
    '',
    'Replaces the hypercare war-room. Meets per the cadence in section 4. The body owns ',
    'every decision in section 2 and every change request in section 3.',
    '',
    '| Name | Role | Function Represented |',
    '|------|------|----------------------|',
    committeeTable(committee),
    '',
    '## 2. Decision-Rights Matrix (RACI)',
    '',
    'For each decision category, who is **R**esponsible / **A**ccountable / **C**onsulted / **I**nformed.',
    '',
    '| Decision | Sustainment Owner | Finance Lead | Operations Lead | IT Lead | Sponsor | Vendor AM |',
    '|----------|-------------------|--------------|------------------|---------|---------|-----------|',
    '| Configuration change (no impact on integrations) | A,R | C | C | I | I | — |',
    '| Master-data change (e.g., COA addition) | A | R | C | C | I | — |',
    '| Integration change (new endpoint, schema, or volume) | A,R | C | C | R | I | C |',
    '| Customisation change (script, workflow) | A,R | I | I | R | I | C |',
    '| Release of new module | A | R | R | R | A | C |',
    '| Expansion to new entity | A | R | R | R | A | C |',
    '| Vendor escalation / contract renegotiation | I | A | I | R | A | R |',
    '',
    '## 3. Change-Request Lifecycle',
    '',
    crSource,
    '',
    crSteps.map((step, i) => `${i + 1}. **${step}**`).join('\n'),
    '',
    'Lifecycle artefacts:',
    '- Change-request register: spreadsheet OR ticket-system queue (engagement-specific).',
    '- Backlog grooming: weekly huddle (workstream + IT)',
    '- Release notes: published per change wave to client KB',
    '',
    '## 4. Cadence',
    '',
    `**Default:** ${cadence}`,
    '',
    '- **Weekly IT-functional huddle** — change-request triage + estimate intake',
    '- **Monthly steering** — backlog prioritization + KPI snapshot + escalations',
    '- **Quarterly business review** — Benefits Realization Tracker review + phase-two decisions',
    '- **Annual board readout** — year-N outcomes vs. business case + year-(N+1) roadmap',
    '',
    `## 5. ${release.sectionTitle}`,
    '',
    release.description,
    '',
    release.cadenceTable,
    '',
    release.freezeGuidance,
    '',
    '## 6. Cross-References',
    '',
    '- Stabilization roadmap: `Documentation/Stabilization/Stabilization_Roadmap.md`',
    '- Process-improvement backlog: `Documentation/Stabilization/Process_Improvement_Backlog.md`',
    '- Benefits realization tracker: `Documentation/Stabilization/Benefits_Realization_Tracker.md`',
    '- KPI evolution plan: `Documentation/Stabilization/KPI_Evolution_Plan.md`',
    '- Phase-two charter: `Documentation/Stabilization/Phase_Two_Charter.md`',
    '- Hypercare escalation matrix (precedes this): `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '',
    '_Generated by ERPLaunch — Pack Y (Stabilization Roadmap)._',
    '',
  ].join('\n');

  return { markdown };
}
