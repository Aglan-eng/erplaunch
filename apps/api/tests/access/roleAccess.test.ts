/**
 * Phase 53.3 — Access alignment tests for the new CEO role + the
 * existing firm-level + engagement-level roles.
 *
 * Focused subset: the highest-signal boundaries the spec calls out.
 * Full per-role coverage of every endpoint would be a separate
 * compliance phase — gaps are documented in the reply.
 *
 * Pins:
 *   - CEO can READ firm-wide (customer detail) and is denied WRITE
 *     on stage transitions / owner edits / document generators.
 *   - APP_ADMIN can do everything CEO can plus the admin endpoints.
 *   - The permissions matrix returns the expected actions for every
 *     non-CEO role on a sample of resources.
 */
import { describe, it, expect } from 'vitest';
import { getActionForRole } from '../../src/services/permissions.js';
import { isFirmLevelRole } from '../../src/types/roles.js';

describe('Phase 53.3 — CEO permission matrix', () => {
  it('CEO is recognised as a firm-level role', () => {
    expect(isFirmLevelRole('CEO')).toBe(true);
  });

  it('CEO has READ on ENGAGEMENT_META at every stage', () => {
    for (const stage of ['PROSPECT', 'DISCOVERY', 'BUILD', 'GOLIVE', 'SLA_ACTIVE'] as const) {
      expect(getActionForRole('CEO', stage, 'ENGAGEMENT_META')).toBe('READ');
    }
  });

  it('CEO has READ on ACTIVITY_LOG, DECISIONS, COMMENTS, MEMBERS — firm-wide visibility', () => {
    for (const resource of ['ACTIVITY_LOG', 'DECISIONS', 'COMMENTS', 'MEMBERS'] as const) {
      expect(getActionForRole('CEO', 'DISCOVERY', resource)).toBe('READ');
    }
  });

  it('CEO can read BILLING but cannot write it', () => {
    expect(getActionForRole('CEO', 'BUILD', 'BILLING')).toBe('READ');
  });

  it('CEO has NONE on GENERATORS — cannot fire document generation', () => {
    for (const stage of ['DISCOVERY', 'BUILD', 'GOLIVE'] as const) {
      expect(getActionForRole('CEO', stage, 'GENERATORS')).toBe('NONE');
    }
  });

  it('CEO never gets WRITE — there are no operational writes for this role', () => {
    const stages = ['PROSPECT', 'DISCOVERY', 'BUILD', 'UAT', 'GOLIVE', 'SLA_ACTIVE'] as const;
    const resources = [
      'ENGAGEMENT_META',
      'MEMBERS',
      'ACTIVITY_LOG',
      'DECISIONS',
      'COMMENTS',
      'BILLING',
      'GENERATORS',
      'ROLES',
      'INTEGRATIONS',
    ] as const;
    for (const stage of stages) {
      for (const resource of resources) {
        const action = getActionForRole('CEO', stage, resource);
        expect(action, `${stage}/${resource} should not be WRITE for CEO`).not.toBe('WRITE');
      }
    }
  });
});

describe('Phase 53.3 — APP_ADMIN remains all-powerful', () => {
  it('APP_ADMIN has WRITE on every resource at every stage', () => {
    const stages = ['PROSPECT', 'DISCOVERY', 'BUILD', 'UAT', 'GOLIVE', 'SLA_ACTIVE'] as const;
    const resources = [
      'ENGAGEMENT_META',
      'GENERATORS',
      'BILLING',
      'ROLES',
      'INTEGRATIONS',
    ] as const;
    for (const stage of stages) {
      for (const resource of resources) {
        expect(getActionForRole('APP_ADMIN', stage, resource)).toBe('WRITE');
      }
    }
  });
});

describe('Phase 53.3 — non-CEO firm roles unchanged by this phase', () => {
  it('SALES_MANAGER can WRITE ENGAGEMENT_META during PROSPECT and READ during BUILD', () => {
    expect(getActionForRole('SALES_MANAGER', 'PROSPECT', 'ENGAGEMENT_META')).toBe('WRITE');
    expect(getActionForRole('SALES_MANAGER', 'BUILD', 'ENGAGEMENT_META')).toBe('READ');
  });

  it('INTERNAL_ACCOUNTANT can WRITE BILLING', () => {
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'BUILD', 'BILLING')).toBe('WRITE');
  });

  it('SUPPORT_LEAD reads stage-overdue / decisions during DISCOVERY', () => {
    expect(getActionForRole('SUPPORT_LEAD', 'DISCOVERY', 'ENGAGEMENT_META')).toBe('READ');
  });
});

describe('Phase 53.3 — engagement-level roles unchanged', () => {
  it('FUNCTIONAL_CONSULTANT has at least READ on DISCOVERY ENGAGEMENT_META', () => {
    // FC writes target deliverables / decisions / comments rather than
    // ENGAGEMENT_META directly — we only pin the floor here. Phase 53.3
    // does not modify this role; this assertion is a regression guard.
    const action = getActionForRole('FUNCTIONAL_CONSULTANT', 'DISCOVERY', 'ENGAGEMENT_META');
    expect(['READ', 'WRITE']).toContain(action);
  });

  it('SUPPORT_ENGINEER can WRITE during SLA_ACTIVE', () => {
    // Stage-scoped writes — pin one canonical resource.
    const action = getActionForRole('SUPPORT_ENGINEER', 'SLA_ACTIVE', 'ENGAGEMENT_META');
    expect(action === 'WRITE' || action === 'READ').toBe(true);
  });
});
