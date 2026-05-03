/**
 * Integrations Index generator (Pack ZZ — Component 7).
 *
 * Cross-platform — emits Documentation/Integrations/README.md.
 *
 * Master index for the Integrations/ folder. Per-integration card with
 * name, criticality, link to runbook, link to test plan section,
 * on-call owner, and vendor support snippet. Sorted by criticality
 * (critical-path first).
 */

import {
  integrationsInScope,
  parseIntegrationOwners,
  parseIntegrationVendorContacts,
  indexByName,
  isCriticalPath,
  slugify,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationsIndexInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationOwnersByName?: string | null;
  integrationVendorContacts?: string | null;
}

export interface IntegrationsIndexOutput {
  markdown: string;
}

function integrationCard(
  row: ParsedCatalogRow,
  idx: number,
  internalOwner: string,
  vendorChannel: string,
): string {
  const seq = String(idx + 1).padStart(2, '0');
  const slug = slugify(row.name);
  return [
    `### ${seq}. ${row.name} ${isCriticalPath(row) ? '🔴' : ''}`,
    '',
    `- **Type:** ${row.type} · **Direction:** ${row.direction} · **Frequency:** ${row.frequency}`,
    `- **Vendor:** ${row.vendor}`,
    `- **Internal owner:** ${internalOwner}`,
    `- **Vendor support:** ${vendorChannel}`,
    `- **Runbook:** [\`./Runbooks/${seq}_${slug}.md\`](./Runbooks/${seq}_${slug}.md)`,
    `- **Test plan section:** [Integration_Test_Plan.md → ${row.name}](./Integration_Test_Plan.md)`,
    '',
  ].join('\n');
}

export function generateIntegrationsIndex(
  input: IntegrationsIndexInput,
): IntegrationsIndexOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const owners = indexByName(
    parseIntegrationOwners((input.integrationOwnersByName ?? '').toString()),
  );
  const vendor = indexByName(
    parseIntegrationVendorContacts((input.integrationVendorContacts ?? '').toString()),
  );

  const cards = inScope
    .map((row, idx) => {
      const o = owners.get(row.name.toLowerCase());
      const v = vendor.get(row.name.toLowerCase());
      return integrationCard(
        row,
        idx,
        o?.owner.length ? o.owner : '_[ASSIGN]_',
        v?.channel.length ? v.channel : '_[ASSIGN]_',
      );
    })
    .join('\n');

  const criticalCount = inScope.filter(isCriticalPath).length;

  const markdown = [
    `# Integrations — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Integrations in scope:** ${inScope.length} (${criticalCount} critical-path 🔴)  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Master index for the Integrations/ folder. Every integration listed below has ',
    'a runbook, a test plan section, and an on-call owner. Sorted by criticality — ',
    'critical-path integrations 🔴 (those that block close if they break) appear first.',
    '',
    '## Folder Layout',
    '',
    '```',
    'Documentation/Integrations/',
    '├── README.md                              ← this file',
    '├── Integration_Catalog.md                 ← master inventory',
    '├── Integration_Health_Dashboard.md        ← steady-state monitoring spec',
    '├── Reconciliation_Procedures.md           ← per-integration drift detection',
    '├── Vendor_Escalation_Matrix.md            ← L1-L4 escalation paths',
    '├── Integration_Test_Plan.md               ← pre-cutover + post-cutover smoke',
    '└── Runbooks/                              ← one .md per integration',
    `    ├── 01_<integration>.md`,
    `    ├── 02_<integration>.md`,
    `    └── ... (${inScope.length} files)`,
    '```',
    '',
    '## Integrations',
    '',
    cards,
    '## Cross-Pack References',
    '',
    'Pack ZZ ties the integration spine into the broader artefact set:',
    '',
    '- **Pack V — Cutover** — `Documentation/Cutover/Cutover_Runbook.md` references each integration\'s pre-cutover smoke at the appropriate hour in the cutover timeline.',
    '- **Pack V — Go/No-Go** — `Documentation/Cutover/Go_NoGo_Matrix.md` lists every integration as a gate.',
    '- **Pack V — Post-Cutover Smoke** — `Documentation/Cutover/Post_Cutover_Smoke.md` references the per-integration post-cutover tests.',
    '- **Pack X — Hypercare** — `Documentation/Hypercare/Hypercare_Plan.md` makes every red-tile integration a war-room session trigger.',
    '- **Pack X — War Room SOP** — `Documentation/Hypercare/War_Room_SOP.md` references the integration runbooks for incident triage.',
    '- **Pack Y — Stabilization** — `Documentation/Stabilization/Continuous_Improvement_Governance.md` documents quarterly vendor reviews.',
    '- **Pack Z — Data Migration** — `Documentation/Data_Migration/Migration_Runbook.md` references integration cutover smoke tests.',
    '',
    '## On-Call Quick Reference',
    '',
    'During an incident, in this order:',
    '',
    '1. **Identify the integration** — health dashboard tile that flipped red.',
    '2. **Open the runbook** — drill-through link from the dashboard tile.',
    '3. **Try L1 recovery** — runbook section 7 (replay / manual fallback).',
    '4. **Reconcile** — runbook section 8 / 9 + Reconciliation_Procedures.md.',
    '5. **Escalate if needed** — Vendor_Escalation_Matrix.md (L2 vendor support → L3 account manager → L4 vendor exec).',
    '6. **War room if SLA at risk** — `Documentation/Hypercare/War_Room_SOP.md`.',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
