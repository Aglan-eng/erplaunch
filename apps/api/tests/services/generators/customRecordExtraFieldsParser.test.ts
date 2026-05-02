import { describe, it, expect } from 'vitest';
import { parseExtraFields } from '../../../src/services/generators/customRecordExtraFieldsParser.js';

/**
 * Pack K — Custom Record Extra Fields parser tests.
 *
 * Pack contract:
 *   1. Parse "<record_name>: <field_label>: <type>" lines.
 *   2. Type tokens (case-insensitive) map to NetSuite SDF fieldtypes:
 *        TEXT/TEXTAREA/CHECKBOX/DATE/CURRENCY/NUMBER/SELECT/EMPLOYEE/
 *        TRANSACTION/SUBSIDIARY.
 *   3. Bad-format lines are silently skipped (consultant fixes
 *      manually; baseline + starter pipeline still produces output).
 *   4. Multiple lines per record accumulate into one entry; field
 *      order preserves wizard line order.
 */

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('parseExtraFields — empty / smoke', () => {
  it('returns empty map for null input', () => {
    expect(parseExtraFields(null).size).toBe(0);
  });

  it('returns empty map for undefined input', () => {
    expect(parseExtraFields(undefined).size).toBe(0);
  });

  it('returns empty map for empty string', () => {
    expect(parseExtraFields('').size).toBe(0);
  });

  it('returns empty map for whitespace-only', () => {
    expect(parseExtraFields('   \n\t\n').size).toBe(0);
  });
});

// ─── Type-token mapping ─────────────────────────────────────────────────────

describe('parseExtraFields — type-token mapping', () => {
  it('TEXT → FREEFORMTEXT', () => {
    const m = parseExtraFields('Approval Tracker: Subject: TEXT');
    const fields = m.get('Approval Tracker')!;
    expect(fields[0].fieldtype).toBe('FREEFORMTEXT');
    expect(fields[0].selectrecordtype).toBeUndefined();
  });

  it('TEXTAREA → TEXTAREA', () => {
    const m = parseExtraFields('Approval Tracker: Notes: TEXTAREA');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('TEXTAREA');
  });

  it('CHECKBOX → CHECKBOX', () => {
    const m = parseExtraFields('Approval Tracker: Auto-Approve Flag: CHECKBOX');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('CHECKBOX');
  });

  it('DATE → DATE', () => {
    const m = parseExtraFields('Approval Tracker: Due Date: DATE');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('DATE');
  });

  it('CURRENCY → CURRENCY', () => {
    const m = parseExtraFields('Approval Tracker: Amount: CURRENCY');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('CURRENCY');
  });

  it('NUMBER → FLOAT (NetSuite SDF enum)', () => {
    const m = parseExtraFields('Approval Tracker: Count: NUMBER');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('FLOAT');
  });

  it('SELECT → SELECT (no selectrecordtype — companion list emitted by generator)', () => {
    const m = parseExtraFields('Approval Tracker: Tier: SELECT');
    const f = m.get('Approval Tracker')![0];
    expect(f.fieldtype).toBe('SELECT');
    expect(f.selectrecordtype).toBeUndefined();
  });

  it('EMPLOYEE → SELECT with selectrecordtype=-4', () => {
    const m = parseExtraFields('Approval Tracker: Approver: EMPLOYEE');
    const f = m.get('Approval Tracker')![0];
    expect(f.fieldtype).toBe('SELECT');
    expect(f.selectrecordtype).toBe('-4');
  });

  it('TRANSACTION → SELECT with selectrecordtype=-30', () => {
    const m = parseExtraFields('Approval Tracker: Reference: TRANSACTION');
    expect(m.get('Approval Tracker')![0].selectrecordtype).toBe('-30');
  });

  it('SUBSIDIARY → SELECT with selectrecordtype=-117', () => {
    const m = parseExtraFields('Approval Tracker: Source: SUBSIDIARY');
    expect(m.get('Approval Tracker')![0].selectrecordtype).toBe('-117');
  });

  it('type token is case-insensitive', () => {
    const m = parseExtraFields('Approval Tracker: Tier: select');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('SELECT');
  });
});

// ─── Multi-line + multi-record ─────────────────────────────────────────────

describe('parseExtraFields — multi-line + multi-record', () => {
  it('groups multiple lines per record', () => {
    const m = parseExtraFields(
      'Approval Tracker: Tier: SELECT\n' +
      'Approval Tracker: Approver: EMPLOYEE\n' +
      'Approval Tracker: Amount: CURRENCY',
    );
    expect(m.get('Approval Tracker')).toHaveLength(3);
  });

  it('preserves wizard line order within a record', () => {
    const m = parseExtraFields(
      'Approval Tracker: Tier: SELECT\n' +
      'Approval Tracker: Approver: EMPLOYEE\n' +
      'Approval Tracker: Amount: CURRENCY',
    );
    expect(m.get('Approval Tracker')!.map((f) => f.label)).toEqual(['Tier', 'Approver', 'Amount']);
  });

  it('separate records get separate entries', () => {
    const m = parseExtraFields(
      'Approval Tracker: Tier: SELECT\n' +
      'Vendor Onboarding Request: Risk Rating: SELECT\n' +
      'Project Milestone: Owner: EMPLOYEE',
    );
    expect(m.size).toBe(3);
    expect(m.get('Approval Tracker')).toHaveLength(1);
    expect(m.get('Vendor Onboarding Request')).toHaveLength(1);
    expect(m.get('Project Milestone')).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const m = parseExtraFields('Approval Tracker: Tier: SELECT\r\nApproval Tracker: Approver: EMPLOYEE');
    expect(m.get('Approval Tracker')).toHaveLength(2);
  });
});

// ─── Bad-format handling ────────────────────────────────────────────────────

describe('parseExtraFields — bad-format handling', () => {
  it('skips lines without two colons', () => {
    const m = parseExtraFields(
      'Approval Tracker: Tier: SELECT\n' +
      'this is not a valid line\n' +
      'Vendor: Risk: SELECT',
    );
    expect(m.size).toBe(2);
    expect(m.get('Approval Tracker')).toHaveLength(1);
    expect(m.get('Vendor')).toHaveLength(1);
  });

  it('skips lines with unknown type tokens', () => {
    const m = parseExtraFields('Approval Tracker: Tier: GIBBERISH');
    expect(m.size).toBe(0);
  });

  it('skips lines with empty record name or label', () => {
    const m = parseExtraFields(
      ': Tier: SELECT\n' +
      'Approval Tracker: : SELECT\n' +
      'Approval Tracker: Tier: SELECT',
    );
    expect(m.size).toBe(1);
    expect(m.get('Approval Tracker')).toHaveLength(1);
  });

  it('tolerates extra whitespace around delimiters', () => {
    const m = parseExtraFields('   Approval Tracker  :  Tier  :  SELECT  ');
    expect(m.get('Approval Tracker')![0].label).toBe('Tier');
    expect(m.get('Approval Tracker')![0].fieldtype).toBe('SELECT');
  });
});
