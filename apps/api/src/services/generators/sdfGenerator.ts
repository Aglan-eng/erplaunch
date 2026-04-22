import { getMappingsForAnswers } from '@ofoq/shared';

export interface SDFData {
  modules: string[];
  answers: Record<string, any>;
  clientName?: string;
}

/** Helper: look up a flat dot-key answer (e.g. 'r2r.fiscalClose.autoLockAfterApproval') — fixed v2 */
function ans(answers: Record<string, any>, key: string): any {
  return answers[key];
}

/**
 * Derive the full set of NetSuite feature IDs from both the license modules
 * array AND the business profile answers.  This ensures features.xml and
 * manifest.xml accurately reflect what the engagement actually needs.
 */
function deriveFeatures(modules: string[], answers: Record<string, any>): string[] {
  const features = new Set<string>();

  // Always required
  features.add('CUSTOMRECORDS');
  features.add('SUITESCRIPT');

  // ── From license modules ────────────────────────────────────────────────
  if (modules.includes('ONEWORLD'))       features.add('SUBSIDIARIES');
  if (modules.includes('MULTICURRENCY'))  features.add('MULTICURRENCY');
  if (modules.includes('WORK_ORDERS')) {
    features.add('WORKORDERS');
    features.add('ROUTINGS');
  }
  if (modules.includes('DEMAND_PLANNING'))    features.add('DEMANDPLANNING');
  if (modules.includes('ADVANCED_INVENTORY')) features.add('ADVANCEDINVENTORY');
  if (modules.includes('ADVANCED_REVENUE'))   features.add('ADVANCEDREVENUE');

  // ── From business-profile answers ───────────────────────────────────────
  // Multi-entity → SUBSIDIARIES
  if (ans(answers, 'r2r.entities.multiEntity') === true) features.add('SUBSIDIARIES');

  // Multi-currency
  if (ans(answers, 'r2r.currencies.isMultiCurrency') === true) features.add('MULTICURRENCY');

  // Segmentation features
  if (ans(answers, 'r2r.segmentation.useDepartments') === true) features.add('DEPARTMENTS');
  if (ans(answers, 'r2r.segmentation.useClasses') === true)     features.add('CLASSES');
  if (ans(answers, 'r2r.segmentation.useLocations') === true)   features.add('LOCATIONS');

  // Purchase Orders
  if (ans(answers, 'p2p.purchasing.usePurchaseOrders') === true) features.add('PURCHASEORDERS');

  // Budget checking
  if (ans(answers, 'p2p.purchasing.budgetCheck') === true) features.add('BUDGETS');

  // Expense reports
  if (ans(answers, 'p2p.expenses.employeeExpenses') === true) features.add('EXPENSEREPORTS');

  // Sales Orders
  if (ans(answers, 'o2c.salesOrders.useSalesOrders') === true) features.add('SALESORDERS');

  // Revenue recognition
  if (ans(answers, 'o2c.invoicing.revenueRecognition') === true) features.add('ADVANCEDREVENUE');

  // Electronic invoicing
  if (ans(answers, 'o2c.invoicing.electronicInvoicing') === true) features.add('ELECTRONICINVOICING');

  // Manufacturing
  const mfgType = ans(answers, 'mfg.productionFlow.type');
  if (mfgType === 'WIP_ROUTINGS' || mfgType === 'WIP_ASSEMBLY') {
    features.add('WORKORDERS');
    features.add('ROUTINGS');
  }
  if (mfgType === 'WIP_ASSEMBLY') features.add('ASSEMBLIES');

  // Demand planning
  if (ans(answers, 'mfg.demand.useDemandPlanning') === true) features.add('DEMANDPLANNING');

  // Inventory features
  if (ans(answers, 'mfg.inventory.lotTracking') === true)    features.add('LOTTRACKING');
  if (ans(answers, 'mfg.inventory.serialTracking') === true) features.add('SERIALIZEDTRACKING');
  if (ans(answers, 'mfg.inventory.multiLocationInventory') === true) features.add('MULTILOCATIONINVENTORY');

  // RMA / Returns
  if (ans(answers, 'rtn.customerReturns.useRMA') === true) features.add('RETURNAUTHORIZATIONS');

  return Array.from(features);
}

export function generateSDFPackage(data: SDFData): Record<string, string> {
  const { modules, answers, clientName = 'NSIXClient' } = data;
  const files: Record<string, string> = {};

  const allFeatures = deriveFeatures(modules, answers);
  const alwaysRequired = new Set(['CUSTOMRECORDS', 'SUITESCRIPT']);

  // 1. Manifest XML
  let manifestXml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  manifestXml += `<manifest projecttype="ACCOUNTCUSTOMIZATION">\n`;
  manifestXml += `  <projectname>NSIX-${clientName}</projectname>\n`;
  manifestXml += `  <frameworkversion>1.0</frameworkversion>\n`;
  manifestXml += `  <dependencies>\n`;
  manifestXml += `    <features>\n`;

  for (const f of allFeatures) {
    const req = alwaysRequired.has(f) ? 'true' : 'false';
    manifestXml += `      <feature required="${req}">${f}</feature>\n`;
  }

  manifestXml += `    </features>\n`;
  manifestXml += `  </dependencies>\n`;
  manifestXml += `</manifest>`;

  files['manifest.xml'] = manifestXml;

  // 2. Deploy XML
  let deployXml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  deployXml += `<deploy>\n`;
  deployXml += `  <configuration>\n`;
  deployXml += `    <path>~/AccountConfiguration/*</path>\n`;
  deployXml += `  </configuration>\n`;
  deployXml += `  <files>\n`;
  deployXml += `    <path>~/FileCabinet/SuiteScripts/NSIX/*</path>\n`;
  deployXml += `  </files>\n`;
  deployXml += `  <objects>\n`;
  deployXml += `    <path>~/Objects/*</path>\n`;
  deployXml += `  </objects>\n`;
  deployXml += `</deploy>`;

  files['deploy.xml'] = deployXml;

  // 3. Features XML
  let featuresXml = `<?xml version="1.0" encoding="UTF-8"?>\n<features>\n`;
  for (const f of allFeatures) {
    featuresXml += `  <feature id="${f}">T</feature>\n`;
  }
  featuresXml += `</features>`;

  files['AccountConfiguration/features.xml'] = featuresXml;

  // 4. Objects Mapping
  const mappings = getMappingsForAnswers(answers);
  mappings.forEach(m => {
    const filename = `Objects/${m.output.scriptid}.xml`;
    files[filename] = `<?xml version="1.0" encoding="UTF-8"?>\n${m.output.template.trim()}`;
  });

  // 5. FileCabinet directory placeholder
  files['FileCabinet/SuiteScripts/NSIX/.gitkeep'] = '';

  return files;
}
