import { describe, it, expect } from 'vitest';
import { generatePerRoleTrainingGuides } from '../../../src/services/generators/perRoleTrainingGuideGenerator.js';

/**
 * Pack U — Per-Role Training Guide tests.
 *
 * Covers:
 *   - Parsing of trainingPerRole + standardRoleCustomization sources
 *   - Role-family classification via classifyRoleFamily
 *   - Curriculum auto-supplement when consultant input is short
 *   - Delivery-mode + cascade-strategy + assessment branching
 *   - File-path layout
 *   - Cross-references to Pack T artefacts (Sign_Off_Matrix etc.)
 *   - Vacuous-truth contract on empty input
 */

describe('Pack U — perRoleTrainingGuideGenerator: parsing', () => {
  it('parses one role per line into one emitted guide', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Vendor Bill Entry, 3-Way Match, Payment Run',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].roleName).toBe('AP Clerk');
    expect(out.emitted[0].family).toBe('AP');
  });

  it('emits one Markdown file per role into Documentation/Training/', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole:
        'AP Clerk: Vendor Bill Entry, 3-Way Match\n' +
        'CFO: Trial Balance, Multi-Entity Close',
    });
    const paths = Object.keys(out.files).sort();
    expect(paths).toEqual([
      'Documentation/Training/ap-clerk_Training_Guide.md',
      'Documentation/Training/cfo_Training_Guide.md',
    ]);
  });

  it('supplementary roles from standardRoleCustomization get a guide with auto-supplemented curriculum', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'CFO: Trial Balance',
      standardRoleCustomization:
        'A/P Clerk: remove "Approve Bills" permission\n' +
        'AR Clerk: add Manage Customer Refunds permission',
    });
    const roles = out.emitted.map((e) => e.roleName).sort();
    expect(roles).toEqual(['A/P Clerk', 'AR Clerk', 'CFO']);
  });

  it('declared trumps supplementary — a role in both sources keeps its declared topics', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Topic A, Topic B, Topic C',
      standardRoleCustomization: 'AP Clerk: should not override',
    });
    expect(out.emitted).toHaveLength(1);
    const md = Object.values(out.files)[0];
    expect(md).toContain('Topic A');
    expect(md).toContain('Topic B');
    expect(md).toContain('Topic C');
  });

  it('case-insensitive dedup between declared + supplementary', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Topic A, Topic B, Topic C',
      standardRoleCustomization: 'ap clerk: extra perms',
    });
    expect(out.emitted).toHaveLength(1);
  });

  it('quote-strip pre-pass on standardRoleCustomization handles quoted permission names', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      standardRoleCustomization: 'A/P Clerk: remove "Approve Bills" permission',
    });
    expect(out.emitted[0].roleName).toBe('A/P Clerk');
  });

  it('skips blank lines + trims whitespace', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: '\n  AP Clerk: Vendor Bill Entry  \n\n   \n',
    });
    expect(out.emitted).toHaveLength(1);
  });
});

describe('Pack U — perRoleTrainingGuideGenerator: curriculum + family inference', () => {
  it('auto-supplements canonical curriculum when topics < 3', () => {
    // Single declared topic → 3 more from AP canonical curriculum.
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Vendor Bill Entry',
    });
    expect(out.emitted[0].topics.length).toBeGreaterThanOrEqual(3);
    const md = Object.values(out.files)[0];
    expect(md).toContain('### Module 1: Vendor Bill Entry');
    // Subsequent modules come from canonical AP curriculum.
    expect(md).toContain('### Module 2:');
    expect(md).toContain('### Module 3:');
  });

  it('does NOT supplement when consultant provides 3+ topics', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: A, B, C',
    });
    expect(out.emitted[0].topics).toEqual(['A', 'B', 'C']);
  });

  it('caps total modules at 7 when canonical curriculum extends beyond consultant input', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'CFO: One',
    });
    expect(out.emitted[0].topics.length).toBeLessThanOrEqual(7);
  });

  it('AP family detected from "AP Clerk"', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x',
    });
    expect(out.emitted[0].family).toBe('AP');
  });

  it('AR family detected from "AR Clerk"', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AR Clerk: x',
    });
    expect(out.emitted[0].family).toBe('AR');
  });

  it('FINANCE_BROAD family detected from "CFO" (not SALES via stray manager keyword)', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'CFO: x',
    });
    expect(out.emitted[0].family).toBe('FINANCE_BROAD');
  });

  it('SALES family detected from "Sales Manager"', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'Sales Manager: x',
    });
    expect(out.emitted[0].family).toBe('SALES');
  });

  it('IT family detected from "IT Admin"', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'IT Admin: x',
    });
    expect(out.emitted[0].family).toBe('IT');
  });

  it('GENERIC family for unrecognized role names', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'Receptionist: x',
    });
    expect(out.emitted[0].family).toBe('GENERIC');
  });
});

