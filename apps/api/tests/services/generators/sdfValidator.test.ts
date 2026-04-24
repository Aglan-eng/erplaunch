import { describe, it, expect, afterEach } from 'vitest';
import {
  validateSDFFile,
  validateSDFBundle,
  isValidationEnabled,
} from '../../../src/services/generators/sdfValidator.js';

/**
 * SDF structural validator tests (Phase 8).
 *
 * One describe block per rule class in sdfValidator.ts. Each test is
 * intentionally narrow — a single rule exercised with a single XML payload,
 * so when a regression hits we get a laser-focused failure rather than a
 * "something in the validator broke" diff.
 *
 * Philosophy:
 *   - Happy-path + failure-path for every rule.
 *   - No cross-file fixtures here; those live in sdfGenerator.test.ts.
 *   - We hand-write the minimum XML shape that triggers each rule so the
 *     tests double as executable documentation of the rule surface.
 */

// ─── manifest.xml ────────────────────────────────────────────────────────────

describe('sdfValidator: manifest.xml rules', () => {
  const validManifest = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>NSIX_Client</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="true">MULTICURRENCY</feature>
    </features>
  </dependencies>
</manifest>`;

  it('accepts a well-formed manifest', () => {
    expect(validateSDFFile('manifest.xml', validManifest)).toEqual([]);
  });

  it('rejects a manifest missing the <manifest> root', () => {
    const errs = validateSDFFile('manifest.xml', '<notmanifest></notmanifest>');
    expect(errs.map((e) => e.rule)).toContain('manifest.root');
  });

  it('rejects a manifest with no projecttype attribute', () => {
    const xml = `<manifest><projectname>X</projectname><frameworkversion>1.0</frameworkversion></manifest>`;
    const errs = validateSDFFile('manifest.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('manifest.projecttype');
  });

  it('rejects a manifest with an unknown projecttype value', () => {
    const xml = `<manifest projecttype="WRONGTYPE"><projectname>X</projectname><frameworkversion>1.0</frameworkversion></manifest>`;
    const errs = validateSDFFile('manifest.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('manifest.projecttype.value');
  });

  it('rejects a manifest missing <projectname>', () => {
    const xml = `<manifest projecttype="ACCOUNTCUSTOMIZATION"><frameworkversion>1.0</frameworkversion></manifest>`;
    const errs = validateSDFFile('manifest.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('manifest.projectname');
  });

  it('rejects a manifest missing <frameworkversion>', () => {
    const xml = `<manifest projecttype="ACCOUNTCUSTOMIZATION"><projectname>X</projectname></manifest>`;
    const errs = validateSDFFile('manifest.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('manifest.frameworkversion');
  });

  it('rejects a <feature> without required attribute inside features block', () => {
    const xml = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
      <projectname>X</projectname>
      <frameworkversion>1.0</frameworkversion>
      <dependencies><features><feature>MULTICURRENCY</feature></features></dependencies>
    </manifest>`;
    const errs = validateSDFFile('manifest.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('manifest.feature.required');
  });
});

// ─── deploy.xml ──────────────────────────────────────────────────────────────

