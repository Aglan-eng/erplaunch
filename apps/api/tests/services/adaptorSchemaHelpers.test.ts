import { describe, it, expect } from 'vitest';
import {
  findSectionLabel,
  flattenAdaptorSchemaToQuestions,
  wizardPrefixForFlow,
} from '../../src/services/adaptorSchemaHelpers.js';

describe('findSectionLabel', () => {
  it('returns undefined for null / malformed schemas', () => {
    expect(findSectionLabel(null, 'r2r.entities')).toBeUndefined();
    expect(findSectionLabel(undefined, 'r2r.entities')).toBeUndefined();
    expect(findSectionLabel({}, 'r2r.entities')).toBeUndefined();
    expect(findSectionLabel({ flows: 'not-an-array' as unknown as never }, 'r2r.entities')).toBeUndefined();
  });

  it('returns the label when the section exists', () => {
    const schema = {
      flows: [
        {
          id: 'R2R',
          sections: [
            { id: 'entities', label: 'Entities & Companies' },
            { id: 'coa', label: 'Chart of Accounts' },
          ],
        },
      ],
    };
    expect(findSectionLabel(schema, 'r2r.entities')).toBe('Entities & Companies');
    expect(findSectionLabel(schema, 'r2r.coa')).toBe('Chart of Accounts');
  });

  it('returns undefined when the wizard key has no section suffix', () => {
    const schema = { flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities' }] }] };
    expect(findSectionLabel(schema, 'r2r')).toBeUndefined();
    expect(findSectionLabel(schema, '')).toBeUndefined();
  });

  it('returns undefined when the section is not declared on the adaptor', () => {
    const schema = { flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities' }] }] };
    expect(findSectionLabel(schema, 'r2r.notThere')).toBeUndefined();
    expect(findSectionLabel(schema, 'p2p.vendors')).toBeUndefined();
  });

  it('skips flows with malformed sections', () => {
    const schema = {
      flows: [
        { id: 'R2R', sections: undefined as unknown as never },
        { id: 'P2P', sections: [{ id: 'purchase', label: 'Purchase' }] },
      ],
    };
    expect(findSectionLabel(schema, 'p2p.purchase')).toBe('Purchase');
  });

  it('tolerates dotted section IDs (preserves suffix after the first dot)', () => {
    // Some adaptors may use dotted section IDs like "accounts.bank" —
    // everything after the flow prefix should be treated as the section id.
    const schema = {
      flows: [{ id: 'R2R', sections: [{ id: 'accounts.bank', label: 'Bank Accounts' }] }],
    };
    expect(findSectionLabel(schema, 'r2r.accounts.bank')).toBe('Bank Accounts');
  });
});

describe('wizardPrefixForFlow', () => {
  it('maps adaptor flow IDs onto wizard prefixes', () => {
    expect(wizardPrefixForFlow('R2R')).toBe('r2r');
    expect(wizardPrefixForFlow('P2P')).toBe('p2p');
    expect(wizardPrefixForFlow('O2C')).toBe('o2c');
    expect(wizardPrefixForFlow('PRODUCTION')).toBe('mfg');
    expect(wizardPrefixForFlow('RETURNS')).toBe('rtn');
  });
});

describe('flattenAdaptorSchemaToQuestions', () => {
  it('returns an empty array for null / malformed schemas', () => {
    expect(flattenAdaptorSchemaToQuestions(null)).toEqual([]);
    expect(flattenAdaptorSchemaToQuestions(undefined)).toEqual([]);
    expect(flattenAdaptorSchemaToQuestions({})).toEqual([]);
  });

  it('flattens a well-formed schema into @ofoq/shared Question[]', () => {
    const schema = {
      flows: [
        {
          id: 'R2R',
          sections: [
            {
              id: 'entities',
              label: 'Entities',
              questions: [
                { id: 'r2r.entities.multiCompany', inputType: 'BOOLEAN', required: true, label: 'Multi-company?' },
                {
                  id: 'r2r.entities.currency',
                  inputType: 'SINGLE_SELECT',
                  required: true,
                  label: 'Base currency',
                  options: [
                    { value: 'USD', label: 'US Dollar' },
                    { value: 'EUR', label: 'Euro', description: 'Eurozone' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const out = flattenAdaptorSchemaToQuestions(schema);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('r2r.entities.multiCompany');
    expect(out[0].flow).toBe('R2R');
    expect(out[0].section).toBe('entities');
    expect(out[0].order).toBe(1);
    expect(out[1].order).toBe(2);
    expect(out[1].options).toHaveLength(2);
    expect(out[1].options?.[0].description).toBe(''); // fills empty description
    expect(out[1].options?.[1].description).toBe('Eurozone');
  });

  it('flattens help blocks whether nested or flat', () => {
    const schema = {
      flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities', questions: [
        { id: 'a', inputType: 'BOOLEAN', required: true, label: 'A', help: { title: 'T', body: 'B', example: 'E' } },
        { id: 'b', inputType: 'BOOLEAN', required: true, label: 'B', helpTitle: 'T2', helpBody: 'B2', exampleText: 'E2' },
      ] }] }],
    };
    const [a, b] = flattenAdaptorSchemaToQuestions(schema);
    expect(a.helpTitle).toBe('T');
    expect(a.helpBody).toBe('B');
    expect(a.exampleText).toBe('E');
    expect(b.helpTitle).toBe('T2');
    expect(b.helpBody).toBe('B2');
    expect(b.exampleText).toBe('E2');
  });

  it('skips unknown flow IDs and invalid questions', () => {
    const schema = {
      flows: [
        { id: 'SOCIAL', sections: [{ id: 'x', label: 'X', questions: [
          { id: 'x.x.y', inputType: 'TEXT', required: true, label: 'Y' },
        ] }] },
        { id: 'R2R', sections: [{ id: 'entities', label: 'Entities', questions: [
          { inputType: 'BOOLEAN', required: true, label: 'No id' },
          { id: 'ok', inputType: 'BOOLEAN', required: true, label: 'OK' },
          { id: 'no-type', required: true, label: 'No type' },
        ] }] },
      ],
    };
    const out = flattenAdaptorSchemaToQuestions(schema);
    expect(out.map((q) => q.id)).toEqual(['ok']);
  });

  it('carries dependsOn + consultantNote through unchanged', () => {
    const schema = {
      flows: [{ id: 'O2C', sections: [{ id: 'sales', label: 'Sales', questions: [
        {
          id: 'o2c.sales.pricing',
          inputType: 'SINGLE_SELECT',
          required: true,
          label: 'Pricing',
          consultantNote: 'Ask the CFO.',
          dependsOn: { questionId: 'o2c.sales.enabled', value: true },
          options: [{ value: 'SINGLE', label: 'Single' }],
        },
      ] }] }],
    };
    const [q] = flattenAdaptorSchemaToQuestions(schema);
    expect(q.consultantNote).toBe('Ask the CFO.');
    expect(q.dependsOn?.questionId).toBe('o2c.sales.enabled');
    expect(q.dependsOn?.value).toBe(true);
  });
});
