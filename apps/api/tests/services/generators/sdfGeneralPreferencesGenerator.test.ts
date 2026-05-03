import { describe, it, expect } from 'vitest';
import { generateGeneralPreferences } from '../../../src/services/generators/sdfGeneralPreferencesGenerator.js';

/**
 * Pack C — General Preferences generator tests.
 *
 * Pack contract:
 *   - <generalpreferences> root.
 *   - ssoInScope flag → enablesinglesignon T / F.
 *   - customRolesRequired flag → enablecustomroles T / F.
 *   - auditLogRetentionMonths → auditrailretentionmonths (default 84).
 *   - enableauditrail always T.
 */

describe('generateGeneralPreferences', () => {
  it('emits the <generalpreferences> root + XML declaration', () => {
    const xml = generateGeneralPreferences({});
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<generalpreferences>');
    expect(xml).toContain('</generalpreferences>');
  });

  it('ssoInScope=true → enablesinglesignon=T', () => {
    expect(generateGeneralPreferences({ ssoInScope: true })).toContain('<enablesinglesignon>T</enablesinglesignon>');
  });

  it('ssoInScope=false → enablesinglesignon=F', () => {
    expect(generateGeneralPreferences({ ssoInScope: false })).toContain('<enablesinglesignon>F</enablesinglesignon>');
  });

  it('customRolesRequired=true → enablecustomroles=T', () => {
    expect(generateGeneralPreferences({ customRolesRequired: true })).toContain('<enablecustomroles>T</enablecustomroles>');
  });

  it('auditLogRetentionMonths=120 → auditrailretentionmonths=120', () => {
    expect(generateGeneralPreferences({ auditLogRetentionMonths: 120 })).toContain('<auditrailretentionmonths>120</auditrailretentionmonths>');
  });

  it('auditLogRetentionMonths default = 84 when unset', () => {
    expect(generateGeneralPreferences({})).toContain('<auditrailretentionmonths>84</auditrailretentionmonths>');
  });

  it('auditLogRetentionMonths default = 84 when set to 0 / negative / NaN', () => {
    expect(generateGeneralPreferences({ auditLogRetentionMonths: 0 })).toContain('<auditrailretentionmonths>84</auditrailretentionmonths>');
    expect(generateGeneralPreferences({ auditLogRetentionMonths: -10 })).toContain('<auditrailretentionmonths>84</auditrailretentionmonths>');
  });

  it('enableauditrail is always T (regardless of flags)', () => {
    expect(generateGeneralPreferences({})).toContain('<enableauditrail>T</enableauditrail>');
    expect(generateGeneralPreferences({ ssoInScope: false, customRolesRequired: false })).toContain(
      '<enableauditrail>T</enableauditrail>',
    );
  });

  it('emailcase + datedefault hardcoded in starter shape', () => {
    const xml = generateGeneralPreferences({});
    expect(xml).toContain('<emailcase>SENTENCE</emailcase>');
    expect(xml).toContain('<datedefault>YYYY-MM-DD</datedefault>');
  });
});
