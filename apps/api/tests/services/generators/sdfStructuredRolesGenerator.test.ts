import { describe, it, expect } from 'vitest';
import {
  generateSdfStructuredRoles,
  resolveLegacyStandardRoleCustomization,
  type StructuredRole,
} from '../../../src/services/generators/sdfStructuredRolesGenerator.js';

/**
 * Phase 25 — sdfStructuredRolesGenerator coverage.
 *
 * Same shape as Phase 23's sdfStructuredCustomFieldsGenerator.test.ts:
 *   - happy-path emit
 *   - per-field overrides (center / permissions / restriction)
 *   - customizationNotes overlay (read-only / group-wide / remove-approve)
 *   - input parsing (string vs array, malformed JSON, empty)
 *   - validation surface (empty name, unknown center, unknown permlevel)
 *   - dedup (case-insensitive slug collision)
 *   - adaptor gate (odoo / custom:* → empty output)
 *   - resolveLegacyStandardRoleCustomization precedence helper
 */

function role(over: Partial<StructuredRole> = {}): StructuredRole {
  return {
    name: 'AP Clerk',
    centerOverride: null,
    permissionOverrides: null,
    restrictionOverride: null,
    customizationNotes: '',
    ...over,
  };
}

describe('generateSdfStructuredRoles — happy path', () => {
  it('emits one role XML per structured row', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk' }), role({ name: 'CFO' })],
    });
    expect(out.errors).toEqual([]);
    expect(Object.keys(out.files)).toHaveLength(2);
    expect(out.emitted).toHaveLength(2);
    expect(out.files['Objects/customrole_nsix_ap_clerk.xml']).toBeDefined();
    expect(out.files['Objects/customrole_nsix_cfo.xml']).toBeDefined();
  });

  it('uses the keyword classifier when no override is supplied (AP → ACCOUNTING_CENTER)', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk' })],
    });
    expect(out.emitted[0].center).toBe('ACCOUNTING_CENTER');
  });

  it('emits XML containing the role name, scriptid, and center', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'Finance Manager - GCC' })],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('<name>Finance Manager - GCC</name>');
    expect(xml).toContain('<role scriptid="customrole_nsix_finance_manager_gcc">');
    expect(xml).toContain('<centertype>ACCOUNTING_CENTER</centertype>');
  });

  it('includes the structured-row provenance hint in the XML comment header', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk', customizationNotes: 'subsidiary-scoped' })],
    });
    const xml = Object.values(out.files)[0]!;
    expect(xml).toContain('[structured row 0] AP Clerk: subsidiary-scoped');
  });
});

describe('generateSdfStructuredRoles — overrides', () => {
  it('centerOverride supersedes the keyword classifier', () => {
    // "AP Clerk" classifies to ACCOUNTING_CENTER by default; override to SALES.
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk', centerOverride: 'SALES_CENTER' })],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted[0].center).toBe('SALES_CENTER');
    expect(out.emitted[0].appliedOverlays).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/center override: SALES_CENTER \(classifier suggested ACCOUNTING_CENTER\)/),
      ]),
    );
  });

  it('permissionOverrides replace the starter set', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({
          name: 'Custom Auditor',
          permissionOverrides: [
            { permkey: 'LIST_CUSTOMER', permlevel: 'VIEW' },
            { permkey: 'LIST_VENDOR', permlevel: 'VIEW' },
          ],
        }),
      ],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted[0].permissions).toHaveLength(2);
    expect(out.emitted[0].permissions[0]).toEqual({ permkey: 'LIST_CUSTOMER', permlevel: 'VIEW' });
    expect(out.emitted[0].appliedOverlays).toEqual(
      expect.arrayContaining([expect.stringMatching(/permissions override: 2 explicit perm/)]),
    );
  });

  it('restrictionOverride supersedes the classifier default', () => {
    // CFO classifies to defaultRestriction = NONE; override to OWN.
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'CFO', restrictionOverride: 'OWN' })],
    });
    expect(out.emitted[0].restrictionbysubsidiary).toBe('OWN');
    expect(out.emitted[0].appliedOverlays).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/restriction override: OWN \(classifier defaulted to NONE\)/),
      ]),
    );
  });

  it('all three overrides combine without re-running the keyword classifier', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({
          name: 'AP Clerk',
          centerOverride: 'CLASSIC',
          permissionOverrides: [{ permkey: 'LIST_VENDOR', permlevel: 'VIEW' }],
          restrictionOverride: 'OWN_AND_HIERARCHY',
        }),
      ],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted[0].center).toBe('CLASSIC');
    expect(out.emitted[0].permissions).toEqual([{ permkey: 'LIST_VENDOR', permlevel: 'VIEW' }]);
    expect(out.emitted[0].restrictionbysubsidiary).toBe('OWN_AND_HIERARCHY');
  });
});

