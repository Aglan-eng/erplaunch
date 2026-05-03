import { describe, it, expect } from 'vitest';
import { generateProcessImprovementBacklog } from '../../../src/services/generators/processImprovementBacklogGenerator.js';

describe('Pack Y — processImprovementBacklogGenerator: structure', () => {
  it('emits the canonical 7 sections', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('## 1. Quick Wins (≤ 2 weeks)');
    expect(out.markdown).toContain('## 2. Enhancements (≤ 1 quarter)');
    expect(out.markdown).toContain('## 3. Phase Two (next wave)');
    expect(out.markdown).toContain('## 4. Known Limitations');
    expect(out.markdown).toContain('## 5. Triage Rules — Value-vs-Effort 2×2');
    expect(out.markdown).toContain('## 6. Submission Template');
    expect(out.markdown).toContain('## 7. Cross-References');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: Quick Wins canonical seed', () => {
  it('renders 5 default canonical Quick Wins', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| Automate manual reclass JE for cost-center misposts |');
    expect(out.markdown).toContain('| Add field validator on supplier bank account format |');
    expect(out.markdown).toContain('| Saved search alerts for stuck approval transactions > 48h |');
    expect(out.markdown).toContain('| Standardise period-close checklist into a custom record |');
    expect(out.markdown).toContain('| Template common journal-entry corrections |');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: Enhancements from deferredFeatures overlay', () => {
  it('parses overlay rows into Enhancements table', () => {
    const out = generateProcessImprovementBacklog({
      clientName: 'Atlas',
      deferredFeatures:
        'Bank statement auto-reconciliation | Pilot scope | T+90 enhancement\n' +
        'Approval delegation rules | Pilot scope | T+90 enhancement',
    });
    expect(out.markdown).toContain(
      '| Bank statement auto-reconciliation | Pilot scope | T+90 enhancement |',
    );
    expect(out.markdown).toContain(
      '| Approval delegation rules | Pilot scope | T+90 enhancement |',
    );
  });

  it('placeholder when overlay empty', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('empty `stabilization.backlog.deferredFeatures` overlay');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: Phase Two from overlay or default', () => {
  it('uses default 6-row Phase Two seed when overlay empty', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| WhatsApp / Telegram supplier portal integration |');
    expect(out.markdown).toContain('| Advanced revenue recognition deepening |');
    expect(out.markdown).toContain('| Fixed asset module rollout |');
    expect(out.markdown).toContain('| Intercompany automation enhancement |');
  });

  it('uses overlay when consultant provides phaseTwoScope', () => {
    const out = generateProcessImprovementBacklog({
      clientName: 'Atlas',
      phaseTwoScope:
        'Custom initiative A | Business value A | T+180\n' +
        'Custom initiative B | Business value B | T+270',
    });
    expect(out.markdown).toContain('| Custom initiative A | Business value A | T+180 |');
    expect(out.markdown).toContain('| Custom initiative B | Business value B | T+270 |');
    // Default seeds should NOT render when overlay is provided.
    expect(out.markdown).not.toContain('| WhatsApp / Telegram supplier portal integration |');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: Known Limitations', () => {
  it('renders limitations from overlay', () => {
    const out = generateProcessImprovementBacklog({
      clientName: 'Atlas',
      knownLimitations:
        'Multi-currency reval batch must be run sequentially | run sequentially | temporary, fixing in 2026.2',
    });
    expect(out.markdown).toContain(
      '| Multi-currency reval batch must be run sequentially | run sequentially | temporary, fixing in 2026.2 |',
    );
  });

  it('placeholder when no limitations provided', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('empty `stabilization.backlog.knownLimitations` overlay');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: triage rules + submission', () => {
  it('renders the 2×2 value-vs-effort matrix', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('| **Low Effort (≤ 2 weeks)** | Quick Win OR drop | Quick Win — top priority |');
    expect(out.markdown).toContain('| **High Effort (> 2 weeks)** | Backlog only — no commitment | Enhancement OR Phase Two depending on scope |');
  });

  it('lists submission template required fields', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Title');
    expect(out.markdown).toContain('Problem statement');
    expect(out.markdown).toContain('Proposed solution');
    expect(out.markdown).toContain('Business value');
    expect(out.markdown).toContain('Risk if not done');
    expect(out.markdown).toContain('Submitter + workstream');
  });
});

describe('Pack Y — processImprovementBacklogGenerator: cross-references', () => {
  it('cross-refs sibling Pack Y artefacts', () => {
    const out = generateProcessImprovementBacklog({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Documentation/Stabilization/Continuous_Improvement_Governance.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Stabilization_Roadmap.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Phase_Two_Charter.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Benefits_Realization_Tracker.md');
    expect(out.markdown).toContain('Documentation/Stabilization/Lessons_Learned_Register.md');
  });
});
