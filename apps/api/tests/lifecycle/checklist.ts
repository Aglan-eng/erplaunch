import { fileContains, fileLineCount, bundleContains, type BundleSnapshot } from './_helpers.js';

/**
 * 9-phase lifecycle rubric — automated coverage scoring for ERPLaunch
 * generated bundles. Each phase has 3-9 binary checks; phase score is
 * computed from passed / (passed + failed) — SKIP excluded.
 *
 * Three states per check:
 *   - PASS — evaluator returned true
 *   - FAIL — evaluator returned false
 *   - SKIP — applicable() returned false (e.g. SDF checks N/A on Odoo)
 *
 * Authored from the LIFECYCLE_COVERAGE_AUDIT rubric. Some checks are
 * documented gaps that future packs will close. Each pack that closes
 * a gap raises the bar via threshold ratchets in lifecycleScore.test.ts.
 */

export interface PhaseCheck {
  /** Stable id used in the gap report and threshold-bumping. */
  id: string;
  /** Human-readable description shown in the gap report. */
  description: string;
  /** When false, the check is treated as SKIP and excluded from the
   *  phase denominator. Defaults to "always applicable" if omitted. */
  applicable?: (snap: BundleSnapshot) => boolean;
  /** True when the check passes for this snapshot. */
  evaluator: (snap: BundleSnapshot) => boolean;
}

export interface Phase {
  /** Phase number (1-9) — drives ordering + front-half weighting. */
  number: number;
  /** Phase name — drives the gap report headers. */
  name: string;
  checks: ReadonlyArray<PhaseCheck>;
}

// Convenience: the 45 existing checks all read from snap.docs. This
// wrapper keeps their bodies tidy without touching the public types.
function docs(s: BundleSnapshot) {
  return s.docs;
}

// Adaptor-conditional applicability — used by the new Phase 4 SDF
// checks. SDF artefacts only exist on NetSuite bundles; on Odoo they
// SKIP (excluded from the phase denominator) rather than FAIL.
const onlyNetSuite = (s: BundleSnapshot): boolean => s.adaptor === 'netsuite';

// ─── Phase 1 — Kickoff ───────────────────────────────────────────────────────

