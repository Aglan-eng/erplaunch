/**
 * Integration Catalog generator (Pack ZZ — Component 1).
 *
 * Cross-platform — emits Documentation/Integrations/Integration_Catalog.md.
 *
 * Master inventory of every integration in scope. Joins data from
 * `integrationCatalog`, `integrationOwnersByName`, and `integrationVendorContacts`
 * to render a single source-of-truth table. Falls back to the adaptor's
 * canonical catalog when overlay is sparse.
 */

import {
  integrationsInScope,
  parseIntegrationOwners,
  parseIntegrationVendorContacts,
  indexByName,
  isCriticalPath,
  type ParsedCatalogRow,
} from './integrationHelpers.js';

export interface IntegrationCatalogInput {
  clientName: string;
  adaptorName: string;
  answers: Record<string, unknown>;
  /** TEXTAREA integrations.catalog.integrationOwnersByName. */
  integrationOwnersByName?: string | null;
  /** TEXTAREA integrations.support.integrationVendorContacts. */
  integrationVendorContacts?: string | null;
}

export interface IntegrationCatalogOutput {
  markdown: string;
}

function inventoryRow(
  row: ParsedCatalogRow,
  owner: string,
  vendorSla: string,
): string {
  const critical = isCriticalPath(row) ? '🔴 critical-path' : '—';
  return `| ${row.name} | ${row.type} | ${row.direction} | ${row.frequency} | ${row.tooling} | ${row.vendor} | ${owner} | ${vendorSla} | ${critical} |`;
}

export function generateIntegrationCatalog(
  input: IntegrationCatalogInput,
): IntegrationCatalogOutput {
  const platform = input.adaptorName.length > 0 ? input.adaptorName : 'ERP';
  const inScope = integrationsInScope({
    adaptorName: input.adaptorName,
    answers: input.answers,
  });

  const owners = parseIntegrationOwners((input.integrationOwnersByName ?? '').toString());
  const vendorContacts = parseIntegrationVendorContacts(
    (input.integrationVendorContacts ?? '').toString(),
  );
  const ownerByName = indexByName(owners);
  const vendorByName = indexByName(vendorContacts);

  const inventoryRows = inScope
    .map((row) => {
      const ownerEntry = ownerByName.get(row.name.toLowerCase());
      const vendorEntry = vendorByName.get(row.name.toLowerCase());
      const owner = ownerEntry?.owner.length ? ownerEntry.owner : '_[ASSIGN]_';
      const sla = vendorEntry?.sla.length ? vendorEntry.sla : '_[ASSIGN]_';
      return inventoryRow(row, owner, sla);
    })
    .join('\n');

  const criticalPathRows = inScope.filter(isCriticalPath);
  const criticalPathBullets = criticalPathRows.length > 0
    ? criticalPathRows.map((r) => `- **${r.name}** — ${r.type} (${r.direction}, ${r.frequency})`).join('\n')
    : '_(No critical-path integrations identified yet — review against the heuristic when scope firms up.)_';

  const markdown = [
    `# Integration Catalog — ${input.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Integrations in scope:** ${inScope.length}  `,
    `**Critical-path integrations:** ${criticalPathRows.length}  `,
    `**Date prepared:** ${new Date().toLocaleDateString()}`,
    '',
    'Master inventory of every integration in scope. The on-call rotation reads ',
    'this table during incidents to know whose runbook to open. Per-integration ',
    'runbooks live in `./Runbooks/<NN>_<integration_name>.md` — one file per row ',
    'in the table below.',
    '',
    '## Inventory',
    '',
    '| Integration | Type | Direction | Frequency | Tooling | Vendor | Internal owner | Vendor SLA | Criticality |',
    '|-------------|------|-----------|-----------|---------|--------|----------------|------------|-------------|',
    inventoryRows,
    '',
    '## Type Definitions',
    '',
    'Every integration falls into one of five types. Type drives the failure-mode ',
    'analysis in each runbook:',
    '',
    '| Type | Definition | Typical failure modes |',
    '|------|-----------|------------------------|',
    '| **Master-data sync** | Reference data (customers / vendors / products / employees) flows between systems | Field-mapping mismatch, dedupe collision, lookup failure |',
    '| **Transactional** | Business documents (orders / invoices / payments) flow between systems | Missing parent record, posting validation, tax mismatch |',
    '| **File drop** | Scheduled file exchange (SFTP / S3 / shared folder) | File missing, format change, encryption / signature failure |',
    '| **Event stream** | Webhooks / message queues / pub-sub | Delivery failure, sequence gap, duplicate events |',
    '| **On-demand API** | Synchronous API call triggered by user action or workflow | Network timeout, auth expiry, rate-limit |',
    '',
    '## Critical-Path Integrations',
    '',
    'Critical-path integrations are those that **block close** if they break. ',
    'Heuristic: Inbound + Frequency ≤ Daily + Type=Transactional. Reviewed per cycle:',
    '',
    criticalPathBullets,
    '',
    '## Decommission Registry',
    '',
    'Integrations slated for retirement once phase-two work begins. Empty until ',
    'phase-two kicks off; track decommission decisions here.',
    '',
    '| Integration | Reason | Replacement | Decommission target | Owner |',
    '|-------------|--------|-------------|---------------------|-------|',
    '| _(none yet)_ | — | — | — | — |',
    '',
    '## Cross-References',
    '',
    '- Per-integration runbooks: `./Runbooks/`',
    '- Health dashboard: `./Integration_Health_Dashboard.md`',
    '- Reconciliation procedures: `./Reconciliation_Procedures.md`',
    '- Vendor escalation matrix: `./Vendor_Escalation_Matrix.md`',
    '- Integration test plan: `./Integration_Test_Plan.md`',
    '- Cutover runbook (Pack V): `Documentation/Cutover/Cutover_Runbook.md`',
    '- Migration runbook (Pack Z): `Documentation/Data_Migration/Migration_Runbook.md`',
    '- Hypercare plan (Pack X): `Documentation/Hypercare/Hypercare_Plan.md`',
    '',
    '_Generated by ERPLaunch — Pack ZZ (Integration Runbooks)._',
    '',
  ].join('\n');

  return { markdown };
}