describe('sdfValidator: deploy.xml rules', () => {
  const validDeploy = `<deploy>
  <files><path>~/FileCabinet/SuiteScripts/README.md</path></files>
  <objects><path>~/Objects/*</path></objects>
</deploy>`;

  it('accepts a well-formed deploy.xml', () => {
    expect(validateSDFFile('deploy.xml', validDeploy)).toEqual([]);
  });

  it('rejects a deploy missing the <deploy> root', () => {
    const errs = validateSDFFile('deploy.xml', '<other></other>');
    expect(errs.map((e) => e.rule)).toContain('deploy.root');
  });

  it('rejects a deploy with a non-relative path', () => {
    const xml = `<deploy><objects><path>/abs/path/Objects/*</path></objects></deploy>`;
    const errs = validateSDFFile('deploy.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('deploy.path.relative');
  });

  it('rejects a deploy that still references AccountConfiguration (Fix #3 closeout)', () => {
    const xml = `<deploy><configuration><path>~/AccountConfiguration/features.xml</path></configuration></deploy>`;
    const errs = validateSDFFile('deploy.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('deploy.accountconfig.dropped');
  });
});

// ─── Objects/customrecord_*.xml (Fix #1) ─────────────────────────────────────

describe('sdfValidator: customrecordtype rules (Fix #1)', () => {
  const valid = `<customrecordtype scriptid="customrecord_nsix_thing">
    <recordname>NSIX Thing</recordname>
    <customrecordcustomfields></customrecordcustomfields>
  </customrecordtype>`;

  it('accepts a well-formed customrecordtype', () => {
    expect(validateSDFFile('Objects/customrecord_nsix_thing.xml', valid)).toEqual([]);
  });

  it('rejects the legacy <customrecord> root element', () => {
    const xml = `<customrecord scriptid="customrecord_x"><recordname>X</recordname></customrecord>`;
    const errs = validateSDFFile('Objects/customrecord_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customrecordtype.root');
  });

  it('rejects missing <recordname>', () => {
    const xml = `<customrecordtype scriptid="customrecord_x"><customrecordcustomfields></customrecordcustomfields></customrecordtype>`;
    const errs = validateSDFFile('Objects/customrecord_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customrecordtype.recordname');
  });

  it('rejects missing <customrecordcustomfields> container', () => {
    const xml = `<customrecordtype scriptid="customrecord_x"><recordname>X</recordname></customrecordtype>`;
    const errs = validateSDFFile('Objects/customrecord_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customrecordtype.customrecordcustomfields');
  });

  it('rejects forbidden <description> child', () => {
    const xml = `<customrecordtype scriptid="customrecord_x">
      <recordname>X</recordname>
      <description>legacy</description>
      <customrecordcustomfields></customrecordcustomfields>
    </customrecordtype>`;
    const errs = validateSDFFile('Objects/customrecord_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customrecordtype.no-description');
  });

  it('rejects forbidden <isordered> child', () => {
    const xml = `<customrecordtype scriptid="customrecord_x">
      <recordname>X</recordname>
      <isordered>T</isordered>
      <customrecordcustomfields></customrecordcustomfields>
    </customrecordtype>`;
    const errs = validateSDFFile('Objects/customrecord_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customrecordtype.no-isordered');
  });
});

// ─── Objects/custbody_*.xml (Fix #2) ─────────────────────────────────────────

describe('sdfValidator: transactionbodycustomfield rules (Fix #2)', () => {
  const valid = `<transactionbodycustomfield scriptid="custbody_nsix_x">
    <label>X</label>
    <fieldtype>FREEFORMTEXT</fieldtype>
  </transactionbodycustomfield>`;

  it('accepts a well-formed transactionbodycustomfield', () => {
    expect(validateSDFFile('Objects/custbody_nsix_x.xml', valid)).toEqual([]);
  });

  it('rejects legacy <othercustomfield> root', () => {
    const xml = `<othercustomfield scriptid="custbody_x"><label>X</label><fieldtype>FREEFORMTEXT</fieldtype></othercustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.root');
  });

  it('rejects missing <label>', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x"><fieldtype>FREEFORMTEXT</fieldtype></transactionbodycustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.label');
  });

  it('rejects missing <fieldtype>', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x"><label>X</label></transactionbodycustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.fieldtype');
  });

  it('rejects an invalid fieldtype enum value', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x"><label>X</label><fieldtype>BOGUSTYPE</fieldtype></transactionbodycustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.fieldtype.value');
  });

  it('rejects SELECT fieldtype without <selectrecordtype>', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x"><label>X</label><fieldtype>SELECT</fieldtype></transactionbodycustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.selectrecordtype');
  });

  it('rejects MULTISELECT fieldtype without <selectrecordtype>', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x"><label>X</label><fieldtype>MULTISELECT</fieldtype></transactionbodycustomfield>`;
    const errs = validateSDFFile('Objects/custbody_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custbody.selectrecordtype');
  });

  it('accepts SELECT fieldtype WITH <selectrecordtype>', () => {
    const xml = `<transactionbodycustomfield scriptid="custbody_x">
      <label>X</label>
      <fieldtype>SELECT</fieldtype>
      <selectrecordtype>-224</selectrecordtype>
    </transactionbodycustomfield>`;
    expect(validateSDFFile('Objects/custbody_x.xml', xml)).toEqual([]);
  });
});

// ─── Objects/custentity_*.xml ────────────────────────────────────────────────

describe('sdfValidator: entitycustomfield rules', () => {
  const valid = `<entitycustomfield scriptid="custentity_nsix_x"><label>X</label><fieldtype>FREEFORMTEXT</fieldtype></entitycustomfield>`;

  it('accepts a well-formed entitycustomfield', () => {
    expect(validateSDFFile('Objects/custentity_nsix_x.xml', valid)).toEqual([]);
  });

  it('rejects missing <entitycustomfield> root', () => {
    const xml = `<other><label>X</label><fieldtype>FREEFORMTEXT</fieldtype></other>`;
    const errs = validateSDFFile('Objects/custentity_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custentity.root');
  });

  it('rejects missing <label>', () => {
    const xml = `<entitycustomfield scriptid="custentity_x"><fieldtype>FREEFORMTEXT</fieldtype></entitycustomfield>`;
    const errs = validateSDFFile('Objects/custentity_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custentity.label');
  });

  it('rejects missing <fieldtype>', () => {
    const xml = `<entitycustomfield scriptid="custentity_x"><label>X</label></entitycustomfield>`;
    const errs = validateSDFFile('Objects/custentity_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('custentity.fieldtype');
  });
});

// ─── Objects/customlist_*.xml (Fix #4) ───────────────────────────────────────

describe('sdfValidator: customlist rules (Fix #4)', () => {
  const valid = `<customlist scriptid="customlist_nsix_x">
    <label>X</label>
    <customvalues>
      <customvalue scriptid="val_a"><value>A</value></customvalue>
    </customvalues>
  </customlist>`;

  it('accepts a well-formed customlist with at least one value', () => {
    expect(validateSDFFile('Objects/customlist_nsix_x.xml', valid)).toEqual([]);
  });

  it('rejects missing <customlist> root', () => {
    const errs = validateSDFFile('Objects/customlist_x.xml', '<nope></nope>');
    expect(errs.map((e) => e.rule)).toContain('customlist.root');
  });

  it('rejects missing <label>', () => {
    const xml = `<customlist scriptid="customlist_x"><customvalues><customvalue scriptid="a"><value>A</value></customvalue></customvalues></customlist>`;
    const errs = validateSDFFile('Objects/customlist_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customlist.label');
  });

  it('rejects use of legacy <name> element', () => {
    const xml = `<customlist scriptid="customlist_x"><name>X</name><label>X</label><customvalues><customvalue scriptid="a"><value>A</value></customvalue></customvalues></customlist>`;
    const errs = validateSDFFile('Objects/customlist_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customlist.no-name');
  });

  it('rejects customlist with no <customvalue> entries', () => {
    const xml = `<customlist scriptid="customlist_x"><label>X</label><customvalues></customvalues></customlist>`;
    const errs = validateSDFFile('Objects/customlist_x.xml', xml);
    expect(errs.map((e) => e.rule)).toContain('customlist.customvalues');
  });
});

// ─── Objects/cseg_*.xml — forbidden (Fix #5) ─────────────────────────────────

describe('sdfValidator: forbidden cseg_*.xml (Fix #5)', () => {
  it('flags any cseg_*.xml as forbidden regardless of contents', () => {
    const errs = validateSDFFile('Objects/cseg_nsix_department.xml', '<customsegment scriptid="cseg_nsix_department"></customsegment>');
    expect(errs.map((e) => e.rule)).toContain('customsegment.forbidden');
  });
});

// ─── Bundle-level aggregation ────────────────────────────────────────────────

describe('sdfValidator: validateSDFBundle()', () => {
  it('returns ok=true for a clean bundle', () => {
    const bundle = {
      'manifest.xml': `<manifest projecttype="ACCOUNTCUSTOMIZATION"><projectname>X</projectname><frameworkversion>1.0</frameworkversion></manifest>`,
      'deploy.xml': `<deploy><objects><path>~/Objects/*</path></objects></deploy>`,
      'Objects/customrecord_nsix_x.xml': `<customrecordtype scriptid="customrecord_nsix_x"><recordname>X</recordname><customrecordcustomfields></customrecordcustomfields></customrecordtype>`,
    };
    const result = validateSDFBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('aggregates errors across multiple files', () => {
    const bundle = {
      'manifest.xml': '<notmanifest></notmanifest>', // bad root
      'Objects/customrecord_x.xml': '<customrecord></customrecord>', // legacy root
      'Objects/cseg_nsix_bad.xml': '<customsegment></customsegment>', // forbidden
    };
    const result = validateSDFBundle(bundle);
    expect(result.ok).toBe(false);
    // Aggregated errors should cover every broken file.
    const filesWithErrors = new Set(result.errors.map((e) => e.file));
    expect(filesWithErrors.has('manifest.xml')).toBe(true);
    expect(filesWithErrors.has('Objects/customrecord_x.xml')).toBe(true);
    expect(filesWithErrors.has('Objects/cseg_nsix_bad.xml')).toBe(true);
  });

  it('skips non-.xml files (README, .gitkeep, etc)', () => {
    const bundle = {
      'FileCabinet/SuiteScripts/README.md': '# not xml',
      'FileCabinet/SuiteScripts/.gitkeep': '',
    };
    const result = validateSDFBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('ignores unknown .xml file shapes (additive rule surface)', () => {
    // Validator only flags what it knows about — unknown file patterns
    // aren't lurking errors, they're just "not validated yet".
    const bundle = { 'Objects/customsavedsearch_x.xml': '<anything></anything>' };
    expect(validateSDFBundle(bundle).ok).toBe(true);
  });
});

// ─── isValidationEnabled toggle ──────────────────────────────────────────────

describe('sdfValidator: isValidationEnabled()', () => {
  const original = process.env.SDF_VALIDATE;
  afterEach(() => {
    if (original === undefined) delete process.env.SDF_VALIDATE;
    else process.env.SDF_VALIDATE = original;
  });

  it('is enabled by default (env var unset)', () => {
    delete process.env.SDF_VALIDATE;
    expect(isValidationEnabled()).toBe(true);
  });

  it('is disabled when SDF_VALIDATE=0', () => {
    process.env.SDF_VALIDATE = '0';
    expect(isValidationEnabled()).toBe(false);
  });

  it('stays enabled for any other SDF_VALIDATE value', () => {
    process.env.SDF_VALIDATE = '1';
    expect(isValidationEnabled()).toBe(true);
  });
});
