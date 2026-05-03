import { describe, it, expect } from 'vitest';
import { generateCompanyInformation } from '../../../src/services/generators/sdfCompanyInformationGenerator.js';

/**
 * Pack C — Company Information generator tests.
 *
 * Pack contract:
 *   - <companyinformation> root.
 *   - legalname / country / basecurrency / fiscalyearstart populated.
 *   - employerid empty (consultant fills in per filing-jurisdiction).
 *   - XML escapes special chars.
 */

describe('generateCompanyInformation', () => {
  it('emits the <companyinformation> root + XML declaration', () => {
    const xml = generateCompanyInformation({
      clientName: 'Atlas Industries Group',
      primaryCountry: 'US',
      fiscalYearStart: '01-01',
      baseCurrency: 'USD',
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<companyinformation>');
    expect(xml).toContain('</companyinformation>');
  });

  it('populates legalname / country / basecurrency / fiscalyearstart from input', () => {
    const xml = generateCompanyInformation({
      clientName: 'Brightside Pharmaceuticals Group',
      primaryCountry: 'AE',
      fiscalYearStart: '07-01',
      baseCurrency: 'AED',
    });
    expect(xml).toContain('<legalname>Brightside Pharmaceuticals Group</legalname>');
    expect(xml).toContain('<country>AE</country>');
    expect(xml).toContain('<basecurrency>AED</basecurrency>');
    expect(xml).toContain('<fiscalyearstart>07-01</fiscalyearstart>');
  });

  it('emits empty <employerid></employerid> (consultant fills per jurisdiction)', () => {
    const xml = generateCompanyInformation({
      clientName: 'Acme',
      primaryCountry: 'US',
      fiscalYearStart: '01-01',
      baseCurrency: 'USD',
    });
    expect(xml).toContain('<employerid></employerid>');
  });

  it('XML-escapes special chars in client name', () => {
    const xml = generateCompanyInformation({
      clientName: 'Tom & Jerry "Quoted" Co.',
      primaryCountry: 'US',
      fiscalYearStart: '01-01',
      baseCurrency: 'USD',
    });
    expect(xml).toContain('<legalname>Tom &amp; Jerry &quot;Quoted&quot; Co.</legalname>');
  });

  it('comment header references foundation answers', () => {
    const xml = generateCompanyInformation({
      clientName: 'Atlas',
      primaryCountry: 'US',
      fiscalYearStart: '01-01',
      baseCurrency: 'USD',
    });
    expect(xml).toContain('ns.foundation');
  });

  it('renders cleanly for an empty primaryCountry (fallback path)', () => {
    const xml = generateCompanyInformation({
      clientName: 'Acme',
      primaryCountry: '',
      fiscalYearStart: '01-01',
      baseCurrency: 'USD',
    });
    expect(xml).toContain('<country></country>');
  });
});
