/**
 * Training Matrix generator (Pack U — Training Collateral, Component 4).
 *
 * Cross-platform — single Documentation/Training_Matrix.md (+ .html).
 * Renders a per-role × per-workstream coverage grid (✓ Required / View
 * / —) plus per-role total-hours summary. Drives engagement training-
 * planning conversations: who needs what, how long, in which order.
 *
 * Workstream coverage per role family is the canonical mapping in
 * trainingRoleFamilies.ts. The matrix grid columns are filtered by
 * which workstreams are actually in scope for the engagement (driven
 * by wizard answers — same predicates as Pack U's QRC generator).
 *
 * Sources:
 *   - ADDIE — Analyze step (audience analysis × scope analysis = matrix).
 *   - Standard ERP training planning practice (SuiteSuccess, SAP
 *     Activate role-based training matrix).
 */

import MarkdownIt from 'markdown-it';
import {
  classifyRoleFamily,
  type CoverageLevel,
  type Workstream,
} from './trainingRoleFamilies.js';

const md = new MarkdownIt({ html: true, typographer: true });

export interface TrainingMatrixGeneratorInput {
  clientName: string;
  adaptorName?: string;
  /** TEXTAREA training.curriculum.trainingPerRole — primary role list. */
  trainingPerRole?: string | null;
  /** TEXTAREA ns.design.standardRoleCustomization — supplementary roles. */
  standardRoleCustomization?: string | null;
  /** Wizard answers — drive workstream-in-scope filtering. */
  r2rInScope?: boolean;
  p2pInScope?: boolean;
  o2cInScope?: boolean;
  invInScope?: boolean;
  mfgInScope?: boolean;
  rtnInScope?: boolean;
  crmInScope?: boolean;
  hrInScope?: boolean;
  itInScope?: boolean;
}

export interface TrainingMatrixGeneratorOutput {
  markdown: string;
  html: string;
}

// ─── Role parsing (shared shape with perRoleTrainingGuideGenerator) ─────────

const ROLE_LINE = /^([^:]+):\s*(.*)$/;

