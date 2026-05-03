/**
 * Shared helpers for Pack ZZ — Integration Runbooks generators.
 *
 * Three responsibilities:
 *   1. Pipe-delimited parsers for the 8 cross-platform integrations.*
 *      answers.
 *   2. `integrationsInScope(answers)` spine — every Pack ZZ generator
 *      iterates this. Reads the consultant's `integrationCatalog` overlay
 *      and falls back to the adaptor-canonical catalog when sparse.
 *   3. Slugify helper for filename safety (e.g. "Avalara Tax" →
 *      `avalara_tax`) and criticality scoring (transactional / inbound /
 *      ≤daily = critical-path).
 *
 * Adaptor split:
 *   - NetSuite catalog: 11 canonical integrations covering the typical
 *     OneWorld engagement (Avalara, Salesforce, HSBC bank statements,
 *     Wells Fargo ACH, Workday HRIS, Coupa P2P, Shopify, DocuSign,
 *     Concur, Snowflake, Workato).
 *   - Odoo catalog: 6 canonical integrations covering the typical KSA
 *     localization (ZATCA Phase 2, SNB bank statement, SARIE payment
 *     file, Salla e-commerce, Power BI reporting, native Odoo Sign).
 */

// ─── Parsers — 8 cross-platform Pack ZZ answers ─────────────────────────────────

export interface ParsedCatalogRow {
  /** Integration name (Avalara Tax, ZATCA, etc) — used as join key. */
  name: string;
  /** Type: master-data sync / transactional / file drop / event stream / on-demand API. */
  type: string;
  /** Direction: Inbound / Outbound / Bidirectional / Internal. */
  direction: string;
  /** Frequency: Realtime / Hourly / Daily / etc. */
  frequency: string;
  /** Tooling — middleware / connector / native bundle. */
  tooling: string;
  /** Vendor (commercial owner of the integrated system). */
  vendor: string;
}

export interface ParsedOwnerRow {
  name: string;
  /** Internal owner — named individual or role. */
  owner: string;
  /** Backup owner (delegate). */
  backup: string;
}

export interface ParsedAuthRow {
  name: string;
  /** Auth method (OAuth 2.0, SFTP key, HMAC, OAuth + IP allowlist, …). */
  method: string;
  /** Secret rotation cadence (90 days / annual / per ZATCA renewal). */
  rotationCadence: string;
  /** Secret owner — named individual responsible for rotation. */
  secretOwner: string;
}

export interface ParsedMonitoringRow {
  name: string;
  /** Health metric (API success rate / sync queue depth / file received by …). */
  metric: string;
  /** Green threshold (passing). */
  green: string;
  /** Yellow threshold (warning). */
  yellow: string;
  /** Red threshold (page on-call). */
  red: string;
}

export interface ParsedErrorPatternRow {
  name: string;
  category: string;
  /** Resolution pattern — what the on-call should do. */
  resolution: string;
}

export interface ParsedVendorContactRow {
  name: string;
  channel: string;
  sla: string;
  /** Tier-2/Tier-3 escalation path beyond standard support channel. */
  escalation: string;
}

export interface ParsedReconciliationRow {
  name: string;
  cadence: string;
  owner: string;
}

export interface ParsedSmokeTestRow {
  name: string;
  /** Pre-cutover test description. */
  preCutover: string;
  /** Post-cutover smoke description. */
  postCutover: string;
}

function pipeSplit(line: string): string[] {
  return line.split('|').map((s) => s.trim());
}

export function parseIntegrationCatalog(raw: string): ParsedCatalogRow[] {
  const out: ParsedCatalogRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      type: segs[1] ?? '',
      direction: segs[2] ?? '',
      frequency: segs[3] ?? '',
      tooling: segs[4] ?? '',
      vendor: segs[5] ?? '',
    });
  }
  return out;
}

export function parseIntegrationOwners(raw: string): ParsedOwnerRow[] {
  const out: ParsedOwnerRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      owner: segs[1] ?? '',
      backup: segs[2] ?? '',
    });
  }
  return out;
}

export function parseIntegrationAuthMethods(raw: string): ParsedAuthRow[] {
  const out: ParsedAuthRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      method: segs[1] ?? '',
      rotationCadence: segs[2] ?? '',
      secretOwner: segs[3] ?? '',
    });
  }
  return out;
}

