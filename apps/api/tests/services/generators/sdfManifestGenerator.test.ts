import { describe, it, expect } from 'vitest';
import { generateSdfManifest } from '../../../src/services/generators/sdfManifestGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF Manifest generator tests (Pack A — feature derivation).
 *
 * Pre-Pack-A: features were hardcoded to {CUSTOMRECORDS,
 * SERVERSIDESCRIPTING}. Pack A wires the feature list to wizard
 * answers (edition, multi-currency, multi-book, ARM, custom roles,
 * SSO, languages, tax engine, downstream artefact presence).
 *
 * Test stratification:
 *   - <projectname> shape with firm/client substitution + XML escaping
 *   - Root + framework + XML declaration (audit-fix #3 contract)
 *   - Feature-derivation rules per flag (CHECKBOX-style — flip flag,
 *     observe feature presence/absence in output)
 *   - Edition-tier gating (CUSTOMTRANSACTIONS / CUSTOMSEGMENTS)
 *   - OneWorld trio (SUBSIDIARIES / INTERCOMPANY / EXPENSEALLOCATIONS)
 *   - Atlas / Brightside-shaped seeds produce ≥5 derived features
 *   - Validator passthrough
 */

const MINIMAL_INPUT = {
  firmName: 'NSIX',
  clientName: 'Atlas Manufacturing',
} as const;

const ATLAS_INPUT = {
  firmName: 'NSIX',
  clientName: 'Atlas Industries Group',
  edition: 'ONEWORLD',
  multiCurrencyInScope: true,
  multiBookAccounting: true,
  advancedRevRecInScope: true,
  customRolesRequired: true,
  ssoInScope: true,
  taxEngine: 'SUITETAX',
  hasCustomRecords: true,
  hasSuiteScripts: true,
  hasWorkflows: false,
  poApprovalInScope: true,
  uiLanguages: ['en — English', 'de — German'],
} as const;

// ─── projectname + firm/client ──────────────────────────────────────────────

describe('generateSdfManifest — projectname + firm/client', () => {
  it('renders projectname as "<firm> implementation for <client>"', () => {
    const xml = generateSdfManifest(MINIMAL_INPUT);
    expect(xml).toContain('<projectname>NSIX implementation for Atlas Manufacturing</projectname>');
  });

  it('XML-escapes special chars in firm/client names', () => {
    const xml = generateSdfManifest({
      firmName: 'Tom & Jerry',
      clientName: '<Acme> "Quoted"',
    });
    expect(xml).toContain(
      '<projectname>Tom &amp; Jerry implementation for &lt;Acme&gt; &quot;Quoted&quot;</projectname>',
    );
  });
});

// ─── Root + framework shape ─────────────────────────────────────────────────

describe('generateSdfManifest — root + framework shape (audit-fix #3 contract)', () => {
  it('uses <manifest projecttype="ACCOUNTCUSTOMIZATION"> as root', () => {
    const xml = generateSdfManifest(MINIMAL_INPUT);
    expect(xml).toContain('<manifest projecttype="ACCOUNTCUSTOMIZATION">');
  });

  it('declares frameworkversion="1.0"', () => {
    const xml = generateSdfManifest(MINIMAL_INPUT);
    expect(xml).toContain('<frameworkversion>1.0</frameworkversion>');
  });

  it('contains an XML declaration', () => {
    const xml = generateSdfManifest(MINIMAL_INPUT);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('every <feature> tag carries required="true|false"', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    const featureTags = xml.match(/<feature\b[^>]*>/g) ?? [];
    expect(featureTags.length).toBeGreaterThan(0);
    for (const tag of featureTags) {
      expect(tag, `feature tag missing required="true|false": ${tag}`).toMatch(
        /required="(true|false)"/,
      );
    }
  });
});

// ─── Feature derivation per flag ────────────────────────────────────────────

describe('generateSdfManifest — feature derivation per flag', () => {
  it('CUSTOMRECORDS only when hasCustomRecords=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, hasCustomRecords: true })).toContain(
      '>CUSTOMRECORDS<',
    );
    expect(generateSdfManifest({ ...MINIMAL_INPUT, hasCustomRecords: false })).not.toContain(
      '>CUSTOMRECORDS<',
    );
  });

  it('SERVERSIDESCRIPTING only when hasSuiteScripts=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, hasSuiteScripts: true })).toContain(
      '>SERVERSIDESCRIPTING<',
    );
    expect(generateSdfManifest({ ...MINIMAL_INPUT, hasSuiteScripts: false })).not.toContain(
      '>SERVERSIDESCRIPTING<',
    );
  });

  it('OneWorld trio (SUBSIDIARIES + INTERCOMPANY + EXPENSEALLOCATIONS) only on edition=ONEWORLD', () => {
    const ow = generateSdfManifest({ ...MINIMAL_INPUT, edition: 'ONEWORLD' });
    expect(ow).toContain('>SUBSIDIARIES<');
    expect(ow).toContain('>INTERCOMPANY<');
    expect(ow).toContain('>EXPENSEALLOCATIONS<');

    const std = generateSdfManifest({ ...MINIMAL_INPUT, edition: 'STANDARD' });
    expect(std).not.toContain('>SUBSIDIARIES<');
    expect(std).not.toContain('>INTERCOMPANY<');
    expect(std).not.toContain('>EXPENSEALLOCATIONS<');
  });

  it('MULTICURRENCY only when multiCurrencyInScope=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, multiCurrencyInScope: true })).toContain(
      '>MULTICURRENCY<',
    );
    expect(generateSdfManifest(MINIMAL_INPUT)).not.toContain('>MULTICURRENCY<');
  });

  it('MULTIBOOKACCOUNTING + REVENUEACCOUNTINGSTANDARDS only when multiBookAccounting=true', () => {
    const xml = generateSdfManifest({ ...MINIMAL_INPUT, multiBookAccounting: true });
    expect(xml).toContain('>MULTIBOOKACCOUNTING<');
    expect(xml).toContain('>REVENUEACCOUNTINGSTANDARDS<');
  });

  it('ADVANCEDREVENUERECOGNITION only when advancedRevRecInScope=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, advancedRevRecInScope: true })).toContain(
      '>ADVANCEDREVENUERECOGNITION<',
    );
    expect(generateSdfManifest(MINIMAL_INPUT)).not.toContain('>ADVANCEDREVENUERECOGNITION<');
  });

  it('CUSTOMSCRIPTS + CUSTOMUI when customRolesRequired=true', () => {
    const xml = generateSdfManifest({ ...MINIMAL_INPUT, customRolesRequired: true });
    expect(xml).toContain('>CUSTOMSCRIPTS<');
    expect(xml).toContain('>CUSTOMUI<');
  });

  it('CUSTOMSCRIPTS + CUSTOMUI also when hasSuiteScripts=true (alternate trigger)', () => {
    const xml = generateSdfManifest({ ...MINIMAL_INPUT, hasSuiteScripts: true });
    expect(xml).toContain('>CUSTOMSCRIPTS<');
    expect(xml).toContain('>CUSTOMUI<');
  });

  it('SAMLSSO only when ssoInScope=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, ssoInScope: true })).toContain('>SAMLSSO<');
    expect(generateSdfManifest(MINIMAL_INPUT)).not.toContain('>SAMLSSO<');
  });

  it('SUITETAX only when taxEngine=SUITETAX', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, taxEngine: 'SUITETAX' })).toContain(
      '>SUITETAX<',
    );
    expect(generateSdfManifest({ ...MINIMAL_INPUT, taxEngine: 'LEGACY' })).not.toContain(
      '>SUITETAX<',
    );
  });

  it('SUITEFLOW when hasWorkflows=true OR poApprovalInScope=true', () => {
    expect(generateSdfManifest({ ...MINIMAL_INPUT, hasWorkflows: true })).toContain(
      '>SUITEFLOW<',
    );
    expect(generateSdfManifest({ ...MINIMAL_INPUT, poApprovalInScope: true })).toContain(
      '>SUITEFLOW<',
    );
    expect(generateSdfManifest(MINIMAL_INPUT)).not.toContain('>SUITEFLOW<');
  });

  it('MULTILANGUAGE only when uiLanguages.length > 1', () => {
    expect(
      generateSdfManifest({ ...MINIMAL_INPUT, uiLanguages: ['en — English', 'de — German'] }),
    ).toContain('>MULTILANGUAGE<');
    expect(
      generateSdfManifest({ ...MINIMAL_INPUT, uiLanguages: ['en — English'] }),
    ).not.toContain('>MULTILANGUAGE<');
    expect(generateSdfManifest(MINIMAL_INPUT)).not.toContain('>MULTILANGUAGE<');
  });
});

