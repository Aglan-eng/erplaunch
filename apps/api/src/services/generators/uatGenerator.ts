import MarkdownIt from 'markdown-it';
import type { AdaptorContext } from './brdGenerator.js';

export interface UATData {
  clientName: string;
  /** Adaptor context — required so byline / subtitle / footer flex
   *  per platform. Same shape as BRDData.adaptor. */
  adaptor: AdaptorContext;
  answers: Record<string, any>;
  comments?: any[];
  images?: any[];
  aiAdvice?: any[];
}

const md = new MarkdownIt({ html: true, typographer: true });

interface TestCase {
  id: string;
  workstream: string;
  scenario: string;
  expected: string;
  /** Pack T — linked TC-* IDs from testScriptGenerator emissions when
   *  the wizard's testing.scope.scenariosPerWorkstream covers this workstream. */
  linkedTestScripts?: string[];
}

/**
 * Pack T — parse the wizard's testing.scope.scenariosPerWorkstream answer to
 * derive TC-<workstream>-NN references that downstream test scripts
 * carry. The UAT plan now points directly at the per-scenario MD files
 * in Documentation/Test_Scripts/, closing the gap where consultants
 * couldn't trace a UAT row to a real test script.
 */
function buildLinkedScriptMap(scenariosPerWorkstream: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const counters: Record<string, number> = {};
  const re = /^([\w]+):\s*([^:]+):\s*(.+)$/;
  for (const line of scenariosPerWorkstream.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(re);
    if (!m) continue;
    const ws = m[1].toUpperCase();
    const next = (counters[ws] ?? 0) + 1;
    counters[ws] = next;
    const id = `TC-${ws}-${next < 10 ? `0${next}` : String(next)}`;
    if (!out.has(ws)) out.set(ws, []);
    out.get(ws)!.push(id);
  }
  return out;
}