const PHASE_1_KICKOFF: Phase = {
  number: 1,
  name: 'Kickoff',
  checks: [
    {
      id: 'p1.kickoff-doc-exists',
      description: 'Project_Kickoff.md is generated',
      evaluator: (s) => docs(s).has('Project_Kickoff.md'),
    },
    {
      id: 'p1.contains-project-charter',
      description: 'Project_Kickoff.md contains "Project Charter" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'Project Charter'),
    },
    {
      id: 'p1.contains-stakeholder-map',
      description: 'Project_Kickoff.md contains "Stakeholder Map" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'Stakeholder Map'),
    },
    {
      id: 'p1.contains-raci-matrix',
      description: 'Project_Kickoff.md contains "RACI Matrix" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'RACI Matrix'),
    },
    {
      id: 'p1.contains-governance-plan',
      description: 'Project_Kickoff.md contains "Governance Plan" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'Governance Plan'),
    },
    {
      id: 'p1.contains-communication-plan',
      description: 'Project_Kickoff.md contains "Communication Plan" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'Communication Plan'),
    },
    {
      id: 'p1.contains-kickoff-agenda',
      description: 'Project_Kickoff.md contains "Kickoff Meeting Agenda" section',
      evaluator: (s) => fileContains(docs(s), 'Project_Kickoff.md', 'Kickoff Meeting Agenda'),
    },
    {
      id: 'p1.sponsor-populated',
      description: 'Project sponsor is populated (not empty / not [ASSIGN])',
      evaluator: (s) => {
        const c = docs(s).get('Project_Kickoff.md');
        if (!c) return false;
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
      evaluator: (s) => docs(s).has('BRD.md'),
    },
    {
      id: 'p2.brd-executive-summary',
      description: 'BRD contains "1. Executive Summary"',
      evaluator: (s) => fileContains(docs(s), 'BRD.md', '## 1. Executive Summary'),
    },
    {
      id: 'p2.brd-license-edition',
      description: 'BRD contains "2. License & Edition Profile"',
      evaluator: (s) => fileContains(docs(s), 'BRD.md', '## 2. License & Edition Profile'),
    },
    {
      id: 'p2.brd-workstream-requirements',
      description: 'BRD contains "3. Workstream Requirements"',
      evaluator: (s) => fileContains(docs(s), 'BRD.md', '## 3. Workstream Requirements'),
    },
    {
      id: 'p2.brd-three-subsections',
      description: 'BRD has at least 3 numbered subsections under section 3',
      evaluator: (s) => {
        const c = docs(s).get('BRD.md');
        if (!c) return false;
        const matches = c.match(/^### 3\.\d+\./gm);
        return (matches?.length ?? 0) >= 3;
      },
    },
    {
      id: 'p2.risk-register-exists',
      description: 'Risk_Register.md is generated',
      evaluator: (s) => docs(s).has('Risk_Register.md'),
    },
    {
      id: 'p2.uat-plan-exists',
      description: 'UAT_Plan.md is generated',
      evaluator: (s) => docs(s).has('UAT_Plan.md'),
    },
    {
      id: 'p2.solution-design-exists',
      description: 'Solution_Design.md is generated',
      evaluator: (s) => docs(s).has('Solution_Design.md'),
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
      evaluator: (s) =>
        fileContains(docs(s), 'Solution_Design.md', 'Architecture') ||
        fileContains(docs(s), 'Solution_Design.md', 'Technical Specifications') ||
        fileContains(docs(s), 'Solution_Design.md', 'Configuration Design'),
    },
    {
      id: 'p3.integration-coverage',
      description: 'Solution_Design.md mentions "Integration" (gap until Discovery — integration architecture pack)',
      evaluator: (s) => fileContains(docs(s), 'Solution_Design.md', 'Integration'),
    },
    {
      id: 'p3.data-architecture',
      description: 'Solution_Design.md mentions "Master Data" / "Data Architecture" / "Data Model" (gap until Solution Design — data architecture pack)',
      evaluator: (s) =>
        fileContains(docs(s), 'Solution_Design.md', 'Master Data') ||
        fileContains(docs(s), 'Solution_Design.md', 'Data Architecture') ||
        fileContains(docs(s), 'Solution_Design.md', 'Data Model'),
    },
    {
      id: 'p3.security-roles',
      description: 'Solution_Design.md mentions "Security" or "Roles" or "SoD" (gap until SoD matrix pack)',
      evaluator: (s) =>
        fileContains(docs(s), 'Solution_Design.md', 'Security') ||
        fileContains(docs(s), 'Solution_Design.md', 'Roles') ||
        fileContains(docs(s), 'Solution_Design.md', 'SoD'),
    },
    {
      id: 'p3.solution-design-depth',
      description: 'Solution_Design.md has more than 200 lines (depth proxy)',
      evaluator: (s) => fileLineCount(docs(s), 'Solution_Design.md') > 200,
    },
  ],
};

// ─── Phase 4 — Build ─────────────────────────────────────────────────────────
//
// Build phase rubric expanded post real-code generator landing.
// Pre-extension checks (5) measure prose evidence; new SDF checks (4)
// measure deployable artefacts. SDF checks SKIP on Odoo.
//
// Future: when the Odoo real-code generators ship (XML data files +
// Python module templates), add adaptor: 'odoo' counterparts here so
// Odoo's Phase 4 ratchets up the same way NetSuite's just did.

const PHASE_4_BUILD: Phase = {
  number: 4,
  name: 'Build',
  checks: [
    {
      id: 'p4.config-or-sdf-exists',
      description: 'Configuration_Plan.md (Odoo) OR Implementation_Plan.html (NetSuite) exists',
      evaluator: (s) => docs(s).has('Configuration_Plan.md') || docs(s).has('Implementation_Plan.html'),
    },
    {
      id: 'p4.references-workstream-module',
      description: 'Build artefact references at least one workstream-specific module/app',
      evaluator: (s) => {
        const candidates = ['Configuration_Plan.md', 'Implementation_Plan.html', 'Solution_Design.md'];
        const moduleHints = ['Accounting', 'Inventory', 'Purchase', 'Sales', 'Manufacturing', 'CRM', 'HR', 'Project'];
        return candidates.some((f) => moduleHints.some((m) => fileContains(docs(s), f, m)));
      },
    },
    {
      id: 'p4.environment-plan',
      description: '"Environment" plan referenced (gap until Build — environment plan pack)',
      evaluator: (s) => bundleContains(docs(s), 'Environment'),
    },
    {
      id: 'p4.deployment-runbook',
      description: '"Deployment" or "Runbook" referenced (gap until deployment-runbook pack)',
      evaluator: (s) => bundleContains(docs(s), 'Deployment') || bundleContains(docs(s), 'Runbook'),
    },
    {
      id: 'p4.cutover-references-in-plan',
      description: 'Implementation_Plan references "Cutover"',
      evaluator: (s) => fileContains(docs(s), 'Implementation_Plan.html', 'Cutover'),
    },
    // ── New SDF / build-artefact checks (NetSuite-only — SKIP on Odoo) ──
    {
      id: 'p4.sdf-customrecords-emitted',
      description: 'When ns.design.customRecords is non-empty, ≥1 customrecord_*.xml file is emitted to SDF/Objects/',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/customrecord_[a-z0-9_]+\.xml$/.test(key)) return true;
        }
        return false;
      },
    },
    {
      id: 'p4.sdf-customrecords-valid-root',
      description: 'Every emitted customrecord_*.xml has root <customrecordtype scriptid=...> (audit-fix #1 contract)',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        let count = 0;
        for (const [key, content] of s.buildArtefacts.entries()) {
          if (!/^SDF\/Objects\/customrecord_[a-z0-9_]+\.xml$/.test(key)) continue;
          count++;
          // Allow optional XML declaration before the root element.
          if (!/<customrecordtype\s+scriptid="customrecord_[a-z0-9_]+"\s*>/.test(content)) {
            return false;
          }
        }
        // No customrecord files emitted = no records were declared on
        // this engagement; treat as a SKIP-equivalent pass (the contract
        // is "every emitted file is valid", and zero files trivially
        // satisfies that).
        return count > 0 || true;
      },
    },
    {
      id: 'p4.sdf-manifest-present',
      description: 'SDF/manifest.xml exists in NetSuite bundle',
      applicable: onlyNetSuite,
      evaluator: (s) => s.buildArtefacts.has('SDF/manifest.xml'),
    },
    {
      id: 'p4.sdf-deploy-present',
      description: 'SDF/deploy.xml exists in NetSuite bundle',
      applicable: onlyNetSuite,
      evaluator: (s) => s.buildArtefacts.has('SDF/deploy.xml'),
    },
    // ── SuiteScript UE checks (NetSuite-only — SKIP on Odoo) ──
    // First real-LOGIC SuiteScript file — PO approval User Event.
    // The harness measures (a) the file exists when a wizard answer is
    // present, and (b) the emitted JS carries the JSDoc annotations
    // SuiteCloud requires to recognise the script type. Both checks
    // SKIP on Odoo. Phase 4 NS ratchet stays at ≥ 9.0; these add
    // headroom against future regression rather than gating.
    {
      id: 'p4.suitescript-po-approval-emitted',
      description:
        'When wizard answer for PO approval tiers is non-empty, SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js exists',
      applicable: onlyNetSuite,
      evaluator: (s) =>
        s.buildArtefacts.has('SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js'),
    },
    {
      id: 'p4.suitescript-po-approval-valid-jsdoc',
      description:
        'PO approval script has @NApiVersion 2.1 + @NScriptType UserEventScript JSDoc annotations',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        const body = s.buildArtefacts.get('SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js');
        if (!body) return false;
        return body.includes('@NApiVersion 2.1') && body.includes('@NScriptType UserEventScript');
      },
    },
    // ── Pack B — Custom Field full coverage ──
    // BRD-driven custom fields, custbody required-approver auto-add,
    // and populated record shells. All NetSuite-only.
    {
      id: 'p4.sdf-custom-fields-emitted',
      description:
        'When ns.design.customFieldsScope is non-empty, ≥1 custbody/custentity/custitem field XML is emitted to SDF/Objects/',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/(custbody|custentity|custitem)_[a-z0-9_]+\.xml$/.test(key)) {
            return true;
          }
        }
        return false;
      },
    },
    {
      id: 'p4.po-script-required-field-present',
      description:
        'IF NSIX_UE_PurchaseOrderApproval.js exists, THEN custbody_nsix_required_approver.xml MUST exist (script writes to that field at runtime)',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        const scriptExists = s.buildArtefacts.has('SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js');
        if (!scriptExists) return true; // vacuous-truth contract: no script → no requirement
        return s.buildArtefacts.has('SDF/Objects/custbody_nsix_required_approver.xml');
      },
    },
    {
      id: 'p4.customrecord-fields-populated',
      description:
        'Every emitted customrecord_*.xml has a non-empty <customrecordcustomfields> block (Pack B baseline fields, no shells)',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        let count = 0;
        for (const [key, content] of s.buildArtefacts.entries()) {
          if (!/^SDF\/Objects\/customrecord_[a-z0-9_]+\.xml$/.test(key)) continue;
          count++;
          // Look for at least one nested customrecordcustomfield element —
          // pre-Pack-B shells had `<customrecordcustomfields>` followed
          // immediately by its closing tag, so a single
          // `<customrecordcustomfield ` substring is sufficient signal.
          if (!/<customrecordcustomfield\s/.test(content)) return false;
        }
        // Vacuous-truth pass when no customrecord files exist.
        return count > 0 || true;
      },
    },
    // ── Pack H — Custom Forms (Transaction + Entry) ──
    // Custom forms emit one custform_<client>_<recordtype>.xml per
    // parent record that has at least one Pack B custom field. All
    // NetSuite-only — Odoo SKIPs the trio.
    //
    // The "emitted" checks are conditional on Pack B having parsed at
    // least one transaction-side / entity-side parent. Vacuous-truth
    // when no such parent appears in the wizard answer.
    {
      id: 'p4.sdf-transaction-forms-emitted',
      description:
        'When customFieldsScope mentions a transaction parent, ≥1 custform_*_<txn>.xml exists',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        // First — any custom field at all on a transaction parent?
        // Detected by scanning Pack B's emitted custbody_*.xml files
        // (only transaction-side fields use the custbody_ prefix in
        // the Pack B field generator's output).
        let hasTxnCustomField = false;
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/custbody_[a-z0-9_]+\.xml$/.test(key)) {
            hasTxnCustomField = true;
            break;
          }
        }
        if (!hasTxnCustomField) return true; // vacuous-truth: no fields → no forms expected
        // Then — at least one transaction form emitted? Recordtype
        // suffixes from sdfTransactionFormGenerator's table:
        // salesord / purchord / invoice / vendbill / journalentry / itemrcpt.
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/custform_[a-z0-9_]+_(salesord|purchord|invoice|vendbill|journalentry|itemrcpt)\.xml$/.test(key)) {
            return true;
          }
        }
        return false;
      },
    },
    {
      id: 'p4.sdf-entry-forms-emitted',
      description:
        'When customFieldsScope mentions an entity parent, ≥1 custform_*_<entity>.xml exists',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        // Any entity-side custom field? custentity_*.xml or custitem_*.xml.
        let hasEntityCustomField = false;
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/(custentity|custitem)_[a-z0-9_]+\.xml$/.test(key)) {
            hasEntityCustomField = true;
            break;
          }
        }
        if (!hasEntityCustomField) return true; // vacuous-truth pass
        for (const key of s.buildArtefacts.keys()) {
          if (/^SDF\/Objects\/custform_[a-z0-9_]+_(customer|vendor|item|employee)\.xml$/.test(key)) {
            return true;
          }
        }
        return false;
      },
    },
    {
      id: 'p4.sdf-form-includes-custom-field',
      description:
        'At least one emitted custform_*.xml contains a <field><id>cust(body|entity|item)_*</id></field> reference (forms actually embed Pack B fields, not empty containers)',
      applicable: onlyNetSuite,
      evaluator: (s) => {
        let formCount = 0;
        for (const [key, content] of s.buildArtefacts.entries()) {
          if (!/^SDF\/Objects\/custform_[a-z0-9_]+\.xml$/.test(key)) continue;
          formCount++;
          if (/<id>cust(body|entity|item)_[a-z0-9_]+<\/id>/.test(content)) {
            return true;
          }
        }
        // Vacuous-truth: no forms emitted = no requirement to embed fields.
        return formCount === 0;
      },
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
      evaluator: (s) => docs(s).has('UAT_Plan.md'),
    },
    {
      id: 'p5.acceptance-criteria',
      description: 'UAT_Plan.md contains "Acceptance Criteria" (gap until Test pack)',
      evaluator: (s) => fileContains(docs(s), 'UAT_Plan.md', 'Acceptance Criteria'),
    },
    {
      id: 'p5.three-named-scenarios',
      description: 'UAT_Plan.md has at least 3 named scenarios (lines starting with TC- or Scenario)',
      evaluator: (s) => {
        const c = docs(s).get('UAT_Plan.md');
        if (!c) return false;
        const matches = c.match(/^(?:TC-|Scenario|### TC|\| TC-)/gm);
        return (matches?.length ?? 0) >= 3;
      },
    },
    {
      id: 'p5.signoff-section',
      description: 'UAT_Plan.md contains "Sign-off" (gap until Test pack)',
      evaluator: (s) => fileContains(docs(s), 'UAT_Plan.md', 'Sign-off'),
    },
    {
      id: 'p5.performance-section',
      description: 'UAT_Plan.md mentions "Performance" (gap until Test pack)',
      evaluator: (s) => fileContains(docs(s), 'UAT_Plan.md', 'Performance'),
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
      evaluator: (s) => docs(s).has('Training_Manual.md'),
    },
    {
      id: 'p6.two-sections',
      description: 'Training_Manual.md has at least 2 ## sections',
      evaluator: (s) => {
        const c = docs(s).get('Training_Manual.md');
        if (!c) return false;
        const matches = c.match(/^## /gm);
        return (matches?.length ?? 0) >= 2;
      },
    },
    {
      id: 'p6.quick-reference',
      description: 'Training_Manual.md contains "Quick Reference" (gap until Train pack)',
      evaluator: (s) => fileContains(docs(s), 'Training_Manual.md', 'Quick Reference'),
    },
    {
      id: 'p6.per-role-section',
      description: 'Training_Manual.md has a per-role section (gap until Train pack)',
      evaluator: (s) =>
        fileContains(docs(s), 'Training_Manual.md', 'Role:') ||
        fileContains(docs(s), 'Training_Manual.md', 'For Accountants') ||
        fileContains(docs(s), 'Training_Manual.md', 'For Managers') ||
        fileContains(docs(s), 'Training_Manual.md', 'By Role'),
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
      evaluator: (s) => docs(s).has('Cutover_Runbook.md'),
    },
    {
      id: 'p7.go-no-go',
      description: '"Go/No-Go" section in cutover artefact (gap)',
      evaluator: (s) =>
        bundleContains(docs(s), 'Go/No-Go') || bundleContains(docs(s), 'Go / No-Go'),
    },
    {
      id: 'p7.rollback',
      description: '"Rollback" section in cutover artefact (gap)',
      evaluator: (s) => bundleContains(docs(s), 'Rollback'),
    },
    {
      id: 'p7.smoke-checklist',
      description: 'Smoke checklist in cutover artefact (gap)',
      evaluator: (s) =>
        bundleContains(docs(s), 'Smoke Test') || bundleContains(docs(s), 'Smoke checklist'),
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
      evaluator: (s) => docs(s).has('Hypercare_Plan.md'),
    },
    {
      id: 'p8.daily-readiness',
      description: 'Daily readiness template (gap)',
      evaluator: (s) =>
        bundleContains(docs(s), 'Daily Readiness') || bundleContains(docs(s), 'Daily readiness'),
    },
    {
      id: 'p8.escalation-matrix',
      description: 'Escalation matrix (gap)',
      evaluator: (s) => bundleContains(docs(s), 'Escalation Matrix'),
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
      evaluator: (s) => docs(s).has('Optimization_Roadmap.md'),
    },
    {
      id: 'p9.phase-2-or-continuous',
      description: '"Phase 2" or "Continuous improvement" referenced (gap)',
      evaluator: (s) =>
        bundleContains(docs(s), 'Continuous Improvement') ||
        bundleContains(docs(s), 'Phase 2') ||
        bundleContains(docs(s), 'Continuous improvement'),
    },
    {
      id: 'p9.backlog',
      description: '"Backlog" referenced (gap)',
      evaluator: (s) => bundleContains(docs(s), 'Backlog'),
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
  /** Checks that ran AND passed. */
  passed: number;
  /** Checks that ran AND failed. */
  failed: number;
  /** Checks excluded from this run via applicable() === false. */
  skipped: number;
  /** passed + failed (the denominator for the phase score). */
  applicable: number;
  /** passed / (passed + failed) × 10, 1-decimal. 10 when no checks
   *  applicable (vacuous-truth contract). */
  score: number;
  failedCheckIds: string[];
  failedCheckDescriptions: string[];
  skippedCheckIds: string[];
}

export interface BundleScore {
  perPhase: ReadonlyArray<PhaseScore>;
  /** Mean of the 9 phase scores, 1-decimal. */
  uniformOverall: number;
  /** Phases 1-4 weighted ×2, phases 5-9 weighted ×1. 1-decimal. */
  frontHalfWeightedOverall: number;
}

export function scoreBundle(snap: BundleSnapshot): BundleScore {
  const perPhase: PhaseScore[] = LIFECYCLE_PHASES.map((phase) => {
    let passed = 0;
    let failed = 0;
    const skipped: string[] = [];
    const failedIds: string[] = [];
    const failedDescs: string[] = [];

    for (const check of phase.checks) {
      const applicable = check.applicable ? check.applicable(snap) : true;
      if (!applicable) {
        skipped.push(check.id);
        continue;
      }
      if (check.evaluator(snap)) {
        passed++;
      } else {
        failed++;
        failedIds.push(check.id);
        failedDescs.push(check.description);
      }
    }

    const applicableCount = passed + failed;
    const score = applicableCount === 0 ? 10 : round1((passed / applicableCount) * 10);

    return {
      number: phase.number,
      name: phase.name,
      passed,
      failed,
      skipped: skipped.length,
      applicable: applicableCount,
      score,
      failedCheckIds: failedIds,
      failedCheckDescriptions: failedDescs,
      skippedCheckIds: skipped,
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