export function parseIntegrationMonitoring(raw: string): ParsedMonitoringRow[] {
  const out: ParsedMonitoringRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      metric: segs[1] ?? '',
      green: segs[2] ?? '',
      yellow: segs[3] ?? '',
      red: segs[4] ?? '',
    });
  }
  return out;
}

export function parseIntegrationErrorPatterns(raw: string): ParsedErrorPatternRow[] {
  const out: ParsedErrorPatternRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      category: segs[1] ?? '',
      resolution: segs[2] ?? '',
    });
  }
  return out;
}

export function parseIntegrationVendorContacts(raw: string): ParsedVendorContactRow[] {
  const out: ParsedVendorContactRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      channel: segs[1] ?? '',
      sla: segs[2] ?? '',
      escalation: segs[3] ?? '',
    });
  }
  return out;
}

export function parseIntegrationReconciliation(raw: string): ParsedReconciliationRow[] {
  const out: ParsedReconciliationRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      cadence: segs[1] ?? '',
      owner: segs[2] ?? '',
    });
  }
  return out;
}

export function parseIntegrationSmokeTests(raw: string): ParsedSmokeTestRow[] {
  const out: ParsedSmokeTestRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const segs = pipeSplit(trimmed);
    if (segs.length < 2 || segs[0].length === 0) continue;
    out.push({
      name: segs[0],
      preCutover: segs[1] ?? '',
      postCutover: segs[2] ?? '',
    });
  }
  return out;
}

// ─── Slugify helper ────────────────────────────────────────────────────────────

/**
 * Convert an integration name into a filesystem-safe slug.
 * "Avalara Tax" → "avalara_tax"
 * "ZATCA E-Invoicing Phase 2" → "zatca_e_invoicing_phase_2"
 * "HSBC Bank Statement (UK + AU)" → "hsbc_bank_statement_uk_au"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

// ─── Criticality scoring ───────────────────────────────────────────────────────

/**
 * Critical-path integrations are those that block close if they break.
 * Heuristic: Inbound + (≤ Daily frequency) + Type=Transactional.
 *
 * Used by the runbook bundle to order files by criticality (lower
 * sequence prefix = more critical).
 */
export function isCriticalPath(row: ParsedCatalogRow): boolean {
  const inbound = /inbound|bidirectional/i.test(row.direction);
  const transactional = /transactional/i.test(row.type);
  const dailyOrFaster = /(realtime|hourly|15min|min|daily|hour)/i.test(row.frequency);
  return inbound && transactional && dailyOrFaster;
}

/**
 * Stable ordering for runbook filenames + catalog table:
 *   1. Critical-path transactional integrations first (alphabetical within tier)
 *   2. Master-data syncs second
 *   3. File drops + on-demand third
 *   4. Everything else last
 */
export function sortByCriticality(rows: ReadonlyArray<ParsedCatalogRow>): ParsedCatalogRow[] {
  const tier = (row: ParsedCatalogRow): number => {
    if (isCriticalPath(row)) return 0;
    if (/master.?data/i.test(row.type)) return 1;
    if (/file.?drop/i.test(row.type)) return 2;
    if (/on.?demand/i.test(row.type)) return 3;
    return 4;
  };
  return rows.slice().sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    return a.name.localeCompare(b.name);
  });
}

// ─── Adaptor catalogs — canonical defaults when overlay is sparse ───────────────

/**
 * NetSuite canonical catalog. 11 integrations covering the typical
 * mid-market OneWorld engagement.
 */
