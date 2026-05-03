/**
 * SDF Saved Search generator (Pack F — Reporting).
 *
 * Reporting is one of the heaviest manual surfaces in any NetSuite
 * implementation — typical OneWorld engagement has 30–100 saved
 * searches. Pre-Pack-F the bundle had ZERO. Pack F closes this with
 * three layered inputs:
 *
 *   1. Starter library (12 hardcoded saved searches always emitted) —
 *      universal report set every NS engagement uses (Open POs / AR
 *      Aging / Trial Balance / Top Vendors by Spend / etc.).
 *   2. KPI catalog (ns.design.kpiCatalog wizard answer) — consultant-
 *      supplied KPIs in the form "<workstream>: <KPI name>: <desc>".
 *      Generator infers the recordtype from KPI-name keywords and
 *      emits one savedsearch XML per parsed line.
 *   3. Custom record default views — for each customrecord parsed
 *      from ns.design.customRecords, a default list-view savedsearch
 *      is emitted (consistent UX across all custom records).
 *
 * Dedup rule: when a wizard KPI yields the same scriptid as a starter,
 * the wizard line wins (consultant intent > heuristic floor).
 *
 * The emitted XMLs are deliberately MINIMAL — searchfilter empty,
 * searchresults with internalid + name + lastmodifieddate columns
 * only. The consultant adds criteria filters + extra columns in the
 * NetSuite UI before deploy. The bundle's value is in declaring the
 * search exists with the correct recordtype + scriptid; everything
 * else is iterative refinement.
 *
 * Sources:
 *   - NetSuite SDF savedsearch XML reference (Oracle docs).
 *   - Common NetSuite reporting patterns (Oracle Help — Saved Searches).
 */

export type RecordType =
  | 'PURCHORD'
  | 'VENDOR'
  | 'VENDORBILL'
  | 'SALESORD'
  | 'INVOICE'
  | 'CUSTOMER'
  | 'TRANSACTION'
  | 'INVENTORYITEM'
  | 'EMPLOYEE'
  | 'RTNAUTH'
  | 'ASSEMBLYBUILD'
  | 'OPPORTUNITY';

export interface EmittedSavedSearch {
  filename: string;
  scriptid: string;
  /** NetSuite searchtype enum / recordtype reference. Standard values
   *  use the bare enum (PURCHORD); custom-record references use the
   *  bracketed [scriptid=customrecord_*] form. */
  recordtype: string;
  title: string;
  /** Provenance — drives the harness coverage checks. */
  origin: 'starter' | 'kpi-catalog' | 'custom-record-view';
}

export interface SavedSearchGeneratorInput {
  /** Raw TEXTAREA from ns.design.kpiCatalog. */
  kpiCatalogAnswer: string | null | undefined;
  /** Raw TEXTAREA from ns.design.customRecords (re-parsed here for
   *  the per-record default-view emission). */
  customRecordsAnswer: string | null | undefined;
}

export interface SavedSearchGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedSavedSearch[];
}

// ─── Starter library ────────────────────────────────────────────────────────

interface StarterEntry {
  scriptid: string;
  recordtype: RecordType;
  title: string;
}

/**
 * 12-entry starter library — the universal NS report set every
 * engagement uses regardless of vertical or workstream mix. Emitted
 * unconditionally on every NetSuite bundle. Wizard KPIs that
 * collide on scriptid override these (consultant intent wins).
 */
