import { fileContains, fileLineCount, bundleContains } from './_helpers.js';

/**
 * 9-phase lifecycle rubric — automated coverage scoring for ERPLaunch
 * generated bundles. Each phase has 3-6 binary checks; phase score is
 * (passed / total) × 10, rounded to 1 decimal.
 *
 * Authored from the LIFECYCLE_COVERAGE_AUDIT rubric. Some checks are
 * marked `currentlyFailing: true` to flag known gaps that future packs
 * will close — the test harness asserts a uniform threshold (currently
 * 4.0) and a front-half-weighted threshold (currently 6.0), so failing
 * checks lower the score but don't fail the test on day one. Each pack
 * that closes a gap raises the bar.
 */

export type BundleFiles = ReadonlyMap<string, string>;

export interface PhaseCheck {
  /** Stable id used in the gap report and threshold-bumping. */
  id: string;
  /** Human-readable description shown in the gap report. */
  description: string;
  /** True = check passes for this bundle. */
  evaluator: (files: BundleFiles) => boolean;
}

export interface Phase {
  /** Phase number (1-9) — drives ordering + front-half weighting. */
  number: number;
  /** Phase name — drives the gap report headers. */
  name: string;
  checks: ReadonlyArray<PhaseCheck>;
}

// ─── Phase 1 — Kickoff ───────────────────────────────────────────────────────