export function generateUATPlan(data: UATData): string {
  const { clientName, adaptor, answers } = data;
  const now = new Date().toLocaleDateString();
  // NetSuite gets the hand-tuned scenario library below. Other adaptors
  // get a schema-driven test case per populated wizard question, so an
  // Odoo engagement's UAT plan isn't an empty table even before the
  // per-adaptor scenario libraries land.
  const baseCases = adaptor.id === 'netsuite'
    ? buildTestCases(answers)
    : buildSchemaDrivenTestCases(adaptor, answers);

  // Pack T — link UAT rows to the per-scenario test scripts emitted by
  // testScriptGenerator. The map is keyed by upper-cased workstream id;
  // we attach all TC-<ws>-NN ids derived from that workstream's
  // scenariosPerWorkstream entries.
  const scenariosRaw = (answers['testing.scope.scenariosPerWorkstream'] as string | undefined) ?? '';
  const linkedScriptMap = buildLinkedScriptMap(scenariosRaw);
  const cases = baseCases.map((tc) => {
    // Workstream tokens in baseCases use uppercase short forms (R2R/P2P
    // /O2C/MFG/RTN). Look up directly; if no scenarios emitted for the
    // workstream the column reads "—".
    const linked = linkedScriptMap.get(tc.workstream.toUpperCase()) ?? [];
    return { ...tc, linkedTestScripts: linked };
  });

  // Acceptance-criteria style — same SELECT the consultant chooses on
  // Pack T testScriptGenerator. Default SIMPLE if omitted.
  const acceptanceStyle = (() => {
    const raw = (answers['testing.scope.acceptanceCriteriaTemplate'] as string | undefined) ?? 'SIMPLE';
    const upper = raw.toString().toUpperCase();
    return upper === 'GIVEN_WHEN_THEN' || upper === 'GHERKIN' ? upper : 'SIMPLE';
  })();

  let content = `# User Acceptance Test (UAT) Plan\n\n`;
  content += `**Client:** ${clientName}  \n**Date:** ${now}  \n**Prepared by:** ERPLaunch\n\n`;
  content += `## 1. Introduction\n\nThis document contains functional test cases auto-generated from the business profile captured for **${clientName}**. Each test case validates a specific configuration decision made during the discovery workshop.\n\n`;
  content += `**Total Test Cases:** ${cases.length}\n\n`;
  content += `**Linked artefacts (Pack T):** \`Documentation/Test_Scripts/\` (per-scenario step-by-step), `;
  content += `\`Documentation/Sign_Off_Matrix.md\`, \`Documentation/Defect_Log_Template.md\`, `;
  content += `\`Documentation/Performance_Test_Plan.md\`, \`Documentation/Regression_Test_Suite.md\`.\n\n`;
  content += `---\n\n`;
  content += `## 2. Test Cases\n\n`;
  content += `| TC ID | Workstream | Scenario | Expected Result | Linked Test Scripts | Status |\n`;
  content += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  cases.forEach(tc => {
    const links = (tc.linkedTestScripts ?? []).length === 0
      ? '—'
      : tc.linkedTestScripts!.map((id) => `\`${id}\``).join(', ');
    content += `| ${tc.id} | ${tc.workstream} | ${tc.scenario} | ${tc.expected} | ${links} | ☐ Pass / ☐ Fail |\n`;
  });

  if (cases.length === 0) {
    content += `| — | All | No specific test cases triggered. Complete wizard questions first. | N/A | — | — |\n`;
  }

  // Acceptance Criteria block — Pack T contract: every UAT plan must
  // include an Acceptance Criteria section (replaces pre-Pack-T gap
  // where the harness check p5.acceptance-criteria failed).
  content += `\n---\n\n## 3. Acceptance Criteria\n\n`;
  content += `Acceptance criteria style for this engagement: **${acceptanceStyleLabel(acceptanceStyle)}**.\n\n`;
  content += renderAcceptanceCriteriaBlock(acceptanceStyle, cases);
  content += `\n\n---\n\n`;
  content += `**Defect tracking:** All defects discovered during UAT are logged in \`Documentation/Defect_Log_Template.md\` per the configured severity scheme. Any Critical or High defect blocks UAT sign-off until resolved or accepted by the project sponsor.\n\n`;
  content += `\n---\n\n## 4. Performance Targets\n\n`;
  content += `Performance benchmarks for this engagement are documented in \`Documentation/Performance_Test_Plan.md\`. UAT pass requires every benchmark met under steady-state load (see that document for the full table).\n\n`;

  content += `\n---\n\n## 5. Implementation Notes\n\n`;
  
  const commentsList = data.comments ?? [];
  const imagesList = data.images ?? [];

  if (commentsList.length > 0 || imagesList.length > 0) {
    if (commentsList.length > 0) {
      content += `### Consultant Guidelines\n\n`;
      commentsList.forEach(c => {
        content += `**${c.sectionKey}**\n> ${c.text.replace(/\n/g, '\n> ')}\n\n`;
      });
    }
    if (imagesList.length > 0) {
      content += `### Reference Data & Attachments\n\n`;
      imagesList.forEach(img => {
        content += `![${img.originalName}](/uploads/${img.engagementId}/${img.filename})\n\n`;
      });
    }
  } else {
    content += `_No additional implementation notes captured._\n\n`;
  }

  content += `\n---\n\n## 6. Sign-off\n\n`;
  content += `For the full per-workstream + per-role sign-off matrix see \`Documentation/Sign_Off_Matrix.md\`. The roll-up signatures below are the project-level gate.\n\n`;
  content += `| Role | Name | Signature | Date |\n`;
  content += `| :--- | :--- | :--- | :--- |\n`;
  content += `| Implementation Lead | | | |\n`;
  content += `| Client Project Manager | | | |\n`;
  content += `| Finance Approver | | | |\n`;

  return content;
}

function acceptanceStyleLabel(style: string): string {
  switch (style) {
    case 'GHERKIN':
      return 'Gherkin (Feature / Scenario / Given / When / Then)';
    case 'GIVEN_WHEN_THEN':
      return 'Given / When / Then (BDD-style)';
    case 'SIMPLE':
    default:
      return 'Simple bulleted criteria';
  }
}

