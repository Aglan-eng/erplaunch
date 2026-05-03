/**
 * Integration Runbook Bundle generator (Pack ZZ — Component 2).
 *
 * Cross-platform — emits multiple files under
 * Documentation/Integrations/Runbooks/<NN>_<integration_name>.md.
 *
 * One runbook per integration in scope. Each runbook ~150-250 lines
 * with 11 mandatory sections. Adaptor-conditional content branches
 * on `adaptorName.toLowerCase()` (NetSuite SuiteScript log refs vs
 * Odoo ir.logging refs).
 *
 * Returns Record<string, string> keyed by relative path
 * ("01_avalara_tax.md") so the orchestrator spreads into one
 * fs.writeFile per entry.
 */

import {
  integrationsInScope,
  parseIntegrationOwners,
  parseIntegrationAuthMethods,
  parseIntegrationMonitoring,
  parseIntegrationErrorPatterns,
  parseIntegrationVendorContacts,
  parseIntegrationReconciliation,
  parseIntegrationSmokeTests,
  indexByName,
  slugify,
  isCriticalPath,
  type ParsedCatalogRow,
  type ParsedOwnerRow,
  type ParsedAuthRow,
  type ParsedMonitoringRow,
  type ParsedErrorPatternRow,
  type ParsedVendorContactRow,
  type ParsedReconciliationRow,
  type ParsedSmokeTestRow,
} from './integrationHelpers.js';

export interface IntegrationRunbookBundleInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationOwnersByName?: string | null;
  integrationAuthMethods?: string | null;
  integrationMonitoring?: string | null;
  integrationErrorPatterns?: string | null;
  integrationVendorContacts?: string | null;
  integrationReconciliation?: string | null;
  integrationCutoverSmokeTests?: string | null;
}

export interface IntegrationRunbookBundleOutput {
  /** Map of relative path → runbook markdown. Keys: "01_<slug>.md". */
  files: Record<string, string>;
  /** Number of runbooks emitted (== count of integrations in scope). */
  runbookCount: number;
}

interface BundleContext {
  clientName: string;
  adaptorName: string;
  isNetSuite: boolean;
  integrations: ReadonlyArray<ParsedCatalogRow>;
  owners: Map<string, ParsedOwnerRow>;
  auth: Map<string, ParsedAuthRow>;
  monitoring: Map<string, ParsedMonitoringRow>;
  errorPatterns: ParsedErrorPatternRow[];
  vendorContacts: Map<string, ParsedVendorContactRow>;
  reconciliation: Map<string, ParsedReconciliationRow>;
  smokeTests: Map<string, ParsedSmokeTestRow>;
}

function archDiagram(row: ParsedCatalogRow, ctx: BundleContext): string {
  const ercpLabel = ctx.isNetSuite ? 'NetSuite' : 'Odoo';
  // Direction-aware DAG.
  if (/inbound/i.test(row.direction)) {
    return [
      '```mermaid',
      'graph LR',
      `  Vendor["${row.vendor}<br/>(source)"] --> Middleware["${row.tooling}"]`,
      `  Middleware --> ERP["${ercpLabel}<br/>(target)"]`,
      '```',
    ].join('\n');
  }
  if (/outbound/i.test(row.direction)) {
    return [
      '```mermaid',
      'graph LR',
      `  ERP["${ercpLabel}<br/>(source)"] --> Middleware["${row.tooling}"]`,
      `  Middleware --> Vendor["${row.vendor}<br/>(target)"]`,
      '```',
    ].join('\n');
  }
  // Bidirectional / Internal.
  return [
    '```mermaid',
    'graph LR',
    `  ERP["${ercpLabel}"] <--> Middleware["${row.tooling}"]`,
    `  Middleware <--> Vendor["${row.vendor}"]`,
    '```',
  ].join('\n');
}

function logRef(ctx: BundleContext): string {
  return ctx.isNetSuite
    ? '**Log location:** Customization → Scripting → Script Execution Log (filter by Script Type = Map/Reduce / RESTlet / User Event); SuiteCloud Manager for SDF deploys.'
    : '**Log location:** Settings → Technical → Logging (`ir.logging` table); for scheduled actions: Settings → Technical → Scheduled Actions → action history.';
}

function dashboardRef(ctx: BundleContext, row: ParsedCatalogRow): string {
  const slug = slugify(row.name);
  return ctx.isNetSuite
    ? `**Dashboard tile:** \`customsearch_int_${slug}_health\` published to the Integration Health dashboard (Reports → Saved Searches).`
    : `**Dashboard tile:** Studio dashboard panel "${row.name} — Health" with PostgreSQL view \`v_int_${slug}_health\`.`;
}

