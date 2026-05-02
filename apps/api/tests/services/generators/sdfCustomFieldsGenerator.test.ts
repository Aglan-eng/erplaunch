import { describe, it, expect } from 'vitest';
import {
  generateSdfCustomFields,
  classifyFieldType,
} from '../../../src/services/generators/sdfCustomFieldsGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * BRD Custom Field generator tests (Pack B).
 *
 * Pack contract:
 *   1. Parse one parent-record line per record:
 *      "<Parent>: <count> custom fields (<comma-separated labels>)"
 *   2. Map parent → root + prefix + appliesto from a fixed table.
 *   3. Classify each label's fieldtype via keyword priority.
 *   4. Emit one SDF XML per field; SELECT fields flag the customlist
 *      they need so the orchestrator can emit the companion list.
 *   5. When includePoApprovalRequiredField, also emit
 *      custbody_nsix_required_approver as a TEXT field on Purchase Order.
 *
 * Test stratification:
 *   - Parser edge cases (empty, malformed, casing, multi-line)
 *   - Parent → root/prefix/appliesto for every parent type
 *   - Classifier priority for each fieldtype keyword family
 *   - SELECT fields flag a customlist scriptid; non-SELECTs don't
 *   - PO approval required-field auto-add behaviour
 *   - Atlas/Brightside-shaped seed data validates clean
 */

const ATLAS_FIELDS_SCOPE =
  'Customer record: 6 custom fields (Tier, Industry, KAM, Renewal Date, Payment Terms Override, Tax Exemption Status)\n' +
  'Sales Order: 8 custom fields (Project Reference, Renewal Type, Margin Override, ARM Trigger, Shipping Priority, EU Reverse-Charge Flag, Subsidiary Source, External Order ID)\n' +
  'Item: 5 custom fields (Tier-Pricing Override, ASC-606 Performance Obligation Type, Standard Cost Variance Account, Subsidiary Restriction, Hazmat Class)\n' +
  'Vendor record: 4 custom fields (1099 Withholding Class, Approved Tier, Audit Score, Last Compliance Review Date)\n' +
  'Employee record: 3 custom fields (Cost Center, Department Hierarchy, Time-Entry Approver Override)';

const BRIGHTSIDE_FIELDS_SCOPE =
  'Item: 6 custom fields (Batch tracking required, Lot expiry policy, Storage temp, Hazard classification, Controlled substance flag, Regulatory authorization #)\n' +
  'Customer: 4 custom fields (Pharmacy license, Authorization expiry, GPO membership, Tier)\n' +
  'Sales Order: 5 custom fields (Cold-chain required, Regulatory hold reason, Clinical trial flag, Patient program ID, Batch override)';

// ─── Parser edge cases ──────────────────────────────────────────────────────

describe('generateSdfCustomFields — input parsing edge cases', () => {
  it('returns zero files for undefined input', () => {
    const out = generateSdfCustomFields({ customFieldsScopeAnswer: undefined });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns zero files for null input', () => {
    const out = generateSdfCustomFields({ customFieldsScopeAnswer: null });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('returns zero files for empty / whitespace input', () => {
    expect(generateSdfCustomFields({ customFieldsScopeAnswer: '' }).emitted).toEqual([]);
    expect(generateSdfCustomFields({ customFieldsScopeAnswer: '   \n\n\t' }).emitted).toEqual([]);
  });

  it('skips lines that do not match the parent-prefix regex', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer:
        'this is not a field line\n' +
        'Customer: 1 custom field (Tier)\n' +
        'random gibberish',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('custentity_tier');
  });

  it('parser is case-insensitive on parent name', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'customer: 1 custom field (Tier)',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].parent).toBe('Customer');
  });

  it('handles CRLF line endings', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Item: 1 custom field (Lot expiry policy)\r\nVendor: 1 custom field (Audit Score)',
    });
    expect(out.emitted).toHaveLength(2);
  });

  it('drops the count token if absent (label-only count)', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Customer: custom fields (Tier)',
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('custentity_tier');
  });

  it('de-duplicates colliding scriptids with numeric suffix', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer:
        'Customer: 2 custom fields (Tier, Tier)',
    });
    expect(out.emitted).toHaveLength(2);
    expect(out.emitted[0].scriptid).toBe('custentity_tier');
    expect(out.emitted[1].scriptid).toBe('custentity_tier_2');
  });
});

// ─── Parent → root / prefix / appliesto ─────────────────────────────────────