function renderAcceptanceCriteriaBlock(style: string, cases: TestCase[]): string {
  if (cases.length === 0) {
    return '_No test cases — populate the wizard before acceptance criteria can be generated._\n';
  }
  if (style === 'GHERKIN') {
    return cases
      .map((tc) =>
        [
          '```gherkin',
          `Feature: ${tc.scenario}`,
          '',
          `  Scenario: ${tc.scenario}`,
          `    Given the engagement is configured per discovery answers`,
          `    When the tester executes ${tc.id}`,
          `    Then ${tc.expected.toLowerCase().replace(/\.$/, '')}`,
          `    And no Critical or High defects are logged for this case`,
          '```',
          '',
        ].join('\n'),
      )
      .join('\n');
  }
  if (style === 'GIVEN_WHEN_THEN') {
    return cases
      .map((tc) =>
        [
          `**${tc.id} — ${tc.scenario}**`,
          '',
          '- **Given** the engagement is configured per discovery answers',
          `- **When** the tester executes ${tc.id}`,
          `- **Then** ${tc.expected}`,
          `- **And** no Critical or High defects are logged for this case`,
          '',
        ].join('\n'),
      )
      .join('\n');
  }
  // SIMPLE — bulleted per case.
  return cases
    .map((tc) =>
      [
        `**${tc.id} — ${tc.scenario}**`,
        '',
        `- ${tc.expected}`,
        `- Audit log captures actor + action + timestamp`,
        `- No Critical or High defects logged against this case`,
        '',
      ].join('\n'),
    )
    .join('\n');
}

