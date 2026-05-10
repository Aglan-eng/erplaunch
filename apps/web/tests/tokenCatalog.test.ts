/**
 * Phase 50.5 — Pure tests for the client-side TOKEN_CATALOG mirror.
 *
 * Pins the catalog shape + group ordering so the api drift surfaces
 * here if either side adds/removes tokens.
 */
import { describe, it, expect } from 'vitest';
import {
  TOKEN_CATALOG,
  TOKEN_GROUPS_IN_ORDER,
  tokensByGroup,
} from '../src/lib/tokenCatalog';

describe('TOKEN_CATALOG', () => {
  it('lists at least 18 tokens across 7 groups', () => {
    expect(TOKEN_CATALOG.length).toBeGreaterThanOrEqual(18);
    const groups = new Set(TOKEN_CATALOG.map((t) => t.group));
    expect(groups.size).toBe(7);
  });

  it('every token uses safe identifier characters (letters, digits, underscore, dot)', () => {
    for (const entry of TOKEN_CATALOG) {
      expect(entry.token).toMatch(/^[a-zA-Z0-9_.]+$/);
    }
  });

  it('grouped tokens use dotted "group.subkey" naming; system tokens are single-word', () => {
    for (const entry of TOKEN_CATALOG) {
      if (entry.group === 'System') {
        expect(entry.token.includes('.')).toBe(false);
      } else {
        expect(entry.token.includes('.')).toBe(true);
      }
    }
  });

  it('every token has a non-empty description', () => {
    for (const entry of TOKEN_CATALOG) {
      expect(entry.description.length).toBeGreaterThan(5);
    }
  });

  it('every entry belongs to one of TOKEN_GROUPS_IN_ORDER', () => {
    const allowedGroups = new Set(TOKEN_GROUPS_IN_ORDER);
    for (const entry of TOKEN_CATALOG) {
      expect(allowedGroups.has(entry.group)).toBe(true);
    }
  });
});

describe('tokensByGroup', () => {
  it('returns a Map keyed by every group in TOKEN_GROUPS_IN_ORDER', () => {
    const m = tokensByGroup();
    for (const group of TOKEN_GROUPS_IN_ORDER) {
      expect(m.has(group)).toBe(true);
    }
  });

  it('preserves insertion order matching TOKEN_GROUPS_IN_ORDER', () => {
    const keys = [...tokensByGroup().keys()];
    expect(keys).toEqual([...TOKEN_GROUPS_IN_ORDER]);
  });

  it('partitions every catalog entry into exactly one group bucket', () => {
    const grouped = tokensByGroup();
    let total = 0;
    for (const [, entries] of grouped) total += entries.length;
    expect(total).toBe(TOKEN_CATALOG.length);
  });
});
