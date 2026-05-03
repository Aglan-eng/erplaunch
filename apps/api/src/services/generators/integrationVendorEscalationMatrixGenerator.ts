/**
 * Integration Vendor Escalation Matrix generator (Pack ZZ — Component 5).
 *
 * Cross-platform — emits Documentation/Integrations/Vendor_Escalation_Matrix.md.
 *
 * Master vendor-escalation table sourced from `integrationVendorContacts`.
 * Adaptor-vendor row included as the platform-itself escalation path
 * (NetSuite Customer Care / OdooSH Support) for cross-cutting issues.
 *
 * Escalation tiers L1 → L4 with explicit triggers.
 */

import {
  integrationsInScope,
  parseIntegrationVendorContacts,
  parseIntegrationOwners,
  indexByName,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationVendorEscalationMatrixInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  integrationVendorContacts?: string | null;
  integrationOwnersByName?: string | null;
}

export interface IntegrationVendorEscalationMatrixOutput {
  markdown: string;
}

function escalationRow(
  row: ParsedCatalogRow,
  channel: string,
  sla: string,
  internalOwner: string,
  vendorEscalation: string,
): string {
  return `| ${row.name} | ${row.vendor} | ${channel} | ${sla} | ${internalOwner} | ${vendorEscalation} | _[FILL IN account manager]_ |`;
}

export function generateIntegrationVendorEscalationMatrix(
  input: IntegrationVendorEscalationMatrixInput,
): IntegrationVendorEscalationMatrixOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const isNetSuite = input.adaptorName.toLowerCase().includes('netsuite');
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });
  const vendor = indexByName(
    parseIntegrationVendorContacts((input.integrationVendorContacts ?? '').toString()),
  );
  const owners = indexByName(
    parseIntegrationOwners((input.integrationOwnersByName ?? '').toString()),
  );

  const rows = inScope
    .map((row) => {
      const v = vendor.get(row.name.toLowerCase());
      const o = owners.get(row.name.toLowerCase());
      return escalationRow(
        row,
        v?.channel.length ? v.channel : '_[FILL IN support channel]_',
        v?.sla.length ? v.sla : '_[FILL IN SLA]_',
        o?.owner.length ? o.owner : '_[FILL IN internal owner]_',
        v?.escalation.length ? v.escalation : '_[FILL IN vendor escalation path]_',
      );
    })
    .join('\n');

  const platformVendorRow = isNetSuite
    ? '| **Platform — NetSuite** | NetSuite (Oracle) | NetSuite Customer Care via system.netsuite.com | 4h critical / 8h high | Internal IT lead | NetSuite Account Manager | _[FILL IN account manager name]_ |'
    : '| **Platform — Odoo** | Odoo SA / OdooSH | OdooSH Support via odoo.sh portal | 4h business / 1h critical (Enterprise) | Internal IT lead | Odoo CSM | _[FILL IN CSM name]_ |';

  const markdown = [
    `# Vendor Escalation Matrix — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Integrations covered:** ${inScope.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Master vendor-escalation table for the on-call rotation. When recovery ',
    'procedures in a runbook are exhausted, this matrix tells the on-call which ',
    'vendor channel to engage and on what SLA. Tier-1 (internal owner) sits ',
    'inside the runbook itself; Tier-2 (vendor support) and beyond live here.',
    '',
    '## Master Table',
    '',
    '| Integration | Vendor | Support channel | Vendor SLA | Tier-1 (internal) | Tier-2 (vendor support) | Account manager |',
    '|-------------|--------|-----------------|------------|---------------------|--------------------------|-----------------|',
    rows,
    platformVendorRow,
    '',
    '## Escalation Tiers',
    '',
    '| Tier | Authority | Trigger | SLA |',
    '|------|-----------|---------|-----|',
    '| **L1** | Internal owner | All standard incidents within SLA | Per integration runbook |',
    '| **L2** | Vendor support channel | SLA breached OR recovery procedure exhausted | Per vendor SLA above |',
    '| **L3** | Vendor account manager | Repeated breaches OR vendor-side outage OR contractual issue | 24h response |',
    '| **L4** | Vendor executive escalation | Unresolved L3 > 24h with business-critical impact | Sponsor-driven |',
    '',
    '## Escalation Triggers — When to Move Up',
    '',
    '- **L1 → L2** — internal owner has worked the recovery procedure to completion ',
    '  AND issue persists; OR SLA breach is imminent (< 25% of SLA budget remaining); ',
    '  OR root cause appears vendor-side.',
    '- **L2 → L3** — vendor support has not responded within their SLA; OR same ',
    '  failure pattern has recurred 3+ times in the last 90 days; OR vendor support ',
    '  is unable to resolve and case has been open > 48h.',
    '- **L3 → L4** — L3 has not resolved within 24h AND business impact is critical ',
    '  (revenue loss, regulatory deadline, customer-facing outage).',
    '',
    '## Standing Calls + Quarterly Review',
    '',
    '- **Per-vendor monthly review** — internal owner + vendor account manager. ',
    '  Reviews open tickets, recurring incidents, and roadmap items. Documented in ',
    '  `Documentation/Stabilization/Continuous_Improvement_Governance.md`.',
    isNetSuite
      ? '- **Quarterly platform review** — internal IT lead + NetSuite Customer Care. Surface any cross-integration patterns.'
      : '- **Quarterly platform review** — internal IT lead + OdooSH support. Surface any cross-integration patterns.',
    '',
    '## Cross-References',
    '',
    '- Per-integration runbooks: `./Runbooks/`',
    '- Issue escalation matrix (Pack X — internal hypercare escalation): `Documentation/Hypercare/Issue_Escalation_Matrix.md`',
    '- Continuous improvement governance: `Documentation/Stabilization/Continuous_Improvement_Governance.md`',
    '- War-room SOP: `Documentation/Hypercare/War_Room_SOP.md`',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
