import { describe, it, expect } from 'vitest';
import {
  registerCardRenderer,
  getCardRenderer,
  type CardRenderer,
} from '../src/components/wizard/pending-review/cardRenderers';

/**
 * Phase 29 — pure-TS coverage of the per-targetType card renderer
 * registry. The DOM-rendered cards (WizardAnswerCard, future Phase 30-32
 * cards) get visual coverage via the existing Playwright e2e suite —
 * apps/web vitest stays pure-TS in line with the discipline established
 * for portalBranding.test.ts.
 */

describe('cardRenderers registry', () => {
  it('returns null for an unregistered targetType', () => {
    expect(getCardRenderer('NOT_A_REAL_TYPE')).toBeNull();
  });

  it('returns the registered renderer after registerCardRenderer', () => {
    const stub: CardRenderer = () => null;
    registerCardRenderer('PHASE_29_TEST', stub);
    expect(getCardRenderer('PHASE_29_TEST')).toBe(stub);
  });

  it('is last-wins on re-registration', () => {
    const first: CardRenderer = () => null;
    const second: CardRenderer = () => null;
    registerCardRenderer('PHASE_29_TEST_2', first);
    registerCardRenderer('PHASE_29_TEST_2', second);
    expect(getCardRenderer('PHASE_29_TEST_2')).toBe(second);
  });
});
