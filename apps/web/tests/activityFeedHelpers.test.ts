import { describe, it, expect } from 'vitest';
import {
  getActionMeta,
  groupByDay,
  filterAndSearch,
  paginate,
  ACTION_CATEGORIES,
  type ActivityRow,
} from '../src/components/wizard/activityFeedHelpers';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeActivity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'a1',
    engagementId: 'e1',
    firmId: 'f1',
    action: 'NOTE',
    details: 'A note about something',
    createdAt: '2026-05-07T12:00:00.000Z',
    ...overrides,
  };
}

// ─── getActionMeta ───────────────────────────────────────────────────────────

describe('getActionMeta', () => {
  it('classifies risk actions under "risks" with red palette', () => {
    const meta = getActionMeta('RISK_ADDED');
    expect(meta.category).toBe('risks');
    expect(meta.color).toMatch(/red/i);
    expect(meta.label.toLowerCase()).toContain('risk');
  });

  it('classifies issue actions under "issues" with orange palette', () => {
    const meta = getActionMeta('ISSUE_OPENED');
    expect(meta.category).toBe('issues');
    expect(meta.color).toMatch(/orange|amber/i);
  });

  it('classifies decision actions under "decisions"', () => {
    expect(getActionMeta('DECISION_LOGGED').category).toBe('decisions');
    expect(getActionMeta('DECISION_UPDATED').category).toBe('decisions');
    // The manual whitelist also accepts plain "DECISION".
    expect(getActionMeta('DECISION').category).toBe('decisions');
  });

  it('classifies meeting actions under "meetings"', () => {
    expect(getActionMeta('MEETING_SCHEDULED').category).toBe('meetings');
    expect(getActionMeta('MEETING_UPDATED').category).toBe('meetings');
    expect(getActionMeta('MEETING_DELETED').category).toBe('meetings');
  });

  it('classifies member actions under "members"', () => {
    expect(getActionMeta('MEMBER_ADDED').category).toBe('members');
    expect(getActionMeta('MEMBER_REMOVED').category).toBe('members');
  });

  it('classifies migration actions under "migration"', () => {
    expect(getActionMeta('MIGRATION_ITEM_CREATED').category).toBe('migration');
  });

  it('classifies data-* actions under "data"', () => {
    expect(getActionMeta('DATA_FILE_UPLOADED').category).toBe('data');
    expect(getActionMeta('DATA_TEMPLATES_GENERATED').category).toBe('data');
  });

  it('classifies manual notes under "notes"', () => {
    expect(getActionMeta('NOTE').category).toBe('notes');
    expect(getActionMeta('OBSERVATION').category).toBe('notes');
    expect(getActionMeta('TODO').category).toBe('notes');
  });

  it('classifies engagement-lifecycle actions under "system"', () => {
    expect(getActionMeta('ENGAGEMENT_CREATED').category).toBe('system');
    expect(getActionMeta('LICENSE_UPDATED').category).toBe('system');
    expect(getActionMeta('PROFILE_UPDATED').category).toBe('system');
    expect(getActionMeta('PHASE_UPDATED').category).toBe('system');
  });

  it('falls back to "system" for unknown actions', () => {
    const meta = getActionMeta('SOMETHING_UNKNOWN');
    expect(meta.category).toBe('system');
    expect(meta.label).toBeTruthy();
  });

  it('produces a section route for risk actions', () => {
    const meta = getActionMeta('RISK_ADDED');
    expect(meta.section).toBe('risks');
  });

  it('exposes the union of category ids', () => {
    expect(ACTION_CATEGORIES).toContain('risks');
    expect(ACTION_CATEGORIES).toContain('issues');
    expect(ACTION_CATEGORIES).toContain('decisions');
    expect(ACTION_CATEGORIES).toContain('meetings');
    expect(ACTION_CATEGORIES).toContain('members');
    expect(ACTION_CATEGORIES).toContain('migration');
    expect(ACTION_CATEGORIES).toContain('data');
    expect(ACTION_CATEGORIES).toContain('notes');
    expect(ACTION_CATEGORIES).toContain('system');
  });
});

// ─── groupByDay ──────────────────────────────────────────────────────────────

