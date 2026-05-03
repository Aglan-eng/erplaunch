import { describe, it, expect } from 'vitest';
import {
  generateSignOffMatrix,
  type SignOffMember,
} from '../../../src/services/generators/signOffMatrixGenerator.js';

/**
 * Pack T — Sign-off Matrix tests.
 */

const ATLAS_MEMBERS: SignOffMember[] = [
  { name: 'Helena Reyes', role: 'Project Sponsor / CFO', team: 'CLIENT' },
  { name: 'David Chen', role: 'Project Manager / VP Finance Transformation', team: 'CLIENT' },
  { name: 'Sophie Müller', role: 'Workstream Lead — EU subsidiaries', team: 'CLIENT' },
  { name: 'Hesham Aglan', role: 'Consultant Project Manager', team: 'CONSULTANT' },
  { name: 'Sarah Chen', role: 'Senior NetSuite Consultant — Financials', team: 'CONSULTANT' },
];

describe('Pack T — signOffMatrixGenerator: top-level shape', () => {
  it('emits markdown with the 3 canonical sections', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas Industries Group' });
    expect(out.markdown).toContain('# UAT Sign-off Matrix — Atlas Industries Group');
    expect(out.markdown).toContain('## 1. Per-Workstream Sign-off');
    expect(out.markdown).toContain('## 2. Per-Role Sign-off');
    expect(out.markdown).toContain('## 3. Final UAT Sign-off');
  });

  it('emits HTML companion that renders the markdown', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas Industries Group' });
    expect(out.html).toContain('<!DOCTYPE html>');
    expect(out.html).toContain('Atlas Industries Group');
    expect(out.html).toContain('UAT Sign-off Matrix');
  });

  it('platform placeholder reads as ERP when adaptorName omitted', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Platform:** ERP');
  });

  it('platform name flows into the markdown header when provided', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas', adaptorName: 'NetSuite' });
    expect(out.markdown).toContain('**Platform:** NetSuite');
  });
});

describe('Pack T — signOffMatrixGenerator: per-workstream rows', () => {
  it('counts scenarios per workstream from scenariosPerWorkstream', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      scenariosPerWorkstream:
        'P2P: PO creation: desc\nP2P: Bill match: desc\nO2C: SO creation: desc\nR2R: Period close: desc',
    });
    expect(out.markdown).toContain('| P2P | 2 scenarios |');
    expect(out.markdown).toContain('| O2C | 1 scenario |');
    expect(out.markdown).toContain('| R2R | 1 scenario |');
  });

  it('orders workstream rows in canonical order (R2R / P2P / O2C / MFG / RTN / ...)', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      scenariosPerWorkstream:
        'O2C: SO: desc\nR2R: Close: desc\nMFG: WO: desc\nP2P: PO: desc',
    });
    const md = out.markdown;
    const r2rIdx = md.indexOf('| R2R |');
    const p2pIdx = md.indexOf('| P2P |');
    const o2cIdx = md.indexOf('| O2C |');
    const mfgIdx = md.indexOf('| MFG |');
    expect(r2rIdx).toBeGreaterThan(0);
    expect(r2rIdx).toBeLessThan(p2pIdx);
    expect(p2pIdx).toBeLessThan(o2cIdx);
    expect(o2cIdx).toBeLessThan(mfgIdx);
  });

  it('shows placeholder row when no scenarios are captured', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no scenarios captured)_');
  });

  it('client sponsor populates the Approver (Client) column when CFO present', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      scenariosPerWorkstream: 'P2P: PO: desc',
      members: ATLAS_MEMBERS,
    });
    expect(out.markdown).toContain('Helena Reyes');
  });

  it('consultant PM populates the Approver (Consultant) column', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      scenariosPerWorkstream: 'P2P: PO: desc',
      members: ATLAS_MEMBERS,
    });
    expect(out.markdown).toContain('Hesham Aglan');
  });
});

describe('Pack T — signOffMatrixGenerator: per-role rows', () => {
  it('captures roles from testRoles primary source', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      testRoles: 'AP Clerk: Test all P2P scenarios\nCFO: Sign off on R2R',
    });
    expect(out.markdown).toContain('| AP Clerk |');
    expect(out.markdown).toContain('| CFO |');
  });

  it('supplements roles from standardRoleCustomization (Pack C answer)', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      testRoles: 'AP Clerk: Test all P2P',
      standardRoleCustomization:
        'A/R Clerk: add "Manage Customer Refunds" permission\nSales Manager: add per-subsidiary scoping',
    });
    expect(out.markdown).toContain('| AP Clerk |');
    expect(out.markdown).toContain('| A/R Clerk |');
    expect(out.markdown).toContain('| Sales Manager |');
  });

  it('dedups roles between testRoles and standardRoleCustomization (case-insensitive)', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      testRoles: 'AP Clerk: Test all P2P',
      standardRoleCustomization: 'ap clerk: extra perms',
    });
    const occurrences = (out.markdown.match(/\| AP Clerk \|/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('handles quoted permission names in standardRoleCustomization without breaking', () => {
    // Audit fix: quote-strip pre-pass borrowed from Pack C role generator.
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      standardRoleCustomization: 'A/P Clerk: remove "Approve Bills" permission',
    });
    expect(out.markdown).toContain('| A/P Clerk |');
  });

  it('shows placeholder row when neither role source has content', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('_(no roles captured)_');
  });
});

describe('Pack T — signOffMatrixGenerator: final sign-off block', () => {
  it('wires sponsor + client PM + consultant PM cells from members', () => {
    const out = generateSignOffMatrix({
      clientName: 'Atlas',
      members: ATLAS_MEMBERS,
    });
    expect(out.markdown).toContain('**Project Sponsor approval:** Helena Reyes');
    expect(out.markdown).toContain('**Client PM approval:** David Chen');
    expect(out.markdown).toContain('**Consultant PM approval:** Hesham Aglan');
  });

  it('falls back to [ASSIGN] placeholder when no members provided', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('**Project Sponsor approval:** _[ASSIGN]_');
    expect(out.markdown).toContain('**Client PM approval:** _[ASSIGN]_');
    expect(out.markdown).toContain('**Consultant PM approval:** _[ASSIGN]_');
  });

  it('checklist references the other Pack T artefacts (defect log, perf plan, regression suite)', () => {
    const out = generateSignOffMatrix({ clientName: 'Atlas' });
    expect(out.markdown).toContain('Performance_Test_Plan.md');
    expect(out.markdown).toContain('Regression_Test_Suite.md');
    expect(out.markdown).toContain('Defect_Log_Template.md');
  });
});
