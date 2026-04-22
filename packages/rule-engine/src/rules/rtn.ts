import type { RuleInput, ConflictResult } from '../types.js';

export function evaluateRTN(input: RuleInput): ConflictResult[] {
  const { answers, license } = input;
  const results: ConflictResult[] = [];

  const get = (key: string) => answers[key];

  // ── customerReturns ─────────────────────────────────────────────────────────

  // RTN-001 (WARN): Restocking fees without RMA flow
  if (get('rtn.processing.restockingFees') === true) {
    if (get('rtn.customerReturns.useRMA') !== true) {
      results.push({
        id: 'RTN-001',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['rtn.processing.restockingFees', 'rtn.customerReturns.useRMA'],
        message: 'Restocking fees are enabled but the formal RMA workflow is disabled. Restocking fees are difficult to manage without an RMA transaction.',
        resolution: 'Enable the RMA requirement, or confirm that fees will be added manually to Credit Memos.',
      });
    }
  }

  // RTN-002 (BLOCK): Refund before receipt on Starter Edition
  if (get('rtn.customerReturns.refundPolicy') === 'REFUND_BEFORE_RECEIPT') {
     if (license.edition === 'STARTER') {
      results.push({
        id: 'RTN-002',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['rtn.customerReturns.refundPolicy'],
        message: 'The "Refund before receipt" workflow (Advanced Returns Management) is not supported on the Starter edition.',
        resolution: 'Upgrade to Mid-Market or Enterprise, or change policy to "Refund after receipt".',
      });
    }
  }

  // RTN-003 (WARN): Auto-generate credit notes without RMA flow
  if (get('rtn.customerReturns.creditNoteAutoGenerate') === true) {
    if (get('rtn.customerReturns.useRMA') !== true) {
      results.push({
        id: 'RTN-003',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['rtn.customerReturns.creditNoteAutoGenerate', 'rtn.customerReturns.useRMA'],
        message: 'Automatic Credit Note generation is enabled but the RMA workflow is disabled. Without an RMA, the system has no event to trigger the auto-generation.',
        resolution: 'Enable the RMA requirement to activate the automatic Credit Note trigger, or generate Credit Memos manually.',
      });
    }
  }

  // RTN-004 (WARN): Return window shorter than typical carrier dispute window
  const returnWindow = get('rtn.customerReturns.returnWindow');
  if (typeof returnWindow === 'number' && returnWindow > 0 && returnWindow < 14) {
    results.push({
      id: 'RTN-004',
      severity: 'WARN',
      type: 'CONFIG_CONFLICT',
      questionIds: ['rtn.customerReturns.returnWindow'],
      message: `A ${returnWindow}-day return window is shorter than most carrier dispute windows (14 days). Customers may not receive their goods in time to initiate a return.`,
      resolution: 'Consider extending the return window to at least 14–30 days to align with standard carrier timelines.',
    });
  }

  // ── vendorReturns ───────────────────────────────────────────────────────────

  // RTN-005 (WARN): Vendor RMA process without tracking purchase receipts
  if (get('rtn.vendorReturns.useVendorRMA') === true) {
    if (license.edition === 'STARTER') {
      results.push({
        id: 'RTN-005',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['rtn.vendorReturns.useVendorRMA'],
        message: 'Formal Vendor Return Authorization workflows, including vendor debit memos and return shipment tracking, may have limited functionality on the Starter edition.',
        resolution: 'Upgrade to Mid-Market or Enterprise for full vendor returns support, or manage vendor returns manually via Purchase Orders.',
      });
    }
  }

  // RTN-006 (WARN): Vendor RMA without vendor credit memo automation
  if (get('rtn.vendorReturns.useVendorRMA') === true) {
    if (get('rtn.vendorReturns.useVendorRMA') === true && !license.modules.includes('ADVANCED_PROCUREMENT')) {
      // Only warn if it seems like credit memos may need automation
      results.push({
        id: 'RTN-006',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['rtn.vendorReturns.useVendorRMA'],
        message: 'Vendor RMA is configured. Ensure the team is trained to create Vendor Return Authorizations and apply resulting Vendor Credits against open bills.',
        resolution: 'Document the vendor return SOP: Vendor Return Authorization → Return Shipment → Vendor Credit → Apply to Bill.',
      });
    }
  }

  // ── processing ──────────────────────────────────────────────────────────────

  // RTN-007 (WARN): Inspection required but no quarantine location configured
  if (get('rtn.processing.inspectionRequired') === true) {
    if (!license.modules.includes('ADVANCED_INVENTORY')) {
      results.push({
        id: 'RTN-007',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['rtn.processing.inspectionRequired'],
        message: 'Quality inspection for returns requires a dedicated quarantine warehouse location. This is only available with the Advanced Inventory module.',
        resolution: 'Add the Advanced Inventory module, or implement inspection as a status flag on the Return Receipt transaction.',
      });
    }
  }

  // RTN-008 (WARN): High restocking fee may violate regional consumer protection laws
  const feePercentage = get('rtn.processing.feePercentage');
  if (typeof feePercentage === 'number' && feePercentage > 25) {
    results.push({
      id: 'RTN-008',
      severity: 'WARN',
      type: 'CONFIG_CONFLICT',
      questionIds: ['rtn.processing.feePercentage'],
      message: `A restocking fee of ${feePercentage}% is higher than the typical 10–20% range and may violate consumer protection regulations in certain jurisdictions.`,
      resolution: 'Review the restocking fee percentage with the client\'s legal team, especially if selling to retail consumers.',
    });
  }

  // RTN-009 (WARN): Restocking fees with replacement-only policy — contradiction
  if (get('rtn.processing.restockingFees') === true) {
    if (get('rtn.customerReturns.refundPolicy') === 'REPLACEMENT_ONLY') {
      results.push({
        id: 'RTN-009',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['rtn.processing.restockingFees', 'rtn.customerReturns.refundPolicy'],
        message: 'Restocking fees are enabled but the refund policy is "Replacement only". A restocking fee implies a financial credit is issued, which contradicts a replacement-only policy.',
        resolution: 'Disable restocking fees for replacement-only returns, or change the refund policy to "Refund after receipt".',
      });
    }
  }

  return results;
}
