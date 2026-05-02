import { describe, it, expect } from 'vitest';
import { generateSdfDeploy } from '../../../src/services/generators/sdfDeployGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF Deploy generator tests. Pins:
 *   - <deploy> is the root element
 *   - <files> + <objects> blocks both present
 *   - every <path> is ~/-prefixed (validator rule deploy.path.relative)
 *   - no AccountConfiguration paths (post-Fix-#3 contract)
 *   - output passes the structural validator (sdfValidator.ts)
 */

describe('generateSdfDeploy — root + structure', () => {
  it('uses <deploy> as the root element', () => {
    const xml = generateSdfDeploy();
    expect(xml).toContain('<deploy>');
    expect(xml).toContain('</deploy>');
  });

  it('contains an XML declaration', () => {
    const xml = generateSdfDeploy();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('contains a <files> block with at least one <path>', () => {
    const xml = generateSdfDeploy();
    expect(xml).toContain('<files>');
    expect(xml).toMatch(/<files>[\s\S]*<path>[^<]+<\/path>[\s\S]*<\/files>/);
  });

  it('contains an <objects> block with at least one <path>', () => {
    const xml = generateSdfDeploy();
    expect(xml).toContain('<objects>');
    expect(xml).toMatch(/<objects>[\s\S]*<path>[^<]+<\/path>[\s\S]*<\/objects>/);
  });
});

describe('generateSdfDeploy — path shape (validator contract)', () => {
  it('every <path> value starts with ~/ (SuiteCloud relative-path requirement)', () => {
    const xml = generateSdfDeploy();
    const paths = Array.from(xml.matchAll(/<path>([^<]+)<\/path>/g)).map((m) => m[1].trim());
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths) {
      expect(p, `path must start with ~/: ${p}`).toMatch(/^~\//);
    }
  });

  it('does not reference AccountConfiguration (post-Fix-#3 contract)', () => {
    const xml = generateSdfDeploy();
    expect(xml).not.toMatch(/AccountConfiguration/i);
  });

  it('files path points at FileCabinet/SuiteScripts', () => {
    const xml = generateSdfDeploy();
    expect(xml).toMatch(/<path>~\/FileCabinet\/SuiteScripts/);
  });

  it('objects path points at ~/Objects', () => {
    const xml = generateSdfDeploy();
    expect(xml).toMatch(/<path>~\/Objects/);
  });
});

describe('generateSdfDeploy — passes the structural SDF validator', () => {
  it('default output validates clean', () => {
    const xml = generateSdfDeploy();
    const result = validateSDFBundle({ 'deploy.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
