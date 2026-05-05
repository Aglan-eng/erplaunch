import { describe, it, expect } from 'vitest';
import {
  generateSdfStructuredTemplates,
  type StructuredTemplate,
  type TemplateKind,
  type TemplateSection,
} from '../../../src/services/generators/sdfStructuredTemplatesGenerator.js';

/**
 * Phase 26 — sdfStructuredTemplatesGenerator coverage.
 *
 * Same shape as Phase 23/25 structured generator tests:
 *   - happy-path emit per template kind (4 kinds)
 *   - sections multi-select propagation
 *   - preferred toggle + emailtemplate routing for DUNNING_EMAIL
 *   - input parsing (string vs array, malformed JSON, empty)
 *   - validation surface
 *   - dedup
 *   - adaptor gate
 */

function tmpl(over: Partial<StructuredTemplate> = {}): StructuredTemplate {
  return {
    name: 'Acme Custom Invoice',
    kind: 'INVOICE',
    preferred: true,
    sections: ['LOGO', 'BILL_TO', 'LINE_TABLE'],
    notes: '',
    ...over,
  };
}

describe('generateSdfStructuredTemplates — happy path', () => {
  it('emits one PDF template XML per non-email row', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice' }), tmpl({ name: 'Custom PO', kind: 'PURCHASE_ORDER' })],
    });
    expect(out.errors).toEqual([]);
    expect(Object.keys(out.files)).toHaveLength(2);
    expect(out.files['Objects/custtmpl_nsix_custom_invoice.xml']).toBeDefined();
    expect(out.files['Objects/custtmpl_nsix_custom_po.xml']).toBeDefined();
  });

  it('uses the advancedpdftemplate root for non-email kinds', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', kind: 'INVOICE' })],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('<advancedpdftemplate scriptid="custtmpl_nsix_custom_invoice">');
    expect(xml).toContain('<recordtype>INVOICE</recordtype>');
  });

  it('uses the emailtemplate root for DUNNING_EMAIL', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Late Notice', kind: 'DUNNING_EMAIL', preferred: false })],
    });
    expect(out.emitted[0].isEmailTemplate).toBe(true);
    const xml = out.files['Objects/custemail_nsix_late_notice.xml']!;
    expect(xml).toContain('<emailtemplate scriptid="custemail_nsix_late_notice">');
    expect(xml).toContain('<recordtype>TRANSACTION</recordtype>');
  });

  it('maps each kind to its NetSuite recordtype', () => {
    const cases: Array<{ kind: TemplateKind; expectedRecordtype: string }> = [
      { kind: 'INVOICE', expectedRecordtype: 'INVOICE' },
      { kind: 'PURCHASE_ORDER', expectedRecordtype: 'PURCHASEORDER' },
      { kind: 'STATEMENT', expectedRecordtype: 'STATEMENT' },
      { kind: 'DUNNING_EMAIL', expectedRecordtype: 'TRANSACTION' },
    ];
    for (const { kind, expectedRecordtype } of cases) {
      const out = generateSdfStructuredTemplates({
        adaptorId: 'netsuite',
        structuredAnswer: [tmpl({ name: `Test ${kind}`, kind, preferred: false })],
      });
      expect(out.errors).toEqual([]);
      expect(out.emitted[0].recordtype).toBe(expectedRecordtype);
    }
  });

  it('emits <preferred>T</preferred> when preferred is true (PDF only)', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', preferred: true })],
    });
    expect(Object.values(out.files)[0]).toContain('<preferred>T</preferred>');
  });

  it('emits <preferred>F</preferred> when preferred is false (PDF only)', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', preferred: false })],
    });
    expect(Object.values(out.files)[0]).toContain('<preferred>F</preferred>');
  });
});