describe('Pack U — perRoleTrainingGuideGenerator: delivery mode + cascade strategy', () => {
  it('IN_PERSON delivery mode renders "training room" format text', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Vendor Bill Entry, 3-Way Match, Payment Run',
      deliveryMode: 'IN_PERSON',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('training room');
  });

  it('SELF_PACED_VIDEO delivery mode renders "Pre-recorded walkthrough" format text', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      deliveryMode: 'SELF_PACED_VIDEO',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Pre-recorded walkthrough');
  });

  it('TRAIN_THE_TRAINER cascade renders the train-the-trainer blurb', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      cascadeStrategy: 'TRAIN_THE_TRAINER',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Train-the-trainer');
    expect(md).toContain('cascade');
  });

  it('default (omitted) cascade falls through to HYBRID', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Hybrid');
  });
});

describe('Pack U — perRoleTrainingGuideGenerator: assessment branching', () => {
  it('assessmentRequired=false renders "not required" placeholder', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Assessment is not required');
  });

  it('assessmentRequired=true + LIVE_DEMO renders the live-demo block', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      assessmentRequired: true,
      assessmentFormat: 'LIVE_DEMO',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Live demo');
    expect(md).toContain('representative transaction');
  });

  it('assessmentRequired=true + QUIZ renders the multiple-choice block + 80% pass mark', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      assessmentRequired: true,
      assessmentFormat: 'QUIZ',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Multiple-choice quiz');
    expect(md).toContain('80%');
  });

  it('assessmentRequired=true + WORK_PRODUCT_REVIEW renders the observation block', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      assessmentRequired: true,
      assessmentFormat: 'WORK_PRODUCT_REVIEW',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('under observation');
    expect(md).toContain('audit trail');
  });

  it('assessmentRequired=true + NONE explicitly notes no pass/fail gate', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      assessmentRequired: true,
      assessmentFormat: 'NONE',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('does not gate production access');
  });
});

describe('Pack U — perRoleTrainingGuideGenerator: cross-references + structure', () => {
  it('references Documentation/Training/Quick_Reference_Cards/ in module bodies', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: Vendor Bill Entry, 3-Way Match, Payment Run',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Documentation/Training/Quick_Reference_Cards/QRC-');
  });

  it('cross-references Pack T artefacts (Sign_Off_Matrix + Defect_Log_Template)', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Documentation/Sign_Off_Matrix.md');
    expect(md).toContain('Documentation/Defect_Log_Template.md');
  });

  it('cross-references Pack U sibling artefacts (Training_Matrix + Training_Schedule)', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Documentation/Training_Matrix.md');
    expect(md).toContain('Documentation/Training_Schedule.md');
  });

  it('platform name flows into Prerequisites section', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
      adaptorName: 'NetSuite',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('Active NetSuite account');
  });

  it('emits the standard 6 markdown headings', () => {
    const out = generatePerRoleTrainingGuides({
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: x, y, z',
    });
    const md = Object.values(out.files)[0];
    expect(md).toContain('# AP Clerk Training Guide');
    expect(md).toContain('## Audience');
    expect(md).toContain('## Prerequisites');
    expect(md).toContain('## Curriculum');
    expect(md).toContain('## Hands-On Lab');
    expect(md).toContain('## Assessment');
    expect(md).toContain('## Post-Training Resources');
  });

  it('empty input emits zero files', () => {
    const r1 = generatePerRoleTrainingGuides({ clientName: 'Atlas' });
    const r2 = generatePerRoleTrainingGuides({ clientName: 'Atlas', trainingPerRole: '' });
    const r3 = generatePerRoleTrainingGuides({ clientName: 'Atlas', trainingPerRole: null });
    for (const r of [r1, r2, r3]) {
      expect(r.emitted).toHaveLength(0);
      expect(r.files).toEqual({});
    }
  });

  it('output is deterministic — same input produces identical files', () => {
    const input = {
      clientName: 'Atlas',
      trainingPerRole: 'AP Clerk: A, B, C\nCFO: D, E, F',
      cascadeStrategy: 'TRAIN_THE_TRAINER' as const,
      deliveryMode: 'IN_PERSON' as const,
      assessmentRequired: true,
      assessmentFormat: 'LIVE_DEMO' as const,
    };
    const a = generatePerRoleTrainingGuides(input);
    const b = generatePerRoleTrainingGuides(input);
    expect(a.files).toEqual(b.files);
    expect(a.emitted).toEqual(b.emitted);
  });
});
