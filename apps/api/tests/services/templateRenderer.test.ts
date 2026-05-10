/**
 * Phase 50.2 — templateRenderer tests.
 *
 * Pin the token vocabulary, missing-token sentinel format, table /
 * list formatting, and the empty-body edge case.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  renderTemplate,
  buildTokenContext,
  TOKEN_CATALOG,
} from '../../src/services/templateRenderer.js';
import {
  getDb,
  createRisk,
  createDecision,
  createActionItem,
  updateDecisionSignoff,
} from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute('DELETE FROM ActionItem');
  await db.execute('DELETE FROM RiskItem');
  await db.execute('DELETE FROM DecisionItem');
  await db.execute('DELETE FROM LicenseProfile');
  await db.execute('DELETE FROM Engagement');
  await db.execute('DELETE FROM FirmRole');
  await db.execute('DELETE FROM EngagementRole');
  await db.execute('DELETE FROM User');
  await db.execute('DELETE FROM Firm');
});

async function seedFirm(opts?: {
  displayName?: string;
  tagline?: string;
  primaryColor?: string;
}): Promise<string> {
  const db = getDb();
  const firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, displayName, tagline, primaryColor, supportEmail, createdAt)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      firmId,
      'Internal Name',
      `f-${createId()}`,
      'STARTER',
      opts?.displayName ?? 'Xelerate',
      opts?.tagline ?? 'Outcome-first ERP delivery.',
      opts?.primaryColor ?? '#0A1A2F',
      'support@xelerate.example',
      new Date().toISOString(),
    ],
  });
  return firmId;
}

async function seedEngagement(firmId: string, opts?: { clientName?: string }): Promise<string> {
  const db = getDb();
  const engagementId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt, startDate)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      engagementId,
      firmId,
      opts?.clientName ?? 'Acme Industries',
      'DISCOVERY',
      now,
      now,
      '2026-01-15',
    ],
  });
  // License modules live in a separate LicenseProfile table joined
  // on engagementId — pattern shipped pre-Phase 50.
  await db.execute({
    sql: `INSERT INTO LicenseProfile (id, engagementId, edition, modules, updatedAt)
          VALUES (?,?,?,?,?)`,
    args: [
      createId(),
      engagementId,
      'MID_MARKET',
      JSON.stringify(['gl-ar-ap', 'inventory']),
      now,
    ],
  });
  return engagementId;
}

describe('renderTemplate — empty + minimal', () => {
  it('returns empty string for empty body without hitting the db', async () => {
    const r = await renderTemplate('', { firmId: 'x', engagementId: 'y' });
    expect(r.rendered).toBe('');
    expect(r.missingTokens).toEqual([]);
  });

  it('returns body unchanged when no tokens are present', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const body = '# Just a heading\n\nSome plain text.';
    const r = await renderTemplate(body, { firmId, engagementId });
    expect(r.rendered).toBe(body);
    expect(r.missingTokens).toEqual([]);
  });
});

describe('renderTemplate — firm tokens', () => {
  it('substitutes firm.name with displayName when present', async () => {
    const firmId = await seedFirm({ displayName: 'Xelerate' });
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('Hi from {{firm.name}}', { firmId, engagementId });
    expect(r.rendered).toBe('Hi from Xelerate');
    expect(r.missingTokens).toEqual([]);
  });

  it('substitutes firm.tagline + firm.primaryColor', async () => {
    const firmId = await seedFirm({
      tagline: 'Outcome-first.',
      primaryColor: '#1a8754',
    });
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate(
      'Tagline: {{firm.tagline}} | Color: {{firm.primaryColor}}',
      { firmId, engagementId },
    );
    expect(r.rendered).toBe('Tagline: Outcome-first. | Color: #1a8754');
  });

  it('renders empty string (NOT [missing]) when a firm field is null', async () => {
    const firmId = await seedFirm({ tagline: '' });
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('Tagline=>{{firm.tagline}}<=end', {
      firmId,
      engagementId,
    });
    expect(r.rendered).toBe('Tagline=><=end');
    expect(r.missingTokens).toEqual([]);
  });
});

describe('renderTemplate — engagement tokens', () => {
  it('substitutes engagement.client + engagement.status', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId, { clientName: 'Acme' });
    const r = await renderTemplate(
      'Client: {{engagement.client}} ({{engagement.status}})',
      { firmId, engagementId },
    );
    expect(r.rendered).toBe('Client: Acme (DISCOVERY)');
  });

  it('joins license modules into a comma-separated list', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('Modules: {{engagement.modules}}', {
      firmId,
      engagementId,
    });
    expect(r.rendered).toBe('Modules: gl-ar-ap, inventory');
  });
});

describe('renderTemplate — decisions', () => {
  it('renders an empty-decisions sentinel when none exist', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('{{decisions.signedOff}}', {
      firmId,
      engagementId,
    });
    expect(r.rendered).toContain('No decisions signed off yet');
  });

  it('lists only signed-off decisions under decisions.signedOff', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const dPending = await createDecision(engagementId, { title: 'Pending one' });
    const dSigned = await createDecision(engagementId, { title: 'Signed one' });
    await updateDecisionSignoff((dSigned as { id: string }).id, {
      clientSignoffStatus: 'SIGNED',
      clientSignoffAt: '2026-02-10T00:00:00Z',
    });
    expect(dPending).toBeDefined();

    const r = await renderTemplate(
      '## Done\n\n{{decisions.signedOff}}\n\n## Pending\n\n{{decisions.pending}}',
      { firmId, engagementId },
    );
    expect(r.rendered).toContain('- Signed one — 2026-02-10');
    expect(r.rendered).toContain('- Pending one');
    // Pending decision must NOT appear under signed-off, only under pending.
    const idxSigned = r.rendered.indexOf('## Done');
    const idxPending = r.rendered.indexOf('## Pending');
    const signedSection = r.rendered.slice(idxSigned, idxPending);
    expect(signedSection).not.toContain('Pending one');
  });
});

describe('renderTemplate — risks table', () => {
  it('formats top-5 risks as a markdown table sorted by score', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    // 6 risks of varying severity — only the top 5 by score should land.
    await createRisk(engagementId, { title: 'R1-low', probability: 'LOW', impact: 'LOW' });
    await createRisk(engagementId, { title: 'R2-med', probability: 'MEDIUM', impact: 'MEDIUM' });
    await createRisk(engagementId, { title: 'R3-high', probability: 'HIGH', impact: 'HIGH' });
    await createRisk(engagementId, { title: 'R4-mh', probability: 'MEDIUM', impact: 'HIGH' });
    await createRisk(engagementId, { title: 'R5-hl', probability: 'HIGH', impact: 'LOW' });
    await createRisk(engagementId, { title: 'R6-ll', probability: 'LOW', impact: 'LOW' });
    const r = await renderTemplate('{{risks.top5}}', { firmId, engagementId });
    expect(r.rendered).toContain('| Risk | Probability | Impact | Owner | Mitigation |');
    // R3 (HIGH×HIGH=9) is top.
    expect(r.rendered.indexOf('R3-high')).toBeLessThan(r.rendered.indexOf('R4-mh'));
    // Only top 5 shown — R1-low or R6-ll absent. Filter on the
    // R-prefixed test fixture titles so the table header (which also
    // starts with `| Risk`) doesn't pollute the count.
    const rows = r.rendered
      .split('\n')
      .filter((l) => /^\| R\d/.test(l));
    expect(rows).toHaveLength(5);
  });

  it('escapes pipes inside risk titles + mitigation', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    await createRisk(engagementId, {
      title: 'A | risk | with | pipes',
      probability: 'MEDIUM',
      impact: 'MEDIUM',
    });
    const r = await renderTemplate('{{risks.top5}}', { firmId, engagementId });
    // Pipes inside cell content must be escaped so they don't break the table.
    expect(r.rendered).toContain('A \\| risk \\| with \\| pipes');
  });
});

describe('renderTemplate — action items', () => {
  it('lists open action items with due date + owner', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    await createActionItem(engagementId, {
      title: 'Confirm GL chart',
      dueDate: '2026-06-15',
      owner: 'alice',
    });
    await createActionItem(engagementId, { title: 'No-owner item' });
    const r = await renderTemplate('{{actionItems.open}}', { firmId, engagementId });
    expect(r.rendered).toContain('- Confirm GL chart (due 2026-06-15) — @alice');
    expect(r.rendered).toContain('- No-owner item');
  });

  it('omits DONE / CANCELLED action items', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    await createActionItem(engagementId, { title: 'Open' });
    const done = await createActionItem(engagementId, { title: 'Done item' });
    const db = getDb();
    await db.execute({
      sql: `UPDATE ActionItem SET status = 'DONE' WHERE id = ?`,
      args: [(done as { id: string }).id],
    });
    const r = await renderTemplate('{{actionItems.open}}', { firmId, engagementId });
    expect(r.rendered).toContain('Open');
    expect(r.rendered).not.toContain('Done item');
  });
});

describe('renderTemplate — system tokens', () => {
  it('substitutes {{today}} from ctx.now when provided', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('Today is {{today}}', {
      firmId,
      engagementId,
      now: new Date('2026-05-10T12:00:00Z'),
    });
    expect(r.rendered).toBe('Today is 2026-05-10');
  });
});

describe('renderTemplate — missing-token sentinel', () => {
  it('surfaces unknown tokens as [missing: name]', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate(
      'Real: {{firm.name}} | Bogus: {{nonsense.token}} | Also bad: {{another.bad}}',
      { firmId, engagementId },
    );
    expect(r.rendered).toContain('[missing: nonsense.token]');
    expect(r.rendered).toContain('[missing: another.bad]');
    expect(r.missingTokens).toEqual(['another.bad', 'nonsense.token']);
  });

  it('deduplicates repeated missing tokens', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate(
      '{{x.y}} again {{x.y}} thrice {{x.y}}',
      { firmId, engagementId },
    );
    expect(r.missingTokens).toEqual(['x.y']);
  });

  it('tolerates whitespace inside braces', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const r = await renderTemplate('{{ firm.name }} and {{  firm.name  }}', {
      firmId,
      engagementId,
    });
    expect(r.rendered).toContain('Xelerate and Xelerate');
  });
});

describe('TOKEN_CATALOG', () => {
  it('lists every token the renderer knows about', async () => {
    const firmId = await seedFirm();
    const engagementId = await seedEngagement(firmId);
    const ctx = await buildTokenContext({ firmId, engagementId });
    // Every catalog entry should map to a context key (some may be empty
    // strings — that's still a valid resolution, not "missing").
    for (const entry of TOKEN_CATALOG) {
      expect(ctx.has(entry.token)).toBe(true);
    }
  });

  it('has at least 18 documented tokens (the specified vocabulary)', () => {
    expect(TOKEN_CATALOG.length).toBeGreaterThanOrEqual(18);
  });

  it('groups tokens into the spec-documented groups', () => {
    const groups = new Set(TOKEN_CATALOG.map((t) => t.group));
    expect(groups.has('Firm')).toBe(true);
    expect(groups.has('Engagement')).toBe(true);
    expect(groups.has('Decisions')).toBe(true);
    expect(groups.has('Risks')).toBe(true);
    expect(groups.has('Action Items')).toBe(true);
    expect(groups.has('System')).toBe(true);
  });
});
