import { describe, it, expect } from 'vitest';
import { generateTrainingSchedule } from '../../../src/services/generators/trainingScheduleGenerator.js';

/**
 * Pack U — Training Schedule tests.
 */

describe('Pack U — trainingScheduleGenerator: structure', () => {
  it('emits markdown with the 4 canonical sections', () => {
    const out = generateTrainingSchedule({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Sessions');
    expect(out.markdown).toContain('## 2. Pre-Training Prerequisites');
    expect(out.markdown).toContain('## 3. Post-Training Validation');
    expect(out.markdown).toContain('## 4. Cross-References');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generateTrainingSchedule({ clientName: 'Atlas' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Training Schedule');
  });
});

describe('Pack U — trainingScheduleGenerator: session parsing', () => {
  it('parses valid 3-segment lines into rows', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions:
        'P2P End-to-End: 4 hours: AP Clerk + Buyer\n' +
        'Multi-Entity Reporting: 2 hours: Finance Team',
    });
    expect(out.markdown).toContain('| P2P End-to-End | 4 hours | AP Clerk + Buyer |');
    expect(out.markdown).toContain('| Multi-Entity Reporting | 2 hours | Finance Team |');
  });

  it('skips lines with fewer than 3 colon-segments', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions:
        'P2P End-to-End: 4 hours: AP Clerk\n' +
        'Bad line with no colons\n' +
        'OK Session: 1h: Audience',
    });
    expect(out.markdown).toContain('| P2P End-to-End |');
    expect(out.markdown).toContain('| OK Session |');
    expect(out.markdown).not.toContain('Bad line');
  });

  it('shows placeholder row when no sessions captured', () => {
    const out = generateTrainingSchedule({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no sessions captured)_');
  });

  it('skips blank lines + trims whitespace', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: '\n  P2P: 4h: AP  \n\n   \n',
    });
    expect(out.markdown).toContain('| P2P | 4h | AP |');
  });
});

describe('Pack U — trainingScheduleGenerator: scheduling', () => {
  it('staggers 4 sessions across Week -4 / -3 / -2 / -1', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions:
        'S1: 1h: A\nS2: 1h: B\nS3: 1h: C\nS4: 1h: D',
      targetGoLiveDate: '2026-11-15',
    });
    expect(out.markdown).toContain('| Week -4 |');
    expect(out.markdown).toContain('| Week -3 |');
    expect(out.markdown).toContain('| Week -2 |');
    expect(out.markdown).toContain('| Week -1 |');
  });

  it('renders absolute date ranges when go-live date is parseable', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
      targetGoLiveDate: '2026-11-15',
    });
    // Week -4 of 2026-11-15 = ~ 2026-10-19 ish.
    expect(out.markdown).toMatch(/2026-10-\d{2} → 2026-10-\d{2}/);
  });

  it('renders [ASSIGN] placeholder dates when go-live is TBD', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
      targetGoLiveDate: 'TBD',
    });
    expect(out.markdown).toContain('_[ASSIGN once go-live locked]_');
  });

  it('renders [ASSIGN] when go-live is missing', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
    });
    expect(out.markdown).toContain('_[ASSIGN once go-live locked]_');
  });

  it('go-live header reads "TBD" when not set', () => {
    const out = generateTrainingSchedule({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Target Go-Live:** TBD');
  });
});

describe('Pack U — trainingScheduleGenerator: delivery mode', () => {
  it('IN_PERSON renders "In-person" in Format column', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
      deliveryMode: 'IN_PERSON',
    });
    expect(out.markdown).toContain('| In-person |');
  });

  it('SELF_PACED_VIDEO renders "Self-paced video"', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
      deliveryMode: 'SELF_PACED_VIDEO',
    });
    expect(out.markdown).toContain('Self-paced video');
  });

  it('default mode is HYBRID when omitted', () => {
    const out = generateTrainingSchedule({
      clientName: 'Atlas',
      trainingSessions: 'S1: 1h: A',
    });
    expect(out.markdown).toContain('**Delivery Mode:** Hybrid');
  });
});
