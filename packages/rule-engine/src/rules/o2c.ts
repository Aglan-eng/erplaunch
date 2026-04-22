import type { RuleInput, ConflictResult } from '../types.js';

export function evaluateO2C(input: RuleInput): ConflictResult[] {
  const { answers, license } = input;
  const results: ConflictResult[] = [];

  const get = (key: string) => answers[key];

  // O2C-001 (BLOCK): Credit limits enabled but Starter edition
  if (get('o2c.customers.creditLimits') === true && license.edition === 'STARTER') {
    results.push({
      id: 'O2C-001',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['o2c.customers.creditLimits'],
      message: 'Credit limit enforcement requires at least the Mid-Market edition. It is not available on Starter.',
      resolution: 'Upgrade the license edition, or disable credit limit enforcement.',
    });
  }

  // O2C-002 (WARN): Sales order approval enabled but no thresholds defined
  if (get('o2c.salesOrders.soApprovalRequired') === true) {
    const thresholds = get('o2c.salesOrders.soApprovalThresholds');
    if (!thresholds || (Array.isArray(thresholds) && thresholds.length === 0)) {
      results.push({
        id: 'O2C-002',
        severity: 'WARN',
        type: 'CONFIG_CONFLICT',
        questionIds: ['o2c.salesOrders.soApprovalRequired'],
        message: 'Sales order approval is required but no approval thresholds have been defined.',
        resolution: 'Add at least one approval threshold in the Sales Orders section to define who approves at what amount.',
      });
    }
  }

  // O2C-003 (BLOCK): Foreign currency pricing but Starter edition
  if (get('o2c.pricing.foreignCurrencyPricing') === true && license.edition === 'STARTER') {
    results.push({
      id: 'O2C-003',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['o2c.pricing.foreignCurrencyPricing'],
      message: 'Multi-currency pricing requires at least the Mid-Market edition. It is not available on Starter.',
      resolution: 'Upgrade the license edition, or confirm that all prices will be maintained in the base currency only.',
    });
  }

  // O2C-004 (BLOCK): Revenue recognition enabled but Starter edition
  if (get('o2c.invoicing.revenueRecognition') === true && license.edition === 'STARTER') {
    results.push({
      id: 'O2C-004',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['o2c.invoicing.revenueRecognition'],
      message: 'Revenue recognition (ASC 606 / IFRS 15) requires at least the Mid-Market edition. It is not supported on Starter.',
      resolution: 'Upgrade the license edition, or disable the revenue recognition module.',
    });
  }

  // O2C-005 (BLOCK): Multi-location fulfillment enabled but Starter edition
  if (get('o2c.fulfillment.multipleLocations') === true && license.edition === 'STARTER') {
    results.push({
      id: 'O2C-005',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: ['o2c.fulfillment.multipleLocations'],
      message: 'Multi-location fulfillment requires at least the Mid-Market edition. It is not available on Starter.',
      resolution: 'Upgrade the license edition, or confirm that all fulfillment will be managed from a single location.',
    });
  }

  // O2C-006 (WARN): Dunning letters enabled — reminder to configure schedule
  if (get('o2c.collections.dunningLetters') === true) {
    results.push({
      id: 'O2C-006',
      severity: 'WARN',
      type: 'DATA_WARNING',
      questionIds: ['o2c.collections.dunningLetters'],
      message: 'Dunning letters are enabled. A dunning schedule must be configured to define reminder intervals and escalation steps.',
      resolution: 'Configure the dunning schedule in the Collections section, specifying reminder intervals (e.g. 15, 30, 60 days overdue).',
    });
  }

  // O2C-007 (BLOCK): Quantity discounts or promotions enabled but Starter edition
  const hasAdvancedPricing =
    get('o2c.pricing.quantityDiscounts') === true ||
    get('o2c.pricing.promotionalPricing') === true;

  if (hasAdvancedPricing && license.edition === 'STARTER') {
    const affectedIds: string[] = [];
    if (get('o2c.pricing.quantityDiscounts') === true) affectedIds.push('o2c.pricing.quantityDiscounts');
    if (get('o2c.pricing.promotionalPricing') === true) affectedIds.push('o2c.pricing.promotionalPricing');

    results.push({
      id: 'O2C-007',
      severity: 'BLOCK',
      type: 'LICENSE_GAP',
      questionIds: affectedIds,
      message: 'Advanced pricing features (quantity discounts and/or promotions) require at least the Mid-Market edition. They are not available on Starter.',
      resolution: 'Upgrade the license edition, or use simple flat price levels only.',
    });
  }

  // O2C-008 (WARN): Pick-pack-ship without warehouse
  if (get('o2c.fulfillment.pickPackShip') === true &&
      get('o2c.fulfillment.usesWarehouse') !== true) {
    results.push({
      id: 'O2C-008',
      severity: 'BLOCK',
      type: 'CONFIG_CONFLICT',
      questionIds: ['o2c.fulfillment.pickPackShip', 'o2c.fulfillment.usesWarehouse'],
      message: 'Pick-pack-ship fulfillment is enabled but no warehouse has been defined. Pick-pack-ship requires warehouse operations to be active.',
      resolution: 'Enable warehouse operations in the Fulfillment section, or disable pick-pack-ship processing.',
    });
  }

  return results;
}