function buildRunbook(row: ParsedCatalogRow, ctx: BundleContext): string {
  const lcName = row.name.toLowerCase();
  const ownerEntry = ctx.owners.get(lcName);
  const authEntry = ctx.auth.get(lcName);
  const monEntry = ctx.monitoring.get(lcName);
  const vendorEntry = ctx.vendorContacts.get(lcName);
  const reconEntry = ctx.reconciliation.get(lcName);
  const smokeEntry = ctx.smokeTests.get(lcName);

  const internalOwner = ownerEntry?.owner.length ? ownerEntry.owner : '_[ASSIGN internal owner]_';
  const backup = ownerEntry?.backup.length ? ownerEntry.backup : '_[ASSIGN backup owner]_';

  const authMethod = authEntry?.method.length ? authEntry.method : '_[ASSIGN auth method]_';
  const rotationCadence = authEntry?.rotationCadence.length ? authEntry.rotationCadence : '_[ASSIGN rotation cadence]_';
  const secretOwner = authEntry?.secretOwner.length ? authEntry.secretOwner : internalOwner;

  const greenT = monEntry?.green.length ? monEntry.green : '_[ASSIGN]_';
  const yellowT = monEntry?.yellow.length ? monEntry.yellow : '_[ASSIGN]_';
  const redT = monEntry?.red.length ? monEntry.red : '_[ASSIGN]_';
  const metric = monEntry?.metric.length ? monEntry.metric : 'Health metric (transactions / hour or success %)';

  const channel = vendorEntry?.channel.length ? vendorEntry.channel : '_[ASSIGN vendor support channel]_';
  const sla = vendorEntry?.sla.length ? vendorEntry.sla : '_[ASSIGN SLA]_';
  const escalation = vendorEntry?.escalation.length ? vendorEntry.escalation : '_[ASSIGN escalation path]_';

  const reconCadence = reconEntry?.cadence.length ? reconEntry.cadence : 'Daily count + Weekly sum';
  const reconOwner = reconEntry?.owner.length ? reconEntry.owner : internalOwner;

  const preCutover = smokeEntry?.preCutover.length
    ? smokeEntry.preCutover
    : '_[ASSIGN pre-cutover smoke test]_';
  const postCutover = smokeEntry?.postCutover.length
    ? smokeEntry.postCutover
    : '_[ASSIGN post-cutover smoke test]_';

  // Error patterns are joined by name; a single integration can have N rows.
  const errorRows = ctx.errorPatterns
    .filter((e) => e.name.toLowerCase() === lcName)
    .map((e) => `| ${e.category} | ${e.resolution} |`)
    .join('\n');
  const errorTable = errorRows.length > 0
    ? errorRows
    : '| _Network timeout_ | Retry with exponential backoff up to 3 attempts; queue for manual review if all fail; page on-call if pattern persists. |\n' +
      '| _Auth expiry_ | Rotate per cadence above; redeploy connection; verify with smoke test before re-enabling traffic. |\n' +
      '| _Data validation_ | Quarantine the offending record; capture original payload to defect log; fix at source; replay. |';

  const lines = [
    `# Runbook — ${row.name}`,
    '',
    `**Client:** ${ctx.clientName}  `,
    `**Platform:** ${ctx.adaptorName}  `,
    `**Vendor:** ${row.vendor}  `,
    `**Internal owner:** ${internalOwner}  `,
    `**Backup owner:** ${backup}  `,
    `**Criticality:** ${isCriticalPath(row) ? 'critical-path (blocks close)' : 'standard'}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    '## 1. Overview',
    '',
    `${row.name} is a **${row.type.toLowerCase()}** integration between ${row.vendor} and the ${ctx.adaptorName} platform. ` +
      `Direction: ${row.direction}. Frequency: ${row.frequency}. Tooling: ${row.tooling}.`,
    '',
    '## 2. Architecture',
    '',
    archDiagram(row, ctx),
    '',
    `**Components:** source connector (\`${row.vendor}\`-side) → middleware (\`${row.tooling}\`) → ERP endpoint (${ctx.adaptorName}).`,
    '',
    '## 3. Auth & Secrets',
    '',
    `- **Auth method:** ${authMethod}`,
    `- **Secret rotation cadence:** ${rotationCadence}`,
    `- **Secret owner:** ${secretOwner}`,
    '',
    '**If a secret leaks:**',
    '',
    '1. Revoke the compromised credential at the vendor immediately.',
    '2. Rotate the credential per the cadence procedure above.',
    '3. Redeploy the connection; verify via smoke test.',
    '4. Audit access logs for the compromised window; report any anomalous activity.',
    '5. File an incident report; root-cause review within 5 business days.',
    '',
    '## 4. Data Flow',
    '',
    `- **Direction:** ${row.direction}`,
    `- **Frequency:** ${row.frequency}`,
    `- **Tooling:** ${row.tooling}`,
    `- **Expected volume:** _[ASSIGN per-cycle volume]_`,
    `- **Payload format:** _[ASSIGN — JSON / XML / CSV / EDIFACT / etc]_`,
    '',
    '## 5. Monitoring',
    '',
    `- **Health metric:** ${metric}`,
    `- **Green:** ${greenT}`,
    `- **Yellow:** ${yellowT}`,
    `- **Red:** ${redT}`,
    '',
    dashboardRef(ctx, row),
    '',
    '## 6. Common Errors & Resolution',
    '',
    '| Error category | Resolution pattern |',
    '|----------------|---------------------|',
    errorTable,
    '',
    logRef(ctx),
    '',
    '## 7. Recovery Procedures',
    '',
    '**Replay procedure:**',
    '',
    '1. Identify the failed transaction window from the log location above.',
    '2. Pull the original payload from the source system\'s audit log.',
    '3. Validate the payload against current schema.',
    '4. Re-submit via the standard inbound channel (do NOT bypass middleware).',
    '5. Confirm reconciliation passes per `../Reconciliation_Procedures.md`.',
    '',
    '**Manual fallback:**',
    '',
    '1. If middleware is unavailable, follow the manual entry SOP for this integration.',
    '2. Document every manual entry in the integration\'s defect log.',
    '3. Reconcile manual entries against source within the next cycle.',
    '4. Resume automated flow only after middleware is fully restored AND smoke test passes.',
    '',
    '**Escalation trigger:** if recovery exceeds 4 hours OR if more than 5% of cycle volume requires manual fallback, page the internal owner and convene war-room session per `Documentation/Hypercare/War_Room_SOP.md`.',
    '',
    '## 8. Pre-Cutover Smoke Test',
    '',
    preCutover,
    '',
    '**Pass criteria:** test record successfully traverses end-to-end within frequency SLA; reconciliation match against source.',
    '',
    '## 9. Post-Cutover Smoke Test',
    '',
    postCutover,
    '',
    '**Pass criteria:** first business cycle after cutover reconciles 100% record-for-record.',
    '',
    '## 10. Vendor Support',
    '',
    `- **Channel:** ${channel}`,
    `- **Vendor SLA:** ${sla}`,
    `- **Escalation path:** ${escalation}`,
    '',
    '**Escalation tiers:**',
    '',
    '- **L1** — internal owner (`' + internalOwner + '`) — standard incidents within SLA.',
    '- **L2** — vendor support channel (above) — when L1 has exhausted recovery procedures or SLA breach is imminent.',
    '- **L3** — vendor account manager — repeated breaches or vendor-side outage.',
    '- **L4** — vendor executive escalation — unresolved L3 > 24h with business-critical impact.',
    '',
    '## 11. Cross-References',
    '',
    '- Integration catalog: `../Integration_Catalog.md`',
    '- Health dashboard: `../Integration_Health_Dashboard.md`',
    '- Reconciliation procedures: `../Reconciliation_Procedures.md`',
    '- Vendor escalation matrix: `../Vendor_Escalation_Matrix.md`',
    '- Cutover runbook (Pack V): `Documentation/Cutover/Cutover_Runbook.md`',
    '- Migration runbook (Pack Z): `Documentation/Data_Migration/Migration_Runbook.md`',
    '- Hypercare plan (Pack X): `Documentation/Hypercare/Hypercare_Plan.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '',
    `**Reconciliation cadence:** ${reconCadence} (owner: ${reconOwner})`,
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ];
  return lines.join('\n');
}

export function generateIntegrationRunbookBundle(
  input: IntegrationRunbookBundleInput,
): IntegrationRunbookBundleOutput {
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const integrations = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });

  const ctx: BundleContext = {
    clientName: input.clientName,
    adaptorName: input.adaptorName,
    isNetSuite,
    integrations,
    owners: indexByName(parseIntegrationOwners((input.integrationOwnersByName ?? '').toString())),
    auth: indexByName(parseIntegrationAuthMethods((input.integrationAuthMethods ?? '').toString())),
    monitoring: indexByName(parseIntegrationMonitoring((input.integrationMonitoring ?? '').toString())),
    errorPatterns: parseIntegrationErrorPatterns((input.integrationErrorPatterns ?? '').toString()),
    vendorContacts: indexByName(parseIntegrationVendorContacts((input.integrationVendorContacts ?? '').toString())),
    reconciliation: indexByName(parseIntegrationReconciliation((input.integrationReconciliation ?? '').toString())),
    smokeTests: indexByName(parseIntegrationSmokeTests((input.integrationCutoverSmokeTests ?? '').toString())),
  };

  const files: Record<string, string> = {};
  integrations.forEach((row, idx) => {
    const seq = String(idx + 1).padStart(2, '0');
    const filename = `${seq}_${slugify(row.name)}.md`;
    files[filename] = buildRunbook(row, ctx);
  });

  return {
    files,
    runbookCount: integrations.length,
  };
}
