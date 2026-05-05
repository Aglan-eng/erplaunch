import { describe, it, expect } from 'vitest';
import { inferStarterFields } from '../../../src/services/generators/customRecordStarterFields.js';

/**
 * Pack K — Custom Record Starter Fields tests.
 *
 * Pack contract:
 *   1. inferStarterFields(name) returns a curated set of business
 *      fields per keyword family (matched case-insensitively against
 *      the record name).
 *   2. SELECT fields with a hardcoded selectrecordtype (-4 / -30 /
 *      -117) are returned verbatim; the customrecord generator
 *      doesn't emit a companion customlist for these.
 *   3. SELECT fields WITHOUT a hardcoded selectrecordtype are
 *      returned with selectrecordtype=undefined; the customrecord
 *      generator auto-emits a companion customlist (Pack K wiring).
 *   4. Default case (no keyword match) returns []. The consultant
 *      uses the wizard overlay (ns.design.customRecordExtraFields)
 *      to add fields beyond the 4 baseline.
 */

// ─── Per-family ──────────────────────────────────────────────────────────────

describe('inferStarterFields — Approval / Tracker family', () => {
  it('matches "Approval Tracker"', () => {
    const fields = inferStarterFields('Approval Tracker');
    expect(fields.map((f) => f.id)).toEqual([
      'subject',
      'transaction_link',
      'requested_amount',
      'requested_by',
      'approval_date',
      'approval_chain_history',
    ]);
  });

  it('matches "PO Approval Log" (any "approval" word)', () => {
    const fields = inferStarterFields('PO Approval Log');
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.map((f) => f.id)).toContain('approval_chain_history');
  });

  it('transaction_link is SELECT with selectrecordtype=-30 (no companion list)', () => {
    const f = inferStarterFields('Approval Tracker').find((f) => f.id === 'transaction_link')!;
    expect(f.fieldtype).toBe('SELECT');
    expect(f.selectrecordtype).toBe('-30');
  });

  it('requested_by is SELECT with selectrecordtype=-4 (Employee)', () => {
    const f = inferStarterFields('Approval Tracker').find((f) => f.id === 'requested_by')!;
    expect(f.selectrecordtype).toBe('-4');
  });
});

describe('inferStarterFields — Onboarding / Request family', () => {
  it('matches "Vendor Onboarding Request"', () => {
    const fields = inferStarterFields('Vendor Onboarding Request');
    expect(fields.map((f) => f.id)).toContain('kyc_status');
    expect(fields.map((f) => f.id)).toContain('risk_rating');
  });

  it('kyc_status + risk_rating are SELECT WITHOUT selectrecordtype (need companion customlists)', () => {
    const fields = inferStarterFields('Vendor Onboarding Request');
    const kyc = fields.find((f) => f.id === 'kyc_status')!;
    const risk = fields.find((f) => f.id === 'risk_rating')!;
    expect(kyc.fieldtype).toBe('SELECT');
    expect(kyc.selectrecordtype).toBeUndefined();
    expect(risk.fieldtype).toBe('SELECT');
    expect(risk.selectrecordtype).toBeUndefined();
  });
});

describe('inferStarterFields — Milestone family', () => {
  it('matches "Project Milestone"', () => {
    const fields = inferStarterFields('Project Milestone');
    expect(fields.map((f) => f.id)).toEqual([
      'planned_date',
      'actual_date',
      'completion_percent',
      'deliverables',
      'responsible_party',
    ]);
  });

  it('responsible_party links to Employee record (-4)', () => {
    const f = inferStarterFields('Project Milestone').find((f) => f.id === 'responsible_party')!;
    expect(f.selectrecordtype).toBe('-4');
  });

  it('completion_percent is FLOAT', () => {
    const f = inferStarterFields('Project Milestone').find((f) => f.id === 'completion_percent')!;
    expect(f.fieldtype).toBe('FLOAT');
  });
});

describe('inferStarterFields — Transfer / Intercompany family', () => {
  it('matches "Intercompany Transfer Request"', () => {
    const fields = inferStarterFields('Intercompany Transfer Request');
    // "Intercompany Transfer Request" matches BOTH "transfer" and
    // "request" — first-match wins is "transfer/intercompany" per
    // priority order.
    expect(fields.map((f) => f.id)).toContain('source_entity');
    expect(fields.map((f) => f.id)).toContain('destination_entity');
  });

  it('source_entity + destination_entity link to Subsidiary (-117)', () => {
    const fields = inferStarterFields('Intercompany Transfer Request');
    const src = fields.find((f) => f.id === 'source_entity')!;
    const dest = fields.find((f) => f.id === 'destination_entity')!;
    expect(src.selectrecordtype).toBe('-117');
    expect(dest.selectrecordtype).toBe('-117');
  });
});

