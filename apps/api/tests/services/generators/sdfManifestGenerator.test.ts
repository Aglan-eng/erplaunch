import { describe, it, expect } from 'vitest';
import { generateSdfManifest } from '../../../src/services/generators/sdfManifestGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF Manifest generator tests. Pins:
 *   - <projectname> includes both firm + client names
 *   - root tag declares projecttype="ACCOUNTCUSTOMIZATION"
 *   - frameworkversion is "1.0"
 *   - <dependencies><features> contains at least the CUSTOMRECORDS +
 *     SERVERSIDESCRIPTING feature requireds
 *   - special chars in firm/client names are XML-escaped
 *   - output passes the structural validator (sdfValidator.ts)
 */

describe('generateSdfManifest — projectname + firm/client', () => {
  it('renders projectname including both firm and client', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas Manufacturing' });
    expect(xml).toContain('<projectname>NSIX Atlas Manufacturing</projectname>');
  });

  it('XML-escapes special chars in firm/client names', () => {
    const xml = generateSdfManifest({
      firmName: 'Tom & Jerry',
      clientName: '<Acme> "Quoted"',
    });
    expect(xml).toContain('<projectname>Tom &amp; Jerry &lt;Acme&gt; &quot;Quoted&quot;</projectname>');
  });
});

describe('generateSdfManifest — root + framework shape (audit-fix #3 contract)', () => {
  it('uses <manifest projecttype="ACCOUNTCUSTOMIZATION"> as the root element', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    expect(xml).toContain('<manifest projecttype="ACCOUNTCUSTOMIZATION">');
  });

  it('declares frameworkversion="1.0"', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    expect(xml).toContain('<frameworkversion>1.0</frameworkversion>');
  });

  it('contains an XML declaration', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });
});

describe('generateSdfManifest — features block', () => {
  it('declares CUSTOMRECORDS as a required feature', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    expect(xml).toMatch(/<feature\s+required="true">CUSTOMRECORDS<\/feature>/);
  });

  it('declares SERVERSIDESCRIPTING as a required feature', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    expect(xml).toMatch(/<feature\s+required="true">SERVERSIDESCRIPTING<\/feature>/);
  });

  it('every <feature> tag carries a required="true|false" attribute', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas' });
    const featureTags = xml.match(/<feature\b[^>]*>/g) ?? [];
    expect(featureTags.length).toBeGreaterThanOrEqual(2);
    for (const tag of featureTags) {
      expect(tag, `feature tag missing required="true|false": ${tag}`).toMatch(/required="(true|false)"/);
    }
  });
});

describe('generateSdfManifest — passes the structural SDF validator', () => {
  it('default output validates clean', () => {
    const xml = generateSdfManifest({ firmName: 'NSIX', clientName: 'Atlas Manufacturing' });
    const result = validateSDFBundle({ 'manifest.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
