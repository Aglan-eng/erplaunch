import { describe, it, expect } from 'vitest';
import { generateSdfCustomRecords } from '../../../src/services/generators/sdfCustomRecordsGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF Custom Records generator tests — first real-code generator for
 * the NetSuite track. The pack contract is:
 *   1. Parse the wizard's free-text TEXTAREA answer (one record per
 *      line) into structured (recordName, scriptid, filename) tuples.
 *   2. Emit one customrecordtype XML file per record, deployable as-is
 *      via SuiteCloud CLI.
 *   3. Output passes the structural validator (sdfValidator.ts) which
 *      enforces audit-fix #1's contract.
 *
 * Test stratification:
 *   - Edge cases on input parsing (empty / whitespace / parens / dupes)
 *   - XML shape (root element, scriptid attribute, required children,
 *     forbidden children — all the audit-fix #1 invariants)
 *   - End-to-end against the real validator (must return ok=true)
 *   - Atlas-shaped seed data (mirror of the demo bundle's SD answer)
 */

describe('generateSdfCustomRecords — input parsing edge cases', () => {
  it('returns zero files for undefined input', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: undefined });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns zero files for null input', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: null });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns zero files for empty string', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: '' });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns zero files for whitespace-only input', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: '   \n\n  \t  \n' });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('emits one file for a single line with no parens', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Vendor Onboarding Request',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].recordName).toBe('Vendor Onboarding Request');
    expect(out.emitted[0].scriptid).toBe('customrecord_vendor_onboarding_request');
    expect(out.emitted[0].filename).toBe('Objects/customrecord_vendor_onboarding_request.xml');
  });

  it('strips parenthetical hints from the human name when slugifying', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Approval Tracker (custom record — captures full chain per transaction)',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].recordName).toBe('Approval Tracker');
    expect(out.emitted[0].scriptid).toBe('customrecord_approval_tracker');
  });

  it('emits one file per non-empty line', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Approval Tracker\nVendor Onboarding\nProject Milestone',
    });
    expect(out.emitted).toHaveLength(3);
    expect(out.emitted.map((e) => e.scriptid)).toEqual([
      'customrecord_approval_tracker',
      'customrecord_vendor_onboarding',
      'customrecord_project_milestone',
    ]);
  });

  it('handles CRLF line endings (Windows)', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Approval Tracker\r\nVendor Onboarding',
    });
    expect(out.emitted).toHaveLength(2);
    expect(out.emitted[0].scriptid).toBe('customrecord_approval_tracker');
    expect(out.emitted[1].scriptid).toBe('customrecord_vendor_onboarding');
  });

  it('skips empty lines mid-input', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Approval Tracker\n\n\nVendor Onboarding\n',
    });
    expect(out.emitted).toHaveLength(2);
  });

  it('de-duplicates colliding scriptids with numeric suffix', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: [
        'Approval Tracker',
        'Approval Tracker (custom record — different purpose)',
        'Approval Tracker (yet another)',
      ].join('\n'),
    });
    expect(out.emitted).toHaveLength(3);
    expect(out.emitted.map((e) => e.scriptid)).toEqual([
      'customrecord_approval_tracker',
      'customrecord_approval_tracker_2',
      'customrecord_approval_tracker_3',
    ]);
  });

  it('handles special characters in the human name (slug strips them)', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: "Customer's & Vendor Onboarding! / Special — Record",
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('customrecord_customer_s_vendor_onboarding_special_record');
  });

  it('falls back to "unnamed" when slug would be empty', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: '!@#$%' });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('customrecord_unnamed');
  });
});

describe('generateSdfCustomRecords — XML shape (audit-fix #1 contract)', () => {
  it('emits a valid XML document with declaration + root element', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Approval Tracker' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<customrecordtype scriptid="customrecord_approval_tracker">');
    expect(xml).toContain('</customrecordtype>');
  });

  it('contains required <recordname> child', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Project Milestone' });
    const xml = Object.values(out.files)[0];
    expect(xml).toMatch(/<recordname>Project Milestone<\/recordname>/);
  });

  it('contains required <customrecordcustomfields> container (empty is valid)', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Approval Tracker' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<customrecordcustomfields>');
    expect(xml).toContain('</customrecordcustomfields>');
  });

  it('does NOT contain forbidden <description> child (audit-fix #1)', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Approval Tracker' });
    const xml = Object.values(out.files)[0];
    expect(xml).not.toMatch(/<description>/);
  });

  it('does NOT contain forbidden <isordered> child (audit-fix #1)', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Approval Tracker' });
    const xml = Object.values(out.files)[0];
    expect(xml).not.toMatch(/<isordered>/);
  });

  it('does NOT use the legacy <customrecord> root (audit-fix #1)', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Approval Tracker' });
    const xml = Object.values(out.files)[0];
    expect(xml).not.toMatch(/^\s*<customrecord\s/m);
  });

  it('XML-escapes special characters in <recordname>', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Tom & Jerry <Test> "Quoted"',
    });
    const xml = Object.values(out.files)[0];
    // The slug strips specials, but the recordname text must be escaped.
    expect(xml).toContain('<recordname>Tom &amp; Jerry &lt;Test&gt; &quot;Quoted&quot;</recordname>');
  });
});

describe('generateSdfCustomRecords — passes the structural SDF validator', () => {
  it('single-record output validates clean', () => {
    const out = generateSdfCustomRecords({ customRecordsAnswer: 'Vendor Onboarding Request' });
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('multi-record output validates clean', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: [
        'Approval Tracker (custom record — captures full chain per transaction)',
        'Vendor Onboarding Request (workflow-driven; replaces current spreadsheet)',
        'Project Milestone (links Project + Sales Order + Revenue Element)',
        'Intercompany Transfer Request (drives auto-mirror on counterpart entity)',
        'Tax Filing Calendar (per nexus, per period; tracks filed/due dates)',
      ].join('\n'),
    });
    expect(Object.keys(out.files)).toHaveLength(5);
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('Atlas-shaped seed data (mirror of demo bundle SD answer) validates clean', () => {
    const ATLAS_SD =
      'Approval Tracker (custom record — captures full chain per transaction)\n' +
      'Vendor Onboarding Request (workflow-driven; replaces current spreadsheet)\n' +
      'Project Milestone (links Project + Sales Order + Revenue Element)\n' +
      'Intercompany Transfer Request (drives auto-mirror on counterpart entity)\n' +
      'Tax Filing Calendar (per nexus, per period; tracks filed/due dates)';
    const out = generateSdfCustomRecords({ customRecordsAnswer: ATLAS_SD });
    expect(out.emitted).toHaveLength(5);
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
    // Spot-check a couple of expected scriptids
    expect(out.emitted.map((e) => e.scriptid)).toContain('customrecord_approval_tracker');
    expect(out.emitted.map((e) => e.scriptid)).toContain('customrecord_intercompany_transfer_request');
  });

  it('output filenames match the Objects/<scriptid>.xml convention', () => {
    const out = generateSdfCustomRecords({
      customRecordsAnswer: 'Approval Tracker\nVendor Onboarding',
    });
    for (const filename of Object.keys(out.files)) {
      expect(filename).toMatch(/^Objects\/customrecord_[a-z0-9_]+\.xml$/);
    }
  });
});