describe('generateSdfStructuredRoles — customizationNotes overlay', () => {
  it('"read-only" overlay downgrades all permissions to VIEW', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk', customizationNotes: 'read-only' })],
    });
    expect(out.emitted[0].permissions.every((p) => p.permlevel === 'VIEW')).toBe(true);
    expect(out.emitted[0].appliedOverlays).toEqual(
      expect.arrayContaining([expect.stringMatching(/read-only override/)]),
    );
  });

  it('"group-wide" overlay sets restrictionbysubsidiary = NONE', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk', customizationNotes: 'group-wide' })],
    });
    expect(out.emitted[0].restrictionbysubsidiary).toBe('NONE');
  });

  it('"subsidiary-scoped" overlay sets restrictionbysubsidiary = OWN', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'CFO', customizationNotes: 'subsidiary-scoped' })],
    });
    expect(out.emitted[0].restrictionbysubsidiary).toBe('OWN');
  });

  it('"remove Approve Bills permission" downgrades VENDORBILL FULL → CREATE for AP roles', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({ name: 'AP Clerk', customizationNotes: 'remove Approve Bills permission' }),
      ],
    });
    const billPerm = out.emitted[0].permissions.find((p) => p.permkey === 'TRAN_VENDORBILL');
    expect(billPerm?.permlevel).toBe('CREATE');
  });

  it('overlay applies to permissionOverrides too (read-only on a custom perm list)', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({
          name: 'Custom Reviewer',
          permissionOverrides: [
            { permkey: 'LIST_CUSTOMER', permlevel: 'FULL' },
            { permkey: 'TRAN_INVOICE', permlevel: 'EDIT' },
          ],
          customizationNotes: 'read-only',
        }),
      ],
    });
    expect(out.emitted[0].permissions.every((p) => p.permlevel === 'VIEW')).toBe(true);
  });
});

describe('generateSdfStructuredRoles — input parsing', () => {
  it('accepts a JSON-stringified array', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: JSON.stringify([role({ name: 'AP Clerk' })]),
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted).toHaveLength(1);
  });

  it('accepts a parsed array directly', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk' })],
    });
    expect(out.errors).toEqual([]);
    expect(out.emitted).toHaveLength(1);
  });

  it.each([null, undefined, '', '   '])(
    'returns empty output for absent/empty input (%p)',
    (input) => {
      const out = generateSdfStructuredRoles({
        adaptorId: 'netsuite',
        structuredAnswer: input as null,
      });
      expect(out.errors).toEqual([]);
      expect(out.emitted).toEqual([]);
      expect(out.files).toEqual({});
    },
  );

  it('reports a JSON parse error for malformed strings', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: '{ not valid json',
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].field).toBe('_root');
    expect(out.errors[0].message).toMatch(/JSON parse failed/);
  });

  it('reports a shape error when JSON is not an array', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: '{"name":"oops"}',
    });
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].message).toMatch(/must be a JSON array/);
  });
});

