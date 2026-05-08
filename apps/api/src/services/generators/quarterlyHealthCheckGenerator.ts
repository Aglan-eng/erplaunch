/**
 * Phase 45.7 — Quarterly Health Check generator.
 *
 * Pure function — `generateQuarterlyHealthCheck(input)` returns a
 * Record<filepath, content> the route layer writes to disk. Mirrors
 * the Phase 45.2 HANDOFF_PACKAGE generator's shape so processJob can
 * dispatch them through identical machinery.
 *
 * The bundle is intended to be regenerated quarterly while an
 * engagement is in SLA_ACTIVE — it summarises ticket KPIs, rolls up
 * open issues, lists recent stage / role / closeout activity, and
 * suggests recommended next actions for the upcoming quarter.
 *
 *   Documentation/
 *     Engagement_Summary.md         — client + adaptor + license at a glance
 *     SLA_Performance.md            — ticket counts, breach rates, MTTR
 *     Open_Issues.md                — open IssueItem rollup by priority
 *     Recent_Activity.md            — last 30 days of activity log
 *     Recommended_Actions.md        — derived next-quarter punch list
 *
 * Inputs are intentionally light — the route layer hydrates them from
 * the DB (engagement, tickets, issues, activity log) so the generator
 * stays testable without booting libSQL.
 */

export interface QuarterlyHealthCheckInput {
  clientName: string;
  adaptorId: string;
  adaptorName: string;
  license: { edition?: string; modules: string[] };
  preparedAt: string; // ISO date — anchors the "this quarter" window

  /** Resolved + closed tickets in the period, with createdAt/firstResolvedAt. */
  resolvedTickets: ReadonlyArray<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    createdAt: string;
    firstResolvedAt: string | null;
    /** Whether the ticket breached its first-response or resolution
     *  target. The generator only summarises — the breach computation
     *  itself lives in services/ticketSla.ts. */
    breached: boolean;
  }>;
  /** Currently open tickets (not RESOLVED or CLOSED). */
  openTickets: ReadonlyArray<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    daysOpen: number;
  }>;
  /** Open IssueItem rows for the engagement. */
  openIssues: ReadonlyArray<{
    title: string;
    priority: string;
    owner?: string | null;
  }>;
  /** Recent ActivityLog entries — newest first. The generator caps
   *  this at 30 rows when rendering. */
  recentActivity: ReadonlyArray<{ action: string; details: string; createdAt: string }>;
}

const HOUR_MS = 3_600_000;

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function md(s: string): string {
  return s.trim() + '\n';
}

