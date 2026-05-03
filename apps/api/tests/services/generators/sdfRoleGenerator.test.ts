import { describe, it, expect } from 'vitest';
import {
  generateRoles,
  classifyRole,
  applyOverlay,
} from '../../../src/services/generators/sdfRoleGenerator.js';

/**
 * Pack C — Custom Role generator tests.
 *
 * Pack contract:
 *   1. Parse "<role_name>: <customization notes>" lines.
 *   2. Slugify into customrole_nsix_<slug>.
 *   3. Classify role family by keyword (specificity-first; AP/AR
 *      before generic accounting; CFO before sales; "A/P Clerk"
 *      normalizes to "AP Clerk" for matching).
 *   4. Apply customization overlay (remove approve / read-only /
 *      subsidiary-scoped / group-wide).
 *   5. Emit role XML with permissions + restrictionbysubsidiary.
 */

const ATLAS_ROLES =
  'A/P Clerk: remove "Approve Bills" permission (split into separate Approver role)\n' +
  'A/R Clerk: scope to home subsidiary\n' +
  'Sales Manager: subsidiary-scoped + region-scoped\n' +
  'Inventory Manager: cap inventory adjustment to $5k per single adjustment\n' +
  'Custom Group Auditor role: read-only across all 4 subsidiaries\n' +
  'Custom Tax Specialist role: SuiteTax + ZATCA SuiteApp + Tax Reporting Framework only';

// ─── Empty / smoke ──────────────────────────────────────────────────────────

describe('generateRoles — empty / smoke', () => {
  it('emits nothing when input is empty', () => {
    expect(generateRoles({ standardRoleCustomization: '' }).files).toEqual({});
    expect(generateRoles({ standardRoleCustomization: undefined }).files).toEqual({});
    expect(generateRoles({ standardRoleCustomization: '   \n\t' }).files).toEqual({});
  });

  it('skips bad-format lines (no colon)', () => {
    const out = generateRoles({
      standardRoleCustomization: 'AP Clerk: notes\nrandom gibberish without colon\nAR Clerk: more notes',
    });
    expect(out.emitted).toHaveLength(2);
  });
});

// ─── classifyRole — keyword classifier ──────────────────────────────────────

describe('classifyRole — keyword classifier', () => {
  it('AP Clerk → ACCOUNTING_CENTER + AP starter set', () => {
    const r = classifyRole('AP Clerk');
    expect(r.center).toBe('ACCOUNTING_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_VENDORBILL');
    expect(r.defaultRestriction).toBe('OWN');
  });

  it('A/P Clerk normalizes to AP (slash-stripped) → AP family', () => {
    const r = classifyRole('A/P Clerk');
    expect(r.center).toBe('ACCOUNTING_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_VENDORBILL');
  });

  it('A/R Clerk normalizes to AR → AR family', () => {
    const r = classifyRole('A/R Clerk');
    expect(r.center).toBe('ACCOUNTING_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_INVOICE');
    expect(r.permissions.map((p) => p.permkey)).toContain('REPO_AR');
  });

  it('Sales Manager → SALES_CENTER + Sales starter', () => {
    const r = classifyRole('Sales Manager');
    expect(r.center).toBe('SALES_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_SALESORD');
  });

  it('CFO → ACCOUNTING_CENTER + finance-broad starter (group-wide default)', () => {
    const r = classifyRole('CFO');
    expect(r.center).toBe('ACCOUNTING_CENTER');
    expect(r.permissions.length).toBeGreaterThanOrEqual(10);
    expect(r.defaultRestriction).toBe('NONE');
  });

  it('Finance Manager matches CFO bucket (not sales) — specificity-first', () => {
    const r = classifyRole('Finance Manager');
    expect(r.center).toBe('ACCOUNTING_CENTER');
    expect(r.defaultRestriction).toBe('NONE');
  });

  it('Inventory Manager → INVENTORY_CENTER + Inventory starter', () => {
    const r = classifyRole('Inventory Manager');
    expect(r.center).toBe('INVENTORY_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_INVADJST');
  });

  it('Procurement Lead → PURCHASE_CENTER', () => {
    expect(classifyRole('Procurement Lead').center).toBe('PURCHASE_CENTER');
    expect(classifyRole('Senior Buyer').center).toBe('ACCOUNTING_CENTER'); // buyer in AP family per spec
  });

  it('Manufacturing Manager → MANUFACTURING_CENTER + BOM/Work Order perms', () => {
    const r = classifyRole('Manufacturing Manager');
    expect(r.center).toBe('MANUFACTURING_CENTER');
    expect(r.permissions.map((p) => p.permkey)).toContain('TRAN_WORKORDER');
  });

  it('Quality Auditor → CLASSIC + view-only starter', () => {
    const r = classifyRole('Quality Auditor');
    expect(r.center).toBe('CLASSIC');
    for (const p of r.permissions) {
      expect(p.permlevel).toBe('VIEW');
    }
  });

  it('Clinical Trial Manager → CLASSIC + clinical starter', () => {
    const r = classifyRole('Clinical Trial Manager');
    expect(r.center).toBe('CLASSIC');
    expect(r.permissions.map((p) => p.permkey)).toContain('LIST_CUSTOMRECORDENTRY');
  });

  it('IT Admin → CLASSIC + SuiteAdmin starter (no transactional FULL)', () => {
    const r = classifyRole('IT Admin');
    expect(r.center).toBe('CLASSIC');
    expect(r.permissions.map((p) => p.permkey)).toContain('SETUP_SUITESCRIPT');
    expect(r.defaultRestriction).toBe('NONE');
  });

  it('Unknown role → CLASSIC + default minimal starter', () => {
    const r = classifyRole('Project Coordinator');
    expect(r.center).toBe('CLASSIC');
    expect(r.permissions.length).toBeGreaterThan(0);
    for (const p of r.permissions) {
      expect(p.permlevel).toBe('VIEW');
    }
  });
});

