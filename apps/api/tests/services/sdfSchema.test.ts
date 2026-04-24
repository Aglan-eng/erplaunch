import { describe, it, expect } from 'vitest';
import { generateSDFPackage } from '../../src/services/generators/sdfGenerator.js';
import { validateSDFBundle } from '../../src/services/generators/sdfValidator.js';

/**
 * Integration gate — runs the real generator against a dense, schema-provoking
 * answer set and asserts every emitted XML file passes the structural
 * validator. This is the "no regression" backstop for Fixes #1–#6: if
 * anyone ever rewrites a mapping template and sneaks a forbidden shape
 * through, this test fails before the bundle ever reaches a customer.
 *
 * Scenarios are intentionally loud — every high-impact answer flipped on
 * so every mapping path fires, including the ones that normally sit
 * behind rare trigger combinations.
 */

describe('sdfSchema integration: generator output always validates', () => {
  it('every emitted XML in the mid-market bundle passes structural validation', () => {
    const { files } = generateSDFPackage({
      modules: ['MULTICURRENCY', 'WORK_ORDERS', 'MANUFACTURING', 'DEMAND_PLANNING', 'ADVANCED_INVENTORY'],
      answers: {
        // Flip on everything so every mapping template is exercised.
        'r2r.currencies.isMultiCurrency': true,
        'r2r.segmentation.useDepartments': true,
        'r2r.segmentation.useClasses': true,
        'r2r.segmentation.useLocations': true,
        'r2r.journalEntries.approvalRequired': true,
        'p2p.purchasing.purchaseRequisitions': true,
        'p2p.purchasing.poApprovalRequired': true,
        'p2p.purchasing.usePurchaseOrders': true,
        'p2p.receiving.threeWayMatch': true,
        'p2p.expenses.employeeExpenses': true,
        'o2c.invoicing.revenueRecognition': true,
        'o2c.collections.dunningLetters': true,
        'o2c.customers.creditLimits': true,
        'o2c.pricing.multiplePriceLevels': true,
        'mfg.productionFlow.type': 'WIP_ROUTINGS',
      },
      clientName: 'IntegrationTest',
    });

    const xmlFiles = Object.entries(files).filter(([k]) => k.endsWith('.xml'));
    expect(xmlFiles.length, 'bundle should emit some XML files to validate').toBeGreaterThan(0);

    const result = validateSDFBundle(files);
    if (!result.ok) {
      // Surface every error so a failing CI run shows the full diff at once
      // rather than drip-feeding the engineer one rule at a time.
      const report = result.errors
        .map((e) => `  ${e.file} :: ${e.rule} → ${e.detail}`)
        .join('\n');
      throw new Error(`SDF bundle failed structural validation:\n${report}`);
    }
    expect(result.ok).toBe(true);
  });

  it('empty-answers bundle still validates cleanly (degenerate case)', () => {
    // Even when no wizard triggers fire, the base manifest + deploy must
    // still be well-formed on their own.
    const { files } = generateSDFPackage({ modules: [], answers: {}, clientName: 'Empty' });
    const result = validateSDFBundle(files);
    expect(result.ok, JSON.stringify(result.errors, null, 2)).toBe(true);
  });

  it('never emits a cseg_*.xml in any scenario (Fix #5 invariant)', () => {
    const { files } = generateSDFPackage({
      modules: ['MULTICURRENCY'],
      answers: {
        'r2r.segmentation.useDepartments': true,
        'r2r.segmentation.useClasses': true,
        'r2r.segmentation.useLocations': true,
      },
      clientName: 'NoSegments',
    });
    const csegFiles = Object.keys(files).filter((k) => /\/cseg_|^cseg_/.test(k));
    expect(csegFiles).toEqual([]);
  });

  it('never emits an AccountConfiguration/features.xml (Fix #3 invariant)', () => {
    const { files } = generateSDFPackage({
      modules: ['MULTICURRENCY', 'WORK_ORDERS'],
      answers: { 'r2r.currencies.isMultiCurrency': true },
      clientName: 'NoFeaturesFile',
    });
    expect(files['AccountConfiguration/features.xml']).toBeUndefined();
    for (const k of Object.keys(files)) {
      expect(k).not.toMatch(/features\.xml$/i);
    }
  });
});
