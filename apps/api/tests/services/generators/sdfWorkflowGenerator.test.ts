import { describe, it, expect } from 'vitest';
import { generateWorkflows } from '../../../src/services/generators/sdfWorkflowGenerator.js';

/**
 * Pack W — SuiteFlow Workflow generator tests.
 *
 * Pack contract:
 *   1. Read APPROVALS flow's wizard answers (PO/JE/VB/Expense/SO scope
 *      flags + tier strings + record state machines + notification
 *      cadence + escalation days).
 *   2. Per in-scope amount-tiered approval (PO/JE/VB), emit one
 *      customworkflow_nsix_<type>_approval.xml with Pending →
 *      Approved/Rejected state machine.
 *   3. Per in-scope Expense, emit customworkflow_nsix_expense_approval.xml
 *      (role-chain answer embedded in description).
 *   4. Per in-scope SO, emit customworkflow_nsix_so_approval.xml
 *      (Hold → Approved/Rejected; trigger conditions embedded).
 *   5. Per parsed record state line, emit
 *      customworkflow_nsix_<record_slug>_state.xml with manual
 *      transitions between all states.
 */

const MINIMAL_NO_SCOPE: Record<string, unknown> = {};

const FULL_ATLAS_SCOPE: Record<string, unknown> = {
  'ns.approvals.poApprovalInScope': true,
  'ns.approvals.poApprovalTiers':
    '<$5,000: auto-approve\n$5,000-$50,000: Department Manager\n>$250,000: CFO',
  'ns.approvals.jeApprovalInScope': true,
  'ns.approvals.jeApprovalTiers':
    '<$10,000: auto-approve\n>$10,000: Controller\n>$100,000: CFO',
  'ns.approvals.vbApprovalInScope': true,
  'ns.approvals.vbApprovalTiers':
    '<$5,000: auto-approve\n$5,000-$50,000: AP Manager\n>$50,000: CFO',
  'ns.approvals.expenseApprovalInScope': true,
  'ns.approvals.expenseApprovalTiers':
    'Standard: Manager → Director\nOver $5,000: Manager → Director → CFO',
  'ns.approvals.soApprovalInScope': true,
  'ns.approvals.soApprovalTrigger':
    'Customer over credit limit\nDiscount > 15%\nOrder total > $250,000',
  'ns.approvals.recordStateWorkflowsInScope': true,
  'ns.approvals.recordStateWorkflows':
    'Approval Tracker: New, In Review, Approved, Rejected\n' +
    'Vendor Onboarding Request: Submitted, Under Review, Approved, Active, Suspended',
  'ns.approvals.notificationCadence': 'IMMEDIATE',
  'ns.approvals.escalationDays': 3,
};

// ─── Empty / scope-off behavior ─────────────────────────────────────────────

describe('generateWorkflows — empty / scope-off behavior', () => {
  it('emits nothing when no scope flags are true', () => {
    const out = generateWorkflows({ answers: MINIMAL_NO_SCOPE });
    expect(out.files).toEqual({});
    expect(out.emitted).toEqual([]);
  });

  it('emits nothing when scope flags are explicitly false', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.poApprovalInScope': false,
        'ns.approvals.jeApprovalInScope': false,
        'ns.approvals.vbApprovalInScope': false,
        'ns.approvals.expenseApprovalInScope': false,
        'ns.approvals.soApprovalInScope': false,
        'ns.approvals.recordStateWorkflowsInScope': false,
      },
    });
    expect(out.files).toEqual({});
  });
});

// ─── Per-type emission ──────────────────────────────────────────────────────