describe('generateSdfStructuredTemplates — sections', () => {
  it('renders one TODO marker per captured section (non-email)', () => {
    const sections: TemplateSection[] = ['LOGO', 'BILL_TO', 'SHIP_TO', 'LINE_TABLE', 'FOOTER_TERMS'];
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', sections })],
    });
    const xml = Object.values(out.files)[0]!;
    for (const s of sections) {
      // Header comment lists the section
      expect(xml).toContain(s === 'LOGO' ? 'Company logo' : '');
    }
    // Body content has the TODO markers
    expect(xml).toContain('TODO: Company logo (top-left)');
    expect(xml).toContain('TODO: Bill-to address block');
    expect(xml).toContain('TODO: Ship-to address block');
    expect(xml).toContain('TODO: Line-item table');
    expect(xml).toContain('TODO: Footer terms');
  });

  it('renders an empty-state hint when no sections captured', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', sections: [] })],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('(no sections selected — consultant to add content)');
  });

  it('renders TODO markers for DUNNING_EMAIL too', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({
          name: 'First Notice',
          kind: 'DUNNING_EMAIL',
          preferred: false,
          sections: ['DUNNING_TIER', 'PAYMENT_INSTRUCTIONS'],
        }),
      ],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('TODO: Dunning tier message');
    expect(xml).toContain('TODO: Payment instructions');
  });

  it('preserves the consultant notes block when notes is non-empty', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({ name: 'Custom Invoice', notes: 'Use Acme corporate red (#c8102e) for header bar.' }),
      ],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('Consultant notes:');
    expect(xml).toContain('Use Acme corporate red (#c8102e) for header bar.');
  });

  it('omits the consultant notes block when notes is empty', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Custom Invoice', notes: '' })],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).not.toContain('Consultant notes:');
  });
});

describe('generateSdfStructuredTemplates — input parsing', () => {
  it('accepts a JSON-stringified array', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: JSON.stringify([tmpl({ name: 'X' })]),
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted).toHaveLength(1);
  });

  it('accepts a parsed array directly', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'X' })],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted).toHaveLength(1);
  });

  it.each([null, undefined, '', '   '])(
    'returns empty output for absent/empty input (%p)',
    (input) => {
      const out = generateSdfStructuredTemplates({
        adaptorId: 'netsuite',
        structuredAnswer: input as null,
      });
      expect(out.errors).toEqual([]);
      expect(out.emitted).toEqual([]);
      expect(out.files).toEqual({});
    },
  );

  it('reports a JSON parse error for malformed strings', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: '{ not valid json',
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].message).toMatch(/JSON parse failed/);
  });

  it('reports a shape error when JSON is not an array', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: '{"oops":true}',
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].message).toMatch(/must be a JSON array/);
  });
});

describe('generateSdfStructuredTemplates — validation', () => {
  it('flags an empty name', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: '' })],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('name');
  });

  it('flags a name that slugifies to nothing', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: '!!!' })],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].message).toMatch(/produces an empty slug/);
  });

  it('flags an unknown kind', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({ name: 'Bogus', kind: 'CHECK_PRINT' as unknown as TemplateKind }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('kind');
  });

  it('flags an unknown section', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({
          name: 'Custom Invoice',
          sections: ['LOGO', 'BARCODES' as unknown as TemplateSection],
        }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('sections[1]');
  });

  it('flags non-boolean preferred', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: 'Bad', preferred: 1 as unknown as boolean })],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('preferred');
  });

  it('flags a row that is not an object', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: ['oops' as unknown as StructuredTemplate],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('_root');
  });

  it('skips an invalid row but still emits valid rows in the same batch', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [tmpl({ name: '' }), tmpl({ name: 'Good' })],
    });
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].name).toBe('Good');
  });
});

describe('generateSdfStructuredTemplates — dedup', () => {
  it('flags duplicate scriptids per prefix (PDF and email collide independently)', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({ name: 'Notice' }),
        tmpl({ name: 'NOTICE' }), // case-insensitive collision after slugify
      ],
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/duplicate scriptid "custtmpl_nsix_notice"/),
      }),
    );
  });

  it('does NOT flag a name collision across PDF and email prefixes (different scriptid prefixes)', () => {
    const out = generateSdfStructuredTemplates({
      adaptorId: 'netsuite',
      structuredAnswer: [
        tmpl({ name: 'Notice', kind: 'INVOICE' }),
        tmpl({ name: 'Notice', kind: 'DUNNING_EMAIL', preferred: false }),
      ],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted).toHaveLength(2);
    expect(out.emitted.map((e) => e.scriptid).sort()).toEqual([
      'custemail_nsix_notice',
      'custtmpl_nsix_notice',
    ]);
  });
});

describe('generateSdfStructuredTemplates — adaptor gate', () => {
  it.each(['odoo', 'custom:sahel', 'custom:meridian'])(
    'returns empty output for non-netsuite adaptors (%s)',
    (adaptorId) => {
      const out = generateSdfStructuredTemplates({
        adaptorId,
        structuredAnswer: [tmpl({ name: 'Custom Invoice' })],
      });
      expect(out.files).toEqual({});
      expect(out.emitted).toEqual([]);
      expect(out.errors).toEqual([]);
    },
  );
});