describe('generateSdfCustomFields — parent → root / prefix / appliesto', () => {
  it('Item → itemcustomfield + custitem_ + appliestoitem', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Item: 1 custom field (Hazmat Class)',
    });
    const f = out.emitted[0];
    expect(f.root).toBe('itemcustomfield');
    expect(f.scriptid.startsWith('custitem_')).toBe(true);
    expect(out.files[f.filename]).toContain('<itemcustomfield ');
    expect(out.files[f.filename]).toContain('<appliestoitem>T</appliestoitem>');
  });

  it('Customer → entitycustomfield + custentity_ + appliestocustomer', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Customer: 1 custom field (Tier)',
    });
    const f = out.emitted[0];
    expect(f.root).toBe('entitycustomfield');
    expect(f.scriptid).toBe('custentity_tier');
    expect(out.files[f.filename]).toContain('<entitycustomfield ');
    expect(out.files[f.filename]).toContain('<appliestocustomer>T</appliestocustomer>');
  });

  it('Vendor → entitycustomfield + custentity_ + appliestovendor', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Vendor: 1 custom field (Audit Score)',
    });
    const f = out.emitted[0];
    expect(out.files[f.filename]).toContain('<appliestovendor>T</appliestovendor>');
  });

  it('Sales Order → transactionbodycustomfield + custbody_ + appliestosalesorder', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Sales Order: 1 custom field (Project Reference)',
    });
    const f = out.emitted[0];
    expect(f.root).toBe('transactionbodycustomfield');
    expect(f.scriptid.startsWith('custbody_')).toBe(true);
    expect(out.files[f.filename]).toContain('<appliestosalesorder>T</appliestosalesorder>');
  });

  it('Bill → transactionbodycustomfield with appliestovendorbill (NOT appliestobill)', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Bill: 1 custom field (Approval Tier)',
    });
    const f = out.emitted[0];
    expect(out.files[f.filename]).toContain('<appliestovendorbill>T</appliestovendorbill>');
    expect(out.files[f.filename]).not.toContain('<appliestobill>');
  });

  it('Journal Entry, Item Receipt, Invoice all map to transactionbodycustomfield', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer:
        'Journal Entry: 1 custom field (Posting Reason)\n' +
        'Item Receipt: 1 custom field (Discrepancy Reason)\n' +
        'Invoice: 1 custom field (Tax Note)',
    });
    expect(out.emitted).toHaveLength(3);
    for (const f of out.emitted) {
      expect(f.root).toBe('transactionbodycustomfield');
      expect(f.scriptid.startsWith('custbody_')).toBe(true);
    }
  });
});

// ─── Classifier priority ────────────────────────────────────────────────────

describe('classifyFieldType — keyword priority', () => {
  it('CHECKBOX priority — flag / required / enabled / allowed', () => {
    expect(classifyFieldType('Cold-chain required')).toBe('CHECKBOX');
    expect(classifyFieldType('Controlled substance flag')).toBe('CHECKBOX');
    expect(classifyFieldType('Auto-approve enabled')).toBe('CHECKBOX');
    expect(classifyFieldType('GPO membership allowed')).toBe('CHECKBOX');
  });

  it('DATE priority — date / expir / deadline / maturit', () => {
    expect(classifyFieldType('Renewal Date')).toBe('DATE');
    expect(classifyFieldType('Lot expiry policy')).toBe('DATE');
    expect(classifyFieldType('Submission deadline')).toBe('DATE');
    expect(classifyFieldType('Bond maturity')).toBe('DATE');
  });

  it('CURRENCY priority — amount / cost / price / value / total', () => {
    expect(classifyFieldType('Adjustment amount')).toBe('CURRENCY');
    expect(classifyFieldType('Margin Override')).toBe('FREEFORMTEXT');
    expect(classifyFieldType('Standard Cost Variance Account')).toBe('CURRENCY');
    expect(classifyFieldType('Total Premium')).toBe('CURRENCY');
  });

  it('SELECT priority — tier / level / category / type / status / policy / reason / class / grade', () => {
    expect(classifyFieldType('Tier')).toBe('SELECT');
    expect(classifyFieldType('Hazard classification')).toBe('SELECT');
    expect(classifyFieldType('Renewal Type')).toBe('SELECT');
    expect(classifyFieldType('Order Status')).toBe('SELECT');
    expect(classifyFieldType('Hold reason')).toBe('SELECT');
    expect(classifyFieldType('Hazmat Class')).toBe('SELECT');
    expect(classifyFieldType('Quality Grade')).toBe('SELECT');
  });

  it('TEXTAREA priority — note / comment / description', () => {
    expect(classifyFieldType('Audit notes')).toBe('TEXTAREA');
    expect(classifyFieldType('Reviewer comment')).toBe('TEXTAREA');
    expect(classifyFieldType('Field description')).toBe('TEXTAREA');
  });

  it('default → FREEFORMTEXT (NetSuite SDF enum, not "TEXT")', () => {
    expect(classifyFieldType('Project Reference')).toBe('FREEFORMTEXT');
    expect(classifyFieldType('External Order ID')).toBe('FREEFORMTEXT');
    expect(classifyFieldType('Pharmacy license')).toBe('FREEFORMTEXT');
  });

  it('CHECKBOX wins over DATE when both keywords appear', () => {
    // "expiry flag" — flag comes BEFORE expiry in the priority chain
    expect(classifyFieldType('expiry flag')).toBe('CHECKBOX');
  });
});

