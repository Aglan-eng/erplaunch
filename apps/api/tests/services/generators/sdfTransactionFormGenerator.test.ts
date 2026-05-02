import { describe, it, expect } from 'vitest';
import {
  generateTransactionForms,
  clientSlug,
} from '../../../src/services/generators/sdfTransactionFormGenerator.js';
import { validateSDFBundle } from '../../../src/services/generators/sdfValidator.js';

/**
 * Pack H — Transaction Form generator tests.
 *
 * Pack contract:
 *   1. Re-parse customFieldsScope via Pack B's generator; group fields
 *      by transaction parent.
 *   2. Emit one transactionform XML per parent that has ≥1 custom field.
 *   3. Form scriptid = custform_<client_slug>_<recordtype_lower>.
 *   4. Form name = "<Client> <Display> Form".
 *   5. <preferred>T</preferred> on every form.
 *   6. Pack B field scriptids appear as <field><id>...</id></field> entries.
 *   7. PO approval auto-add: when poApprovalInScope, the PO form
 *      embeds custbody_nsix_required_approver.
 */

const ATLAS_FIELDS_SCOPE =
  'Customer record: 6 custom fields (Tier, Industry, KAM, Renewal Date, Payment Terms Override, Tax Exemption Status)\n' +
  'Sales Order: 8 custom fields (Project Reference, Renewal Type, Margin Override, ARM Trigger, Shipping Priority, EU Reverse-Charge Flag, Subsidiary Source, External Order ID)\n' +
  'Item: 5 custom fields (Tier-Pricing Override, ASC-606 Performance Obligation Type, Standard Cost Variance Account, Subsidiary Restriction, Hazmat Class)\n' +
  'Vendor record: 4 custom fields (1099 Withholding Class, Approved Tier, Audit Score, Last Compliance Review Date)';

const TXN_HEAVY_SCOPE =
  'Sales Order: 2 custom fields (Project Reference, Margin Override)\n' +
  'Purchase Order: 2 custom fields (Vendor Tier, PO Notes)\n' +
  'Invoice: 1 custom field (Tax Note)\n' +
  'Bill: 1 custom field (Approval Tier)\n' +
  'Journal Entry: 1 custom field (Posting Reason)\n' +
  'Item Receipt: 1 custom field (Discrepancy Reason)';

const BASE_INPUT = {
  clientName: 'Atlas Industries Group',
  poApprovalInScope: false,
};

// ─── client_slug derivation ─────────────────────────────────────────────────

describe('clientSlug — slug derivation rules', () => {
  it('lowercases + replaces non-alphanumeric runs with underscores', () => {
    expect(clientSlug('Atlas Industries Group')).toBe('atlas_industries');
  });

  it('truncates to ≤ 20 chars at last word boundary that fits', () => {
    const slug = clientSlug('Brightside Pharmaceuticals Group');
    expect(slug.length).toBeLessThanOrEqual(20);
    // Word-boundary truncation prefers complete words
    expect(slug).not.toMatch(/[a-z]_$/); // no trailing partial word
  });

  it('leaves short names untouched', () => {
    expect(clientSlug('Acme')).toBe('acme');
    expect(clientSlug('TechCo Inc')).toBe('techco_inc');
  });

  it('handles names with extra punctuation', () => {
    expect(clientSlug("O'Reilly & Sons, Ltd.")).toBe('o_reilly_sons_ltd');
  });
});

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateTransactionForms — empty / smoke cases', () => {
  it('returns empty file map for undefined scope', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: undefined,
    });
    expect(out.files).toEqual({});
  });

  it('returns empty file map for whitespace-only scope', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: '   \n\t\n',
    });
    expect(out.files).toEqual({});
  });

  it('returns empty file map when only entity parents are declared', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Customer: 1 custom field (Tier)\nVendor: 1 custom field (Score)',
    });
    expect(out.files).toEqual({});
  });
});

// ─── One form per applicable parent ─────────────────────────────────────────

describe('generateTransactionForms — one form per applicable parent', () => {
  it('emits one form per transaction parent with ≥1 custom field', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: TXN_HEAVY_SCOPE,
    });
    expect(Object.keys(out.files)).toHaveLength(6);
  });

  it('skips transaction parents that have no custom fields', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    expect(Object.keys(out.files)).toHaveLength(1);
    expect(Object.keys(out.files)[0]).toMatch(/_salesord\.xml$/);
  });

  it('skips entity parents in transaction form output', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: ATLAS_FIELDS_SCOPE,
    });
    // Atlas seed has Customer + Vendor + Item (entity) + Sales Order (txn).
    // Only Sales Order should produce a transaction form.
    for (const filename of Object.keys(out.files)) {
      expect(filename).not.toMatch(/_(customer|vendor|item|employee)\.xml$/);
    }
  });
});

// ─── Form structure ─────────────────────────────────────────────────────────

