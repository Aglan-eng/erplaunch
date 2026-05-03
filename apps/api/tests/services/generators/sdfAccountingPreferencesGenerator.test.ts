import { describe, it, expect } from 'vitest';
import { generateAccountingPreferences } from '../../../src/services/generators/sdfAccountingPreferencesGenerator.js';

/**
 * Pack C — Accounting Preferences generator tests.
 *
 * Pack contract:
 *   - <accountingpreferences> root.
 *   - sodMatrixRequired flag → forceperiodlock T / F.
 *   - multiBookAccounting flag → multibookaccountingenabled +
 *     restrictbookaccess.
 *   - advancedRevRecInScope flag → armenabled.
 */

describe('generateAccountingPreferences', () => {
  it('emits the <accountingpreferences> root + XML declaration', () => {
    const xml = generateAccountingPreferences({});
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<accountingpreferences>');
    expect(xml).toContain('</accountingpreferences>');
  });

  it('sodMatrixRequired=true → forceperiodlock=T', () => {
    const xml = generateAccountingPreferences({ sodMatrixRequired: true });
    expect(xml).toContain('<forceperiodlock>T</forceperiodlock>');
  });

  it('sodMatrixRequired=false → forceperiodlock=F', () => {
    const xml = generateAccountingPreferences({ sodMatrixRequired: false });
    expect(xml).toContain('<forceperiodlock>F</forceperiodlock>');
  });

  it('multiBookAccounting=true → both multibookaccountingenabled AND restrictbookaccess T', () => {
    const xml = generateAccountingPreferences({ multiBookAccounting: true });
    expect(xml).toContain('<multibookaccountingenabled>T</multibookaccountingenabled>');
    expect(xml).toContain('<restrictbookaccess>T</restrictbookaccess>');
  });

  it('multiBookAccounting=false → both flags F', () => {
    const xml = generateAccountingPreferences({ multiBookAccounting: false });
    expect(xml).toContain('<multibookaccountingenabled>F</multibookaccountingenabled>');
    expect(xml).toContain('<restrictbookaccess>F</restrictbookaccess>');
  });

  it('advancedRevRecInScope=true → armenabled=T', () => {
    expect(generateAccountingPreferences({ advancedRevRecInScope: true })).toContain('<armenabled>T</armenabled>');
  });

  it('always emits maintaincurrentbalance=T + enableaccountnumbers=T', () => {
    const xml = generateAccountingPreferences({});
    expect(xml).toContain('<maintaincurrentbalance>T</maintaincurrentbalance>');
    expect(xml).toContain('<enableaccountnumbers>T</enableaccountnumbers>');
  });

  it('Atlas-shaped input (multiBook + ARM + SoD all true) emits all T flags', () => {
    const xml = generateAccountingPreferences({
      multiBookAccounting: true,
      advancedRevRecInScope: true,
      sodMatrixRequired: true,
    });
    expect(xml).toContain('<forceperiodlock>T</forceperiodlock>');
    expect(xml).toContain('<multibookaccountingenabled>T</multibookaccountingenabled>');
    expect(xml).toContain('<armenabled>T</armenabled>');
  });
});