describe('generateSdfStructuredRoles — validation', () => {
  it('flags an empty name', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: '' })],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors).toContainEqual(
      expect.objectContaining({ field: 'name', message: 'name is required' }),
    );
  });

  it('flags a name that slugifies to nothing', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: '!!!' })],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].message).toMatch(/produces an empty slug/);
  });

  it('flags an unknown centerOverride', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({ name: 'AP Clerk', centerOverride: 'BOGUS_CENTER' as unknown as null }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('centerOverride');
  });

  it('flags an unknown restrictionOverride', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({ name: 'AP Clerk', restrictionOverride: 'GROUP_AND_PARENTS' as unknown as null }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('restrictionOverride');
  });

  it('flags an unknown permlevel inside permissionOverrides', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({
          name: 'Custom Reviewer',
          permissionOverrides: [
            { permkey: 'LIST_CUSTOMER', permlevel: 'WRITE' as unknown as 'VIEW' },
          ],
        }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('permissionOverrides[0].permlevel');
  });

  it('flags an empty permkey inside permissionOverrides', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [
        role({
          name: 'Custom Reviewer',
          permissionOverrides: [{ permkey: '', permlevel: 'VIEW' }],
        }),
      ],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('permissionOverrides[0].permkey');
  });

  it('skips an invalid row but still emits valid rows in the same batch', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: '' }), role({ name: 'CFO' })],
    });
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.emitted).toHaveLength(1);
    expect(out.emitted[0].roleName).toBe('CFO');
  });

  it('flags a row that is not an object', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: ['oops' as unknown as StructuredRole],
    });
    expect(out.emitted).toEqual([]);
    expect(out.errors[0].field).toBe('_root');
  });
});

describe('generateSdfStructuredRoles — dedup', () => {
  it('flags duplicates that produce the same scriptid', () => {
    const out = generateSdfStructuredRoles({
      adaptorId: 'netsuite',
      structuredAnswer: [role({ name: 'AP Clerk' }), role({ name: 'AP CLERK' })],
    });
    expect(out.emitted).toHaveLength(1);
    expect(out.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringMatching(/duplicate scriptid "customrole_nsix_ap_clerk"/),
      }),
    );
  });
});

describe('generateSdfStructuredRoles — adaptor gate', () => {
  it.each(['odoo', 'custom:sahel', 'custom:meridian'])(
    'returns empty output for non-netsuite adaptors (%s)',
    (adaptorId) => {
      const out = generateSdfStructuredRoles({
        adaptorId,
        structuredAnswer: [role({ name: 'AP Clerk' })],
      });
      expect(out.files).toEqual({});
      expect(out.emitted).toEqual([]);
      expect(out.errors).toEqual([]);
    },
  );
});

describe('resolveLegacyStandardRoleCustomization', () => {
  it('returns undefined when structured payload is non-empty (structured wins)', () => {
    const structured = JSON.stringify([role({ name: 'AP Clerk' })]);
    expect(
      resolveLegacyStandardRoleCustomization('AP Clerk: subsidiary-scoped', structured),
    ).toBeUndefined();
  });

  it('returns the legacy textarea when structured is null', () => {
    expect(
      resolveLegacyStandardRoleCustomization('AP Clerk: read-only', null),
    ).toBe('AP Clerk: read-only');
  });

  it('returns the legacy textarea when structured is undefined', () => {
    expect(
      resolveLegacyStandardRoleCustomization('AP Clerk: read-only', undefined),
    ).toBe('AP Clerk: read-only');
  });

  it('returns the legacy textarea when structured is empty string', () => {
    expect(resolveLegacyStandardRoleCustomization('AP Clerk', '')).toBe('AP Clerk');
  });

  it('returns the legacy textarea when structured is whitespace only', () => {
    expect(resolveLegacyStandardRoleCustomization('AP Clerk', '   ')).toBe('AP Clerk');
  });

  it('returns undefined when both are empty', () => {
    expect(resolveLegacyStandardRoleCustomization('', '')).toBeUndefined();
    expect(resolveLegacyStandardRoleCustomization(null, null)).toBeUndefined();
    expect(resolveLegacyStandardRoleCustomization(undefined, undefined)).toBeUndefined();
  });

  it('returns the legacy textarea when structured is a valid JSON empty array (matches Phase 23 empty-object behaviour)', () => {
    expect(resolveLegacyStandardRoleCustomization('AP Clerk', '[]')).toBe('AP Clerk');
  });

  it('returns undefined when structured is a non-empty array literal (already-parsed payload)', () => {
    expect(
      resolveLegacyStandardRoleCustomization(
        'AP Clerk',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [role({ name: 'CFO' })] as any,
      ),
    ).toBeUndefined();
  });

  it('returns the legacy textarea when structured JSON is malformed (defensive — surface error elsewhere)', () => {
    expect(
      resolveLegacyStandardRoleCustomization('AP Clerk', '{not valid json'),
    ).toBe('AP Clerk');
  });
});