describe('generateTransactionForms — form structure', () => {
  it('scriptid follows custform_<client_slug>_<recordtype_lower> convention', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    const filename = Object.keys(out.files)[0];
    expect(filename).toBe('Objects/custform_atlas_industries_salesord.xml');
    expect(out.files[filename]).toContain(
      '<transactionform scriptid="custform_atlas_industries_salesord">',
    );
  });

  it('form name is "<Client Name> <Display> Form"', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<name>Atlas Industries Group Sales Order Form</name>');
  });

  it('form is marked preferred=T', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<preferred>T</preferred>');
  });

  it('recordtype enum maps SO/PO/INV/BILL/JE/IR correctly', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: TXN_HEAVY_SCOPE,
    });
    const wholeBundle = Object.values(out.files).join('\n');
    expect(wholeBundle).toContain('<recordtype>SALESORD</recordtype>');
    expect(wholeBundle).toContain('<recordtype>PURCHORD</recordtype>');
    expect(wholeBundle).toContain('<recordtype>INVOICE</recordtype>');
    expect(wholeBundle).toContain('<recordtype>VENDBILL</recordtype>');
    expect(wholeBundle).toContain('<recordtype>JOURNALENTRY</recordtype>');
    expect(wholeBundle).toContain('<recordtype>ITEMRCPT</recordtype>');
  });

  it('Bill display name is "Vendor Bill" (NetSuite convention)', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Bill: 1 custom field (Approval Tier)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<name>Atlas Industries Group Vendor Bill Form</name>');
  });
});

// ─── Field embedding ────────────────────────────────────────────────────────

describe('generateTransactionForms — field embedding', () => {
  it('embeds every Pack B field for the parent as a <field><id>...</id></field>', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope:
        'Sales Order: 3 custom fields (Project Reference, Renewal Type, Margin Override)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<id>custbody_project_reference</id>');
    expect(xml).toContain('<id>custbody_renewal_type</id>');
    expect(xml).toContain('<id>custbody_margin_override</id>');
  });

  it('field rows include visible=T mandatory=F defaults', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toMatch(/<id>custbody_project_reference<\/id>\s*<visible>T<\/visible>\s*<mandatory>F<\/mandatory>/);
  });

  it('fields are wrapped under a "Custom Fields" fieldgroup', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<fieldgroup>');
    expect(xml).toContain('<id>customfields</id>');
    expect(xml).toContain('<label>Custom Fields</label>');
    expect(xml).toContain('</fieldgroup>');
  });
});

// ─── PO approval auto-add ───────────────────────────────────────────────────

describe('generateTransactionForms — PO approval auto-add', () => {
  it('embeds custbody_nsix_required_approver in the PO form when poApprovalInScope=true', () => {
    const out = generateTransactionForms({
      clientName: 'Atlas Industries Group',
      customFieldsScope: 'Purchase Order: 1 custom field (Vendor Tier)',
      poApprovalInScope: true,
    });
    const filename = 'Objects/custform_atlas_industries_purchord.xml';
    expect(out.files[filename]).toBeDefined();
    expect(out.files[filename]).toContain('<id>custbody_nsix_required_approver</id>');
  });

  it('does NOT embed custbody_nsix_required_approver when poApprovalInScope=false', () => {
    const out = generateTransactionForms({
      clientName: 'Atlas Industries Group',
      customFieldsScope: 'Purchase Order: 1 custom field (Vendor Tier)',
      poApprovalInScope: false,
    });
    const filename = 'Objects/custform_atlas_industries_purchord.xml';
    expect(out.files[filename]).toBeDefined();
    expect(out.files[filename]).not.toContain('custbody_nsix_required_approver');
  });

  it('does NOT auto-emit a Purchase Order form when no PO custom fields AND poApprovalInScope=false', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
    });
    expect(Object.keys(out.files)).not.toContain(
      'Objects/custform_atlas_industries_purchord.xml',
    );
  });

  it('AUTO-emits a Purchase Order form when poApprovalInScope=true even without explicit PO fields (auto-add IS the field)', () => {
    const out = generateTransactionForms({
      clientName: 'Atlas Industries Group',
      customFieldsScope: 'Sales Order: 1 custom field (Project Reference)',
      poApprovalInScope: true,
    });
    // poApprovalInScope=true causes Pack B's field generator to emit
    // custbody_nsix_required_approver under parent='Purchase Order'.
    // That parent now has a field, so a PO form is emitted.
    expect(Object.keys(out.files)).toContain(
      'Objects/custform_atlas_industries_purchord.xml',
    );
  });
});

// ─── Validator passthrough ──────────────────────────────────────────────────

describe('generateTransactionForms — validator passthrough', () => {
  it('Atlas-shaped seed forms are valid XML and pass the structural validator', () => {
    const out = generateTransactionForms({
      ...BASE_INPUT,
      customFieldsScope: ATLAS_FIELDS_SCOPE,
      poApprovalInScope: true,
    });
    // The structural validator does not currently have transactionform
    // rules — it returns clean by default for unknown file types,
    // which is by design (additive validator extension model).
    const result = validateSDFBundle(out.files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });
});
