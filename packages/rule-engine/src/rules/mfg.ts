import type { RuleInput, ConflictResult } from '../types.js';

export function evaluateMFG(input: RuleInput): ConflictResult[] {
  const { answers, license } = input;
  const results: ConflictResult[] = [];

  const get = (key: string) => answers[key];

  // ── productionFlow ──────────────────────────────────────────────────────────

  // MFG-001 (BLOCK): WIP & Routings without WORK_ORDERS and WIP_ROUTINGS modules
  if (get('mfg.productionFlow.type') === 'WIP_ROUTINGS') {
    const missingWorkOrders = !license.modules.includes('WORK_ORDERS');
    const missingWipRoutings = !license.modules.includes('WIP_ROUTINGS');
    if (missingWorkOrders || missingWipRoutings) {
      const missingList = [
        missingWorkOrders ? '"Work Orders"' : null,
        missingWipRoutings ? '"WIP/Routings"' : null,
      ].filter(Boolean).join(' and ');
      results.push({
        id: 'MFG-001',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.productionFlow.type'],
        message: `WIP & Routings requires the ${missingList} module${missingList.includes('and') ? 's' : ''}, which ${missingList.includes('and') ? 'are' : 'is'} not included in the current license.`,
        resolution: 'Add the Work Orders and WIP/Routings modules to the license profile, or use Simple Assembly.',
      });
    }
  }

  // MFG-002 (WARN): Labor tracking without WIP & Routings
  if (get('mfg.productionFlow.trackLabor') === true) {
    if (get('mfg.productionFlow.type') !== 'WIP_ROUTINGS') {
       results.push({
        id: 'MFG-002',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.productionFlow.trackLabor', 'mfg.productionFlow.type'],
        message: 'Labor/machine cost tracking is enabled but the production flow is not set to WIP & Routings.',
        resolution: 'Switch production flow to WIP & Routings, or disable labor tracking.',
      });
    }
  }

  // MFG-003 (BLOCK): Demand Planning without module
  if (get('mfg.demand.useDemandPlanning') === true) {
    if (!license.modules.includes('DEMAND_PLANNING')) {
      results.push({
        id: 'MFG-003',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.demand.useDemandPlanning'],
        message: 'Demand Planning requires the "Demand Planning" module, which is missing from the license profile.',
        resolution: 'Add the Demand Planning module, or plan to create work orders manually.',
      });
    }
  }

  // MFG-004 (WARN): Outsourced manufacturing on Starter edition
  if (get('mfg.outsourced.useOutsourced') === true) {
    if (license.edition === 'STARTER') {
      results.push({
        id: 'MFG-004',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.outsourced.useOutsourced'],
        message: 'Outsourced Manufacturing is typically not supported on the NetSuite Starter edition.',
        resolution: 'Upgrade the license to Mid-Market or Enterprise, or manage outsourced production as standard POs and inventory transfers.',
      });
    }
  }

  // ── workOrders ──────────────────────────────────────────────────────────────

  // MFG-005 (BLOCK): Work Orders enabled without WORK_ORDERS module
  if (get('mfg.workOrders.useWorkOrders') === true) {
    if (!license.modules.includes('WORK_ORDERS')) {
      results.push({
        id: 'MFG-005',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.workOrders.useWorkOrders'],
        message: 'Work Orders require the "Work Orders" module, which is not included in the current license.',
        resolution: 'Add the Work Orders module to the license profile, or plan to track production using Assembly Builds only.',
      });
    }
  }

  // MFG-006 (WARN): Auto-create WOs from SOs without Work Orders enabled
  if (get('mfg.workOrders.autoCreateWO') === true) {
    if (get('mfg.workOrders.useWorkOrders') !== true) {
      results.push({
        id: 'MFG-006',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.workOrders.autoCreateWO', 'mfg.workOrders.useWorkOrders'],
        message: 'Automatic Work Order creation from Sales Orders is configured but Work Orders are not enabled.',
        resolution: 'Enable Work Orders first, then configure the auto-creation workflow.',
      });
    }
  }

  // MFG-007 (WARN): Backflushing enabled without WIP/Routings — may cause inaccurate costing
  if (get('mfg.workOrders.backflushComponents') === true) {
    if (get('mfg.productionFlow.type') !== 'WIP_ROUTINGS') {
      results.push({
        id: 'MFG-007',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.workOrders.backflushComponents', 'mfg.productionFlow.type'],
        message: 'Backflushing components is enabled but the production flow is not set to WIP & Routings. Backflushing without routings relies entirely on accurate BOMs.',
        resolution: 'Ensure BOMs are 100% accurate, or switch to WIP & Routings for more controlled component consumption.',
      });
    }
  }

  // ── inventory ───────────────────────────────────────────────────────────────

  // MFG-008 (BLOCK): Multi-location inventory without ADVANCED_INVENTORY module
  if (get('mfg.inventory.multiLocationInventory') === true) {
    if (!license.modules.includes('ADVANCED_INVENTORY')) {
      results.push({
        id: 'MFG-008',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.inventory.multiLocationInventory'],
        message: 'Multi-location inventory requires the "Advanced Inventory" module, which is not in the current license.',
        resolution: 'Add the Advanced Inventory module, or limit the implementation to a single warehouse location.',
      });
    }
  }

  // MFG-009 (WARN): Lot tracking enabled on Starter — lot-level traceability has limitations
  if (get('mfg.inventory.lotTracking') === true) {
    if (license.edition === 'STARTER') {
      results.push({
        id: 'MFG-009',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.inventory.lotTracking'],
        message: 'Full lot and batch traceability, including outbound lot selection, may be limited on the Starter edition.',
        resolution: 'Upgrade to Mid-Market or Enterprise for full lot management, or confirm the required traceability features with NetSuite support.',
      });
    }
  }

  // MFG-010 (WARN): Serial tracking without Advanced Inventory — serialized items require ADVANCED_INVENTORY for bin-level tracking
  if (get('mfg.inventory.serialTracking') === true) {
    if (!license.modules.includes('ADVANCED_INVENTORY')) {
      results.push({
        id: 'MFG-010',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.inventory.serialTracking'],
        message: 'Serial number tracking is enabled but Advanced Inventory is not licensed. Bin-level and transfer order serial tracking will not be available.',
        resolution: 'Add the Advanced Inventory module for full serialized item support.',
      });
    }
  }

  // ── costing ─────────────────────────────────────────────────────────────────

  // MFG-011 (BLOCK): Standard Cost + Variance without WIP & Routings
  if (get('mfg.costing.standardCostVariance') === true) {
    if (get('mfg.productionFlow.type') !== 'WIP_ROUTINGS') {
      results.push({
        id: 'MFG-011',
        severity: 'BLOCK',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.costing.standardCostVariance', 'mfg.productionFlow.type'],
        message: 'Standard Cost variance analysis requires WIP & Routings to capture actual labor and material costs per production job.',
        resolution: 'Switch the production flow to WIP & Routings, or disable standard cost variance tracking.',
      });
    }
  }

  // MFG-012 (WARN): LIFO costing on certain jurisdictions — advisory only
  if (get('mfg.costing.costingMethod') === 'LIFO') {
    results.push({
      id: 'MFG-012',
      severity: 'WARN',
      type: 'CONFIG_CONFLICT',
      questionIds: ['mfg.costing.costingMethod'],
      message: 'LIFO (Last In, First Out) is prohibited under IFRS and is uncommon in the GCC region. Confirm this is the correct method with the client\'s auditors.',
      resolution: 'Consider switching to Average Cost or FIFO, which are IFRS-compliant.',
    });
  }

  // MFG-013 (WARN): Overhead allocation without Standard Cost — may complicate costing calculations
  if (get('mfg.costing.overheadAllocation') === true) {
    if (get('mfg.costing.costingMethod') !== 'STANDARD_COST') {
      results.push({
        id: 'MFG-013',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.costing.overheadAllocation', 'mfg.costing.costingMethod'],
        message: 'Overhead allocation is most effective with Standard Costing. Using overhead allocation with Average Cost or FIFO can produce unexpected inventory valuations.',
        resolution: 'Switch to Standard Costing, or implement overhead as a separate cost element managed via manual journal entries.',
      });
    }
  }

  // ── quality ─────────────────────────────────────────────────────────────────

  // MFG-014 (WARN): Quality inspection enabled without Advanced Inventory (quarantine location)
  if (get('mfg.quality.qualityInspection') === true) {
    if (!license.modules.includes('ADVANCED_INVENTORY')) {
      results.push({
        id: 'MFG-014',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: ['mfg.quality.qualityInspection'],
        message: 'A Quality Inspection hold/quarantine workflow typically requires a dedicated bin or warehouse location, which needs the Advanced Inventory module.',
        resolution: 'Add the Advanced Inventory module for bin-level quarantine, or implement QA inspection as a status field on the Work Order.',
      });
    }
  }

  // MFG-015 (WARN): NCR tracking without quality inspection step enabled
  if (get('mfg.quality.ncr') === true) {
    if (get('mfg.quality.qualityInspection') !== true) {
      results.push({
        id: 'MFG-015',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['mfg.quality.ncr', 'mfg.quality.qualityInspection'],
        message: 'Non-Conformance Reports (NCRs) are enabled but the quality inspection gate is disabled. Without an inspection step, NCRs will need to be created manually rather than automatically triggered by failed inspections.',
        resolution: 'Enable the quality inspection requirement so NCRs can be triggered automatically, or confirm NCRs will be created on an ad-hoc basis.',
      });
    }
  }

  return results;
}