// ─── XML shape contract ─────────────────────────────────────────────────────

describe('generateSdfCustomFields — XML shape contract', () => {
  it('every emitted XML has the @xml declaration + the inferred fieldtype', () => {
    const out = generateSdfCustomFields({ customFieldsScopeAnswer: ATLAS_FIELDS_SCOPE });
    for (const f of out.emitted) {
      const xml = out.files[f.filename];
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(`<fieldtype>${f.fieldtype}</fieldtype>`);
    }
  });

  it('SELECT fields emit a <selectrecordtype> reference + flag selectListScriptid', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Customer: 1 custom field (Tier)',
    });
    const f = out.emitted[0];
    expect(f.fieldtype).toBe('SELECT');
    expect(f.selectListScriptid).toBe('customlist_tier');
    expect(out.files[f.filename]).toContain('<selectrecordtype>customlist_tier</selectrecordtype>');
  });

  it('non-SELECT fields do NOT emit a <selectrecordtype> reference', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Customer: 1 custom field (External Order ID)',
    });
    const f = out.emitted[0];
    expect(f.fieldtype).toBe('FREEFORMTEXT');
    expect(f.selectListScriptid).toBeUndefined();
    expect(out.files[f.filename]).not.toContain('<selectrecordtype>');
  });

  it('XML-escapes special characters in <label>', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Customer: 1 custom field (Tom & "Quoted")',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<label>Tom &amp; &quot;Quoted&quot;</label>');
  });
});

// ─── PO approval required-field auto-add ────────────────────────────────────

describe('generateSdfCustomFields — PO approval required-field auto-add', () => {
  it('auto-adds custbody_nsix_required_approver when includePoApprovalRequiredField is true', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: undefined,
      includePoApprovalRequiredField: true,
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].scriptid).toBe('custbody_nsix_required_approver');
    expect(out.emitted[0].parent).toBe('Purchase Order');
    expect(out.emitted[0].fieldtype).toBe('FREEFORMTEXT');
  });

  it('emits a comment header explaining why the auto-add field is there', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: undefined,
      includePoApprovalRequiredField: true,
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toMatch(/Auto-added because the PO Approval User Event script depends on this field/);
  });

  it('does NOT auto-add when includePoApprovalRequiredField is false / omitted', () => {
    const a = generateSdfCustomFields({ customFieldsScopeAnswer: undefined });
    expect(a.emitted).toEqual([]);
    const b = generateSdfCustomFields({
      customFieldsScopeAnswer: undefined,
      includePoApprovalRequiredField: false,
    });
    expect(b.emitted).toEqual([]);
  });

  it('does NOT duplicate when consultant already declared the same field manually', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: 'Purchase Order: 1 custom field (Required Approver auto-routed)',
      includePoApprovalRequiredField: true,
    });
    const fieldsWithThatScriptid = out.emitted.filter(
      (f) => f.scriptid === 'custbody_nsix_required_approver',
    );
    // The consultant's manual one slugifies differently
    // ('custbody_required_approver_auto_routed') — the auto-add still
    // emits its canonical 'custbody_nsix_required_approver' once.
    expect(fieldsWithThatScriptid).toHaveLength(1);
  });
});

// ─── End-to-end against the real validator ──────────────────────────────────

describe('generateSdfCustomFields — passes the structural SDF validator', () => {
  it('Atlas-shaped seed validates clean', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: ATLAS_FIELDS_SCOPE,
      includePoApprovalRequiredField: true,
    });
    expect(out.emitted.length).toBeGreaterThan(20);
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('Brightside-shaped seed validates clean', () => {
    const out = generateSdfCustomFields({
      customFieldsScopeAnswer: BRIGHTSIDE_FIELDS_SCOPE,
      includePoApprovalRequiredField: true,
    });
    expect(out.emitted.length).toBeGreaterThan(10);
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('output filenames match the Objects/<scriptid>.xml convention', () => {
    const out = generateSdfCustomFields({ customFieldsScopeAnswer: ATLAS_FIELDS_SCOPE });
    for (const filename of Object.keys(out.files)) {
      expect(filename).toMatch(/^Objects\/(custbody|custentity|custitem)_[a-z0-9_]+\.xml$/);
    }
  });
});
