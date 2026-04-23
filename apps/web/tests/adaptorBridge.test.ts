import { describe, it, expect } from 'vitest';
import { bridgeAdaptorSchema } from '@/components/wizard/adaptorBridge';

describe('bridgeAdaptorSchema', () => {
  it('returns an empty map for null / malformed input', () => {
    expect(bridgeAdaptorSchema(null).size).toBe(0);
    expect(bridgeAdaptorSchema(undefined).size).toBe(0);
    expect(bridgeAdaptorSchema({}).size).toBe(0);
    expect(bridgeAdaptorSchema({ flows: 'nope' }).size).toBe(0);
  });

  it('maps R2R / P2P / O2C flows onto the wizard prefix convention', () => {
    const schema = {
      version: '1.0.0',
      flows: [
        {
          id: 'R2R',
          label: 'Record-to-Report',
          sections: [{ id: 'entities', label: 'Entities', order: 1, questions: [
            { id: 'x.entities.multiCompany', inputType: 'BOOLEAN', required: true, label: 'Multi-company?' },
          ] }],
        },
        {
          id: 'P2P',
          label: 'Procure-to-Pay',
          sections: [{ id: 'purchase', label: 'Purchase', order: 1, questions: [
            { id: 'x.purchase.threeWayMatch', inputType: 'BOOLEAN', required: true, label: '3-way match?' },
          ] }],
        },
        {
          id: 'O2C',
          label: 'Order-to-Cash',
          sections: [{ id: 'sales', label: 'Sales', order: 1, questions: [
            { id: 'x.sales.quote', inputType: 'BOOLEAN', required: true, label: 'Quotes?' },
          ] }],
        },
      ],
    };

    const out = bridgeAdaptorSchema(schema);
    expect(Array.from(out.keys()).sort()).toEqual(['o2c.sales', 'p2p.purchase', 'r2r.entities']);
  });

  it('maps PRODUCTION → mfg and RETURNS → rtn (legacy wizard prefixes)', () => {
    const schema = {
      flows: [
        { id: 'PRODUCTION', sections: [{ id: 'mrp', label: 'MRP', order: 1, questions: [
          { id: 'x.mrp.enabled', inputType: 'BOOLEAN', required: true, label: 'Use MRP?' },
        ] }] },
        { id: 'RETURNS', sections: [{ id: 'policy', label: 'Policy', order: 1, questions: [
          { id: 'x.policy.rule', inputType: 'TEXT', required: true, label: 'Rule' },
        ] }] },
      ],
    };

    const out = bridgeAdaptorSchema(schema);
    expect(out.has('mfg.mrp')).toBe(true);
    expect(out.has('rtn.policy')).toBe(true);
  });

  it('ignores unknown flow IDs', () => {
    const schema = {
      flows: [
        { id: 'MAGIC', sections: [{ id: 'x', label: 'X', order: 1, questions: [
          { id: 'x.x.y', inputType: 'TEXT', required: true, label: 'Y' },
        ] }] },
      ],
    };
    expect(bridgeAdaptorSchema(schema).size).toBe(0);
  });

  it('flattens nested help blocks into flat helpTitle/helpBody/exampleText', () => {
    const schema = {
      flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities', order: 1, questions: [
        {
          id: 'r2r.entities.multiCompany',
          inputType: 'BOOLEAN',
          required: true,
          label: 'Multi-company?',
          help: { title: 'Multi-company in Odoo', body: 'Enables intercompany rules.', example: 'EMEA + APAC' },
        },
      ] }] }],
    };
    const bridged = bridgeAdaptorSchema(schema).get('r2r.entities')!;
    expect(bridged.questions[0].helpTitle).toBe('Multi-company in Odoo');
    expect(bridged.questions[0].helpBody).toBe('Enables intercompany rules.');
    expect(bridged.questions[0].exampleText).toBe('EMEA + APAC');
  });

  it('passes options, dependsOn, consultantNote through', () => {
    const schema = {
      flows: [{ id: 'O2C', sections: [{ id: 'sales', label: 'Sales', order: 1, questions: [
        {
          id: 'o2c.sales.priceListStrategy',
          inputType: 'SINGLE_SELECT',
          required: true,
          label: 'Pricelist strategy',
          consultantNote: 'Ask the CFO first.',
          options: [
            { value: 'SINGLE', label: 'Single' },
            { value: 'TIERED', label: 'Tiered', description: 'Per customer tier' },
          ],
          dependsOn: { questionId: 'o2c.sales.enabled', value: true },
        },
      ] }] }],
    };
    const q = bridgeAdaptorSchema(schema).get('o2c.sales')!.questions[0];
    expect(q.options).toHaveLength(2);
    expect(q.options?.[0].description).toBe(''); // defaults empty
    expect(q.options?.[1].description).toBe('Per customer tier');
    expect(q.dependsOn?.questionId).toBe('o2c.sales.enabled');
    expect(q.dependsOn?.value).toBe(true);
    expect(q.consultantNote).toBe('Ask the CFO first.');
  });

  it('drops questions missing id / inputType / label', () => {
    const schema = {
      flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities', order: 1, questions: [
        { inputType: 'BOOLEAN', required: true, label: 'Missing id' },
        { id: 'r2r.entities.hasLabel', required: true, label: 'Missing inputType' },
        { id: 'r2r.entities.hasType', inputType: 'BOOLEAN', required: true },
        { id: 'r2r.entities.ok', inputType: 'BOOLEAN', required: true, label: 'Fine' },
      ] }] }],
    };
    const section = bridgeAdaptorSchema(schema).get('r2r.entities')!;
    expect(section.questions.map((q) => q.id)).toEqual(['r2r.entities.ok']);
  });

  it('sets section/flow fields on bridged questions so downstream code stays compatible', () => {
    const schema = {
      flows: [{ id: 'R2R', sections: [{ id: 'entities', label: 'Entities', order: 3, questions: [
        { id: 'r2r.entities.a', inputType: 'BOOLEAN', required: true, label: 'A' },
        { id: 'r2r.entities.b', inputType: 'BOOLEAN', required: true, label: 'B' },
      ] }] }],
    };
    const section = bridgeAdaptorSchema(schema).get('r2r.entities')!;
    expect(section.sectionOrder).toBe(3);
    expect(section.questions.every((q) => q.flow === 'R2R' && q.section === 'entities')).toBe(true);
    expect(section.questions.map((q) => q.order)).toEqual([1, 2]);
  });
});