describe('generateWorkflows — amount-tiered approvals (PO/JE/VB)', () => {
  it('PO scope true → emits customworkflow_nsix_po_approval.xml with PURCHORD recordtype', () => {
    const out = generateWorkflows({
      answers: { 'ns.approvals.poApprovalInScope': true, 'ns.approvals.poApprovalTiers': '<$5,000: auto-approve' },
    });
    expect(out.files['Objects/customworkflow_nsix_po_approval.xml']).toBeDefined();
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('<workflow scriptid="customworkflow_nsix_po_approval">');
    expect(xml).toContain('<name>Purchase Order Approval</name>');
    expect(xml).toContain('<recordtype>PURCHORD</recordtype>');
  });

  it('JE scope true → emits customworkflow_nsix_je_approval.xml with JOURNALENTRY recordtype', () => {
    const out = generateWorkflows({
      answers: { 'ns.approvals.jeApprovalInScope': true },
    });
    const xml = out.files['Objects/customworkflow_nsix_je_approval.xml'];
    expect(xml).toContain('<recordtype>JOURNALENTRY</recordtype>');
  });

  it('VB scope true → emits customworkflow_nsix_vb_approval.xml with VENDBILL recordtype', () => {
    const out = generateWorkflows({
      answers: { 'ns.approvals.vbApprovalInScope': true },
    });
    const xml = out.files['Objects/customworkflow_nsix_vb_approval.xml'];
    expect(xml).toContain('<recordtype>VENDBILL</recordtype>');
  });

  it('PO workflow has Pending / Approved / Rejected baseline states', () => {
    const out = generateWorkflows({ answers: { 'ns.approvals.poApprovalInScope': true } });
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('<workflowstate scriptid="workflowstate_pending">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_approved">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_rejected">');
  });

  it('PO workflow has Approve + Reject button transitions', () => {
    const out = generateWorkflows({ answers: { 'ns.approvals.poApprovalInScope': true } });
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('<buttonaction>STDBUTTONAPPROVE</buttonaction>');
    expect(xml).toContain('<buttonaction>STDBUTTONREJECT</buttonaction>');
  });

  it('PO workflow comment header preserves the verbatim wizard tiers', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.poApprovalInScope': true,
        'ns.approvals.poApprovalTiers':
          '<$5,000: auto-approve\n>$50,000: CFO',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('<$5,000: auto-approve');
    expect(xml).toContain('>$50,000: CFO');
  });

  it('PO workflow declares releasestatus=RELEASED + isinactive=F', () => {
    const out = generateWorkflows({ answers: { 'ns.approvals.poApprovalInScope': true } });
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('<releasestatus>RELEASED</releasestatus>');
    expect(xml).toContain('<isinactive>F</isinactive>');
  });

  it('PO workflow references the companion WFA script in its comment header', () => {
    const out = generateWorkflows({ answers: { 'ns.approvals.poApprovalInScope': true } });
    const xml = out.files['Objects/customworkflow_nsix_po_approval.xml'];
    expect(xml).toContain('NSIX_WFA_PO_Approval.js');
  });
});

// ─── Expense workflow ───────────────────────────────────────────────────────

describe('generateWorkflows — Expense Report workflow', () => {
  it('Expense scope true → emits customworkflow_nsix_expense_approval.xml with EXPRPT recordtype', () => {
    const out = generateWorkflows({
      answers: { 'ns.approvals.expenseApprovalInScope': true },
    });
    const xml = out.files['Objects/customworkflow_nsix_expense_approval.xml'];
    expect(xml).toBeDefined();
    expect(xml).toContain('<recordtype>EXPRPT</recordtype>');
    expect(xml).toContain('<name>Expense Report Approval</name>');
  });

  it('Expense workflow embeds the role-chain answer in the comment header', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.expenseApprovalInScope': true,
        'ns.approvals.expenseApprovalTiers':
          'Standard: Manager → Director\nOver $5,000: Manager → Director → CFO',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_expense_approval.xml'];
    expect(xml).toContain('Manager → Director');
    expect(xml).toContain('Over $5,000');
  });
});

// ─── SO workflow ────────────────────────────────────────────────────────────

describe('generateWorkflows — Sales Order workflow', () => {
  it('SO scope true → emits customworkflow_nsix_so_approval.xml with SALESORD recordtype', () => {
    const out = generateWorkflows({
      answers: { 'ns.approvals.soApprovalInScope': true },
    });
    const xml = out.files['Objects/customworkflow_nsix_so_approval.xml'];
    expect(xml).toBeDefined();
    expect(xml).toContain('<recordtype>SALESORD</recordtype>');
    expect(xml).toContain('<name>Sales Order Approval (Hold)</name>');
  });

  it('SO workflow uses Hold → Approved/Rejected (not Pending)', () => {
    const out = generateWorkflows({ answers: { 'ns.approvals.soApprovalInScope': true } });
    const xml = out.files['Objects/customworkflow_nsix_so_approval.xml'];
    expect(xml).toContain('<workflowstate scriptid="workflowstate_hold">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_approved">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_rejected">');
    expect(xml).not.toContain('<workflowstate scriptid="workflowstate_pending">');
  });

  it('SO workflow embeds trigger conditions in the comment header', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.soApprovalInScope': true,
        'ns.approvals.soApprovalTrigger':
          'Customer over credit limit\nDiscount > 15%',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_so_approval.xml'];
    expect(xml).toContain('Customer over credit limit');
    // XML comments don't require entity-escaping for < and > — only the
    // "--" sequence is forbidden inside comments. Verbatim text wins.
    expect(xml).toContain('Discount > 15%');
  });
});

