/**
 * Phase 43.1 — permission matrix coverage.
 *
 * Pinned outcomes for every role × representative stage × representative
 * resource. Doesn't enumerate all 15 × 11 × 16 = 2640 cells (that would
 * be a maintenance hazard) — instead each role gets a handful of pinned
 * cells that capture its policy intent: where it has WRITE, where it has
 * READ, and where it has NONE.
 *
 * The matrix lookup is pure (no DB), so this file stays in
 * tests/services/ alongside other pure-helper coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  getActionForRole,
  evaluateEffectiveAction,
} from '../../src/services/permissions.js';
import type { Role, Stage, Resource } from '../../src/types/roles.js';
import {
  ALL_ROLES,
  LIFECYCLE_STAGES,
  RESOURCES,
} from '../../src/types/roles.js';

// ─── APP_ADMIN ───────────────────────────────────────────────────────────────

describe('APP_ADMIN', () => {
  it('has WRITE on every resource at every stage', () => {
    for (const stage of LIFECYCLE_STAGES) {
      for (const resource of RESOURCES) {
        expect(getActionForRole('APP_ADMIN', stage, resource)).toBe('WRITE');
      }
    }
  });
});

// ─── SALES_MANAGER ───────────────────────────────────────────────────────────

describe('SALES_MANAGER', () => {
  it('has WRITE on ENGAGEMENT_META at PROSPECT/PROPOSED/CONTRACTED', () => {
    expect(getActionForRole('SALES_MANAGER', 'PROSPECT', 'ENGAGEMENT_META')).toBe('WRITE');
    expect(getActionForRole('SALES_MANAGER', 'PROPOSED', 'ENGAGEMENT_META')).toBe('WRITE');
    expect(getActionForRole('SALES_MANAGER', 'CONTRACTED', 'ENGAGEMENT_META')).toBe('WRITE');
  });

  it('drops to READ on ENGAGEMENT_META at DISCOVERY and later', () => {
    expect(getActionForRole('SALES_MANAGER', 'DISCOVERY', 'ENGAGEMENT_META')).toBe('READ');
    expect(getActionForRole('SALES_MANAGER', 'GOLIVE', 'ENGAGEMENT_META')).toBe('READ');
    expect(getActionForRole('SALES_MANAGER', 'SLA_ACTIVE', 'ENGAGEMENT_META')).toBe('READ');
  });

  it('cannot WRITE billing — that is the accountant`s domain', () => {
    expect(getActionForRole('SALES_MANAGER', 'PROSPECT', 'BILLING')).toBe('READ');
    expect(getActionForRole('SALES_MANAGER', 'CONTRACTED', 'BILLING')).toBe('READ');
  });

  it('cannot WRITE generators (consultants own deliverable generation)', () => {
    expect(getActionForRole('SALES_MANAGER', 'BUILD', 'GENERATORS')).toBe('READ');
  });
});

// ─── SALES_REP (engagement-scoped) ───────────────────────────────────────────

describe('SALES_REP', () => {
  it('has WRITE on ENGAGEMENT_META + MEMBERS at PROSPECT/PROPOSED/CONTRACTED', () => {
    expect(getActionForRole('SALES_REP', 'PROSPECT', 'ENGAGEMENT_META')).toBe('WRITE');
    expect(getActionForRole('SALES_REP', 'CONTRACTED', 'MEMBERS')).toBe('WRITE');
  });

  it('drops to READ once the deal moves into DISCOVERY', () => {
    expect(getActionForRole('SALES_REP', 'DISCOVERY', 'ENGAGEMENT_META')).toBe('READ');
    expect(getActionForRole('SALES_REP', 'BUILD', 'ENGAGEMENT_META')).toBe('READ');
  });

  it('cannot WRITE deliverables (GENERATORS) or BILLING — sales-only role', () => {
    expect(getActionForRole('SALES_REP', 'PROSPECT', 'GENERATORS')).toBe('NONE');
    expect(getActionForRole('SALES_REP', 'PROSPECT', 'BILLING')).toBe('READ');
  });
});

// ─── PROJECT_MANAGER (engagement-scoped) ─────────────────────────────────────

describe('PROJECT_MANAGER', () => {
  it('is READ-only on PROSPECT/PROPOSED/CONTRACTED (sales hasn`t handed off yet)', () => {
    expect(getActionForRole('PROJECT_MANAGER', 'PROSPECT', 'WIZARD_ANSWERS')).toBe('READ');
    expect(getActionForRole('PROJECT_MANAGER', 'PROPOSED', 'DECISIONS')).toBe('READ');
    expect(getActionForRole('PROJECT_MANAGER', 'CONTRACTED', 'WIZARD_ANSWERS')).toBe('READ');
  });

  it('has WRITE on most operational resources during DISCOVERY..GOLIVE', () => {
    for (const stage of ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GOLIVE'] as const) {
      expect(getActionForRole('PROJECT_MANAGER', stage, 'WIZARD_ANSWERS')).toBe('WRITE');
      expect(getActionForRole('PROJECT_MANAGER', stage, 'DECISIONS')).toBe('WRITE');
      expect(getActionForRole('PROJECT_MANAGER', stage, 'RISKS')).toBe('WRITE');
      expect(getActionForRole('PROJECT_MANAGER', stage, 'ISSUES')).toBe('WRITE');
      expect(getActionForRole('PROJECT_MANAGER', stage, 'GENERATORS')).toBe('WRITE');
    }
  });

  it('has READ-only on BILLING and ROLES even mid-cycle', () => {
    expect(getActionForRole('PROJECT_MANAGER', 'BUILD', 'BILLING')).toBe('READ');
    expect(getActionForRole('PROJECT_MANAGER', 'BUILD', 'ROLES')).toBe('READ');
  });

  it('drops to READ on CLOSEOUT/SLA_ACTIVE/ARCHIVED', () => {
    expect(getActionForRole('PROJECT_MANAGER', 'CLOSEOUT', 'WIZARD_ANSWERS')).toBe('READ');
    expect(getActionForRole('PROJECT_MANAGER', 'SLA_ACTIVE', 'WIZARD_ANSWERS')).toBe('READ');
    expect(getActionForRole('PROJECT_MANAGER', 'ARCHIVED', 'WIZARD_ANSWERS')).toBe('READ');
  });
});

// ─── PROJECT_LEAD ────────────────────────────────────────────────────────────

describe('PROJECT_LEAD', () => {
  it('matches PROJECT_MANAGER on most resources', () => {
    expect(getActionForRole('PROJECT_LEAD', 'BUILD', 'RISKS')).toBe('WRITE');
    expect(getActionForRole('PROJECT_LEAD', 'BUILD', 'WIZARD_ANSWERS')).toBe('WRITE');
  });

  it('has signoff WRITE on DECISIONS even at CONTRACTED (matching PM, plus signoff implied)', () => {
    expect(getActionForRole('PROJECT_LEAD', 'BUILD', 'DECISIONS')).toBe('WRITE');
  });
});

// ─── FUNCTIONAL_CONSULTANT / TECHNICAL_CONSULTANT ────────────────────────────

describe('FUNCTIONAL_CONSULTANT / TECHNICAL_CONSULTANT', () => {
  it('has WRITE on WIZARD_ANSWERS during DISCOVERY..GOLIVE (module-scoped at the route layer)', () => {
    expect(getActionForRole('FUNCTIONAL_CONSULTANT', 'DISCOVERY', 'WIZARD_ANSWERS')).toBe('WRITE');
    expect(getActionForRole('TECHNICAL_CONSULTANT', 'BUILD', 'WIZARD_ANSWERS')).toBe('WRITE');
  });

  it('has READ on DECISIONS — they consume them, not author them', () => {
    expect(getActionForRole('FUNCTIONAL_CONSULTANT', 'BUILD', 'DECISIONS')).toBe('READ');
    expect(getActionForRole('TECHNICAL_CONSULTANT', 'UAT', 'DECISIONS')).toBe('READ');
  });

  it('cannot touch BILLING or ROLES', () => {
    expect(getActionForRole('FUNCTIONAL_CONSULTANT', 'BUILD', 'BILLING')).toBe('NONE');
    expect(getActionForRole('FUNCTIONAL_CONSULTANT', 'BUILD', 'ROLES')).toBe('NONE');
  });

  it('drops to READ on PROSPECT..CONTRACTED (no write rights pre-discovery)', () => {
    expect(getActionForRole('FUNCTIONAL_CONSULTANT', 'PROSPECT', 'WIZARD_ANSWERS')).toBe('READ');
    expect(getActionForRole('TECHNICAL_CONSULTANT', 'CONTRACTED', 'WIZARD_ANSWERS')).toBe('READ');
  });
});

// ─── SUPPORT_LEAD / SUPPORT_ENGINEER / ACCOUNT_MANAGER ───────────────────────

describe('SUPPORT_LEAD', () => {
  it('has WRITE on ISSUES + ACTION_ITEMS during SLA_ACTIVE', () => {
    expect(getActionForRole('SUPPORT_LEAD', 'SLA_ACTIVE', 'ISSUES')).toBe('WRITE');
    expect(getActionForRole('SUPPORT_LEAD', 'SLA_ACTIVE', 'ACTION_ITEMS')).toBe('WRITE');
  });

  it('is READ-only on stages before SLA_ACTIVE', () => {
    expect(getActionForRole('SUPPORT_LEAD', 'BUILD', 'ISSUES')).toBe('READ');
    expect(getActionForRole('SUPPORT_LEAD', 'GOLIVE', 'ISSUES')).toBe('READ');
  });
});

describe('SUPPORT_ENGINEER', () => {
  it('has WRITE on ISSUES during SLA_ACTIVE on assigned engagements', () => {
    expect(getActionForRole('SUPPORT_ENGINEER', 'SLA_ACTIVE', 'ISSUES')).toBe('WRITE');
  });

  it('has READ-only on earlier stages (visibility for handoff context)', () => {
    expect(getActionForRole('SUPPORT_ENGINEER', 'GOLIVE', 'ISSUES')).toBe('READ');
  });
});

describe('ACCOUNT_MANAGER', () => {
  it('has WRITE on ENGAGEMENT_META + BILLING during SLA_ACTIVE (renewal/expansion)', () => {
    expect(getActionForRole('ACCOUNT_MANAGER', 'SLA_ACTIVE', 'ENGAGEMENT_META')).toBe('WRITE');
    expect(getActionForRole('ACCOUNT_MANAGER', 'SLA_ACTIVE', 'BILLING')).toBe('WRITE');
  });

  it('is READ-only outside SLA_ACTIVE', () => {
    expect(getActionForRole('ACCOUNT_MANAGER', 'BUILD', 'BILLING')).toBe('READ');
  });
});

// ─── INTERNAL_ACCOUNTANT ─────────────────────────────────────────────────────

describe('INTERNAL_ACCOUNTANT', () => {
  it('has WRITE on BILLING at every stage', () => {
    for (const stage of LIFECYCLE_STAGES) {
      expect(getActionForRole('INTERNAL_ACCOUNTANT', stage, 'BILLING')).toBe('WRITE');
    }
  });

  it('cannot READ decisions, risks, or deliverables (field-level filter applies on top)', () => {
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'BUILD', 'DECISIONS')).toBe('NONE');
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'BUILD', 'RISKS')).toBe('NONE');
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'BUILD', 'GENERATORS')).toBe('NONE');
  });

  it('can READ ENGAGEMENT_META at every stage (so the dashboard list works)', () => {
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'PROSPECT', 'ENGAGEMENT_META')).toBe('READ');
    expect(getActionForRole('INTERNAL_ACCOUNTANT', 'GOLIVE', 'ENGAGEMENT_META')).toBe('READ');
  });
});

// ─── CLIENT_* roles ──────────────────────────────────────────────────────────

describe('CLIENT_SPONSOR', () => {
  it('has WRITE on DECISIONS (signoff rights) during DISCOVERY..GOLIVE', () => {
    expect(getActionForRole('CLIENT_SPONSOR', 'DISCOVERY', 'DECISIONS')).toBe('WRITE');
    expect(getActionForRole('CLIENT_SPONSOR', 'BUILD', 'DECISIONS')).toBe('WRITE');
  });

  it('cannot touch GENERATORS or BILLING', () => {
    expect(getActionForRole('CLIENT_SPONSOR', 'BUILD', 'GENERATORS')).toBe('NONE');
    expect(getActionForRole('CLIENT_SPONSOR', 'BUILD', 'BILLING')).toBe('NONE');
  });
});

describe('CLIENT_LEAD', () => {
  it('matches CLIENT_SPONSOR but has READ-only on DECISIONS (no signoff)', () => {
    expect(getActionForRole('CLIENT_LEAD', 'BUILD', 'DECISIONS')).toBe('READ');
    expect(getActionForRole('CLIENT_LEAD', 'BUILD', 'COMMENTS')).toBe('WRITE');
  });
});

describe('CLIENT_SME', () => {
  it('has WRITE on WIZARD_ANSWERS + COMMENTS (module-scoped at the route layer)', () => {
    expect(getActionForRole('CLIENT_SME', 'DISCOVERY', 'WIZARD_ANSWERS')).toBe('WRITE');
    expect(getActionForRole('CLIENT_SME', 'BUILD', 'COMMENTS')).toBe('WRITE');
  });

  it('cannot touch BILLING / ROLES / GENERATORS', () => {
    expect(getActionForRole('CLIENT_SME', 'BUILD', 'BILLING')).toBe('NONE');
    expect(getActionForRole('CLIENT_SME', 'BUILD', 'ROLES')).toBe('NONE');
  });
});

describe('CLIENT_REVIEWER', () => {
  it('is READ-only on every client-facing resource', () => {
    expect(getActionForRole('CLIENT_REVIEWER', 'BUILD', 'WIZARD_ANSWERS')).toBe('READ');
    expect(getActionForRole('CLIENT_REVIEWER', 'BUILD', 'COMMENTS')).toBe('READ');
  });

  it('has NONE on internal-only resources (BILLING, ROLES)', () => {
    expect(getActionForRole('CLIENT_REVIEWER', 'BUILD', 'BILLING')).toBe('NONE');
    expect(getActionForRole('CLIENT_REVIEWER', 'BUILD', 'ROLES')).toBe('NONE');
  });
});

// ─── Multi-role stacking ─────────────────────────────────────────────────────

describe('evaluateEffectiveAction (role stacking)', () => {
  it('takes the strongest action across all roles', () => {
    // PROJECT_LEAD has WRITE on RISKS at BUILD; CLIENT_REVIEWER has NONE.
    expect(
      evaluateEffectiveAction(['PROJECT_LEAD', 'CLIENT_REVIEWER'], 'BUILD', 'RISKS'),
    ).toBe('WRITE');
  });

  it('returns NONE when no role grants any access', () => {
    // CLIENT_REVIEWER has NONE on BILLING; CLIENT_LEAD has NONE on BILLING.
    expect(
      evaluateEffectiveAction(['CLIENT_REVIEWER', 'CLIENT_LEAD'], 'BUILD', 'BILLING'),
    ).toBe('NONE');
  });

  it('returns NONE when the role list is empty', () => {
    expect(evaluateEffectiveAction([], 'BUILD', 'WIZARD_ANSWERS')).toBe('NONE');
  });

  it('APP_ADMIN trumps every other role in the stack', () => {
    expect(
      evaluateEffectiveAction(['CLIENT_REVIEWER', 'APP_ADMIN'], 'ARCHIVED', 'BILLING'),
    ).toBe('WRITE');
  });
});

// ─── Type completeness sentinel ──────────────────────────────────────────────

describe('matrix completeness', () => {
  it('every role × every stage × every resource returns a defined Action', () => {
    for (const role of ALL_ROLES) {
      for (const stage of LIFECYCLE_STAGES) {
        for (const resource of RESOURCES) {
          const r: Role = role;
          const s: Stage = stage;
          const res: Resource = resource;
          const a = getActionForRole(r, s, res);
          expect(['NONE', 'READ', 'WRITE']).toContain(a);
        }
      }
    }
  });
});
