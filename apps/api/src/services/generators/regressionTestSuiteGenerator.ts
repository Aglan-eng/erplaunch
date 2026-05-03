/**
 * Regression Test Suite generator (Pack T — Test Artifacts, Component 6).
 *
 * Cross-platform — emits Documentation/Regression_Test_Suite.md (+ .html).
 *
 * Reads testing.regressionSmokeScenarios (TEXTAREA — one
 * '<scenario_name>: <key validation>' per line) and renders a
 * post-deploy smoke test suite consultants run after every production
 * deploy + patch.
 *
 * Output:
 *   - Purpose + when to run.
 *   - Per-scenario blocks (S-<n> heading + validation + owner + duration).
 *   - Roll-up table (one row per scenario, ⏳ pending status).
 *   - Pass criteria + halt triggers.
 *
 * Sources:
 *   - Continuous-deployment smoke-test conventions (Atlassian, Google
 *     SRE, Martin Fowler — "Smoke Tests" pattern).
 *   - SuiteSuccess + Odoo go-live runbooks (post-deploy validation).
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export interface RegressionTestSuiteGeneratorInput {
  clientName: string;
  /** TEXTAREA testing.regressionSmokeScenarios. */
  regressionSmokeScenarios?: string | null;
  /** Adaptor identity — flavours the deploy-context language. */
  adaptorName?: string;
}

export interface RegressionTestSuiteGeneratorOutput {
  markdown: string;
  html: string;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface SmokeRow {
  scenarioName: string;
  validation: string;
}

const SMOKE_LINE = /^([^:]+):\s*(.+)$/;

function parseSmoke(raw: string): SmokeRow[] {
  const rows: SmokeRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(SMOKE_LINE);
    if (!m) {
      rows.push({ scenarioName: trimmed, validation: '_[ASSIGN key validation]_' });
      continue;
    }
    rows.push({
      scenarioName: m[1].trim(),
      validation: m[2].trim(),
    });
  }
  return rows;
}

// ─── Markdown emission ───────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  scenarios: SmokeRow[];
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'ERP';
  const date = new Date().toLocaleDateString();

  const perScenarioBlocks =
    args.scenarios.length === 0
      ? '_[No regression smoke scenarios captured during discovery — populate testing.regressionSmokeScenarios in the wizard.]_\n'
      : args.scenarios
          .map(
            (s, i) =>
              [
                `### S-${String(i + 1).padStart(2, '0')}: ${s.scenarioName}`,
                '',
                `- **Validates:** ${s.validation}`,
                '- **Trigger:** Run within 30 minutes of deploy completion.',
                '- **Owner:** Client PM (designated tester).',
                '- **Expected Duration:** ~5 minutes.',
                '- **Pass/Fail:** ⏳ Pending',
                '',
              ].join('\n'),
          )
          .join('\n');

  const tableRowsMd =
    args.scenarios.length === 0
      ? '| _(no scenarios captured)_ | _[ASSIGN]_ | ⏳ |  |  |'
      : args.scenarios
          .map(
            (s, i) =>
              `| S-${String(i + 1).padStart(2, '0')} | ${s.scenarioName} | ⏳ Pending |  |  |`,
          )
          .join('\n');

  return [
    `# Post-Deploy Regression Smoke Test Suite — ${args.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Date:** ${date}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    '## 1. Purpose',
    '',
    `Run after every production deploy on ${platform} (post-go-live + every patch / sprint release). `,
    'Smoke validates that core business flows still work end-to-end. Designed to complete in ~30 minutes ',
    'so the deploy team can decide go / no-go quickly.',
    '',
    '## 2. When to Run',
    '',
    '- **Immediately after every production deploy.**',
    '- After any tenant configuration change touching critical objects (forms, workflows, scripts, tax setup).',
    '- After every quarterly disaster-recovery rehearsal.',
    '- On demand whenever the on-call team suspects a regression.',
    '',
    '## 3. Smoke Scenarios',
    '',
    perScenarioBlocks,
    '## 4. Roll-up Table',
    '',
    '| Scenario ID | Description | Status | Tester | Notes |',
    '|-------------|-------------|--------|--------|-------|',
    tableRowsMd,
    '',
    '## 5. Pass Criteria',
    '',
    '- 100% of smoke scenarios pass within 30 minutes of deploy.',
    '- No new defects introduced (compare to prior smoke run).',
    '- Performance within 10% of baseline (see `Performance_Test_Plan.md`).',
    '',
    '## 6. Deploy Halt Triggers',
    '',
    '- Any smoke scenario fails → halt deploy + investigate.',
    '- Performance regresses > 20% from baseline → escalate to hypercare team.',
    '- Any Critical or High defect logged → halt deploy + log via `Defect_Log_Template.md` workflow.',
    '',
    '## 7. Sign-off',
    '',
    '- **Tested by:**  _____________________  Date: __________',
    '- **Approved by:**  __________________  Date: __________',
    '',
    '_Generated by ERPLaunch — Pack T (Test Artifacts)._',
    '',
  ].join('\n');
}

// ─── HTML wrapper ────────────────────────────────────────────────────────────

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regression Test Suite — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 960px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #1e40af; margin: 20px 0 8px; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 16px; }
    thead { background: #1e40af; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 12px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    strong { color: #0f172a; }
    em { color: #64748b; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="page">
    <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${platform} implementation</p>
    ${body}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateRegressionTestSuite(
  input: RegressionTestSuiteGeneratorInput,
): RegressionTestSuiteGeneratorOutput {
  const scenarios = parseSmoke((input.regressionSmokeScenarios ?? '').toString());
  const adaptorName = (input.adaptorName ?? '').toString();

  const markdown = buildMarkdown({
    clientName: input.clientName,
    adaptorName,
    scenarios,
  });
  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html };
}