// ─── Edition-tier gating ────────────────────────────────────────────────────

describe('generateSdfManifest — edition tier gating', () => {
  it('CUSTOMTRANSACTIONS + CUSTOMSEGMENTS appear when edition >= MID_MARKET AND hasCustomRecords', () => {
    const xml = generateSdfManifest({
      ...MINIMAL_INPUT,
      edition: 'MID_MARKET',
      hasCustomRecords: true,
    });
    expect(xml).toContain('>CUSTOMTRANSACTIONS<');
    expect(xml).toContain('>CUSTOMSEGMENTS<');
  });

  it('CUSTOMTRANSACTIONS + CUSTOMSEGMENTS suppressed on STANDARD edition', () => {
    const xml = generateSdfManifest({
      ...MINIMAL_INPUT,
      edition: 'STANDARD',
      hasCustomRecords: true,
    });
    expect(xml).not.toContain('>CUSTOMTRANSACTIONS<');
    expect(xml).not.toContain('>CUSTOMSEGMENTS<');
  });

  it('CUSTOMTRANSACTIONS + CUSTOMSEGMENTS suppressed when no custom records (no point declaring without them)', () => {
    const xml = generateSdfManifest({
      ...MINIMAL_INPUT,
      edition: 'ONEWORLD',
      hasCustomRecords: false,
    });
    expect(xml).not.toContain('>CUSTOMTRANSACTIONS<');
    expect(xml).not.toContain('>CUSTOMSEGMENTS<');
  });
});

