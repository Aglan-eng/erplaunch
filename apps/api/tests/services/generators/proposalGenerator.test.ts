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

// ─── Phase 49.2 — Brand Pack template field consumption ──────────────────

describe('Phase 49.2 — firm Brand Pack overrides', () => {
  it('uses firmMethodology when supplied (overrides default 5-phase list)', () => {
    const md = generateProposal(
      baseInput({
        firmMethodology: [
          { step: 1, title: 'Frame', body: 'baseline the operating model.' },
          { step: 2, title: 'Build', body: 'cut the new system.' },
          { step: 3, title: 'Land', body: 'go live with confidence.' },
        ],
      }),
    )['Proposal/Implementation_Approach.html'];
    expect(md).toContain('<strong>Frame</strong>');
    expect(md).toContain('<strong>Build</strong>');
    expect(md).toContain('<strong>Land</strong>');
    // The default platform phases shouldn't appear when firmMethodology
    // is supplied — Configure is the platform default phase 2 label.
    expect(md).not.toContain('<strong>Configure</strong>');
    expect(md).toContain('a 3-phase methodology');
  });

  it('falls back to the 5-phase platform default when no firmMethodology supplied', () => {
    const md = generateProposal(baseInput())['Proposal/Implementation_Approach.html'];
    expect(md).toContain('<strong>Discovery</strong>');
    expect(md).toContain('<strong>Configure</strong>');
    expect(md).toContain('<strong>UAT</strong>');
    expect(md).toContain('<strong>Go-Live</strong>');
    expect(md).toContain('<strong>Hypercare</strong>');
    expect(md).toContain('a 5-phase methodology');
  });

  it('appends a Roadmap section when firmRoadmap is supplied', () => {
    const md = generateProposal(
      baseInput({
        firmRoadmap: [
          { phase: 1, title: 'Quick wins', body: 'first 90 days.' },
          { phase: 2, title: 'Scale', body: 'next 6 months.' },
        ],
      }),
    )['Proposal/Implementation_Approach.html'];
    expect(md).toContain('<h2>Roadmap</h2>');
    expect(md).toContain('<strong>Quick wins</strong>');
    expect(md).toContain('<strong>Scale</strong>');
  });

  it('omits the Roadmap section when firmRoadmap is empty/absent', () => {
    const md = generateProposal(baseInput())['Proposal/Implementation_Approach.html'];
    expect(md).not.toContain('<h2>Roadmap</h2>');
  });

  it('renders firmTagline + firmCompanyDescription in Why_Us when firmWhyUs is absent', () => {
    const md = generateProposal(
      baseInput({
        firmTagline: 'Outcome-first ERP delivery.',
        firmCompanyDescription:
          'Our team has shipped 200+ implementations across the GCC and the UK.',
      }),
    )['Proposal/Why_Us.docx'];
    expect(md).toContain('Outcome-first ERP delivery.');
    expect(md).toContain('200+ implementations');
  });

  it('firmWhyUs takes precedence over firmTagline + firmCompanyDescription', () => {
    const md = generateProposal(
      baseInput({
        firmWhyUs: '# Why Us\n\nCustom override copy.',
        firmTagline: 'Should not appear',
        firmCompanyDescription: 'Should also not appear',
      }),
    )['Proposal/Why_Us.docx'];
    expect(md).toContain('Custom override copy');
    expect(md).not.toContain('Should not appear');
    expect(md).not.toContain('Should also not appear');
  });

  it('surfaces a matched industry vertical in Solution_Overview', () => {
    const md = generateProposal(
      baseInput({
        industry: 'retail',
        firmIndustryVerticals: [
          {
            name: 'Retail and Wholesale Distribution',
            outcome: 'Single source of truth for SKU-level margin.',
            strategicContext: 'Omnichannel operators consolidating ERP.',
            approach: 'Phase 1 GL + AR/AP, Phase 2 inventory + fulfilment.',
          },
          {
            name: 'Manufacturing',
            outcome: 'Should not appear',
            strategicContext: 'Should not appear',
            approach: 'Should not appear',
          },
        ],
      }),
    )['Proposal/Solution_Overview.html'];
    expect(md).toContain('For Retail and Wholesale Distribution');
    expect(md).toContain('SKU-level margin');
    expect(md).not.toContain('Should not appear');
  });

  it('industry-vertical match is case-insensitive prefix', () => {
    const md = generateProposal(
      baseInput({
        industry: 'MANUFACTURING',
        firmIndustryVerticals: [
          {
            name: 'Manufacturing and Light Assembly',
            outcome: 'Cycle-time reduction',
            strategicContext: 'Discrete + process MFG',
            approach: 'BOM + WO modules first',
          },
        ],
      }),
    )['Proposal/Solution_Overview.html'];
    expect(md).toContain('Manufacturing and Light Assembly');
  });

  it('omits the vertical section when no industry is supplied', () => {
    const md = generateProposal(
      baseInput({
        firmIndustryVerticals: [
          {
            name: 'Retail',
            outcome: 'x',
            strategicContext: 'y',
            approach: 'z',
          },
        ],
      }),
    )['Proposal/Solution_Overview.html'];
    // Heading appears only when a vertical actually matches.
    expect(md).not.toContain('<h2>For ');
  });

  it('injects a CTA from firmCtaOptions into the cover letter when {{cta}} is present', () => {
    const md = generateProposal(
      baseInput({
        firmCoverLetterTemplate:
          'Hi {{decisionMaker}}, {{firmName}} for {{adaptorName}}. {{cta}}',
        firmCtaOptions: [
          { label: 'Lock in your kickoff date this week.', description: 'urgency' },
        ],
      }),
    )['Proposal/Cover_Letter.docx'];
    expect(md).toContain('Lock in your kickoff date this week.');
  });

  it('renders empty CTA when firmCtaOptions is absent (no `{{cta}}` artifact)', () => {
    const md = generateProposal(
      baseInput({
        firmCoverLetterTemplate: 'Body text. {{cta}}',
      }),
    )['Proposal/Cover_Letter.docx'];
    // {{cta}} token is replaced with empty string — no literal token leaks.
    expect(md).not.toContain('{{cta}}');
  });

  it('NULL-fields firm produces the exact same output as a baseline call', () => {
    // Pin the spec acceptance: a firm with all template fields NULL
    // must still produce a valid proposal. The output must match the
    // baseline (no firm fields supplied) exactly so we can prove no
    // firm-specific drift sneaks in via the new code paths.
    const baseline = generateProposal(baseInput());
    const nullFields = generateProposal(
      baseInput({
        firmTagline: null,
        firmCompanyDescription: null,
        firmMethodology: undefined,
        firmRoadmap: undefined,
        firmIndustryVerticals: undefined,
        firmCtaOptions: undefined,
        industry: null,
      }),
    );
    expect(nullFields['Proposal/Implementation_Approach.html']).toBe(
      baseline['Proposal/Implementation_Approach.html'],
    );
    expect(nullFields['Proposal/Why_Us.docx']).toBe(baseline['Proposal/Why_Us.docx']);
    expect(nullFields['Proposal/Solution_Overview.html']).toBe(
      baseline['Proposal/Solution_Overview.html'],
    );
  });
});
