/**
 * Phase 50.2 — Template token substitution engine.
 *
 * Reads a CustomTemplate body (markdown with `{{token}}` placeholders)
 * and emits rendered markdown with every supported token replaced
 * against the engagement + firm context. Unknown tokens render as
 * `[missing: token-name]` so the author sees what's broken instead of
 * silent emptiness.
 *
 * No template-language dependency (Mustache/Handlebars). The Phase 50
 * contract is intentionally narrow — flat `{{name.part}}` lookups, no
 * conditionals or loops. Conditional rendering + loops are explicitly
 * out of scope (deferred to Phase 51) so the renderer surface stays
 * small + auditable.
 *
 * Token vocabulary (spec'd at apps/api/src/services/templateRenderer.ts):
 *
 *   {{firm.name}}                  Firm.displayName ?? Firm.name
 *   {{firm.tagline}}               Firm.tagline (Phase 49)
 *   {{firm.contactEmail}}          Firm.supportEmail
 *   {{firm.logoUrl}}
 *   {{firm.primaryColor}}
 *   {{firm.secondaryColor}}
 *   {{engagement.client}}          Engagement.clientName
 *   {{engagement.code}}            Engagement.code
 *   {{engagement.status}}          current lifecycle stage
 *   {{engagement.startDate}}       formatted YYYY-MM-DD
 *   {{engagement.targetGoLive}}
 *   {{engagement.modules}}         comma-joined list
 *   {{engagement.cutoverStrategy}} BIG_BANG | PHASED
 *   {{client.lead.name}}           Client Lead from FirmRole
 *   {{client.sponsor.name}}        Client Sponsor
 *   {{consultant.lead.name}}       Implementation Lead
 *   {{decisions.signedOff}}        bullet list of signed-off Decisions
 *   {{decisions.pending}}          bullet list of pending Decisions
 *   {{risks.top5}}                 markdown table of top 5 risks by score
 *   {{actionItems.open}}           bullet list of open Action Items
 *   {{today}}                      current date in YYYY-MM-DD
 *
 * The engine builds the entire context once, then runs a single
 * regex substitution pass. Tokens that map to lists / tables are
 * pre-formatted to markdown so a template author doesn't need to
 * know markdown table syntax to surface them.
 */

import {
  findFirmById,
  findEngagementById,
  listDecisions,
  listRisks,
  listActionItems,
  getDb,
} from '../db/index.js';

/** Phase 50.2 — read the license modules for an engagement directly
 *  from the LicenseProfile table. Returns an empty array when no
 *  license row exists or the row's modules column doesn't parse. */
