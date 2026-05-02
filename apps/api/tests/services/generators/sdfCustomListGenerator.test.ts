import { describe, it, expect } from 'vitest';
import { generateSdfCustomList } from '../../../src/services/generators/sdfCustomListGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF Customlist generator tests (Pack B).
 *
 * Pack contract:
 *   1. Output is a valid Oracle SDF customlist XML body.
 *   2. Root <customlist scriptid="...">; <label> (NOT legacy <name>);
 *      ≥1 <customvalue> under <customvalues> (audit Fix #4 contract).
 *   3. Single inactive placeholder by default — un-inactivated by the
 *      consultant after review.
 *   4. Output passes the structural validator (sdfValidator.ts
 *      validateCustomList).
 */

describe('generateSdfCustomList — root + label', () => {
  it('uses <customlist scriptid="..."> as the root element', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Customer Tier',
    });
    expect(xml).toContain('<customlist scriptid="customlist_tier">');
    expect(xml).toContain('</customlist>');
  });

  it('uses <label> not legacy <name> (audit Fix #4)', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Customer Tier',
    });
    expect(xml).toContain('<label>Customer Tier</label>');
    expect(xml).not.toMatch(/<name>/);
  });

  it('XML-escapes special chars in label', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Tier & "Grade"',
    });
    expect(xml).toContain('<label>Tier &amp; &quot;Grade&quot;</label>');
  });

  it('contains the XML declaration', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Tier',
    });
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });
});

describe('generateSdfCustomList — customvalues block (audit Fix #4)', () => {
  it('emits a single inactive placeholder when no values supplied', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Tier',
    });
    expect(xml).toMatch(/<customvalue scriptid="val_placeholder_1">/);
    expect(xml).toContain('<isinactive>T</isinactive>');
    const matches = xml.match(/<customvalue scriptid=/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('emits one customvalue per supplied value, all inactive', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_status',
      label: 'Status',
      placeholderValues: ['Open', 'In Progress', 'Closed'],
    });
    const matches = xml.match(/<customvalue scriptid=/g) ?? [];
    expect(matches).toHaveLength(3);
    expect(xml).toContain('<value>Open</value>');
    expect(xml).toContain('<value>In Progress</value>');
    expect(xml).toContain('<value>Closed</value>');
    // All inactive — consultant un-inactivates the relevant ones
    const inactiveMatches = xml.match(/<isinactive>T<\/isinactive>/g) ?? [];
    expect(inactiveMatches).toHaveLength(3);
  });
});

describe('generateSdfCustomList — passes the structural SDF validator', () => {
  it('default output validates clean', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_tier',
      label: 'Customer Tier',
    });
    const result = validateSDFBundle({ 'Objects/customlist_tier.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('output with explicit values validates clean', () => {
    const xml = generateSdfCustomList({
      listScriptid: 'customlist_status',
      label: 'Status',
      placeholderValues: ['Open', 'Closed'],
    });
    const result = validateSDFBundle({ 'Objects/customlist_status.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