export function generateQuarterlyHealthCheck(
  input: QuarterlyHealthCheckInput,
): Record<string, string> {
  const out: Record<string, string> = {};

  // ── Engagement_Summary ──────────────────────────────────────────────────
  out['Documentation/Engagement_Summary.md'] = md(`
# Engagement Summary — ${input.clientName}

**Prepared on:** ${input.preparedAt}
**Platform:** ${input.adaptorName} (\`${input.adaptorId}\`)
**Edition:** ${input.license.edition ?? '—'}
**Modules:** ${input.license.modules.length === 0 ? '—' : input.license.modules.join(', ')}

This document is the regular health-check report for the SLA period
ending ${input.preparedAt}. Read alongside \`SLA_Performance.md\` and
\`Recommended_Actions.md\` for the next-quarter plan.
`);

  // ── SLA_Performance ─────────────────────────────────────────────────────
  const counts = countBySeverity(input.resolvedTickets);
  const breached = input.resolvedTickets.filter((t) => t.breached).length;
  const breachRatePct = input.resolvedTickets.length === 0
    ? 0
    : Math.round((breached / input.resolvedTickets.length) * 1000) / 10;

  const mttrHours = avg(
    input.resolvedTickets
      .filter((t) => t.firstResolvedAt)
      .map((t) =>
        (new Date(t.firstResolvedAt as string).getTime() - new Date(t.createdAt).getTime()) / HOUR_MS,
      ),
  );

  out['Documentation/SLA_Performance.md'] = md(`
# SLA Performance

| Metric | Value |
| --- | --- |
| Tickets resolved in period | ${input.resolvedTickets.length} |
| Tickets currently open | ${input.openTickets.length} |
| Breach rate | ${breachRatePct}% |
| Mean time to first resolution | ${mttrHours === 0 ? '—' : `${mttrHours.toFixed(1)}h`} |

## Resolved tickets by severity

| Severity | Count |
| --- | --- |
| CRITICAL | ${counts.CRITICAL} |
| HIGH | ${counts.HIGH} |
| MEDIUM | ${counts.MEDIUM} |
| LOW | ${counts.LOW} |

${
  breached === 0
    ? '_No SLA breaches recorded in the period — clean quarter._'
    : `_${breached} ticket${breached === 1 ? '' : 's'} breached SLA — see Recommended Actions._`
}
`);

  // ── Open_Issues ─────────────────────────────────────────────────────────
  out['Documentation/Open_Issues.md'] = md(`
# Open Issues

${
  input.openIssues.length === 0
    ? '_No open issues on the engagement at the time of this report._'
    : '| Title | Priority | Owner |\n| --- | --- | --- |\n' +
      input.openIssues
        .map((i) => `| ${escapePipe(i.title)} | ${i.priority} | ${i.owner ?? '—'} |`)
        .join('\n')
}

## Open tickets at report time

${
  input.openTickets.length === 0
    ? '_No tickets currently open._'
    : '| Title | Severity | Days open |\n| --- | --- | --- |\n' +
      input.openTickets
        .map((t) => `| ${escapePipe(t.title)} | ${t.severity} | ${t.daysOpen} |`)
        .join('\n')
}
`);

  // ── Recent_Activity ─────────────────────────────────────────────────────
  const recent = input.recentActivity.slice(0, 30);
  out['Documentation/Recent_Activity.md'] = md(`
# Recent Activity (last 30 entries)

${
  recent.length === 0
    ? '_No activity recorded in the period._'
    : '| Date | Action | Details |\n| --- | --- | --- |\n' +
      recent
        .map((a) => `| ${fmtDate(a.createdAt)} | ${a.action} | ${escapePipe(a.details ?? '')} |`)
        .join('\n')
}
`);

  // ── Recommended_Actions ─────────────────────────────────────────────────
  const recs: string[] = [];
  if (breached > 0) {
    recs.push(
      `Review the ${breached} SLA breach${breached === 1 ? '' : 'es'} from this quarter and identify a root cause — recurring breaches often point to a documentation gap or a missing runbook step.`,
    );
  }
  const oldOpen = input.openTickets.filter((t) => t.daysOpen >= 14);
  if (oldOpen.length > 0) {
    recs.push(
      `${oldOpen.length} ticket${oldOpen.length === 1 ? '' : 's'} have been open for 14+ days — escalate or close as appropriate.`,
    );
  }
  const criticalOpen = input.openIssues.filter((i) => i.priority === 'CRITICAL');
  if (criticalOpen.length > 0) {
    recs.push(
      `${criticalOpen.length} critical issue${criticalOpen.length === 1 ? '' : 's'} remain open — these block the engagement's GREEN status on the SLA dashboard.`,
    );
  }
  if (recs.length === 0) {
    recs.push(
      'No outstanding risks flagged for the next quarter. Continue the current cadence; check renewal pipeline (Phase 45.8) for upsell opportunities.',
    );
  }

  out['Documentation/Recommended_Actions.md'] = md(`
# Recommended Actions for Next Quarter

${recs.map((r, i) => `${i + 1}. ${r}`).join('\n')}
`);

  return out;
}

interface SeverityCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

function countBySeverity(
  rows: ReadonlyArray<{ severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }>,
): SeverityCounts {
  const c: SeverityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of rows) c[r.severity]++;
  return c;
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|');
}