const PHASE_1_KICKOFF: Phase = {
  number: 1,
  name: 'Kickoff',
  checks: [
    {
      id: 'p1.kickoff-doc-exists',
      description: 'Project_Kickoff.md is generated',
      evaluator: (files) => files.has('Project_Kickoff.md'),
    },
    {
      id: 'p1.contains-project-charter',
      description: 'Project_Kickoff.md contains "Project Charter" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'Project Charter'),
    },
    {
      id: 'p1.contains-stakeholder-map',
      description: 'Project_Kickoff.md contains "Stakeholder Map" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'Stakeholder Map'),
    },
    {
      id: 'p1.contains-raci-matrix',
      description: 'Project_Kickoff.md contains "RACI Matrix" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'RACI Matrix'),
    },
    {
      id: 'p1.contains-governance-plan',
      description: 'Project_Kickoff.md contains "Governance Plan" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'Governance Plan'),
    },
    {
      id: 'p1.contains-communication-plan',
      description: 'Project_Kickoff.md contains "Communication Plan" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'Communication Plan'),
    },
    {
      id: 'p1.contains-kickoff-agenda',
      description: 'Project_Kickoff.md contains "Kickoff Meeting Agenda" section',
      evaluator: (files) => fileContains(files, 'Project_Kickoff.md', 'Kickoff Meeting Agenda'),
    },
    {
      id: 'p1.sponsor-populated',
      description: 'Project sponsor is populated (not empty / not [ASSIGN])',
      evaluator: (files) => {
        const c = files.get('Project_Kickoff.md');
        if (!c) return false;
        // Find the **Project sponsor** label and confirm the next non-blank
        // line isn't a placeholder.
        const m = c.match(/\*\*Project sponsor\*\*\s*\n([^\n]+)/);
        if (!m) return false;
        const value = m[1].trim();
        return value.length > 0 && !/_\[ASSIGN/.test(value) && !/^TBD$/i.test(value);
      },
    },
  ],
};

// ─── Phase 2 — Discovery ─────────────────────────────────────────────────────

const PHASE_2_DISCOVERY: Phase = {
  number: 2,
  name: 'Discovery',
  checks: [
    {
      id: 'p2.brd-exists',
      description: 'BRD.md is generated',
      evaluator: (files) => files.has('BRD.md'),
    },
    {
      id: 'p2.brd-executive-summary',
      description: 'BRD contains "1. Executive Summary"',
      evaluator: (files) => fileContains(files, 'BRD.md', '## 1. Executive Summary'),
    },
    {
      id: 'p2.brd-license-edition',
      description: 'BRD contains "2. License & Edition Profile"',
      evaluator: (files) => fileContains(files, 'BRD.md', '## 2. License & Edition Profile'),
    },
    {
      id: 'p2.brd-workstream-requirements',
      description: 'BRD contains "3. Workstream Requirements"',
      evaluator: (files) => fileContains(files, 'BRD.md', '## 3. Workstream Requirements'),
    },
    {
      id: 'p2.brd-three-subsections',
      description: 'BRD has at least 3 numbered subsections under section 3',
      evaluator: (files) => {
        const c = files.get('BRD.md');
        if (!c) return false;
        const matches = c.match(/^### 3\.\d+\./gm);
        return (matches?.length ?? 0) >= 3;
      },
    },
    {
      id: 'p2.risk-register-exists',
      description: 'Risk_Register.md is generated',
      evaluator: (files) => files.has('Risk_Register.md'),
    },
    {
      id: 'p2.uat-plan-exists',
      description: 'UAT_Plan.md is generated',
      evaluator: (files) => files.has('UAT_Plan.md'),
    },
    {
      id: 'p2.solution-design-exists',
      description: 'Solution_Design.md is generated',
      evaluator: (files) => files.has('Solution_Design.md'),
    },
  ],
};

// ─── Phase 3 — Solution Design ───────────────────────────────────────────────

const PHASE_3_DESIGN: Phase = {
  number: 3,
  name: 'Solution Design',
  checks: [
    {
      id: 'p3.architecture-section',
      description: 'Solution_Design.md has an architecture / technical-spec section',
      evaluator: (files) =>
        fileContains(files, 'Solution_Design.md', 'Architecture') ||
        fileContains(files, 'Solution_Design.md', 'Technical Specifications') ||
        fileContains(files, 'Solution_Design.md', 'Configuration Design'),
    },
    {
      id: 'p3.integration-coverage',
      description: 'Solution_Design.md mentions "Integration" (gap until Discovery — integration architecture pack)',
      evaluator: (files) => fileContains(files, 'Solution_Design.md', 'Integration'),
    },
    {
      id: 'p3.data-architecture',
      description: 'Solution_Design.md mentions "Master Data" / "Data Architecture" / "Data Model" (gap until Solution Design — data architecture pack)',
      evaluator: (files) =>
        fileContains(files, 'Solution_Design.md', 'Master Data') ||
        fileContains(files, 'Solution_Design.md', 'Data Architecture') ||
        fileContains(files, 'Solution_Design.md', 'Data Model'),
    },
    {
      id: 'p3.security-roles',
      description: 'Solution_Design.md mentions "Security" or "Roles" or "SoD" (gap until SoD matrix pack)',
      evaluator: (files) =>
        fileContains(files, 'Solution_Design.md', 'Security') ||
        fileContains(files, 'Solution_Design.md', 'Roles') ||
        fileContains(files, 'Solution_Design.md', 'SoD'),
    },
    {
      id: 'p3.solution-design-depth',
      description: 'Solution_Design.md has more than 200 lines (depth proxy)',
      evaluator: (files) => fileLineCount(files, 'Solution_Design.md') > 200,
    },
  ],
};

// ─── Phase 4 — Build ─────────────────────────────────────────────────────────

const PHASE_4_BUILD: Phase = {
  number: 4,
  name: 'Build',
  checks: [
    {
      id: 'p4.config-or-sdf-exists',
      description: 'Configuration_Plan.md (Odoo) OR SDF manifest content (NetSuite) exists',
      evaluator: (files) => {
        // Odoo bundles ship Configuration_Plan.md; NetSuite bundles ship
        // SDF artifacts via the SDF generator. The demo driver doesn't
        // currently emit SDF into the bundle (it goes to a sibling
        // SDF/ folder via generation.ts). For the demo bundle we treat
        // Implementation_Plan.html as the configuration-equivalent artefact
        // when Configuration_Plan.md isn't present.
        return files.has('Configuration_Plan.md') || files.has('Implementation_Plan.html');
      },
    },
    {
      id: 'p4.references-workstream-module',
      description: 'Build artefact references at least one workstream-specific module/app',
      evaluator: (files) => {
        const candidates = [
          'Configuration_Plan.md',
          'Implementation_Plan.html',
          'Solution_Design.md',
        ];
        const moduleHints = [
          'Accounting', 'Inventory', 'Purchase', 'Sales', 'Manufacturing',
          'CRM', 'HR', 'Project',
        ];
        return candidates.some((f) =>
          moduleHints.some((m) => fileContains(files, f, m)),
        );
      },
    },
    {
      id: 'p4.environment-plan',
      description: '"Environment" plan referenced (gap until Build — environment plan pack)',
      evaluator: (files) => bundleContains(files, 'Environment'),
    },
    {
      id: 'p4.deployment-runbook',
      description: '"Deployment" or "Runbook" referenced (gap until deployment-runbook pack)',
      evaluator: (files) =>
        bundleContains(files, 'Deployment') || bundleContains(files, 'Runbook'),
    },
    {
      id: 'p4.cutover-references-in-plan',
      description: 'Implementation_Plan references "Cutover"',
      evaluator: (files) => fileContains(files, 'Implementation_Plan.html', 'Cutover'),
    },
  ],
};

// ─── Phase 5 — Test ──────────────────────────────────────────────────────────

const PHASE_5_TEST: Phase = {
  number: 5,
  name: 'Test',
  checks: [
    {
      id: 'p5.uat-plan-exists',
      description: 'UAT_Plan.md is generated',
      evaluator: (files) => files.has('UAT_Plan.md'),
    },
    {
      id: 'p5.acceptance-criteria',
      description: 'UAT_Plan.md contains "Acceptance Criteria" (gap until Test pack)',
      evaluator: (files) => fileContains(files, 'UAT_Plan.md', 'Acceptance Criteria'),
    },
    {
      id: 'p5.three-named-scenarios',
      description: 'UAT_Plan.md has at least 3 named scenarios (lines starting with TC- or Scenario)',
      evaluator: (files) => {
        const c = files.get('UAT_Plan.md');
        if (!c) return false;
        const matches = c.match(/^(?:TC-|Scenario|### TC|\| TC-)/gm);
        return (matches?.length ?? 0) >= 3;
      },
    },
    {
      id: 'p5.signoff-section',
      description: 'UAT_Plan.md contains "Sign-off" (gap until Test pack)',
      evaluator: (files) => fileContains(files, 'UAT_Plan.md', 'Sign-off'),
    },
    {
      id: 'p5.performance-section',
      description: 'UAT_Plan.md mentions "Performance" (gap until Test pack)',
      evaluator: (files) => fileContains(files, 'UAT_Plan.md', 'Performance'),
    },
  ],
};

// ─── Phase 6 — Train ─────────────────────────────────────────────────────────

const PHASE_6_TRAIN: Phase = {
  number: 6,
  name: 'Train',
  checks: [
    {
      id: 'p6.training-manual-exists',
      description: 'Training_Manual.md is generated',
      evaluator: (files) => files.has('Training_Manual.md'),
    },
    {
      id: 'p6.two-sections',
      description: 'Training_Manual.md has at least 2 ## sections',
      evaluator: (files) => {
        const c = files.get('Training_Manual.md');
        if (!c) return false;
        const matches = c.match(/^## /gm);
        return (matches?.length ?? 0) >= 2;
      },
    },
    {
      id: 'p6.quick-reference',
      description: 'Training_Manual.md contains "Quick Reference" (gap until Train pack)',
      evaluator: (files) => fileContains(files, 'Training_Manual.md', 'Quick Reference'),
    },
    {
      id: 'p6.per-role-section',
      description: 'Training_Manual.md has a per-role section (gap until Train pack)',
      evaluator: (files) =>
        fileContains(files, 'Training_Manual.md', 'Role:') ||
        fileContains(files, 'Training_Manual.md', 'For Accountants') ||
        fileContains(files, 'Training_Manual.md', 'For Managers') ||
        fileContains(files, 'Training_Manual.md', 'By Role'),
    },
  ],
};

// ─── Phase 7 — Cutover ───────────────────────────────────────────────────────

const PHASE_7_CUTOVER: Phase = {
  number: 7,
  name: 'Cutover',
  checks: [
    {
      id: 'p7.cutover-runbook-exists',
      description: 'Cutover_Runbook.md is generated (gap — not currently produced)',
      evaluator: (files) => files.has('Cutover_Runbook.md'),
    },
    {
      id: 'p7.go-no-go',
      description: '"Go/No-Go" section in cutover artefact (gap)',
      evaluator: (files) =>
        bundleContains(files, 'Go/No-Go') || bundleContains(files, 'Go / No-Go'),
    },
    {
      id: 'p7.rollback',
      description: '"Rollback" section in cutover artefact (gap)',
      evaluator: (files) => bundleContains(files, 'Rollback'),
    },
    {
      id: 'p7.smoke-checklist',
      description: 'Smoke checklist in cutover artefact (gap)',
      evaluator: (files) =>
        bundleContains(files, 'Smoke Test') || bundleContains(files, 'Smoke checklist'),
    },
  ],
};

// ─── Phase 8 — Hypercare ─────────────────────────────────────────────────────

const PHASE_8_HYPERCARE: Phase = {
  number: 8,
  name: 'Hypercare',
  checks: [
    {
      id: 'p8.hypercare-plan-exists',
      description: 'Hypercare_Plan.md is generated (gap — not currently produced)',
      evaluator: (files) => files.has('Hypercare_Plan.md'),
    },
    {
      id: 'p8.daily-readiness',
      description: 'Daily readiness template (gap)',
      evaluator: (files) =>
        bundleContains(files, 'Daily Readiness') || bundleContains(files, 'Daily readiness'),
    },
    {
      id: 'p8.escalation-matrix',
      description: 'Escalation matrix (gap)',
      evaluator: (files) => bundleContains(files, 'Escalation Matrix'),
    },
  ],
};

// ─── Phase 9 — Stabilize ─────────────────────────────────────────────────────

const PHASE_9_STABILIZE: Phase = {
  number: 9,
  name: 'Stabilize',
  checks: [
    {
      id: 'p9.optimization-roadmap-exists',
      description: 'Optimization_Roadmap.md is generated (gap — not currently produced)',
      evaluator: (files) => files.has('Optimization_Roadmap.md'),
    },
    {
      id: 'p9.phase-2-or-continuous',
      description: '"Phase 2" or "Continuous improvement" referenced (gap)',
      evaluator: (files) =>
        bundleContains(files, 'Continuous Improvement') ||
        bundleContains(files, 'Phase 2') ||
        bundleContains(files, 'Continuous improvement'),
    },
    {
      id: 'p9.backlog',
      description: '"Backlog" referenced (gap)',
      evaluator: (files) => bundleContains(files, 'Backlog'),
    },
  ],
};

export const LIFECYCLE_PHASES: ReadonlyArray<Phase> = [
  PHASE_1_KICKOFF,
  PHASE_2_DISCOVERY,
  PHASE_3_DESIGN,
  PHASE_4_BUILD,
  PHASE_5_TEST,
  PHASE_6_TRAIN,
  PHASE_7_CUTOVER,
  PHASE_8_HYPERCARE,
  PHASE_9_STABILIZE,
];

// ─── Scoring ─────────────────────────────────────────────────────────────────

export interface PhaseScore {
  number: number;
  name: string;
  passed: number;
  total: number;
  /** Out of 10, 1-decimal precision. */
  score: number;
  failedCheckIds: string[];
  failedCheckDescriptions: string[];
}

export interface BundleScore {
  perPhase: ReadonlyArray<PhaseScore>;
  /** Mean of the 9 phase scores, 1-decimal. */
  uniformOverall: number;
  /** Phases 1-4 weighted ×2, phases 5-9 weighted ×1. 1-decimal. */
  frontHalfWeightedOverall: number;
}

export function scoreBundle(files: BundleFiles): BundleScore {
  const perPhase: PhaseScore[] = LIFECYCLE_PHASES.map((phase) => {
    const failed = phase.checks.filter((c) => !c.evaluator(files));
    const passed = phase.checks.length - failed.length;
    const score = round1((passed / phase.checks.length) * 10);
    return {
      number: phase.number,
      name: phase.name,
      passed,
      total: phase.checks.length,
      score,
      failedCheckIds: failed.map((c) => c.id),
      failedCheckDescriptions: failed.map((c) => c.description),
    };
  });

  const uniformOverall = round1(
    perPhase.reduce((sum, p) => sum + p.score, 0) / perPhase.length,
  );

  const frontHalf = perPhase.filter((p) => p.number <= 4);
  const backHalf = perPhase.filter((p) => p.number >= 5);
  const frontAvg = frontHalf.reduce((sum, p) => sum + p.score, 0) / frontHalf.length;
  const backAvg = backHalf.reduce((sum, p) => sum + p.score, 0) / backHalf.length;
  const frontHalfWeightedOverall = round1((frontAvg * 2 + backAvg * 1) / 3);

  return { perPhase, uniformOverall, frontHalfWeightedOverall };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