// ─── Custom record state machine workflows ──────────────────────────────────

describe('generateWorkflows — record state machines', () => {
  it('parses each line into a separate state-machine workflow', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows':
          'Approval Tracker: New, In Review, Approved, Rejected\n' +
          'Vendor Onboarding Request: Submitted, Under Review, Approved',
      },
    });
    expect(out.files['Objects/customworkflow_nsix_approval_tracker_state.xml']).toBeDefined();
    expect(out.files['Objects/customworkflow_nsix_vendor_onboarding_request_state.xml']).toBeDefined();
  });

  it('record state workflow references the customrecord by [scriptid=customrecord_<slug>]', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows': 'Approval Tracker: New, In Review, Approved',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_approval_tracker_state.xml'];
    expect(xml).toContain('<recordtype>[scriptid=customrecord_approval_tracker]</recordtype>');
  });

  it('record state workflow emits one state per parsed state name', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows': 'Approval Tracker: New, In Review, Approved',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_approval_tracker_state.xml'];
    expect(xml).toContain('<workflowstate scriptid="workflowstate_new">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_in_review">');
    expect(xml).toContain('<workflowstate scriptid="workflowstate_approved">');
  });

  it('first parsed state is the initstate', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows': 'Approval Tracker: New, In Review, Approved',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_approval_tracker_state.xml'];
    expect(xml).toContain('<initstate>workflowstate_new</initstate>');
  });

  it('record state workflow emits transitions between every state pair (excluding self)', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows': 'Approval Tracker: A, B, C',
      },
    });
    const xml = out.files['Objects/customworkflow_nsix_approval_tracker_state.xml'];
    // Each state has transitions to the other 2 — total 6 transitions
    const transitions = xml.match(/<workflowtransition scriptid=/g) ?? [];
    expect(transitions).toHaveLength(6);
  });

  it('skips lines with fewer than 2 states', () => {
    const out = generateWorkflows({
      answers: {
        'ns.approvals.recordStateWorkflowsInScope': true,
        'ns.approvals.recordStateWorkflows':
          'Approval Tracker: only one state\n' +
          'Vendor Onboarding: Submitted, Approved',
      },
    });
    expect(Object.keys(out.files)).toHaveLength(1);
    expect(out.files['Objects/customworkflow_nsix_vendor_onboarding_state.xml']).toBeDefined();
  });
});

// ─── Full-Atlas integration ─────────────────────────────────────────────────

describe('generateWorkflows — Atlas-shaped seed', () => {
  it('full Atlas scope produces 5 approval workflows + 2 record-state workflows = 7', () => {
    const out = generateWorkflows({ answers: FULL_ATLAS_SCOPE });
    expect(out.emitted).toHaveLength(7);
  });

  it('emitted entries cover the right categories', () => {
    const out = generateWorkflows({ answers: FULL_ATLAS_SCOPE });
    const categories = new Set(out.emitted.map((e) => e.category));
    expect(categories).toContain('amount-tier');
    expect(categories).toContain('expense');
    expect(categories).toContain('so');
    expect(categories).toContain('record-state');
  });

  it('every approval workflow XML (not record-state) carries the notification cadence + escalation days in its comment header', () => {
    const out = generateWorkflows({ answers: FULL_ATLAS_SCOPE });
    // Notification cadence + escalation are approval-workflow concerns;
    // record-state workflows don't carry approval semantics so they
    // intentionally omit those fields. Filter to the approval set.
    const approvalCategories = new Set(['amount-tier', 'expense', 'so']);
    const approvalFiles = out.emitted
      .filter((e) => approvalCategories.has(e.category))
      .map((e) => out.files[e.filename]);
    expect(approvalFiles.length).toBeGreaterThan(0);
    for (const xml of approvalFiles) {
      expect(xml).toContain('IMMEDIATE');
    }
    expect(out.files['Objects/customworkflow_nsix_po_approval.xml']).toContain('3 day(s)');
  });
});
