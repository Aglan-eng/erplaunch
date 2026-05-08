/**
 * Phase 46.3 — pure tests for the proposal generator.
 */
import { describe, it, expect } from 'vitest';
import {
  generateProposal,
  computeProposalPricing,
  type ProposalInput,
} from '../../../src/services/generators/proposalGenerator.js';

function baseInput(over: Partial<ProposalInput> = {}): ProposalInput {
  return {
    clientName: 'Acme Industries',
    decisionMakerName: 'Jane Tate',
    adaptorId: 'netsuite',
    adaptorName: 'NetSuite',
    pains: ['multi-entity-consolidation', 'reporting-lag'],
    modulesOfInterest: [
      { id: 'gl-ar-ap', label: 'General Ledger / AR / AP' },
      { id: 'inventory', label: 'Inventory' },
    ],
    estimatedUsers: 50,
    estimatedLocations: 3,
    geographyMultiEntity: 'single-country-multi-entity',
    targetGoLive: '6-12m',
    perUserPricing: { 'gl-ar-ap': 1500 },
    defaultPerUserPrice: 1000,
    firmName: 'ERPLaunch Partners',
    preparedAt: '2026-05-08',
    ...over,
  };
}

describe('generateProposal — file inventory', () => {
  it('emits the 7 canonical Proposal/ files', () => {
    const out = generateProposal(baseInput());
    expect(out['Proposal/Cover_Letter.docx']).toBeDefined();
    expect(out['Proposal/Executive_Summary.html']).toBeDefined();
    expect(out['Proposal/Solution_Overview.html']).toBeDefined();
    expect(out['Proposal/Implementation_Approach.html']).toBeDefined();
    expect(out['Proposal/Pricing_Schedule.docx']).toBeDefined();
    expect(out['Proposal/Why_Us.docx']).toBeDefined();
    expect(out['Proposal/Terms_and_Conditions.docx']).toBeDefined();
  });
});

describe('Cover_Letter content', () => {
  it('addresses the named decision-maker', () => {
    const md = generateProposal(baseInput())['Proposal/Cover_Letter.docx'];
    expect(md).toContain('Jane Tate');
  });

  it('falls back to a generic salutation when decision-maker unknown', () => {
    const md = generateProposal(baseInput({ decisionMakerName: null }))['Proposal/Cover_Letter.docx'];
    expect(md).toContain('Decision-maker');
  });

  it('mentions the firm + the adaptor + the validity date', () => {
    const md = generateProposal(baseInput())['Proposal/Cover_Letter.docx'];
    expect(md).toContain('ERPLaunch Partners');
    expect(md).toContain('NetSuite');
    expect(md).toMatch(/valid through \d{4}-\d{2}-\d{2}/);
  });

  it('honours a firm-supplied custom template', () => {
    const md = generateProposal(
      baseInput({
        firmCoverLetterTemplate: 'Dear {{decisionMaker}}, custom template body.',
      }),
    )['Proposal/Cover_Letter.docx'];
    expect(md).toContain('Dear Jane Tate, custom template body.');
  });
});

describe('Executive_Summary content', () => {
  it('renders the pain-point list', () => {
    const md = generateProposal(baseInput())['Proposal/Executive_Summary.html'];
    expect(md).toContain('Multi-entity consolidation pain');
    expect(md).toContain('Slow / inaccurate reporting');
  });

  it('reports the total first-year investment', () => {
    const md = generateProposal(baseInput())['Proposal/Executive_Summary.html'];
    expect(md).toMatch(/\$[\d,]+/);
  });
});

describe('computeProposalPricing — math', () => {
  it('extends per-user pricing × users for each module', () => {
    const p = computeProposalPricing(baseInput());
    // gl-ar-ap: 1500 × 50 = 75,000; inventory falls back to default 1000 × 50 = 50,000
    const baseExpected = 75_000 + 50_000;
    expect(p.baseAnnualLicense).toBe(baseExpected);
  });

  it('applies the geography multiplier', () => {
    const p = computeProposalPricing(baseInput()); // single-country-multi-entity = 1.15
    expect(p.geographyMultiplier).toBe(1.15);
    expect(p.totalAnnualLicense).toBeCloseTo(125_000 * 1.15, 5);
  });

  it('uses 1.0 multiplier for single-entity engagements', () => {
    const p = computeProposalPricing(baseInput({ geographyMultiEntity: 'single' }));
    expect(p.geographyMultiplier).toBe(1.0);
  });

  it('uses 1.30 multiplier for multi-country engagements', () => {
    const p = computeProposalPricing(baseInput({ geographyMultiEntity: 'multi-country' }));
    expect(p.geographyMultiplier).toBe(1.3);
  });

  it('phases sum to the implementation services total', () => {
    const p = computeProposalPricing(baseInput());
    const sum = p.phases.reduce((a, b) => a + b.amount, 0);
    expect(sum).toBeCloseTo(p.implementationServices, 1);
  });

  it('honours a custom phase split that does not sum to 1', () => {
    const p = computeProposalPricing(
      baseInput({ phaseSplit: { Discovery: 50, Configure: 30, Hypercare: 20 } }),
    );
    expect(p.phases.length).toBe(3);
    const sum = p.phases.reduce((a, b) => a + b.amount, 0);
    expect(sum).toBeCloseTo(p.implementationServices, 1);
  });

  it('honours custom validityDays', () => {
    const p = computeProposalPricing(baseInput({ validityDays: 60 }));
    expect(p.validityDays).toBe(60);
    // 60 days from 2026-05-08 = 2026-07-07.
    expect(p.validUntil).toBe('2026-07-07');
  });
});

describe('Pricing_Schedule content', () => {
  it('lists every module + per-user price + extended total', () => {
    const md = generateProposal(baseInput())['Proposal/Pricing_Schedule.docx'];
    expect(md).toContain('General Ledger / AR / AP');
    expect(md).toContain('Inventory');
    expect(md).toContain('$1,500');
    expect(md).toMatch(/\$75,000/);
  });

  it('shows the geography multiplier explicitly', () => {
    const md = generateProposal(baseInput())['Proposal/Pricing_Schedule.docx'];
    expect(md).toContain('1.15');
  });
});

describe('Why_Us / Terms', () => {
  it('uses firm-customised Why_Us when supplied', () => {
    const md = generateProposal(baseInput({ firmWhyUs: '## Custom WHY-US text' }))[
      'Proposal/Why_Us.docx'
    ];
    expect(md).toContain('Custom WHY-US text');
  });

  it('uses firm-customised T&Cs when supplied', () => {
    const md = generateProposal(baseInput({ firmTermsAndConditions: '## Custom contract terms' }))[
      'Proposal/Terms_and_Conditions.docx'
    ];
    expect(md).toContain('Custom contract terms');
  });

  it('default Why_Us mentions the firm name + the adaptor', () => {
    const md = generateProposal(baseInput())['Proposal/Why_Us.docx'];
    expect(md).toContain('ERPLaunch Partners');
    expect(md).toContain('NetSuite');
  });
});

describe('Edge cases', () => {
  it('handles a prospect with no recorded pains', () => {
    const md = generateProposal(baseInput({ pains: [] }))['Proposal/Cover_Letter.docx'];
    expect(md).toContain('operational scale');
  });

  it('handles a prospect with only the default per-user price', () => {
    const p = computeProposalPricing(baseInput({ perUserPricing: {} }));
    expect(p.baseAnnualLicense).toBe(50 * 1000 * 2);
  });
});