async function fetchEngagementModules(engagementId: string): Promise<string[]> {
  try {
    const db = getDb();
    const r = await db.execute({
      sql: `SELECT modules FROM LicenseProfile WHERE engagementId = ?`,
      args: [engagementId],
    });
    if (!r.rows[0]) return [];
    const raw = (r.rows[0] as { modules?: unknown }).modules;
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export interface RenderContext {
  firmId: string;
  engagementId: string;
  /** ISO date override for tests — defaults to today. */
  now?: Date;
}

export interface RenderResult {
  rendered: string;
  /** Each unique unknown token referenced by the body. Lets the UI
   *  surface "your template uses X tokens that don't exist" so the
   *  author can fix them before saving. */
  missingTokens: string[];
}

/**
 * Build the flat string→string token table for substitution. Public
 * for unit-testing without the regex pass.
 */
export async function buildTokenContext(
  ctx: RenderContext,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  // Firm — falls back to platform defaults when the firm row is
  // present but a field is null.
  const firm = await findFirmById(ctx.firmId).catch(() => null);
  if (firm) {
    const fr = firm as unknown as Record<string, unknown>;
    out.set('firm.name', (fr.displayName as string) ?? (fr.name as string) ?? '');
    out.set('firm.tagline', (fr.tagline as string | null) ?? '');
    out.set('firm.contactEmail', (fr.supportEmail as string | null) ?? '');
    out.set('firm.logoUrl', (fr.logoUrl as string | null) ?? '');
    out.set('firm.primaryColor', (fr.primaryColor as string | null) ?? '');
    out.set('firm.secondaryColor', (fr.secondaryColor as string | null) ?? '');
  }

  // Engagement.
  const eng = (await findEngagementById(ctx.engagementId).catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (eng) {
    out.set('engagement.client', (eng.clientName as string) ?? '');
    out.set('engagement.code', (eng.code as string | null) ?? '');
    out.set('engagement.status', (eng.status as string | null) ?? '');
    out.set(
      'engagement.startDate',
      formatDate(eng.startDate as string | null | undefined),
    );
    out.set(
      'engagement.targetGoLive',
      formatDate(eng.targetGoLive as string | null | undefined) ||
        ((eng.targetGoLive as string | null) ?? ''),
    );
    // Modules come from the separate LicenseProfile table (joined via
    // engagementId). Defaults to an empty list when no license has
    // been written yet — the template renders "Modules: " rather than
    // "Modules: [missing]" since the absence is meaningful.
    const modules = await fetchEngagementModules(ctx.engagementId);
    out.set('engagement.modules', modules.join(', '));
    out.set(
      'engagement.cutoverStrategy',
      (eng.cutoverStrategy as string | null) ?? '',
    );
  }

  // People — resolved from engagement-scope FirmRoles when present.
  // listEngagementUsersByRole is the canonical Phase 45.3 helper; we
  // call it via the lazily-imported rbac module to avoid pulling RBAC
  // typing through tests that don't need it.
  try {
    const { listEngagementUsersByRole } = await import('../db/rbac.js');
    const leads = await listEngagementUsersByRole(
      ctx.engagementId,
      'CLIENT_LEAD',
    ).catch(() => []);
    out.set('client.lead.name', leads[0]?.name ?? '');

    const sponsors = await listEngagementUsersByRole(
      ctx.engagementId,
      'CLIENT_SPONSOR',
    ).catch(() => []);
    out.set('client.sponsor.name', sponsors[0]?.name ?? '');

    const consultantLeads = await listEngagementUsersByRole(
      ctx.engagementId,
      'PROJECT_LEAD',
    ).catch(() => []);
    out.set('consultant.lead.name', consultantLeads[0]?.name ?? '');
  } catch {
    // RBAC roles may not exist in older engagements — leave the keys
    // unset so the substitution pass surfaces them as missing tokens
    // rather than silently rendering empty.
  }

  // Decisions — signed-off + pending lists.
  const decisions = (await listDecisions(ctx.engagementId).catch(() => [])) as Array<
    Record<string, unknown>
  >;
  const signedOff = decisions.filter(
    (d) => (d.clientSignoffStatus as string | null) === 'SIGNED',
  );
  const pending = decisions.filter(
    (d) =>
      !d.clientSignoffStatus ||
      d.clientSignoffStatus === 'NONE' ||
      d.clientSignoffStatus === 'PENDING',
  );
  out.set('decisions.signedOff', formatDecisionList(signedOff, 'signedOff'));
  out.set('decisions.pending', formatDecisionList(pending, 'pending'));

  // Risks — top 5 by score (probability × impact, where HIGH=3, MEDIUM=2, LOW=1).
  const risks = (await listRisks(ctx.engagementId).catch(() => [])) as Array<
    Record<string, unknown>
  >;
  const scoredRisks = risks
    .map((r) => ({ row: r, score: riskScore(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.row);
  out.set('risks.top5', formatRiskTable(scoredRisks));

  // Action items — open only.
  const actions = (await listActionItems(ctx.engagementId).catch(() => [])) as Array<
    Record<string, unknown>
  >;
  const openActions = actions.filter(
    (a) => (a.status as string | null) !== 'DONE' && (a.status as string | null) !== 'CANCELLED',
  );
  out.set('actionItems.open', formatActionItemList(openActions));

  // System.
  const today = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  out.set('today', today);

  return out;
}

/**
 * Substitute every `{{token}}` in the body against the prebuilt
 * context. Unknown tokens render as `[missing: token-name]`. Tokens
 * that map to an explicit empty string (e.g. a firm with no tagline)
 * render as the empty string — NOT as [missing] — so a "configure
 * your firm to populate this" UX is up to the template author.
 */
export async function renderTemplate(
  body: string,
  ctx: RenderContext,
): Promise<RenderResult> {
  if (!body || body.length === 0) {
    return { rendered: '', missingTokens: [] };
  }
  const tokens = await buildTokenContext(ctx);
  const missing = new Set<string>();
  const rendered = body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, name) => {
    if (tokens.has(name)) {
      return tokens.get(name) ?? '';
    }
    missing.add(name);
    return `[missing: ${name}]`;
  });
  return { rendered, missingTokens: [...missing].sort() };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatDate(input: string | null | undefined): string {
  if (!input) return '';
  // Accept ISO 8601 or YYYY-MM-DD. Anything that doesn't parse becomes
  // the trimmed input — the template author sees their raw value
  // rather than a silent empty string.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input.trim();
  return d.toISOString().slice(0, 10);
}

function formatDecisionList(
  decisions: ReadonlyArray<Record<string, unknown>>,
  variant: 'signedOff' | 'pending',
): string {
  if (decisions.length === 0) {
    return variant === 'signedOff'
      ? '_No decisions signed off yet._'
      : '_No pending decisions._';
  }
  return decisions
    .map((d) => {
      const title = (d.title as string) ?? 'Untitled decision';
      if (variant === 'signedOff') {
        const at = (d.clientSignoffAt as string | null) ?? '';
        const dateBit = at ? ` — ${formatDate(at)}` : '';
        return `- ${title}${dateBit}`;
      }
      return `- ${title}`;
    })
    .join('\n');
}

const PROBABILITY_SCORE: Record<string, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  CRITICAL: 4,
};

function riskScore(r: Record<string, unknown>): number {
  const p = PROBABILITY_SCORE[(r.probability as string) ?? 'MEDIUM'] ?? 2;
  const i = PROBABILITY_SCORE[(r.impact as string) ?? 'MEDIUM'] ?? 2;
  return p * i;
}

function formatRiskTable(risks: ReadonlyArray<Record<string, unknown>>): string {
  if (risks.length === 0) return '_No risks recorded._';
  const header =
    '| Risk | Probability | Impact | Owner | Mitigation |\n| --- | --- | --- | --- | --- |';
  const rows = risks
    .map(
      (r) =>
        `| ${escapeCell(r.title)} | ${escapeCell(r.probability ?? 'MEDIUM')} | ${escapeCell(
          r.impact ?? 'MEDIUM',
        )} | ${escapeCell(r.owner ?? '—')} | ${escapeCell(r.mitigation ?? '—')} |`,
    )
    .join('\n');
  return `${header}\n${rows}`;
}

function escapeCell(v: unknown): string {
  if (v == null) return '';
  // Pipes break markdown tables — escape them. Newlines collapse to
  // spaces so a multi-line mitigation note doesn't wrap into a new
  // table row.
  return String(v).replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function formatActionItemList(items: ReadonlyArray<Record<string, unknown>>): string {
  if (items.length === 0) return '_No open action items._';
  return items
    .map((a) => {
      const title = (a.title as string) ?? 'Untitled';
      const dueRaw = a.dueDate as string | null | undefined;
      const due = dueRaw ? ` (due ${formatDate(dueRaw)})` : '';
      const owner = (a.owner as string | null) ?? null;
      const ownerBit = owner ? ` — @${owner}` : '';
      return `- ${title}${due}${ownerBit}`;
    })
    .join('\n');
}

// ─── Token catalog ──────────────────────────────────────────────────────────
//
// Public list used by the Phase 50.5 variable-palette UI so the editor
// can render chips for every known token without re-deriving the names
// from the renderer.

export const TOKEN_CATALOG: ReadonlyArray<{
  group: 'Firm' | 'Engagement' | 'People' | 'Decisions' | 'Risks' | 'Action Items' | 'System';
  token: string;
  description: string;
}> = [
  { group: 'Firm', token: 'firm.name', description: 'Display name (falls back to legal name).' },
  { group: 'Firm', token: 'firm.tagline', description: 'Tagline from the Brand Pack.' },
  { group: 'Firm', token: 'firm.contactEmail', description: 'Firm support email.' },
  { group: 'Firm', token: 'firm.logoUrl', description: 'Firm logo URL.' },
  { group: 'Firm', token: 'firm.primaryColor', description: 'Primary brand color (hex).' },
  { group: 'Firm', token: 'firm.secondaryColor', description: 'Secondary brand color (hex).' },

  { group: 'Engagement', token: 'engagement.client', description: 'Client / company name.' },
  { group: 'Engagement', token: 'engagement.code', description: 'Internal engagement code.' },
  { group: 'Engagement', token: 'engagement.status', description: 'Current lifecycle stage.' },
  { group: 'Engagement', token: 'engagement.startDate', description: 'Kickoff date (YYYY-MM-DD).' },
  { group: 'Engagement', token: 'engagement.targetGoLive', description: 'Target go-live (YYYY-MM-DD).' },
  { group: 'Engagement', token: 'engagement.modules', description: 'Comma-joined list of licensed modules.' },
  { group: 'Engagement', token: 'engagement.cutoverStrategy', description: 'BIG_BANG | PHASED.' },

  { group: 'People', token: 'client.lead.name', description: 'Client-side project lead.' },
  { group: 'People', token: 'client.sponsor.name', description: 'Client-side sponsor.' },
  { group: 'People', token: 'consultant.lead.name', description: 'Firm-side implementation lead.' },

  { group: 'Decisions', token: 'decisions.signedOff', description: 'Bullet list of signed-off decisions.' },
  { group: 'Decisions', token: 'decisions.pending', description: 'Bullet list of pending decisions.' },

  { group: 'Risks', token: 'risks.top5', description: 'Markdown table of top 5 risks by score.' },

  { group: 'Action Items', token: 'actionItems.open', description: 'Bullet list of open action items.' },

  { group: 'System', token: 'today', description: 'Current date (YYYY-MM-DD).' },
];
