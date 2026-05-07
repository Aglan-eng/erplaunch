import { describe, it, expect } from 'vitest';
import {
  filterEngagementForAccountant,
  filterEngagementListForAccountant,
  isAccountantOnly,
} from '../../src/services/internalAccountantFilter.js';

/**
 * Phase 43.2 — pure tests for the INTERNAL_ACCOUNTANT field filter.
 *
 * The matrix grants accountants READ on ENGAGEMENT_META but NONE on
 * decisions / risks / etc; the field-level filter strips those off
 * the engagement payload before we send it.
 */

describe('filterEngagementForAccountant', () => {
  it('keeps the structural / metadata fields needed for dashboard listing', () => {
    const eng = {
      id: 'e1',
      firmId: 'f1',
      clientName: 'Acme',
      status: 'BUILD',
      startDate: '2026-01-01',
      contractEndDate: '2026-12-31',
      adaptorId: 'netsuite',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-05-07T00:00:00Z',
    };
    const out = filterEngagementForAccountant(eng);
    expect(out).toEqual(eng);
  });

  it('strips conflicts / profile / jobs but keeps members (Phase 44.2 keep-list)', () => {
    const eng = {
      id: 'e1',
      firmId: 'f1',
      clientName: 'Acme',
      status: 'BUILD',
      members: [{ name: 'Alice' }],
      conflicts: [{ severity: 'BLOCK' }],
      profile: { answers: { foo: 'bar' } },
      jobs: [{ status: 'queued' }],
    };
    const out = filterEngagementForAccountant(eng);
    expect(out).toHaveProperty('members'); // Phase 44.2 keeps members
    expect(out).not.toHaveProperty('conflicts');
    expect(out).not.toHaveProperty('profile');
    expect(out).not.toHaveProperty('jobs');
    // Structural fields stay.
    expect(out.id).toBe('e1');
    expect(out.clientName).toBe('Acme');
  });

  it('forwards a nested billing sub-object verbatim', () => {
    const eng = {
      id: 'e1',
      clientName: 'Acme',
      billing: { monthlyRate: 5000, currency: 'USD', invoiceLines: [{ amount: 5000 }] },
      profile: { answers: { foo: 'bar' } }, // should still be stripped
    };
    const out = filterEngagementForAccountant(eng);
    expect(out.billing).toEqual({ monthlyRate: 5000, currency: 'USD', invoiceLines: [{ amount: 5000 }] });
    expect(out).not.toHaveProperty('profile');
  });

  it('keeps individual billing-shaped scalar columns when present on the row', () => {
    const eng = {
      id: 'e1',
      clientName: 'Acme',
      billingPlan: 'enterprise',
      billingMonthlyRate: 12000,
      billingCurrency: 'EUR',
      // Future-proof: the schema may grow these as scalar columns
      // before the nested billing sub-object lands.
    };
    const out = filterEngagementForAccountant(eng);
    expect(out.billingPlan).toBe('enterprise');
    expect(out.billingMonthlyRate).toBe(12000);
    expect(out.billingCurrency).toBe('EUR');
  });

  it('returns an empty-ish object when nothing matches the keep-list', () => {
    const eng = {
      decisions: [{ title: 'foo' }],
      risks: [{ severity: 'HIGH' }],
    };
    const out = filterEngagementForAccountant(eng);
    expect(Object.keys(out)).toHaveLength(0);
  });
});

describe('filterEngagementListForAccountant', () => {
  it('applies the per-row filter across the array', () => {
    const list = [
      { id: 'e1', clientName: 'A', conflicts: [1] },
      { id: 'e2', clientName: 'B', profile: { answers: { foo: 'bar' } } },
    ];
    const out = filterEngagementListForAccountant(list);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ id: 'e1', clientName: 'A' });
    expect(out[1]).toEqual({ id: 'e2', clientName: 'B' });
  });
});

describe('Phase 44.2 — keep-list extensions for license + members', () => {
  it('keeps the nested license summary block', () => {
    const eng = {
      id: 'e1',
      clientName: 'A',
      license: { edition: 'MID_MARKET', modules: ['ADVANCED_REVENUE'] },
      decisions: [{ title: 'X' }],
    };
    const out = filterEngagementForAccountant(eng);
    expect(out.license).toEqual({ edition: 'MID_MARKET', modules: ['ADVANCED_REVENUE'] });
    expect(out).not.toHaveProperty('decisions');
  });

  it('keeps the members list (read-only — gated by matrix elsewhere)', () => {
    const eng = {
      id: 'e1',
      clientName: 'A',
      members: [{ name: 'Alice', email: 'alice@example.com', role: 'Sponsor' }],
      risks: [{ title: 'X' }],
    };
    const out = filterEngagementForAccountant(eng);
    expect(out.members).toHaveLength(1);
    expect(out).not.toHaveProperty('risks');
  });
});

describe('isAccountantOnly', () => {
  it('returns true for a pure INTERNAL_ACCOUNTANT with no engagement role', () => {
    expect(isAccountantOnly({
      firmRoles: ['INTERNAL_ACCOUNTANT'],
      engagementRoles: [],
    })).toBe(true);
  });

  it('returns false when the user is APP_ADMIN (mixed firm-level)', () => {
    expect(isAccountantOnly({
      firmRoles: ['APP_ADMIN', 'INTERNAL_ACCOUNTANT'],
      engagementRoles: [],
    })).toBe(false);
  });

  it('returns false when the user has SALES_MANAGER alongside accountant', () => {
    expect(isAccountantOnly({
      firmRoles: ['SALES_MANAGER', 'INTERNAL_ACCOUNTANT'],
      engagementRoles: [],
    })).toBe(false);
  });

  it('returns false when the user has any engagement-level role on this engagement', () => {
    // Mixed PM + Accountant: the PM role wins → full payload.
    expect(isAccountantOnly({
      firmRoles: ['INTERNAL_ACCOUNTANT'],
      engagementRoles: ['PROJECT_MANAGER'],
    })).toBe(false);
  });

  it('returns false when the user is not an accountant at all', () => {
    expect(isAccountantOnly({
      firmRoles: [],
      engagementRoles: ['PROJECT_LEAD'],
    })).toBe(false);
  });
});