const STARTER_LIBRARY: ReadonlyArray<StarterEntry> = [
  { scriptid: 'customsearch_nsix_open_po', recordtype: 'PURCHORD', title: 'Open Purchase Orders' },
  { scriptid: 'customsearch_nsix_po_cycle_time', recordtype: 'PURCHORD', title: 'PO Cycle Time' },
  { scriptid: 'customsearch_nsix_top_vendors_by_spend', recordtype: 'VENDOR', title: 'Top Vendors by Spend' },
  { scriptid: 'customsearch_nsix_open_ar', recordtype: 'INVOICE', title: 'Open AR' },
  { scriptid: 'customsearch_nsix_ar_aging', recordtype: 'INVOICE', title: 'AR Aging' },
  { scriptid: 'customsearch_nsix_top_customers_by_rev', recordtype: 'CUSTOMER', title: 'Top Customers by Revenue' },
  { scriptid: 'customsearch_nsix_trial_balance', recordtype: 'TRANSACTION', title: 'Trial Balance' },
  { scriptid: 'customsearch_nsix_pending_bills', recordtype: 'VENDORBILL', title: 'Pending Vendor Bills' },
  { scriptid: 'customsearch_nsix_recent_changes_audit', recordtype: 'TRANSACTION', title: 'Recent Changes — Audit Trail' },
  { scriptid: 'customsearch_nsix_inventory_variance', recordtype: 'INVENTORYITEM', title: 'Inventory Variance' },
  { scriptid: 'customsearch_nsix_lots_expiring_soon', recordtype: 'INVENTORYITEM', title: 'Lots Expiring in 90 Days' },
  { scriptid: 'customsearch_nsix_returns_by_reason', recordtype: 'RTNAUTH', title: 'Returns by Reason' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function slugify(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/**
 * Recordtype keyword classifier. Order matters — more specific
 * phrases first (so "purchase order" matches PURCHORD before "po"
 * heuristically picks something else).
 *
 * Sources: NetSuite recordtype enum reference + standard SuiteCloud
 * search-recordtype mapping.
 */
export function inferRecordType(kpiName: string): RecordType {
  const lc = kpiName.toLowerCase();
  // Pluralisation is common in human KPI names — "Top Vendors" / "Open
  // Invoices" / "Lots Expiring" / "Returns by Reason" all need to
  // match. Each keyword family allows an optional trailing 's' (or
  // 'ies' for opportunity → opportunities).
  if (/\bpurchase orders?\b|\bpo\b/.test(lc)) return 'PURCHORD';
  if (/\bbills?\b|\bpayables?\b/.test(lc)) return 'VENDORBILL';
  if (/\bvendors?\b|\bsuppliers?\b/.test(lc)) return 'VENDOR';
  if (/\bsales orders?\b|\bso\b/.test(lc)) return 'SALESORD';
  if (/\binvoices?\b|\bar\b|\breceivables?\b/.test(lc)) return 'INVOICE';
  if (/\bcustomers?\b/.test(lc)) return 'CUSTOMER';
  if (/\bjournals?\b|\bje\b|\btrial balance\b|\bgl\b/.test(lc)) return 'TRANSACTION';
  if (/\binventory\b|\bskus?\b|\bitems?\b|\blots?\b/.test(lc)) return 'INVENTORYITEM';
  if (/\bemployees?\b|\bstaff\b/.test(lc)) return 'EMPLOYEE';
  if (/\breturns?\b|\brma\b/.test(lc)) return 'RTNAUTH';
  if (/\bproduction\b|\bmos?\b|\bmanufacturing\b/.test(lc)) return 'ASSEMBLYBUILD';
  if (/\bopportunit(?:y|ies)\b|\bleads?\b/.test(lc)) return 'OPPORTUNITY';
  return 'TRANSACTION';
}

/**
 * Parse one KPI catalog line. Format: "<workstream>: <name>: <desc>".
 * Returns null on bad format (silently skipped by the generator).
 */
interface ParsedKpiLine {
  workstream: string;
  name: string;
  description: string;
}

function parseKpiLine(line: string): ParsedKpiLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(/^(R2R|P2P|O2C|MFG|RTN|CRM|INV):\s*([^:]+):\s*(.+)$/i);
  if (!m) return null;
  return {
    workstream: m[1].toUpperCase(),
    name: m[2].trim(),
    description: m[3].trim(),
  };
}

/**
 * Extract the human-readable record name from one customRecords line
 * (mirrors sdfCustomRecordsGenerator's parser — keeps text before
 * the first '(', trimmed). Empty result yields null.
 */
function extractRecordName(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const parenIdx = trimmed.indexOf('(');
  const name = (parenIdx >= 0 ? trimmed.slice(0, parenIdx) : trimmed).trim();
  return name.length > 0 ? name : null;
}

// ─── XML emission ────────────────────────────────────────────────────────────

interface SavedSearchSpec {
  scriptid: string;
  recordtype: string; // either bare enum (PURCHORD) or [scriptid=customrecord_*]
  title: string;
  /** Source identification for the comment header. */
  source: 'starter library' | 'KPI catalog wizard answer' | 'custom record default view';
  /** Verbatim wizard line, when source = KPI catalog. */
  rawLine?: string;
}

function buildSavedSearchXml(spec: SavedSearchSpec): string {
  const sourceLine = spec.rawLine
    ? `  KPI description (verbatim wizard line): "${xmlEscape(spec.rawLine)}"\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Saved Search Generator.
  Source: ${spec.source}
${sourceLine}  Review before deploy:
    - Add criteria filters in NetSuite UI per the KPI description
    - Add result columns beyond internalid + name + lastmodifieddate (the
      deployable starter only includes those three)
    - Set Public/Private flag per role permission policy
-->
<savedsearch scriptid="${spec.scriptid}">
  <searchtype>${spec.recordtype}</searchtype>
  <isinactive>F</isinactive>
  <ispublic>T</ispublic>
  <searchfilter />
  <searchsummary />
  <searchresults>
    <searchresult>
      <searchcolumn>
        <field>internalid</field>
        <label>Internal ID</label>
      </searchcolumn>
      <searchcolumn>
        <field>name</field>
        <label>Name</label>
      </searchcolumn>
      <searchcolumn>
        <field>lastmodifieddate</field>
        <label>Last Modified</label>
      </searchcolumn>
    </searchresult>
  </searchresults>
  <title>${xmlEscape(spec.title)}</title>
</savedsearch>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit the full set of saved searches for an engagement: 12 starter
 * library entries (always) + N KPI-catalog entries (when supplied) +
 * one default-view per custom record (when records are declared).
 *
 * Dedup precedence: KPI-catalog entries override starters on scriptid
 * collision (wizard wins). Custom-record default views can never
 * collide with the others (their scriptids embed the record slug).
 */
export function generateSavedSearches(
  input: SavedSearchGeneratorInput,
): SavedSearchGeneratorOutput {
  // Map keyed by scriptid so dedup is trivial. Order is preserved by
  // insertion: starters first, then catalog (overwrites collisions),
  // then custom record default views.
  const byScriptid = new Map<string, { spec: SavedSearchSpec; emitted: EmittedSavedSearch }>();

  // 1. Starter library — always-on floor.
  for (const s of STARTER_LIBRARY) {
    byScriptid.set(s.scriptid, {
      spec: {
        scriptid: s.scriptid,
        recordtype: s.recordtype,
        title: s.title,
        source: 'starter library',
      },
      emitted: {
        filename: `Objects/${s.scriptid}.xml`,
        scriptid: s.scriptid,
        recordtype: s.recordtype,
        title: s.title,
        origin: 'starter',
      },
    });
  }

  // 2. KPI catalog — consultant-supplied KPIs. Each parses to
  // {workstream, name, description}; recordtype inferred from name.
  const kpiRaw = (input.kpiCatalogAnswer ?? '').toString();
  if (kpiRaw.trim().length > 0) {
    const lines = kpiRaw.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      const parsed = parseKpiLine(line);
      if (!parsed) continue;
      const recordtype = inferRecordType(parsed.name);
      const scriptid = `customsearch_nsix_${slugify(parsed.name)}`;
      byScriptid.set(scriptid, {
        spec: {
          scriptid,
          recordtype,
          title: parsed.name,
          source: 'KPI catalog wizard answer',
          rawLine: line.trim(),
        },
        emitted: {
          filename: `Objects/${scriptid}.xml`,
          scriptid,
          recordtype,
          title: parsed.name,
          origin: 'kpi-catalog',
        },
      });
    }
  }

  // 3. Custom-record default views — one per parsed customrecord.
  // Recordtype reference uses NetSuite's [scriptid=...] bracketed form.
  const recordsRaw = (input.customRecordsAnswer ?? '').toString();
  if (recordsRaw.trim().length > 0) {
    const lines = recordsRaw.replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
      const recordName = extractRecordName(line);
      if (!recordName) continue;
      const recordSlug = slugify(recordName);
      const scriptid = `customsearch_nsix_${recordSlug}_default_view`;
      const recordtypeRef = `[scriptid=customrecord_${recordSlug}]`;
      byScriptid.set(scriptid, {
        spec: {
          scriptid,
          recordtype: recordtypeRef,
          title: `${recordName} — Default View`,
          source: 'custom record default view',
        },
        emitted: {
          filename: `Objects/${scriptid}.xml`,
          scriptid,
          recordtype: recordtypeRef,
          title: `${recordName} — Default View`,
          origin: 'custom-record-view',
        },
      });
    }
  }

  // Materialise the files map + emitted list in insertion order so
  // the output is deterministic across regenerations.
  const files: Record<string, string> = {};
  const emitted: EmittedSavedSearch[] = [];
  for (const { spec, emitted: e } of byScriptid.values()) {
    files[e.filename] = buildSavedSearchXml(spec);
    emitted.push(e);
  }
  return { files, emitted };
}

// Exported for tests + the dashboard generator's KPI-matching logic.
export { STARTER_LIBRARY };
