/**
 * Post-Cutover Smoke Test generator (Pack V — Component 5).
 *
 * Cross-platform — emits Documentation/Cutover/Post_Cutover_Smoke.md.
 *
 * The post-cutover smoke must complete with zero P0 failures within
 * the first 4h after Go declaration to enter normal hypercare. Reuses
 * regression scenarios from Pack T's regressionSmokeScenarios where
 * available; adds cutover-specific data validation (TB tie-out, master
 * counts, aging vs legacy).
 *
 * Sources:
 *   - SuiteSuccess Go-Live smoke checklist conventions.
 *   - Standard ERP first-4h post-cutover validation patterns.
 */

export interface PostCutoverSmokeGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA testing.regression.regressionSmokeScenarios — Pack T reuse. */
  regressionSmokeScenarios?: string | null;
  /** Wizard scope flags drive which P0/P1 rows fire. */
  poApprovalInScope?: boolean;
  vbApprovalInScope?: boolean;
  ssoInScope?: boolean;
  multiCurrencyInScope?: boolean;
  /** Roles parsed from Pack C / Pack U — drives the Login Smoke section. */
  roles?: ReadonlyArray<string>;
}

export interface PostCutoverSmokeGeneratorOutput {
  markdown: string;
}

const SMOKE_LINE = /^([^:]+):\s*(.+)$/;

interface ParsedScenario {
  name: string;
  validation: string;
}

function parseRegressionScenarios(raw: string): ParsedScenario[] {
  const out: ParsedScenario[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(SMOKE_LINE);
    if (m) out.push({ name: m[1].trim(), validation: m[2].trim() });
    else out.push({ name: trimmed, validation: '_[ASSIGN validation]_' });
  }
  return out;
}

export function generatePostCutoverSmoke(
  input: PostCutoverSmokeGeneratorInput,
): PostCutoverSmokeGeneratorOutput {
  const platform = (input.adaptorName ?? '').toString();
  const platformLabel = platform.length > 0 ? platform : 'ERP';
  const regression = parseRegressionScenarios((input.regressionSmokeScenarios ?? '').toString());
  const roles = (input.roles ?? []).filter((r) => r.length > 0);

  const loginSmokeRows =
    roles.length === 0
      ? '- [ ] Each role can log in (populate `training.curriculum.trainingPerRole` in the wizard for the explicit list)'
      : roles.map((r) => `- [ ] ${r} can log in + lands on the configured center / dashboard`).join('\n');

  const ssoLine = input.ssoInScope === true
    ? '- [ ] SSO (per `ns.foundation.ssoInScope`) flow works end-to-end'
    : '- [ ] Direct credentialed login works (SSO not in scope)';

  const workflowSmokeRows: string[] = [
    '- [ ] Create one Purchase Order end-to-end',
  ];
  if (input.poApprovalInScope === true) {
    workflowSmokeRows.push('- [ ] PO routes through approval workflow (per Pack W tiers) + audit log captures actor');
  }
  workflowSmokeRows.push('- [ ] Create one Sales Order end-to-end (price + tax + currency populate)');
  workflowSmokeRows.push('- [ ] Create one Vendor Bill end-to-end (3-way match if in scope)');
  if (input.vbApprovalInScope === true) {
    workflowSmokeRows.push('- [ ] Vendor Bill routes through approval workflow per the configured tiers');
  }
  workflowSmokeRows.push('- [ ] Run Trial Balance — ties to legacy snapshot ±$0.01 per entity');
  if (input.multiCurrencyInScope === true) {
    workflowSmokeRows.push('- [ ] Multi-currency revaluation completes; FX accounts post correctly');
  }

  const dataSmokeRows = [
    '- [ ] Customer master count matches expected (post-migration tie-out)',
    '- [ ] Vendor master count matches expected',
    '- [ ] Item master count matches expected',
    '- [ ] Open AR aging matches legacy aging (within tolerance)',
    '- [ ] Open AP aging matches legacy aging (within tolerance)',
    '- [ ] Inventory snapshot total matches legacy snapshot',
    '- [ ] Open SO count matches expected',
    '- [ ] Open PO count matches expected',
  ].join('\n');

  const p1Block =
    regression.length === 0
      ? '_(no Pack T regression scenarios captured — populate `testing.regression.regressionSmokeScenarios` in the wizard for engagement-specific P1 coverage)_'
      : regression
          .map(
            (s, i) =>
              `- [ ] **P1-${String(i + 1).padStart(2, '0')}: ${s.name}** — ${s.validation}`,
          )
          .join('\n');

  const markdown = [
    `# Post-Cutover Smoke Test — ${input.clientName}`,
    '',
    `**Platform:** ${platformLabel}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Run within the first 4h after Go declaration. Must complete with zero P0 ',
    'failures to enter normal hypercare. Reuses the engagement\'s Pack T regression ',
    'suite (`Documentation/Regression_Test_Suite.md`) plus cutover-specific data ',
    'validation against the legacy snapshot taken at T+0:00.',
    '',
    '## First 4 Hours — P0 Smoke',
    '',
    '### Login Smoke',
    '',
    loginSmokeRows,
    ssoLine,
    `- [ ] Default landing page renders per role (per Pack C role center configuration)`,
    '',
    '### Workflow Smoke',
    '',
    workflowSmokeRows.join('\n'),
    '',
    '### Data Smoke (vs Legacy Snapshot)',
    '',
    dataSmokeRows,
    '',
    '## First 24 Hours — P1 Smoke',
    '',
    'Reuses the regression scenarios captured in Pack T. Each P1 scenario must ',
    'either pass clean OR be downgraded to a defect log entry per ',
    '`Documentation/Defect_Log_Template.md` for hypercare follow-up.',
    '',
    p1Block,
    '',
    '## Pass Criteria',
    '',
    '- **Smoke pass** = 100% of P0 + 95%+ of P1.',
    '- Anything less = Critical / High defect logged + escalation per `Documentation/Cutover/Go_No_Go_Matrix.md`.',
    '- Failures in P0 = potential rollback trigger per `Documentation/Cutover/Rollback_Plan.md`.',
    '',
    '## Cross-References',
    '',
    '- Cutover Runbook: `Documentation/Cutover/Cutover_Runbook.md`',
    '- Go/No-Go Matrix: `Documentation/Cutover/Go_No_Go_Matrix.md`',
    '- Rollback Plan: `Documentation/Cutover/Rollback_Plan.md`',
    '- Pack T Regression Suite: `Documentation/Regression_Test_Suite.md`',
    '- Defect Log Template: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack V (Cutover Runbook)._',
    '',
  ].join('\n');

  return { markdown };
}