function buildTestCases(answers: Record<string, any>): TestCase[] {
  const cases: TestCase[] = [];
  let c = 1;
  const tc = (workstream: string, scenario: string, expected: string) => {
    cases.push({ id: `UAT-${String(c++).padStart(3, '0')}`, workstream, scenario, expected });
  };

  // ── R2R ──────────────────────────────────────────────────────────────────
  if (answers['r2r.entities.multiEntity'] === true) {
    // Multi-entity scenario — phrased platform-neutrally. NetSuite calls
    // these "subsidiaries"; Odoo calls them "companies"; SAP calls them
    // "company codes". "Entity" is the wizard's vocabulary and works
    // across all three.
    tc('R2R', 'Create a transaction in a child entity', 'Transaction is booked in the child entity and consolidated into the parent automatically');
  }
  if (answers['r2r.currencies.isMultiCurrency'] === true) {
    tc('R2R', 'Record a transaction in a non-base currency', 'Exchange rate is applied; unrealised FX gain/loss account is updated correctly');
  }
  if (answers['r2r.currencies.autoExchangeRateUpdate'] === true) {
    tc('R2R', 'Trigger automated exchange rate update', 'Rates are fetched and updated without manual entry');
  }
  if (answers['r2r.segmentation.useDepartments'] === true) {
    tc('R2R', 'Post a bill to a specific department', 'Department field is mandatory; GL report shows correct departmental breakdown');
  }
  if (answers['r2r.journalEntries.intercompanyJE'] === true) {
    tc('R2R', 'Create an intercompany journal entry', 'Elimination entry is auto-generated; debit and credit appear in respective entities');
  }
  if (answers['r2r.bankTransactions.bankAccountCount'] > 0) {
    tc('R2R', 'Reconcile a bank account', 'System matches bank statement items to cleared transactions; unreconciled items flagged');
  }
  if (answers['r2r.fiscalClose.hardClose'] === true) {
    tc('R2R', 'Attempt to post to a hard-closed period', 'System blocks the transaction with a clear error message');
  }

  // ── P2P ──────────────────────────────────────────────────────────────────
  if (answers['p2p.purchasing.usePurchaseOrders'] === true) {
    tc('P2P', 'Create and approve a purchase order', 'PO is routed to the correct approver; approved status unlocks vendor notification');
  }
  if (answers['p2p.purchasing.poApprovalRequired'] === true) {
    tc('P2P', 'Submit a PO above the approval threshold', 'PO is held in "Pending Approval"; approver receives a task notification');
  }
  if (answers['p2p.purchasing.budgetCheck'] === true) {
    tc('P2P', 'Raise a PO that exceeds the department budget', 'System warns or blocks the PO based on budget check rules configured');
  }
  if (answers['p2p.receiving.formalReceiving'] === true) {
    tc('P2P', 'Receive goods against an open purchase order', 'Item Receipt is created; inventory on-hand quantity increases; PO quantity received updates');
  }
  if (answers['p2p.receiving.threeWayMatch'] === true) {
    tc('P2P', 'Enter a vendor bill and trigger 3-way match', 'Bill is matched against PO and receipt; discrepancy in quantity or price blocks approval');
  }
  if (answers['p2p.bills.billApprovalRequired'] === true) {
    tc('P2P', 'Submit a vendor bill for approval', 'Bill is routed to correct approver; payment is blocked until approved');
  }
  if (answers['p2p.expenses.employeeExpenses'] === true) {
    tc('P2P', 'Submit an employee expense report', 'Report is routed for manager approval; reimbursement appears in AP aging upon approval');
  }
  if (answers['p2p.payments.bankFileExport'] === true) {
    tc('P2P', 'Run a payment batch and export bank file', 'Bank file is generated in the correct format; file can be uploaded to the bank portal');
  }

  // ── O2C ──────────────────────────────────────────────────────────────────
  if (answers['o2c.customers.creditLimits'] === true) {
    tc('O2C', 'Create a sales order that exceeds the customer credit limit', 'System warns or blocks the order; credit manager receives notification for override');
  }
  if (answers['o2c.pricing.foreignCurrencyPricing'] === true) {
    tc('O2C', 'Create a sales order in a foreign currency', 'Prices are displayed in foreign currency; AED equivalent calculated using current exchange rate');
  }
  if (answers['o2c.salesOrders.soApprovalRequired'] === true) {
    tc('O2C', 'Submit a sales order above the approval threshold', 'Order is held as "Pending Approval"; approver receives a task in their dashboard');
  }
  if (answers['o2c.fulfillment.pickPackShip'] === true) {
    tc('O2C', 'Fulfil a sales order using pick-pack-ship process', 'Pick list is generated; items are packed and a shipment record is created; inventory decreases');
  }
  if (answers['o2c.fulfillment.multipleLocations'] === true) {
    tc('O2C', 'Fulfil an order from a specific warehouse location', 'Fulfillment location is selectable; inventory is deducted from the correct bin/location');
  }
  if (answers['o2c.invoicing.revenueRecognition'] === true) {
    tc('O2C', 'Create an invoice with a deferred revenue recognition schedule', 'Revenue is spread across the recognition period; deferred revenue account is credited on invoice');
  }
  if (answers['o2c.collections.dunningLetters'] === true) {
    tc('O2C', 'Trigger a dunning letter for an overdue invoice', 'Dunning email is sent at the correct interval; dunning event is logged on the customer record');
  }

  // ── MFG ──────────────────────────────────────────────────────────────────
  if (answers['mfg.productionFlow.type'] === 'WIP_ROUTINGS') {
    tc('MFG', 'Create and release a Work Order for a WIP item', 'Work Order is issued; component materials are consumed or backflushed; WIP cost is calculated');
    tc('MFG', 'Complete a work order and receive finished goods to stock', 'Finished Good quantity increases in inventory; production variance is calculated and posted to GL');
  }
  if (answers['mfg.productionFlow.type'] === 'WORK_ORDER') {
    tc('MFG', 'Create a Work Order and complete production', 'Work Order drives component consumption; finished item is received into inventory');
  }
  if (answers['mfg.productionFlow.trackLabor'] === true) {
    tc('MFG', 'Log labor time against a production operation', 'Labor cost is calculated and added to work order cost; correct GL accounts are debited');
  }
  if (answers['mfg.bom.multiBom'] === true) {
    tc('MFG', 'Create a Work Order using an alternate BOM revision', 'Correct component list is applied; cost correctly reflects the selected BOM revision');
  }
  if (answers['mfg.outsourced.useOutsourced'] === true) {
    tc('MFG', 'Send raw materials to an outsourced vendor and receive finished goods', 'Transfer Order moves components to vendor location; vendor PO is generated; receipt updates inventory');
  }
  if (answers['mfg.demand.useDemandPlanning'] === true) {
    tc('MFG', 'Run the demand planning engine', 'Suggested work orders and purchase orders are generated based on forecast and reorder rules');
  }

  // ── RTN ──────────────────────────────────────────────────────────────────
  if (answers['rtn.customerReturns.useRMA'] === true) {
    tc('RTN', 'Create a Return Merchandise Authorization (RMA) for a customer', 'RMA is created; customer receives confirmation; warehouse can see pending return');
    tc('RTN', 'Receive a returned item against an RMA', 'Item Receipt is created for the returned goods; inventory is updated; Credit Memo is generated');
  }
  if (answers['rtn.processing.restockingFees'] === true) {
    tc('RTN', 'Process a non-faulty customer return with a restocking fee', `Credit Memo is created with the restocking fee automatically deducted (${answers['rtn.processing.feePercentage'] ?? ''}%)`);
  }
  if (answers['rtn.vendorReturns.useVendorRMA'] === true) {
    tc('RTN', 'Create a Vendor Return transaction for defective goods', 'Return Authorization is created; inventory is removed; Vendor Credit Memo is expected on next bill');
  }

  return cases;
}

