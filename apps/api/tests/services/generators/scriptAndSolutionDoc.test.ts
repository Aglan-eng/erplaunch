import { describe, it, expect } from 'vitest';
import { generateScripts } from '../../../src/services/generators/scriptGenerator.js';
import { generateSolutionDoc } from '../../../src/services/generators/solutionDocGenerator.js';

/**
 * Phase 6 — workflow XML dropped; approval flow described in Solution Design
 * prose instead. Oracle guidance is explicit: hand-writing workflow XML
 * uses a SOAP webservices namespace that SDF rejects, plus a
 * <sendemailaction> shape Oracle warns against. Author workflows in the
 * NetSuite UI and export them via SDF — don't write them from scratch.
 */

describe('scriptGenerator: Fix #6 — no hand-written workflow XML is emitted', () => {
  it('never emits NSIX_WF_ApprovalChain.xml even when bill + PO approval triggers fire', () => {
    const files = generateScripts({
      clientName: 'Aurora Foods',
      modules: [],
      answers: {
        'p2p.bills.billApprovalRequired': true,
        'p2p.purchasing.poApprovalRequired': true,
      },
    });
    // Any .xml file in the script bundle was always the workflow file —
    // the script bundle should be pure .js going forward.
    const xmlFiles = Object.keys(files).filter((k) => /\.xml$/i.test(k));
    expect(xmlFiles, 'script generator should emit no XML files').toEqual([]);
    expect(files['NSIX_WF_ApprovalChain.xml']).toBeUndefined();
  });
});

describe('solutionDocGenerator: Fix #6 — approval workflow described in prose', () => {
  it('adds an Approval Workflows section when PO approval is required', () => {
    const doc = generateSolutionDoc({
      clientName: 'Aurora Foods',
      license: { edition: 'STARTER', modules: [] },
      answers: { 'p2p.purchasing.poApprovalRequired': true },
      conflicts: [],
    });
    // The heading surfaces the topic; the body explains why the
    // consultant must build this in the UI rather than shipping XML.
    // Heading may carry section numbering like "4.3" between ### and the title.
    expect(doc).toMatch(/##+\s+(\d+\.\d+\s+)?Approval Workflows/);
    expect(doc).toMatch(/NetSuite UI|author(ed)? in the UI/i);
    expect(doc).toMatch(/PO approval|purchase order/i);
  });

  it('adds the section when bill approval is required even if PO approval is off', () => {
    const doc = generateSolutionDoc({
      clientName: 'Aurora Foods',
      license: { edition: 'STARTER', modules: [] },
      answers: { 'p2p.bills.billApprovalRequired': true },
      conflicts: [],
    });
    // Heading may carry section numbering like "4.3" between ### and the title.
    expect(doc).toMatch(/##+\s+(\d+\.\d+\s+)?Approval Workflows/);
    expect(doc).toMatch(/bill approval|vendor bill/i);
  });

  it('omits the Approval Workflows section entirely when no approval triggers fire', () => {
    const doc = generateSolutionDoc({
      clientName: 'Aurora Foods',
      license: { edition: 'STARTER', modules: [] },
      answers: {},
      conflicts: [],
    });
    expect(doc).not.toMatch(/##+\s+(\d+\.\d+\s+)?Approval Workflows/);
  });
});
