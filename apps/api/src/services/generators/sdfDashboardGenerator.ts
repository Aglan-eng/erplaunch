/**
 * SDF Dashboard generator (Pack F — Reporting).
 *
 * Reads the wizard's free-text TEXTAREA `ns.design.roleDashboards`
 * and emits one Oracle SDF `publisheddashboard` XML per declared role.
 * Each dashboard binds the listed KPIs as Search portlets pointing at
 * the savedsearch scriptids emitted by sdfSavedSearchGenerator.
 *
 * Pack F's dashboard pattern:
 *   - Wizard line: "<role>: <KPI1>, <KPI2>, <KPI3>"
 *   - Generator routes the role to a NetSuite Center (ACCOUNTING_CENTER
 *     for finance, SALES_CENTER for sales, etc.) via keyword matching.
 *   - For each KPI in the comma-separated list, the generator finds
 *     the savedsearch scriptid whose title contains the KPI name
 *     (case-insensitive substring) and binds it as a SEARCH_FORM portlet.
 *   - Unmatched KPIs are recorded in a comment block at the top of
 *     the dashboard XML — the consultant adds the missing search
 *     manually post-generation.
 *
 * Why a separate file vs. inlining in the saved-search generator?
 *   Saved searches stand alone — they're useful even without a
 *   dashboard pointing at them. Dashboards depend on the search set.
 *   Keeping the generators separate means the orchestrator can run
 *   them in dependency order (searches first, then dashboards) and
 *   each generator's tests stay focused.
 *
 * Sources:
 *   - NetSuite SDF publisheddashboard XML reference (Oracle docs).
 *   - NetSuite Center IDs: ACCOUNTING_CENTER, SALES_CENTER,
 *     INVENTORY_CENTER, PURCHASE_CENTER, MANUFACTURING_CENTER,
 *     EXECUTIVE_CENTER, CLASSIC.
 *   - Common NetSuite dashboard patterns (Oracle Help — Dashboards
 *     and Portlets).
 */

import type { EmittedSavedSearch } from './sdfSavedSearchGenerator.js';

export type CenterId =
  | 'ACCOUNTING_CENTER'
  | 'SALES_CENTER'
  | 'INVENTORY_CENTER'
  | 'PURCHASE_CENTER'
  | 'MANUFACTURING_CENTER'
  | 'EXECUTIVE_CENTER'
  | 'CLASSIC';

export interface DashboardGeneratorInput {
  /** Raw TEXTAREA from ns.design.roleDashboards. */
  roleDashboardsAnswer: string | null | undefined;
  /** Saved searches emitted upstream — drives KPI title matching. */
  savedSearches: ReadonlyArray<EmittedSavedSearch>;
}

export interface EmittedDashboard {
  filename: string;
  scriptid: string;
  roleName: string;
  center: CenterId;
  /** scriptids of savedsearch portlets bound on this dashboard. */
  matchedSearchScriptids: string[];
  /** KPI names from the wizard line that didn't match any savedsearch. */
  unmatchedKpis: string[];
}

export interface DashboardGeneratorOutput {
  files: Record<string, string>;
  emitted: EmittedDashboard[];
}

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
 * Role-to-Center keyword classifier. Order matters — most specific
 * phrase patterns first. Default is CLASSIC (NetSuite's catch-all UI
 * for non-role-specific users).
 */
export function inferCenter(roleName: string): CenterId {
  const lc = roleName.toLowerCase();
  // Finance roles
  if (/\b(cfo|controller|finance director|finance manager)\b/.test(lc)) return 'ACCOUNTING_CENTER';
  if (/\b(ap clerk|accounts payable|payable)\b/.test(lc)) return 'ACCOUNTING_CENTER';
  if (/\b(ar clerk|accounts receivable|receivable|collections)\b/.test(lc)) return 'ACCOUNTING_CENTER';
  // Sales
  if (/\b(sales|account exec|account manager|business dev)\b/.test(lc)) return 'SALES_CENTER';
  // Inventory / supply chain
  if (/\b(inventory|warehouse|supply chain)\b/.test(lc)) return 'INVENTORY_CENTER';
  // Procurement
  if (/\b(procurement|purchasing|buyer)\b/.test(lc)) return 'PURCHASE_CENTER';
  // Manufacturing
  if (/\b(manufacturing|production|plant)\b/.test(lc)) return 'MANUFACTURING_CENTER';
  // Executive
  if (/\b(executive|ceo|coo|cmo|cio)\b/.test(lc)) return 'EXECUTIVE_CENTER';
  return 'CLASSIC';
}

/**
 * Parse one role-dashboards line. Format: "<role>: <KPI1>, <KPI2>".
 * Returns null on bad format. KPI list is comma-separated; entries
 * are trimmed and empty entries dropped.
 */
