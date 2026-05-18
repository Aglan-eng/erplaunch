/**
 * Phase 52.1 — pure helpers from db/customer.ts.
 *
 * No DB needed for these — they exercise the stage mapping, group
 * derivation, effective-owner computation, and health-band logic in
 * isolation. The DB-backed integration test lives in
 * `customer.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  CUSTOMER_STAGES,
  isCustomerStage,
  stageGroup,
  mapEngagementStatusToStage,
  effectiveOwnerUserId,
  healthBand,
} from '../../src/db/customer.js';

describe('CUSTOMER_STAGES enum', () => {
  it('contains all 16 stages in journey order', () => {
    expect(CUSTOMER_STAGES).toEqual([
      'LEAD',
      'QUALIFIED',
      'PROPOSAL',
      'NEGOTIATION',
      'WON',
      'DISCOVERY',
      'SCOPING',
      'BUILD',
      'UAT',
      'GOLIVE',
      'HYPERCARE',
      'LIVE_SLA',
      'RENEWAL_DUE',
      'RENEWED',
      'LOST',
      'CHURNED',
    ]);
  });
});

describe('isCustomerStage', () => {
  it('accepts every value in the enum', () => {
    for (const s of CUSTOMER_STAGES) {
      expect(isCustomerStage(s)).toBe(true);
    }
  });

  it('rejects strings that look close but are not in the enum', () => {
    expect(isCustomerStage('lead')).toBe(false); // case-sensitive
    expect(isCustomerStage('PROSPECT')).toBe(false); // old vocabulary
    expect(isCustomerStage('SLA_ACTIVE')).toBe(false); // old vocabulary
    expect(isCustomerStage('CLOSEOUT')).toBe(false); // old vocabulary
  });

  it('rejects non-string inputs', () => {
    expect(isCustomerStage(undefined)).toBe(false);
    expect(isCustomerStage(null)).toBe(false);
    expect(isCustomerStage(0)).toBe(false);
    expect(isCustomerStage({})).toBe(false);
  });
});

describe('stageGroup', () => {
  it('maps every pre-sales stage to "pre-sales"', () => {
    expect(stageGroup('LEAD')).toBe('pre-sales');
    expect(stageGroup('QUALIFIED')).toBe('pre-sales');
    expect(stageGroup('PROPOSAL')).toBe('pre-sales');
    expect(stageGroup('NEGOTIATION')).toBe('pre-sales');
  });

  it('maps WON to "closing"', () => {
    expect(stageGroup('WON')).toBe('closing');
  });

  it('maps every delivery stage to "delivery"', () => {
    expect(stageGroup('DISCOVERY')).toBe('delivery');
    expect(stageGroup('SCOPING')).toBe('delivery');
    expect(stageGroup('BUILD')).toBe('delivery');
    expect(stageGroup('UAT')).toBe('delivery');
  });

  it('maps launch stages to "launch"', () => {
    expect(stageGroup('GOLIVE')).toBe('launch');
    expect(stageGroup('HYPERCARE')).toBe('launch');
  });

  it('maps live stages to "live"', () => {
    expect(stageGroup('LIVE_SLA')).toBe('live');
    expect(stageGroup('RENEWAL_DUE')).toBe('live');
  });

  it('maps every terminal stage to "terminal"', () => {
    expect(stageGroup('RENEWED')).toBe('terminal');
    expect(stageGroup('LOST')).toBe('terminal');
    expect(stageGroup('CHURNED')).toBe('terminal');
  });

  it('covers every stage in the enum (no gaps)', () => {
    // Defence-in-depth: if a future commit adds a stage to
    // CUSTOMER_STAGES but forgets to update the STAGE_GROUP_MAP,
    // calling stageGroup will return undefined and this catches it.
    for (const s of CUSTOMER_STAGES) {
      expect(stageGroup(s)).toMatch(/^(pre-sales|closing|delivery|launch|live|terminal)$/);
    }
  });
});

describe('mapEngagementStatusToStage', () => {
  it('maps the full Engagement.status enum to Customer.currentStage', () => {
    expect(mapEngagementStatusToStage('PROSPECT', null)).toBe('LEAD');
    expect(mapEngagementStatusToStage('PROPOSED', null)).toBe('PROPOSAL');
    expect(mapEngagementStatusToStage('CONTRACTED', null)).toBe('WON');
    expect(mapEngagementStatusToStage('DISCOVERY', null)).toBe('DISCOVERY');
    expect(mapEngagementStatusToStage('SCOPING', null)).toBe('SCOPING');
    expect(mapEngagementStatusToStage('BUILD', null)).toBe('BUILD');
    expect(mapEngagementStatusToStage('UAT', null)).toBe('UAT');
    expect(mapEngagementStatusToStage('GOLIVE', null)).toBe('GOLIVE');
    expect(mapEngagementStatusToStage('CLOSEOUT', null)).toBe('HYPERCARE');
    expect(mapEngagementStatusToStage('SLA_ACTIVE', null)).toBe('LIVE_SLA');
  });

  it('uses previousStatus when archived', () => {
    expect(mapEngagementStatusToStage('ARCHIVED', 'SLA_ACTIVE')).toBe('LIVE_SLA');
    expect(mapEngagementStatusToStage('ARCHIVED', 'BUILD')).toBe('BUILD');
    expect(mapEngagementStatusToStage('ARCHIVED', 'PROPOSED')).toBe('PROPOSAL');
  });

  it('falls back to DISCOVERY when archived with no previousStatus', () => {
    expect(mapEngagementStatusToStage('ARCHIVED', null)).toBe('DISCOVERY');
    expect(mapEngagementStatusToStage('ARCHIVED', undefined)).toBe('DISCOVERY');
  });

  it('falls back to DISCOVERY for unknown future statuses (forward-compat)', () => {
    expect(mapEngagementStatusToStage('SOMETHING_NEW', null)).toBe('DISCOVERY');
    expect(mapEngagementStatusToStage(undefined, null)).toBe('DISCOVERY');
    expect(mapEngagementStatusToStage(null, null)).toBe('DISCOVERY');
  });
});

describe('effectiveOwnerUserId', () => {
  const baseCustomer = {
    salesOwnerUserId: 'sales-user',
    projectLeadUserId: 'pm-user',
    csmUserId: 'csm-user',
  };

  it('returns salesOwner for pre-sales stages', () => {
    for (const stage of ['LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION'] as const) {
      expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: stage })).toBe('sales-user');
    }
  });

  it('returns salesOwner for WON (closing stage = sales close-out)', () => {
    expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: 'WON' })).toBe('sales-user');
  });

  it('returns projectLead for delivery stages', () => {
    for (const stage of ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT'] as const) {
      expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: stage })).toBe('pm-user');
    }
  });

  it('returns csmUser for live stages (LIVE_SLA, RENEWAL_DUE)', () => {
    expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: 'LIVE_SLA' })).toBe('csm-user');
    expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: 'RENEWAL_DUE' })).toBe('csm-user');
  });

  it('returns csmUser for HYPERCARE + RENEWED', () => {
    expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: 'HYPERCARE' })).toBe('csm-user');
    expect(effectiveOwnerUserId({ ...baseCustomer, currentStage: 'RENEWED' })).toBe('csm-user');
  });

  it('falls back through owners for terminal negatives', () => {
    // CHURNED with only sales owner → sales owner
    expect(
      effectiveOwnerUserId({
        currentStage: 'CHURNED',
        salesOwnerUserId: 'sales-user',
        projectLeadUserId: null,
        csmUserId: null,
      }),
    ).toBe('sales-user');
    // LOST with both PM and sales → CSM null → falls back to PM
    expect(
      effectiveOwnerUserId({
        currentStage: 'LOST',
        salesOwnerUserId: 'sales-user',
        projectLeadUserId: 'pm-user',
        csmUserId: null,
      }),
    ).toBe('pm-user');
    // LOST with everyone null → null
    expect(
      effectiveOwnerUserId({
        currentStage: 'LOST',
        salesOwnerUserId: null,
        projectLeadUserId: null,
        csmUserId: null,
      }),
    ).toBeNull();
  });

  it('falls back across owner columns when the stage-canonical one is null (Phase 52.3.1 spec §5)', () => {
    // BUILD stage → canonical column is projectLeadUserId. Old
    // behavior returned null; the strengthened helper now falls
    // back to csmUserId (closest-role priority) so the UI surfaces
    // SOMEONE rather than a blank cell.
    expect(
      effectiveOwnerUserId({
        currentStage: 'BUILD',
        salesOwnerUserId: 'sales-user',
        projectLeadUserId: null,
        csmUserId: 'csm-user',
      }),
    ).toBe('csm-user');
  });

  it('returns null when ALL owner columns are unset (the only true-null case)', () => {
    expect(
      effectiveOwnerUserId({
        currentStage: 'BUILD',
        salesOwnerUserId: null,
        projectLeadUserId: null,
        csmUserId: null,
      }),
    ).toBeNull();
  });
});

describe('healthBand', () => {
  it('returns "red" for health < 30', () => {
    expect(healthBand(0)).toBe('red');
    expect(healthBand(15)).toBe('red');
    expect(healthBand(29)).toBe('red');
  });

  it('returns "yellow" for health 30..69', () => {
    expect(healthBand(30)).toBe('yellow');
    expect(healthBand(50)).toBe('yellow');
    expect(healthBand(69)).toBe('yellow');
  });

  it('returns "green" for health >= 70', () => {
    expect(healthBand(70)).toBe('green');
    expect(healthBand(85)).toBe('green');
    expect(healthBand(100)).toBe('green');
  });

  it('returns "unknown" for null', () => {
    expect(healthBand(null)).toBe('unknown');
  });
});
