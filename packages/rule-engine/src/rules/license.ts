import type { RuleInput, ConflictResult } from '../types.js';

/**
 * License-level compatibility rules.
 *
 * These rules validate that the selected modules are legal for the chosen
 * edition and that inter-module dependencies are satisfied.  They run
 * independently of any individual question answers so that mis-configured
 * license profiles are surfaced the moment the user saves the License Profile
 * screen — before they reach any flow-specific question.
 */
export function evaluateLicense(input: RuleInput): ConflictResult[] {
  const { license } = input;
  const { edition, modules } = license;
  const has = (mod: string) => modules.includes(mod);
  const results: ConflictResult[] = [];

  // ── Edition-Module Compatibility ────────────────────────────────────────────
  // NetSuite Starter is a single-entity, limited-user SKU.  The following
  // modules require at minimum Mid-Market and are not sold with Starter.

  const STARTER_BLOCKED: Array<{ value: string; label: string }> = [
    { value: 'ONEWORLD',            label: 'OneWorld' },
    { value: 'MANUFACTURING',       label: 'Manufacturing' },
    { value: 'WMS',                 label: 'Warehouse Management (WMS)' },
    { value: 'WORK_ORDERS',         label: 'Work Orders' },
    { value: 'WIP_ROUTINGS',        label: 'WIP/Routings' },
    { value: 'ADVANCED_INVENTORY',  label: 'Advanced Inventory' },
    { value: 'DEMAND_PLANNING',     label: 'Demand Planning' },
    { value: 'ADVANCED_PROCUREMENT',label: 'Advanced Procurement' },
    { value: 'PSA',                 label: 'Professional Services Automation (PSA)' },
  ];

  if (edition === 'STARTER') {
    const blocked = STARTER_BLOCKED.filter((m) => has(m.value));

    if (blocked.length > 0) {
      const labelList = blocked.map((m) => `"${m.label}"`).join(', ');
      results.push({
        id: 'LIC-001',
        severity: 'BLOCK',
        type: 'LICENSE_GAP',
        questionIds: [],
        message: `The following module${blocked.length > 1 ? 's are' : ' is'} not available on the Starter edition: ${labelList}.`,
        resolution: 'Upgrade the license to Mid-Market or OneWorld, or remove the incompatible modules from the license profile.',
      });
    }

    // SuiteCommerce is technically purchasable on Starter but is severely
    // limited (no Advanced/Advanced Plus features, no SuiteCommerce Advanced).
    if (has('ECOMMERCE')) {
      results.push({
        id: 'LIC-002',
        severity: 'WARN',
        type: 'LICENSE_GAP',
        questionIds: [],
        message: 'SuiteCommerce is available on the Starter edition but is limited to basic storefront functionality. SuiteCommerce Advanced (SCA) and checkout customisations require Mid-Market or OneWorld.',
        resolution: 'Confirm the required e-commerce feature set with the client. Upgrade to Mid-Market if SuiteCommerce Advanced features are needed.',
      });
    }
  }

  // ── OneWorld Edition / Module Consistency ───────────────────────────────────

  // OneWorld module selected but edition is not OneWorld — the module cannot
  // function without the underlying multi-entity infrastructure.
  if (has('ONEWORLD') && edition !== 'ONEWORLD') {
    results.push({
      id: 'LIC-003',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The OneWorld module requires the OneWorld edition. Multi-entity and multi-subsidiary features are not available on Starter or Mid-Market editions.',
      resolution: 'Upgrade the license edition to OneWorld, or remove the OneWorld module if multi-entity is not required.',
    });
  }

  // OneWorld edition selected but the OneWorld module was not added — the user
  // would be paying for multi-entity capability they cannot actually use.
  if (edition === 'ONEWORLD' && !has('ONEWORLD')) {
    results.push({
      id: 'LIC-004',
      severity: 'WARN',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The OneWorld edition is selected but the OneWorld module is not included in the license profile. Multi-entity and multi-subsidiary features will not be activated.',
      resolution: 'Add the OneWorld module to the license profile to enable multi-entity configuration.',
    });
  }

  // ── Module-to-Module Dependencies ──────────────────────────────────────────

  // WMS requires Advanced Inventory — bin management and multi-location
  // transfer orders depend on the Advanced Inventory infrastructure.
  if (has('WMS') && !has('ADVANCED_INVENTORY')) {
    results.push({
      id: 'LIC-005',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The Warehouse Management (WMS) module requires Advanced Inventory. Bin management, multi-location transfers, and barcode-driven workflows are all built on top of Advanced Inventory.',
      resolution: 'Add the Advanced Inventory module to the license profile alongside WMS.',
    });
  }

  // Demand Planning requires Advanced Inventory — the replenishment engine
  // reads bin/location stock levels that are only available with Advanced Inventory.
  if (has('DEMAND_PLANNING') && !has('ADVANCED_INVENTORY')) {
    results.push({
      id: 'LIC-006',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The Demand Planning module requires Advanced Inventory. Forecast-driven replenishment and reorder calculations depend on the multi-location inventory data provided by Advanced Inventory.',
      resolution: 'Add the Advanced Inventory module to the license profile alongside Demand Planning.',
    });
  }

  // WIP/Routings requires Work Orders — routing steps are defined on Work
  // Order records; the module cannot function without Work Orders being active.
  if (has('WIP_ROUTINGS') && !has('WORK_ORDERS')) {
    results.push({
      id: 'LIC-007',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The WIP/Routings module requires Work Orders. Routing steps, operation sequences, and labour capture are all attached to Work Order records.',
      resolution: 'Add the Work Orders module to the license profile alongside WIP/Routings.',
    });
  }

  // Manufacturing requires Work Orders — the Manufacturing module builds on
  // top of Work Order functionality for BOM-driven production.
  if (has('MANUFACTURING') && !has('WORK_ORDERS')) {
    results.push({
      id: 'LIC-008',
      severity: 'WARN',
      type: 'LICENSE_GAP',
      questionIds: [],
      message: 'The Manufacturing module typically requires Work Orders for BOM-driven production builds. Without Work Orders, production can only use Assembly Builds, which lack routing and labour capture.',
      resolution: 'Add the Work Orders module to enable full manufacturing functionality, or confirm that Assembly Builds alone are sufficient for this client.',
    });
  }

  return results;
}