interface ParsedRoleLine {
  roleName: string;
  kpis: string[];
}

function parseRoleLine(line: string): ParsedRoleLine | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  const m = trimmed.match(/^([^:]+):\s*(.+)$/);
  if (!m) return null;
  const roleName = m[1].trim();
  const kpis = m[2]
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (roleName.length === 0 || kpis.length === 0) return null;
  return { roleName, kpis };
}

/**
 * For each KPI in the role's list, find the first savedsearch whose
 * title contains the KPI name as a case-insensitive substring.
 * Returns matched scriptids (in KPI order) + unmatched KPI names
 * (preserved for the comment header).
 */
function matchKpisToSearches(
  kpis: string[],
  savedSearches: ReadonlyArray<EmittedSavedSearch>,
): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const kpi of kpis) {
    const kpiLc = kpi.toLowerCase();
    const hit = savedSearches.find((s) => s.title.toLowerCase().includes(kpiLc));
    if (hit) {
      matched.push(hit.scriptid);
    } else {
      unmatched.push(kpi);
    }
  }
  return { matched, unmatched };
}

// ─── XML emission ────────────────────────────────────────────────────────────

function buildDashboardXml(args: {
  scriptid: string;
  roleName: string;
  center: CenterId;
  matchedScriptids: string[];
  unmatchedKpis: string[];
  rawKpiList: string;
}): string {
  const portlets = args.matchedScriptids
    .map(
      (sid, i) => `        <portlet>
          <portlettype>SEARCH_FORM</portlettype>
          <column>${(i % 2) + 1}</column>
          <id>${sid}</id>
        </portlet>`,
    )
    .join('\n');
  const unmatchedNote =
    args.unmatchedKpis.length > 0
      ? args.unmatchedKpis.map((u) => `    - ${u}`).join('\n')
      : '    (none — every requested KPI bound to a savedsearch)';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Generated by ERPLaunch Dashboard Generator from wizard answer ns.design.roleDashboards.
  Role: ${xmlEscape(args.roleName)}
  Center: ${args.center}
  KPIs requested (verbatim): ${xmlEscape(args.rawKpiList)}
  Unmatched KPIs (consultant must add manually):
${unmatchedNote}
  Review before deploy:
    - Confirm portlet column placement (currently alternating col 1/2)
    - Add KPI Meter / Trend Graph portlets per role appetite
    - Set dashboard publish-target roles in NetSuite UI
-->
<publisheddashboard scriptid="${args.scriptid}">
  <center>${args.center}</center>
  <name>${xmlEscape(args.roleName)} Dashboard</name>
  <notes>Generated by ERPLaunch from wizard role-dashboards input.</notes>
  <dashboards>
    <dashboard>
      <centertab>SHORTCUTS</centertab>
      <mode>UNLOCKED</mode>
      <portlets>
${portlets}
      </portlets>
    </dashboard>
  </dashboards>
</publisheddashboard>
`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Emit one publisheddashboard XML per role declared in the wizard.
 * Empty / whitespace-only roleDashboardsAnswer → empty file map.
 * Bad-format lines are silently skipped (consultant fixes manually).
 *
 * KPI matching is best-effort substring against savedsearch titles.
 * Unmatched KPIs are preserved in the dashboard XML's comment header
 * so the consultant sees what's missing.
 */
export function generateDashboards(
  input: DashboardGeneratorInput,
): DashboardGeneratorOutput {
  const files: Record<string, string> = {};
  const emitted: EmittedDashboard[] = [];

  const raw = (input.roleDashboardsAnswer ?? '').toString();
  if (raw.trim().length === 0) return { files, emitted };

  const seenScriptids = new Set<string>();
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const parsed = parseRoleLine(line);
    if (!parsed) continue;

    let scriptidBase = `custpubdash_nsix_${slugify(parsed.roleName)}`;
    let scriptid = scriptidBase;
    let n = 2;
    while (seenScriptids.has(scriptid)) {
      scriptid = `${scriptidBase}_${n++}`;
    }
    seenScriptids.add(scriptid);

    const center = inferCenter(parsed.roleName);
    const { matched, unmatched } = matchKpisToSearches(parsed.kpis, input.savedSearches);

    const filename = `Objects/${scriptid}.xml`;
    files[filename] = buildDashboardXml({
      scriptid,
      roleName: parsed.roleName,
      center,
      matchedScriptids: matched,
      unmatchedKpis: unmatched,
      rawKpiList: parsed.kpis.join(', '),
    });
    emitted.push({
      filename,
      scriptid,
      roleName: parsed.roleName,
      center,
      matchedSearchScriptids: matched,
      unmatchedKpis: unmatched,
    });
  }

  return { files, emitted };
}