export const NETSUITE_DEFAULT_CATALOG: ReadonlyArray<ParsedCatalogRow> = [
  { name: 'Avalara Tax', type: 'Transactional API', direction: 'Bidirectional', frequency: 'Realtime per transaction', tooling: 'RESTlet + Avalara AvaTax SDK', vendor: 'Avalara' },
  { name: 'Salesforce CPQ', type: 'Master-data + Transactional', direction: 'Bidirectional', frequency: '15min batch', tooling: 'Workato', vendor: 'Salesforce' },
  { name: 'Bank Statement Inbound', type: 'File drop', direction: 'Inbound', frequency: 'Daily', tooling: 'SFTP + Map/Reduce import', vendor: 'Bank' },
  { name: 'Payment File Outbound', type: 'File drop', direction: 'Outbound', frequency: 'Daily', tooling: 'Map/Reduce + SFTP + PGP', vendor: 'Bank' },
  { name: 'Workday HRIS Employee Sync', type: 'Master-data', direction: 'Inbound', frequency: 'Daily', tooling: 'Workday Studio + RESTlet', vendor: 'Workday' },
  { name: 'Coupa P2P', type: 'Master-data + Transactional', direction: 'Bidirectional', frequency: 'Hourly', tooling: 'Coupa Connect + RESTlet', vendor: 'Coupa' },
  { name: 'Shopify D2C Orders', type: 'Transactional', direction: 'Inbound', frequency: 'Realtime via webhook', tooling: 'Workato', vendor: 'Shopify' },
  { name: 'DocuSign Sales Order Signature', type: 'Event', direction: 'Outbound', frequency: 'On-demand per SO', tooling: 'Native bundle', vendor: 'DocuSign' },
  { name: 'Concur Expense', type: 'Transactional', direction: 'Inbound', frequency: 'Daily', tooling: 'Concur native connector', vendor: 'SAP Concur' },
  { name: 'Snowflake Reporting Export', type: 'Master-data + Transactional', direction: 'Outbound', frequency: 'Hourly', tooling: 'SuiteAnalytics Connect + Snowpipe', vendor: 'Snowflake' },
  { name: 'Workato Orchestration', type: 'iPaaS', direction: 'Bidirectional', frequency: 'Multi-cadence', tooling: 'Workato', vendor: 'Workato' },
];

/**
 * Odoo canonical catalog. 6 integrations covering typical KSA / GCC
 * Odoo Enterprise engagements.
 */
export const ODOO_DEFAULT_CATALOG: ReadonlyArray<ParsedCatalogRow> = [
  { name: 'ZATCA E-Invoicing Phase 2', type: 'Transactional API', direction: 'Outbound', frequency: 'Realtime per invoice', tooling: 'Native KSA localization + ZATCA SDK', vendor: 'Saudi Government (ZATCA)' },
  { name: 'Bank Statement Inbound', type: 'File drop', direction: 'Inbound', frequency: 'Daily', tooling: 'SFTP + native bank statement import', vendor: 'Bank' },
  { name: 'Payment File Outbound', type: 'File drop', direction: 'Outbound', frequency: 'Daily', tooling: 'SEPA-style payment module + local format export', vendor: 'Bank' },
  { name: 'E-commerce Orders', type: 'Transactional', direction: 'Inbound', frequency: 'Realtime via webhook', tooling: 'E-commerce connector', vendor: 'E-commerce platform' },
  { name: 'Power BI Reporting', type: 'Master-data + Transactional', direction: 'Outbound', frequency: 'Hourly', tooling: 'PostgreSQL views + Power BI gateway', vendor: 'Microsoft' },
  { name: 'Native Document Sign', type: 'Event', direction: 'Internal', frequency: 'On-demand per SO', tooling: 'OOTB', vendor: 'Platform' },
];

// ─── integrationsInScope — the spine ───────────────────────────────────────────

export interface IntegrationsInScopeContext {
  /** 'NetSuite' | 'Odoo' | other adaptor display name. */
  adaptorName: string;
  /** Wizard answers map. */
  answers: Record<string, unknown>;
}

/**
 * Read the wizard answers and return the canonical list of integrations
 * actually in scope for this engagement.
 *
 * Selection rule:
 *   - If `integrations.catalog.integrationCatalog` overlay is non-empty,
 *     use it verbatim (consultant has explicitly enumerated scope).
 *   - Otherwise fall back to the adaptor's canonical catalog (the
 *     defaults provide a sensible runbook spine even when consultant
 *     hasn't filled the wizard yet).
 *
 * The result is sorted by criticality so runbook filenames carry stable
 * sequence prefixes (01, 02, …).
 */
export function integrationsInScope(
  ctx: IntegrationsInScopeContext,
): ReadonlyArray<ParsedCatalogRow> {
  const overlay = parseIntegrationCatalog(
    ((ctx.answers['integrations.catalog.integrationCatalog'] as string | undefined) ?? '').toString(),
  );
  if (overlay.length > 0) return sortByCriticality(overlay);

  const isNetSuite = ctx.adaptorName.toLowerCase().includes('netsuite');
  const fallback = isNetSuite ? NETSUITE_DEFAULT_CATALOG : ODOO_DEFAULT_CATALOG;
  return sortByCriticality(fallback);
}

// ─── Lookup helpers — index a parsed list by integration name (case-insensitive) ─

export function indexByName<T extends { name: string }>(
  rows: ReadonlyArray<T>,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) out.set(r.name.toLowerCase(), r);
  return out;
}
