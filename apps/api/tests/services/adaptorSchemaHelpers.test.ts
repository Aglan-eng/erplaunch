import { describe, it, expect } from 'vitest';
import { findSectionLabel } from '../../src/services/adaptorSchemaHelpers.js';

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
