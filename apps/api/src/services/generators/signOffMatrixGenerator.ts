/**
 * Sign-off Matrix generator (Pack T — Test Artifacts, Component 3).
 *
 * Cross-platform — emits a single Documentation/Sign_Off_Matrix.md (+ .html)
 * with three sub-tables:
 *   1. Per-workstream sign-off rows (auto-derived from
 *      testing.scenariosPerWorkstream — one row per distinct workstream).
 *   2. Per-role sign-off rows (auto-derived from testing.testRoles +
 *      ns.design.standardRoleCustomization role list).
 *   3. Final UAT sign-off block (sponsor + client PM + consultant PM).
 *
 * Project members are pulled from the engagement so the table is wired
 * with real names where possible (CLIENT team rows = client testers /
 * approvers; CONSULTANT team rows = consultant approvers).
 *
 * Sources:
 *   - PMI / PMBOK gate-review sign-off practice.
 *   - SuiteSuccess + Odoo Implementation Methodology — UAT sign-off
 *     pattern (workstream + role grids before final go/no-go).
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export interface SignOffMember {
  name: string;
  role: string;
  /** CLIENT or CONSULTANT — drives which column the member lands in. */
  team: string;
}

export interface SignOffMatrixGeneratorInput {
  clientName: string;
  /** TEXTAREA testing.scenariosPerWorkstream — drives workstream rows. */
  scenariosPerWorkstream?: string | null;
  /** TEXTAREA testing.testRoles — primary source for per-role rows. */
  testRoles?: string | null;
  /** TEXTAREA ns.design.standardRoleCustomization — supplementary role
   *  list (when present). One role per line, format
   *  "<role>: <customization notes>". */
  standardRoleCustomization?: string | null;
  /** Engagement project members. Used to populate Tester/Approver columns. */
  members?: ReadonlyArray<SignOffMember>;
  /** "NetSuite" / "Odoo" / etc — flavours the page header. */
  adaptorName?: string;
}

export interface SignOffMatrixGeneratorOutput {
  markdown: string;
  html: string;
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

const SCENARIO_LINE = /^([\w]+):\s*([^:]+):\s*(.+)$/;

interface WorkstreamRow {
  workstream: string;
  scenarioCount: number;
}

function parseWorkstreams(raw: string): WorkstreamRow[] {
  const counts = new Map<string, number>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(SCENARIO_LINE);
    if (!m) continue;
    const ws = m[1].toUpperCase();
    counts.set(ws, (counts.get(ws) ?? 0) + 1);
  }
  // Canonical order — common workstream IDs first, then alphabetical.
  const canonical = ['R2R', 'P2P', 'O2C', 'MFG', 'RTN', 'INV', 'CRM', 'HR'];
  const ordered: WorkstreamRow[] = [];
  for (const ws of canonical) {
    if (counts.has(ws)) ordered.push({ workstream: ws, scenarioCount: counts.get(ws)! });
  }
  for (const ws of [...counts.keys()].filter((w) => !canonical.includes(w)).sort()) {
    ordered.push({ workstream: ws, scenarioCount: counts.get(ws)! });
  }
  return ordered;
}

interface RoleRow {
  role: string;
  /** Optional context (e.g., responsibility from testRoles). */
  context: string;
}