function parseRoleNames(
  trainingPerRole: string,
  standardRoleCustomization: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const line of trainingPerRole.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(ROLE_LINE);
    if (!m) continue;
    const role = m[1].trim();
    if (role.length === 0 || seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    out.push(role);
  }

  const cleaned = standardRoleCustomization.replace(/["'""''']/g, ' ');
  for (const line of cleaned.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const role = trimmed.slice(0, colonIdx).trim();
    if (role.length === 0 || seen.has(role.toLowerCase())) continue;
    seen.add(role.toLowerCase());
    out.push(role);
  }

  return out;
}

// ─── Workstream column filter ───────────────────────────────────────────────

const ALL_WORKSTREAMS: ReadonlyArray<{ id: Workstream; label: string; flag: keyof TrainingMatrixGeneratorInput }> = [
  { id: 'R2R', label: 'R2R', flag: 'r2rInScope' },
  { id: 'P2P', label: 'P2P', flag: 'p2pInScope' },
  { id: 'O2C', label: 'O2C', flag: 'o2cInScope' },
  { id: 'INV', label: 'Inventory', flag: 'invInScope' },
  { id: 'MFG', label: 'MFG', flag: 'mfgInScope' },
  { id: 'RTN', label: 'Returns', flag: 'rtnInScope' },
  { id: 'CRM', label: 'CRM', flag: 'crmInScope' },
  { id: 'HR', label: 'HR', flag: 'hrInScope' },
  { id: 'IT', label: 'IT', flag: 'itInScope' },
];

function workstreamsInScope(
  input: TrainingMatrixGeneratorInput,
): ReadonlyArray<{ id: Workstream; label: string }> {
  // Default policy: when NO workstream flag is provided, render ALL
  // workstream columns (matrix is best-guess complete). When ANY flag
  // is provided, render only the ones explicitly true.
  const anyProvided = ALL_WORKSTREAMS.some((ws) => input[ws.flag] === true || input[ws.flag] === false);
  if (!anyProvided) {
    return ALL_WORKSTREAMS.map(({ id, label }) => ({ id, label }));
  }
  return ALL_WORKSTREAMS.filter((ws) => input[ws.flag] === true).map(({ id, label }) => ({ id, label }));
}

// ─── Cell rendering ─────────────────────────────────────────────────────────

function cell(level: CoverageLevel): string {
  switch (level) {
    case 'REQUIRED':
      return '✓ Required';
    case 'VIEW':
      return 'View';
    case 'NONE':
    default:
      return '—';
  }
}

// ─── Markdown emission ──────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  roles: string[];
  workstreams: ReadonlyArray<{ id: Workstream; label: string }>;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'ERP';

  const headerCols = ['Role', ...args.workstreams.map((w) => w.label), 'Custom Records', 'Reports'];
  const headerRow = `| ${headerCols.join(' | ')} |`;
  const alignRow = `| ${headerCols.map((c, i) => (i === 0 ? ':---' : ':---:')).join(' | ')} |`;

  const dataRows =
    args.roles.length === 0
      ? `| _(no roles captured)_ |${args.workstreams.map(() => ' — |').join('')} — | — |`
      : args.roles
          .map((role) => {
            const family = classifyRoleFamily(role);
            const cells: string[] = [role];
            for (const ws of args.workstreams) {
              cells.push(cell(family.coverage[ws.id]));
            }
            // Custom Records column — REQUIRED for IT family (admin
            // owns the schema), View for finance-broad + quality, None
            // for everyone else.
            const crLevel: CoverageLevel =
              family.family === 'IT' ? 'REQUIRED'
              : family.family === 'FINANCE_BROAD' || family.family === 'QUALITY' ? 'VIEW'
              : 'NONE';
            cells.push(cell(crLevel));
            // Reports column — REQUIRED for finance-broad, View for
            // sales/inventory/quality leads, None for transactional roles.
            const reportLevel: CoverageLevel =
              family.family === 'FINANCE_BROAD' ? 'REQUIRED'
              : family.family === 'SALES' || family.family === 'INVENTORY' || family.family === 'QUALITY' ? 'VIEW'
              : 'NONE';
            cells.push(cell(reportLevel));
            return `| ${cells.join(' | ')} |`;
          })
          .join('\n');

  const hoursRows =
    args.roles.length === 0
      ? '| _(no roles captured)_ | — |'
      : args.roles
          .map((role) => {
            const family = classifyRoleFamily(role);
            return `| ${role} | ${family.estimatedHours}h |`;
          })
          .join('\n');

  return [
    `# Training Matrix — ${args.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Date:** ${new Date().toLocaleDateString()}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    'Per-role × per-workstream coverage grid. Drives the training plan: ',
    'who needs full curriculum, who needs awareness only, and who is out of scope. ',
    'Each cell maps to the canonical curriculum captured in `Documentation/Training/<Role>_Training_Guide.md`.',
    '',
    '## 1. Role × Workstream Coverage',
    '',
    headerRow,
    alignRow,
    dataRows,
    '',
    '## 2. Legend',
    '',
    '- **✓ Required**: Full curriculum + hands-on lab + assessment.',
    '- **View**: Read-only awareness training (~30 min).',
    '- **—**: Not applicable for this role.',
    '',
    '## 3. Total Training Hours per Role',
    '',
    '| Role | Total Hours |',
    '|------|------------:|',
    hoursRows,
    '',
    '## 4. Cross-References',
    '',
    '- Per-role detail: `Documentation/Training/<Role>_Training_Guide.md` (one per row above)',
    '- Quick reference cards: `Documentation/Training/Quick_Reference_Cards/`',
    '- Training schedule: `Documentation/Training_Schedule.md`',
    '- Sign-off matrix: `Documentation/Sign_Off_Matrix.md`',
    '',
    '_Generated by ERPLaunch — Pack U (Training Collateral)._',
    '',
  ].join('\n');
}

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Matrix — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 1100px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 20px; }
    thead { background: #065f46; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 700; color: #065f46; }
    ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
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

export function generateTrainingMatrix(
  input: TrainingMatrixGeneratorInput,
): TrainingMatrixGeneratorOutput {
  const roles = parseRoleNames(
    (input.trainingPerRole ?? '').toString(),
    (input.standardRoleCustomization ?? '').toString(),
  );
  const workstreams = workstreamsInScope(input);
  const adaptorName = (input.adaptorName ?? '').toString();

  const markdown = buildMarkdown({
    clientName: input.clientName,
    adaptorName,
    roles,
    workstreams,
  });
  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html };
}
