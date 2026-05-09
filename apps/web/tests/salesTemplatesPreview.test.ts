/**
 * Phase 46.8.6 — pure tests for the cover-letter preview substitution.
 */
import { describe, it, expect } from 'vitest';
import { previewCoverLetter } from '../src/pages/SalesTemplatesPage';

describe('previewCoverLetter', () => {
  it('substitutes every placeholder with sample data', () => {
    const tmpl =
      'Dear {{decisionMaker}},\n\nFrom {{firmName}} re {{adaptorName}} (focus: {{topPain}}).\n' +
      'Live {{goLiveLabel}}, valid until {{validUntil}}.\n\n— {{preparedBy}}{{contactLine}}';
    const out = previewCoverLetter(tmpl);
    expect(out).toContain('Jane Tate');
    expect(out).toContain('Your Firm');
    expect(out).toContain('NetSuite');
    expect(out).toContain('multi-entity consolidation pain');
    expect(out).toContain('in 6 to 12 months');
    expect(out).toContain('2026-07-01');
    expect(out).toContain('Sales team');
    expect(out).toContain('sales@yourfirm.example');
  });

  it('leaves non-placeholder text unchanged', () => {
    expect(previewCoverLetter('static body text')).toBe('static body text');
  });

  it('substitutes a placeholder that appears multiple times', () => {
    const out = previewCoverLetter('{{firmName}} ↔ {{firmName}}');
    expect(out).toBe('Your Firm ↔ Your Firm');
  });
});
