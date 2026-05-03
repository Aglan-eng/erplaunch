/**
 * Integration Test Plan generator (Pack ZZ — Component 6).
 *
 * Cross-platform — emits Documentation/Integrations/Integration_Test_Plan.md.
 *
 * Per-integration test cases parsed from `integrationCutoverSmokeTests`.
 * Default test pattern per integration type when consultant overlay
 * sparse:
 *   - Inbound master-data: pull test record → assert in ERP within window
 *   - Inbound transactional: pull test transaction → assert posted with GL impact
 *   - Outbound: trigger ERP event → assert downstream system received
 *   - File drop: place test file → assert ingested + ack file produced
 *
 * Pre-cutover gate: every integration must pass smoke before go/no-go.
 * Post-cutover smoke: first business cycle after cutover.
 */

import {
  integrationsInScope,
  parseIntegrationSmokeTests,
  indexByName,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationTestPlanInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationCutoverSmokeTests?: string | null;
}

export interface IntegrationTestPlanOutput {
  markdown: string;
}

function defaultTestForType(row: ParsedCatalogRow): { pre: string; post: string } {
  const inbound = /inbound/i.test(row.direction);
  const transactional = /transactional/i.test(row.type);
  const masterData = /master.?data/i.test(row.type);
  const fileDrop = /file.?drop/i.test(row.type);
  const outbound = /outbound/i.test(row.direction);

  if (fileDrop) {
    return {
      pre: 'Place a single test file in the inbound directory; confirm ingestion completes within frequency SLA AND acknowledgement file produced.',
      post: 'Confirm first production cycle file received + ingested + acknowledgement produced; reconcile row count vs. expected.',
    };
  }
  if (inbound && transactional) {
    return {
      pre: 'Pull a single test transaction from source; confirm posted in ERP with correct GL impact within frequency SLA.',
      post: 'Confirm first business cycle of production transactions reconciles 100% record-for-record vs. source.',
    };
  }
  if (inbound && masterData) {
    return {
      pre: 'Pull a single test master-data record from source; confirm appears in ERP within frequency SLA.',
      post: 'Confirm first cycle master-data delta applies cleanly with zero unexpected diffs.',
    };
  }
  if (outbound) {
    return {
      pre: 'Trigger a single test event in ERP; confirm downstream system receives + acknowledges within frequency SLA.',
      post: 'Confirm first business cycle of outbound events all delivered + acknowledged.',
    };
  }
  return {
    pre: 'Execute a single end-to-end smoke test; confirm round-trip completes within frequency SLA.',
    post: 'Confirm first business cycle reconciles end-to-end.',
  };
}

function testCaseSection(
  row: ParsedCatalogRow,
  pre: string,
  post: string,
): string {
  return [
    `### ${row.name}`,
    '',
    `**Type:** ${row.type} (${row.direction}, ${row.frequency})`,
    '',
    `**Pre-cutover smoke (gate):**`,
    '',
    pre,
    '',
    `**Pass criteria:** test record successfully traverses end-to-end within frequency SLA; reconciliation match against source.`,
    '',
    `**Post-cutover smoke:**`,
    '',
    post,
    '',
    `**Pass criteria:** first business cycle reconciles 100% record-for-record.`,
    '',
    `**UAT linkage:** integration touchpoints in UAT plan reference this runbook for diagnostics — see \`Documentation/UAT_Plan.md\`.`,
    '',
  ].join('\n');
}

export function generateIntegrationTestPlan(
  input: IntegrationTestPlanInput,
): IntegrationTestPlanOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const smoke = indexByName(
    parseIntegrationSmokeTests((input.integrationCutoverSmokeTests ?? '').toString()),
  );

  const sections = inScope
    .map((row) => {
      const overlay = smoke.get(row.name.toLowerCase());
      const defaults = defaultTestForType(row);
      const pre = overlay?.preCutover.length ? overlay.preCutover : defaults.pre;
      const post = overlay?.postCutover.length ? overlay.postCutover : defaults.post;
      return testCaseSection(row, pre, post);
    })
    .join('\n');

  const markdown = [
    `# Integration Test Plan — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Integrations tested:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Per-integration smoke test plan. Every integration in scope MUST pass its ',
    'pre-cutover smoke before the cutover go/no-go decision (`Documentation/Cutover/Go_NoGo_Matrix.md`). ',
    'First business cycle after cutover, every integration runs its post-cutover ',
    'smoke and reconciles record-for-record.',
    '',
    '## Pre-Cutover Gate',
    '',
    'Every integration listed below MUST pass its pre-cutover smoke at least once ',
    'in the dress-rehearsal environment, with results captured in the cutover ',
    'go/no-go matrix. Failed integrations block cutover unless explicitly waived ',
    'by the sponsor.',
    '',
    '## Post-Cutover Smoke',
    '',
    'First business cycle after cutover, every integration runs its post-cutover ',
    'smoke. Cross-references Pack V\'s `Documentation/Cutover/Post_Cutover_Smoke.md` ',
    'for the broader smoke battery. Per-integration smokes are recorded in the ',
    'cutover hour-by-hour timeline.',
    '',
    '## Default Test Pattern per Integration Type',
    '',
    '| Type | Pre-cutover pattern | Post-cutover pattern |',
    '|------|---------------------|----------------------|',
    '| Inbound master-data | Pull test record → assert in ERP within frequency window | First cycle delta applies cleanly with zero unexpected diffs |',
    '| Inbound transactional | Pull test transaction → assert posted with GL impact | First cycle of production transactions reconciles 100% |',
    '| Outbound | Trigger ERP event → assert downstream system received | First cycle of outbound events all delivered + acknowledged |',
    '| File drop | Place test file → assert ingested + ack produced | First production file received + ingested + ack produced |',
    '',
    '## Per-Integration Test Cases',
    '',
    sections,
    '## Test Data Management',
    '',
    'Test records remain distinguishable from production by the following conventions:',
    '',
    '- **Customer / vendor IDs:** prefix with `TEST_` (e.g. `TEST_001`); never reuse a production tax ID.',
    '- **Transaction memos:** include the literal `[INTEGRATION_TEST]` marker so reconciliation queries can exclude.',
    '- **External IDs:** prefix with `TEST_` for any inbound integration; deletion procedure documented per integration runbook.',
    '- **Cleanup:** test records purged immediately after the smoke batch passes; final cleanup confirmed at T-1 readiness gate.',
    '',
    '## Integration UAT Linkage',
    '',
    'Pack T\'s UAT plan rows that touch any integration cross-reference the ',
    'corresponding runbook for diagnostics. See `Documentation/UAT_Plan.md` ',
    'sections that mention any of the integrations listed above.',
    '',
    '## Cross-References',
    '',
    '- Integration catalog: `./Integration_Catalog.md`',
    '- Per-integration runbooks: `./Runbooks/`',
    '- Cutover go/no-go matrix (Pack V): `Documentation/Cutover/Go_NoGo_Matrix.md`',
    '- Post-cutover smoke (Pack V): `Documentation/Cutover/Post_Cutover_Smoke.md`',
    '- UAT plan (Pack T): `Documentation/UAT_Plan.md`',
    '- Reconciliation procedures: `./Reconciliation_Procedures.md`',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