function parseRoles(testRoles: string, standardRoles: string): RoleRow[] {
  const rows: RoleRow[] = [];
  const seen = new Set<string>();

  // Test roles first — they're the primary source.
  for (const line of testRoles.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const role = trimmed.slice(0, colonIdx).trim();
    const context = trimmed.slice(colonIdx + 1).trim();
    if (seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    rows.push({ role, context });
  }

  // Supplement from standardRoleCustomization (Pack C answer) — captures
  // roles the consultant declared but didn't add a tester for. Strip
  // quotes that may wrap "Approve Bills" etc.
  const cleaned = standardRoles.replace(/["'""''']/g, ' ');
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const role = trimmed.slice(0, colonIdx).trim();
    if (seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    rows.push({ role, context: 'Permissions: see Solution Design' });
  }

  return rows;
}

// ─── Member resolution ───────────────────────────────────────────────────────

interface ResolvedMembers {
  clientLeadByWorkstream: Map<string, SignOffMember>;
  clientSponsor?: SignOffMember;
  clientPM?: SignOffMember;
  consultantPM?: SignOffMember;
}

const WORKSTREAM_HINTS: Record<string, string[]> = {
  R2R: ['accounting', 'finance', 'r2r', 'controller'],
  P2P: ['p2p', 'procure', 'procurement', 'ap', 'payable'],
  O2C: ['o2c', 'sales', 'ar', 'receivable', 'customer'],
  MFG: ['mfg', 'manufactur', 'production', 'mrp'],
  RTN: ['return', 'rma'],
  INV: ['inventory', 'logistics', 'warehouse'],
  CRM: ['crm'],
  HR: ['hr', 'people', 'payroll'],
};

function resolveMembers(members: ReadonlyArray<SignOffMember>): ResolvedMembers {
  const out: ResolvedMembers = { clientLeadByWorkstream: new Map() };

  for (const m of members) {
    const lc = `${m.role} ${m.name}`.toLowerCase();
    const team = m.team.toUpperCase();

    if (team === 'CLIENT') {
      if (!out.clientSponsor && /(sponsor|cfo|ceo)/.test(lc)) {
        out.clientSponsor = m;
      }
      if (!out.clientPM && /(project manager|client pm|controller)/.test(lc)) {
        out.clientPM = m;
      }
      for (const [ws, hints] of Object.entries(WORKSTREAM_HINTS)) {
        if (out.clientLeadByWorkstream.has(ws)) continue;
        if (hints.some((h) => lc.includes(h))) {
          out.clientLeadByWorkstream.set(ws, m);
        }
      }
    } else if (team === 'CONSULTANT') {
      if (!out.consultantPM && /(project manager|consultant pm)/.test(lc)) {
        out.consultantPM = m;
      }
    }
  }

  return out;
}

function memberCell(m?: SignOffMember): string {
  if (!m) return '_[ASSIGN]_';
  return `${m.name} _(${m.role})_`;
}

// ─── Markdown emission ───────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  workstreamRows: WorkstreamRow[];
  roleRows: RoleRow[];
  resolved: ResolvedMembers;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'ERP';
  const date = new Date().toLocaleDateString();

  // Per-workstream rows — use resolved client lead if known, sponsor for
  // approver, consultant PM as the consultant approver.
  const workstreamRowsMd =
    args.workstreamRows.length === 0
      ? '| _(no scenarios captured)_ | 0 | _[ASSIGN]_ | _[ASSIGN]_ | _[ASSIGN]_ | ⏳ Pending |  |'
      : args.workstreamRows
          .map((row) => {
            const lead = args.resolved.clientLeadByWorkstream.get(row.workstream);
            return `| ${row.workstream} | ${row.scenarioCount} scenario${row.scenarioCount === 1 ? '' : 's'} | ${memberCell(lead)} | ${memberCell(args.resolved.clientSponsor)} | ${memberCell(args.resolved.consultantPM)} | ⏳ Pending |  |`;
          })
          .join('\n');

  const roleRowsMd =
    args.roleRows.length === 0
      ? '| _(no roles captured)_ | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |'
      : args.roleRows
          .map((r) => `| ${r.role} | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ |`)
          .join('\n');

  return [
    `# UAT Sign-off Matrix — ${args.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Date:** ${date}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    'This matrix tracks per-workstream and per-role User Acceptance Test sign-off. ',
    'Each test scenario in `Documentation/Test_Scripts/` rolls up to one workstream row; ',
    'each role declared in the wizard rolls up to one role row. Final go/no-go requires ',
    'both grids signed plus the explicit project-sponsor + PM block at the bottom.',
    '',
    '## 1. Per-Workstream Sign-off',
    '',
    '| Workstream | Test Scenarios | UAT Tester (Client) | Approver (Client) | Approver (Consultant) | Status | Date |',
    '|------------|----------------|---------------------|---------------------|------------------------|--------|------|',
    workstreamRowsMd,
    '',
    '## 2. Per-Role Sign-off',
    '',
    'Each role logs in, exercises their primary workflow, runs reports they own, and confirms permission boundaries.',
    '',
    '| Role | Login Test | Primary Workflow Test | Reports Access Test | Permissions Test | Sign-off |',
    '|------|------------|-----------------------|---------------------|------------------|----------|',
    roleRowsMd,
    '',
    '## 3. Final UAT Sign-off',
    '',
    '- [ ] All workstream scenarios tested + signed',
    '- [ ] All role-based scenarios tested + signed',
    '- [ ] Performance benchmarks met (see `Performance_Test_Plan.md`)',
    '- [ ] Regression smoke pass (see `Regression_Test_Suite.md`)',
    '- [ ] All Critical / High defects resolved or accepted as known issues (see `Defect_Log_Template.md`)',
    '',
    `**Project Sponsor approval:** ${memberCell(args.resolved.clientSponsor)}    Date: __________`,
    '',
    `**Client PM approval:** ${memberCell(args.resolved.clientPM)}    Date: __________`,
    '',
    `**Consultant PM approval:** ${memberCell(args.resolved.consultantPM)}    Date: __________`,
    '',
    '_Generated by ERPLaunch — Pack T (Test Artifacts)._',
    '',
  ].join('\n');
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UAT Sign-off Matrix — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 960px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 16px; }
    thead { background: #1e40af; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 12px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
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

export function generateSignOffMatrix(input: SignOffMatrixGeneratorInput): SignOffMatrixGeneratorOutput {
  const workstreamRows = parseWorkstreams((input.scenariosPerWorkstream ?? '').toString());
  const roleRows = parseRoles(
    (input.testRoles ?? '').toString(),
    (input.standardRoleCustomization ?? '').toString(),
  );
  const resolved = resolveMembers(input.members ?? []);
  const adaptorName = (input.adaptorName ?? '').toString();

  const markdown = buildMarkdown({
    clientName: input.clientName,
    adaptorName,
    workstreamRows,
    roleRows,
    resolved,
  });

  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html };
}