describe('groupByDay', () => {
  // Pin "now" to a fixed point so "Today" / "Yesterday" labels are stable.
  const NOW_ISO = '2026-05-07T15:30:00.000Z';

  it('groups same-day activities into one bucket', () => {
    const groups = groupByDay(
      [
        makeActivity({ id: 'a', createdAt: '2026-05-07T12:00:00.000Z' }),
        makeActivity({ id: 'b', createdAt: '2026-05-07T08:00:00.000Z' }),
      ],
      NOW_ISO
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });

  it('labels today as "Today"', () => {
    const groups = groupByDay([makeActivity({ createdAt: NOW_ISO })], NOW_ISO);
    expect(groups[0].dateLabel).toBe('Today');
  });

  it('labels yesterday as "Yesterday"', () => {
    const yesterdayIso = '2026-05-06T10:00:00.000Z';
    const groups = groupByDay([makeActivity({ createdAt: yesterdayIso })], NOW_ISO);
    expect(groups[0].dateLabel).toBe('Yesterday');
  });

  it('labels older days with a date string', () => {
    const groups = groupByDay(
      [makeActivity({ createdAt: '2026-05-01T10:00:00.000Z' })],
      NOW_ISO
    );
    expect(groups[0].dateLabel).not.toBe('Today');
    expect(groups[0].dateLabel).not.toBe('Yesterday');
    expect(groups[0].dateLabel.length).toBeGreaterThan(0);
  });

  it('returns groups in newest-first order', () => {
    const groups = groupByDay(
      [
        makeActivity({ id: 'old', createdAt: '2026-05-01T10:00:00.000Z' }),
        makeActivity({ id: 'new', createdAt: '2026-05-07T10:00:00.000Z' }),
        makeActivity({ id: 'mid', createdAt: '2026-05-05T10:00:00.000Z' }),
      ],
      NOW_ISO
    );
    expect(groups.map((g) => g.items[0].id)).toEqual(['new', 'mid', 'old']);
  });

  it('returns an empty array when no activities exist', () => {
    expect(groupByDay([], NOW_ISO)).toEqual([]);
  });
});

// ─── filterAndSearch ─────────────────────────────────────────────────────────

describe('filterAndSearch', () => {
  const activities: ActivityRow[] = [
    makeActivity({ id: '1', action: 'RISK_ADDED', details: 'GL mapping risk' }),
    makeActivity({ id: '2', action: 'ISSUE_OPENED', details: 'Inventory variance' }),
    makeActivity({ id: '3', action: 'DECISION_LOGGED', details: 'Use AVCO costing' }),
    makeActivity({ id: '4', action: 'NOTE', details: 'Spoke with client today' }),
  ];

  it('returns all when no filters are set', () => {
    const r = filterAndSearch(activities, { query: '', category: 'all' });
    expect(r).toHaveLength(4);
  });

  it('filters by category', () => {
    const r = filterAndSearch(activities, { query: '', category: 'risks' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('matches search against details (case-insensitive)', () => {
    const r = filterAndSearch(activities, { query: 'inventory', category: 'all' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });

  it('matches search against action label', () => {
    const r = filterAndSearch(activities, { query: 'risk', category: 'all' });
    // Both the RISK_ADDED action label and the "GL mapping risk" details match.
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('1');
  });

  it('combines category and search filters', () => {
    const r = filterAndSearch(activities, { query: 'avco', category: 'decisions' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('3');
  });

  it('returns empty when no matches', () => {
    const r = filterAndSearch(activities, { query: 'xyzzy', category: 'all' });
    expect(r).toEqual([]);
  });

  it('handles activities with null details', () => {
    const a: ActivityRow[] = [
      { ...makeActivity({ id: 'x' }), details: null },
    ];
    expect(filterAndSearch(a, { query: 'whatever', category: 'all' })).toEqual([]);
    expect(filterAndSearch(a, { query: '', category: 'all' })).toHaveLength(1);
  });
});

// ─── paginate ────────────────────────────────────────────────────────────────

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) =>
    makeActivity({ id: `a${i}`, createdAt: `2026-05-${String(7 - (i % 7)).padStart(2, '0')}T10:00:00.000Z` })
  );

  it('returns the first page', () => {
    const r = paginate(items, 1, 10);
    expect(r.items).toHaveLength(10);
    expect(r.totalPages).toBe(3);
    expect(r.hasMore).toBe(true);
  });

  it('returns the last partial page', () => {
    const r = paginate(items, 3, 10);
    expect(r.items).toHaveLength(5);
    expect(r.hasMore).toBe(false);
  });

  it('clamps page above range to last page', () => {
    const r = paginate(items, 99, 10);
    expect(r.page).toBe(3);
    expect(r.items).toHaveLength(5);
  });

  it('clamps page below 1 to 1', () => {
    const r = paginate(items, 0, 10);
    expect(r.page).toBe(1);
    expect(r.items).toHaveLength(10);
  });

  it('returns 0 totalPages and hasMore=false on empty input', () => {
    const r = paginate([], 1, 10);
    expect(r.totalPages).toBe(0);
    expect(r.hasMore).toBe(false);
    expect(r.items).toEqual([]);
  });
});