/**
 * Schema-driven UAT test cases for non-NetSuite adaptors. One test case
 * per populated wizard question — the workstream column is the flow id,
 * the scenario describes verifying the configured value, the expected
 * result is the formatted answer the consultant captured during
 * discovery. NOT a substitute for a per-adaptor scenario library
 * (which would have richer, role-based scenarios), but it stops the
 * UAT plan being an empty table for every Odoo engagement.
 */
function buildSchemaDrivenTestCases(adaptor: AdaptorContext, answers: Record<string, unknown>): TestCase[] {
  const cases: TestCase[] = [];
  let c = 1;
  for (const flow of adaptor.flows ?? []) {
    for (const section of flow.sections) {
      for (const q of section.questions) {
        const v = answers[q.id];
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) continue;
        const formatted = (() => {
          if (q.inputType === 'BOOLEAN') return v === true ? 'Yes' : 'No';
          if (q.inputType === 'SINGLE_SELECT' && q.options) {
            return q.options.find((o) => o.value === v)?.label ?? String(v);
          }
          if (q.inputType === 'MULTI_SELECT' && Array.isArray(v)) {
            return v.map((x) => q.options?.find((o) => o.value === x)?.label ?? String(x)).join(', ');
          }
          return String(v);
        })();
        cases.push({
          id: `UAT-${String(c++).padStart(3, '0')}`,
          workstream: flow.label,
          scenario: `Verify "${q.label}" is configured as captured during discovery`,
          expected: `Setting reads back as: ${formatted}`,
        });
      }
    }
  }
  return cases;
}

export function generateUATPlanHtml(data: UATData): string {
  const markdown = generateUATPlan(data);
  const body = md.render(markdown);
  const count = (data.adaptor.id === 'netsuite'
    ? buildTestCases(data.answers)
    : buildSchemaDrivenTestCases(data.adaptor, data.answers)).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UAT Plan — ${data.clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 960px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 40px 48px; border-radius: 20px; margin-bottom: 36px; }
    .header h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .header p { opacity: 0.85; font-size: 14px; }
    .badges { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); padding: 5px 14px; border-radius: 999px; font-size: 12px; font-weight: 600; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 36px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 32px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    thead { background: #1e40af; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
    tbody tr:hover { background: #f8fafc; }
    tbody td { padding: 12px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 700; color: #1e40af; font-size: 11px; white-space: nowrap; }
    tbody td:nth-child(2) { font-weight: 600; font-size: 12px; }
    tbody td:last-child { text-align: center; white-space: nowrap; }
    .sign-table { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
    strong { color: #0f172a; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>User Acceptance Test Plan</h1>
      <p>${data.clientName} &mdash; ${data.adaptor.name} Implementation</p>
      <div class="badges">
        <span class="badge">📋 ${count} Test Cases</span>
        <span class="badge">📅 ${new Date().toLocaleDateString()}</span>
        <span class="badge">⚡ Auto-generated</span>
      </div>
    </div>
    ${body}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}