// ─── Atlas / Brightside seed coverage ───────────────────────────────────────

describe('generateSdfManifest — engagement-shaped seeds', () => {
  it('Atlas seed produces ≥10 derived features (was 2 hardcoded pre-Pack-A)', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    const features = xml.match(/<feature\s+required="true">/g) ?? [];
    expect(features.length).toBeGreaterThanOrEqual(10);
  });

  it('Atlas seed declares the OneWorld trio', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    expect(xml).toContain('>SUBSIDIARIES<');
    expect(xml).toContain('>INTERCOMPANY<');
    expect(xml).toContain('>EXPENSEALLOCATIONS<');
  });

  it('Atlas seed declares MULTICURRENCY + MULTIBOOKACCOUNTING + ADVANCEDREVENUERECOGNITION', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    expect(xml).toContain('>MULTICURRENCY<');
    expect(xml).toContain('>MULTIBOOKACCOUNTING<');
    expect(xml).toContain('>ADVANCEDREVENUERECOGNITION<');
  });

  it('Atlas seed declares SUITETAX + SAMLSSO + SUITEFLOW + MULTILANGUAGE', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    expect(xml).toContain('>SUITETAX<');
    expect(xml).toContain('>SAMLSSO<');
    expect(xml).toContain('>SUITEFLOW<');
    expect(xml).toContain('>MULTILANGUAGE<');
  });

  it('feature list is alphabetically sorted (deterministic output)', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    const ids = (xml.match(/<feature\s+required="true">([A-Z]+)</g) ?? []).map(
      (m) => m.replace(/<feature\s+required="true">/, '').replace(/</, ''),
    );
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

// ─── Validator passthrough ──────────────────────────────────────────────────

describe('generateSdfManifest — passes the structural SDF validator', () => {
  it('Atlas-shaped output validates clean', () => {
    const xml = generateSdfManifest(ATLAS_INPUT);
    const result = validateSDFBundle({ 'manifest.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('minimal output validates clean (zero derived features still has valid <features> block)', () => {
    const xml = generateSdfManifest(MINIMAL_INPUT);
    const result = validateSDFBundle({ 'manifest.xml': xml });
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
