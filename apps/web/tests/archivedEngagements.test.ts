import { describe, it, expect } from 'vitest';
import {
  selectArchived,
  previousStatusLabel,
  type ArchivedEngagement,
} from '../src/pages/archivedEngagements';

describe('selectArchived', () => {
  it('keeps only ARCHIVED rows and sorts newest-first', () => {
    const rows: ArchivedEngagement[] = [
      { id: 'a', clientName: 'Old Acme',  status: 'ARCHIVED', updatedAt: '2026-04-01T00:00:00Z' },
      { id: 'b', clientName: 'Active',    status: 'BUILD',    updatedAt: '2026-05-05T00:00:00Z' },
      { id: 'c', clientName: 'New Acme',  status: 'ARCHIVED', updatedAt: '2026-05-01T00:00:00Z' },
    ];
    const out = selectArchived(rows);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('c'); // newer first
    expect(out[1].id).toBe('a');
  });

  it('returns an empty array when no archived rows exist', () => {
    const rows: ArchivedEngagement[] = [
      { id: 'b', clientName: 'Active', status: 'BUILD', updatedAt: '2026-05-05T00:00:00Z' },
    ];
    expect(selectArchived(rows)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const rows: ArchivedEngagement[] = [
      { id: 'a', clientName: 'A', status: 'ARCHIVED', updatedAt: '2026-04-01T00:00:00Z' },
      { id: 'c', clientName: 'C', status: 'ARCHIVED', updatedAt: '2026-05-01T00:00:00Z' },
    ];
    const before = rows.map((r) => r.id);
    selectArchived(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('previousStatusLabel', () => {
  it('maps known status codes to display labels', () => {
    expect(previousStatusLabel('DISCOVERY')).toBe('Discovery');
    expect(previousStatusLabel('SCOPING')).toBe('Scoping');
    expect(previousStatusLabel('BUILD')).toBe('Build');
    expect(previousStatusLabel('UAT')).toBe('UAT');
    expect(previousStatusLabel('GO_LIVE')).toBe('Go-Live');
  });

  it('falls back to Discovery when no previousStatus is recorded', () => {
    expect(previousStatusLabel(null)).toBe('Discovery');
    expect(previousStatusLabel(undefined)).toBe('Discovery');
    expect(previousStatusLabel('')).toBe('Discovery');
  });
});