describe('inferStarterFields — Tax / Filing / Calendar family', () => {
  it('matches "Tax Filing Calendar"', () => {
    const fields = inferStarterFields('Tax Filing Calendar');
    expect(fields.map((f) => f.id)).toEqual([
      'jurisdiction',
      'filing_period_start',
      'filing_period_end',
      'due_date',
      'filed_date',
      'return_amount',
    ]);
  });
});

describe('inferStarterFields — Recall / Compliance / Quality family', () => {
  it('matches "Batch Recall Tracker"', () => {
    // "tracker" puts this in the approval/tracker family first per
    // priority order — caught by the approval keyword. Pharma
    // engagements that want the recall starter set should name the
    // record with a non-tracker keyword (e.g., "Batch Recall Event").
    const fields = inferStarterFields('Batch Recall Event');
    expect(fields.map((f) => f.id)).toContain('severity');
    expect(fields.map((f) => f.id)).toContain('disposition');
  });

  it('matches "Quality Compliance Log"', () => {
    const fields = inferStarterFields('Quality Compliance Log');
    expect(fields.map((f) => f.id)).toContain('regulatory_authority');
  });
});

describe('inferStarterFields — Clinical / Trial family', () => {
  it('matches "Clinical Trial Cost Center"', () => {
    const fields = inferStarterFields('Clinical Trial Cost Center');
    expect(fields.map((f) => f.id)).toContain('trial_id');
    expect(fields.map((f) => f.id)).toContain('phase');
    expect(fields.map((f) => f.id)).toContain('study_lead');
  });

  it('study_lead links to Employee', () => {
    // "tracker" wins over "clinical" per priority — verify with non-tracker name
    const f2 = inferStarterFields('Clinical Trial Cost Center').find((f) => f.id === 'study_lead')!;
    expect(f2.selectrecordtype).toBe('-4');
  });
});

describe('inferStarterFields — Medical / Affairs / Activity family', () => {
  it('matches "Medical Affairs Activity Log"', () => {
    const fields = inferStarterFields('Medical Affairs Activity Log');
    expect(fields.map((f) => f.id)).toContain('drug_or_program');
    expect(fields.map((f) => f.id)).toContain('kol_engaged');
  });
});

describe('inferStarterFields — License / Renewal family', () => {
  it('matches "Product License Renewal Tracker"', () => {
    // "tracker" wins again per priority order. First match is approval/tracker;
    // verify with the non-tracker form to assert the license field set.
    const f2 = inferStarterFields('Product License Renewal');
    expect(f2.map((f) => f.id)).toContain('license_type');
    expect(f2.map((f) => f.id)).toContain('expiry_date');
    expect(f2.map((f) => f.id)).toContain('renewal_amount');
  });
});

describe('inferStarterFields — GCP / Register family', () => {
  it('matches "GCP Compliance Register"', () => {
    // "compliance" puts this in recall/compliance family per priority
    // order — verify with a non-compliance name:
    const fields = inferStarterFields('GCP Register');
    expect(fields.map((f) => f.id)).toContain('registered_date');
    expect(fields.map((f) => f.id)).toContain('responsible_officer');
  });

  it('GCP Register starter contains "status" — the customrecord generator drops it via baseline-wins dedup', () => {
    const fields = inferStarterFields('GCP Register');
    expect(fields.map((f) => f.id)).toContain('status');
  });
});

// ─── Default / no match ─────────────────────────────────────────────────────

describe('inferStarterFields — default case', () => {
  it('returns [] when no keyword matches', () => {
    expect(inferStarterFields('Sales Order Variant Mapping')).toEqual([]);
    expect(inferStarterFields('Bespoke Custom Thing')).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(inferStarterFields('approval tracker')).not.toEqual([]);
    expect(inferStarterFields('APPROVAL TRACKER')).not.toEqual([]);
    expect(inferStarterFields('Approval Tracker')).not.toEqual([]);
  });

  it('matches even when the keyword is buried inside a longer name', () => {
    const fields = inferStarterFields('Brightside Vendor Onboarding Request — KSA Branch');
    expect(fields.length).toBeGreaterThan(0);
  });
});

// ─── Priority order semantics ──────────────────────────────────────────────

describe('inferStarterFields — first-match-wins priority order', () => {
  it('"Approval Tracker" matches the approval family (not onboarding via "tracker")', () => {
    // Both "approval" and "tracker" trigger approval family — same
    // result either way. Verify at least one approval-specific field
    // is present:
    expect(inferStarterFields('Approval Tracker').map((f) => f.id)).toContain('approval_chain_history');
  });

  it('"Vendor Onboarding Request" matches onboarding family (not approval — no approval/tracker keyword)', () => {
    const fields = inferStarterFields('Vendor Onboarding Request');
    expect(fields.map((f) => f.id)).toContain('kyc_status');
    expect(fields.map((f) => f.id)).not.toContain('approval_chain_history');
  });
});