// ─── applyOverlay — customization parser ───────────────────────────────────

describe('applyOverlay — customization-notes parser', () => {
  it('"remove Approve Bills permission" downgrades VENDORBILL FULL → CREATE', () => {
    const starter = classifyRole('AP Clerk');
    const result = applyOverlay(starter, 'remove "Approve Bills" permission');
    const vendorbill = result.permissions.find((p) => p.permkey === 'TRAN_VENDORBILL')!;
    expect(vendorbill.permlevel).toBe('CREATE');
    expect(result.appliedOverlays.length).toBeGreaterThan(0);
  });

  it('"read-only" downgrades all permissions to VIEW', () => {
    const starter = classifyRole('AP Clerk');
    const result = applyOverlay(starter, 'read-only across all 4 subsidiaries');
    for (const p of result.permissions) {
      expect(p.permlevel).toBe('VIEW');
    }
  });

  it('"subsidiary-scoped" sets restrictionbysubsidiary=OWN', () => {
    const starter = classifyRole('Sales Manager');
    const result = applyOverlay(starter, 'subsidiary-scoped + region-scoped');
    expect(result.restriction).toBe('OWN');
  });

  it('"group-wide" overrides default restriction to NONE', () => {
    const starter = classifyRole('AP Clerk');
    const result = applyOverlay(starter, 'group-wide read');
    expect(result.restriction).toBe('NONE');
  });

  it('"cross-subsidiary" also sets restriction=NONE', () => {
    const starter = classifyRole('Quality Auditor');
    const result = applyOverlay(starter, 'cross-subsidiary read access');
    expect(result.restriction).toBe('NONE');
  });

  it('multiple overlays compose (read-only + group-wide)', () => {
    const starter = classifyRole('AP Clerk');
    const result = applyOverlay(starter, 'read-only + group-wide audit access');
    expect(result.restriction).toBe('NONE');
    for (const p of result.permissions) {
      expect(p.permlevel).toBe('VIEW');
    }
    expect(result.appliedOverlays.length).toBe(2);
  });

  it('empty notes: defaults from classifier preserved', () => {
    const starter = classifyRole('AP Clerk');
    const result = applyOverlay(starter, '');
    expect(result.permissions).toEqual(starter.permissions);
    expect(result.restriction).toBe(starter.defaultRestriction);
    expect(result.appliedOverlays).toEqual([]);
  });
});

// ─── End-to-end: Atlas seed ────────────────────────────────────────────────

describe('generateRoles — Atlas-shaped seed', () => {
  it('emits 6 roles for the Atlas customization input', () => {
    const out = generateRoles({ standardRoleCustomization: ATLAS_ROLES });
    expect(out.emitted).toHaveLength(6);
  });

  it('every emitted XML has the role root + scriptid + ≥3 permissions', () => {
    const out = generateRoles({ standardRoleCustomization: ATLAS_ROLES });
    for (const e of out.emitted) {
      const xml = out.files[e.filename];
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(`<role scriptid="${e.scriptid}">`);
      const perms = xml.match(/<permission>/g) ?? [];
      expect(perms.length, `role ${e.roleName} has only ${perms.length} permissions`).toBeGreaterThanOrEqual(3);
    }
  });

  it('A/P Clerk applies the remove-Approve overlay (VENDORBILL → CREATE)', () => {
    const out = generateRoles({ standardRoleCustomization: ATLAS_ROLES });
    const apClerk = out.emitted.find((e) => e.roleName === 'A/P Clerk')!;
    const xml = out.files[apClerk.filename];
    // The TRAN_VENDORBILL line should be CREATE, not FULL
    expect(xml).toMatch(
      /<permkey>TRAN_VENDORBILL<\/permkey>\s*<permlevel>CREATE<\/permlevel>/,
    );
  });

  it('Custom Group Auditor (read-only) emits all VIEW permissions', () => {
    const out = generateRoles({ standardRoleCustomization: ATLAS_ROLES });
    const auditor = out.emitted.find((e) => /Auditor/i.test(e.roleName))!;
    for (const p of auditor.permissions) {
      expect(p.permlevel).toBe('VIEW');
    }
    expect(auditor.restrictionbysubsidiary).toBe('NONE');
  });

  it('Sales Manager has subsidiary-scoped restriction from overlay', () => {
    const out = generateRoles({ standardRoleCustomization: ATLAS_ROLES });
    const sales = out.emitted.find((e) => e.roleName === 'Sales Manager')!;
    expect(sales.restrictionbysubsidiary).toBe('OWN');
  });
});

// ─── XML shape ─────────────────────────────────────────────────────────────

describe('generateRoles — XML shape contract', () => {
  it('declares centertype + employeerestriction + restrictionbysubsidiary', () => {
    const out = generateRoles({ standardRoleCustomization: 'AP Clerk: notes' });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<centertype>ACCOUNTING_CENTER</centertype>');
    expect(xml).toContain('<employeerestriction>NONE</employeerestriction>');
    expect(xml).toContain('<restrictionbysubsidiary>OWN</restrictionbysubsidiary>');
  });

  it('XML-escapes special chars in role name', () => {
    const out = generateRoles({
      standardRoleCustomization: 'Tom & Jerry "Quoted": notes',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('<name>Tom &amp; Jerry &quot;Quoted&quot;</name>');
  });

  it('comment header preserves the original wizard line', () => {
    const out = generateRoles({
      standardRoleCustomization: 'AP Clerk: remove "Approve Bills" permission',
    });
    const xml = Object.values(out.files)[0];
    expect(xml).toContain('AP Clerk: remove');
  });
});
