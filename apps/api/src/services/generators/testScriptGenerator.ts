/**
 * Test Script generator (Pack T — Test Artifacts, Component 2).
 *
 * Cross-platform — works for NetSuite + Odoo + any future adaptor.
 *
 * Reads the wizard's TESTING.scope.scenariosPerWorkstream answer
 * (one line per scenario: "<workstream>: <scenario_name>: <description>")
 * and emits one Markdown test script per scenario into
 * Documentation/Test_Scripts/.
 *
 * Each script is a hand-fillable template with:
 *   - Metadata (Test ID, workstream, owner from testRoles, pre-conditions)
 *   - Inferred default test steps (5–8 per scenario, keyword-matched
 *     against workstream + scenario title — saves the consultant the
 *     boilerplate "navigate / fill / save / verify" plumbing)
 *   - Acceptance criteria rendered in the consultant's chosen style
 *     (SIMPLE bullets / GIVEN_WHEN_THEN / Gherkin)
 *   - Defects-found table (empty rows for tester to fill in)
 *   - Sign-off lines (tester + approver)
 *
 * The generator is intentionally template-y — its value is in the
 * structured shape + auto-filled metadata, not in pretending to know
 * the client's exact business process. Senior consultant goes from
 * "build entire test suite from scratch" (~40h/engagement) to "review
 * starters + add scenario-specific assertions" (~6h).
 *
 * Sources:
 *   - IEEE 829 Standard for Software Test Documentation.
 *   - ISO/IEC 25010 software quality model.
 *   - ASTM E1909 Standard Practice for Software Testing Documentation.
 */

export type AcceptanceCriteriaStyle = 'SIMPLE' | 'GIVEN_WHEN_THEN' | 'GHERKIN';

export interface TestScriptGeneratorInput {
  /** TEXTAREA from testing.scenariosPerWorkstream — one scenario per line. */
  scenariosPerWorkstream?: string | null;
  /** TEXTAREA from testing.testRoles — drives the Test Owner field. */
  testRoles?: string | null;
  /** SINGLE_SELECT from testing.acceptanceCriteriaTemplate. Defaults to
   *  SIMPLE when omitted (most engagements never set this; the bulleted
   *  form is the lowest-effort default). */
  acceptanceCriteriaTemplate?: AcceptanceCriteriaStyle | string | null;
  /** Adaptor identity drives platform-specific phrasing in pre-conditions
   *  (e.g., "Logged in to NetSuite as ..." vs "Logged in to Odoo as ..."). */
  adaptorName?: string;
}

export interface EmittedTestScript {
  /** Path within the bundle, e.g. "Documentation/Test_Scripts/TC-P2P-01-po-creation.md". */
  filename: string;
  /** Stable test ID. */
  testId: string;
  workstream: string;
  scenarioName: string;
  description: string;
}

export interface TestScriptGeneratorOutput {
  /** Map of bundlePath → markdown content. */
  files: Record<string, string>;
  emitted: EmittedTestScript[];
  /** Lines from the input that didn't parse — surfaced in the harness for
   *  the consultant to fix. */
  unmatchedLines: string[];
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

interface ParsedScenario {
  workstream: string;
  scenarioName: string;
  description: string;
}

const SCENARIO_LINE = /^([\w]+):\s*([^:]+):\s*(.+)$/;

function parseScenarios(raw: string): { scenarios: ParsedScenario[]; unmatched: string[] } {
  const scenarios: ParsedScenario[] = [];
  const unmatched: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(SCENARIO_LINE);
    if (!m) {
      unmatched.push(trimmed);
      continue;
    }
    scenarios.push({
      workstream: m[1].toUpperCase(),
      scenarioName: m[2].trim(),
      description: m[3].trim(),
    });
  }
  return { scenarios, unmatched };
}

// ─── Test role inference ─────────────────────────────────────────────────────

const ROLE_LINE = /^([^:]+):\s*(.+)$/;

interface TestRoleRow {
  role: string;
  responsibility: string;
  /** Upper-cased workstream tokens mentioned in the responsibility — drives
   *  default Test Owner per scenario. */
  workstreams: string[];
}

function parseTestRoles(raw: string): TestRoleRow[] {
  const rows: TestRoleRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const m = trimmed.match(ROLE_LINE);
    if (!m) continue;
    const role = m[1].trim();
    const responsibility = m[2].trim();
    const upper = responsibility.toUpperCase();
    const workstreams: string[] = [];
    for (const ws of ['R2R', 'P2P', 'O2C', 'MFG', 'RTN', 'CRM', 'INV', 'HR']) {
      if (upper.includes(ws)) workstreams.push(ws);
    }
    rows.push({ role, responsibility, workstreams });
  }
  return rows;
}

function inferTestOwner(workstream: string, roles: TestRoleRow[]): string {
  // First role whose responsibility mentions this workstream wins. Falls
  // back to the first role overall, then to the literal "[ASSIGN]".
  const match = roles.find((r) => r.workstreams.includes(workstream));
  if (match) return `${match.role} (${match.responsibility})`;
  if (roles.length > 0) return `${roles[0].role} (${roles[0].responsibility})`;
  return '_[ASSIGN — name + role]_';
}

// ─── Default-step inference ──────────────────────────────────────────────────
//
// Per the Pack T spec: 5–8 default steps per scenario based on workstream
// + keyword detection. Saves the consultant from re-typing the same
// "navigate → fill → save → verify" boilerplate for every test case.

interface StepTemplate {
  workstream: string;
  /** Lowercased keywords any of which match the scenario title. */
  keywords: string[];
  steps: ReadonlyArray<{ step: string; expected: string }>;
}

const STEP_TEMPLATES: ReadonlyArray<StepTemplate> = [
  {
    workstream: 'R2R',
    keywords: ['period close', 'month-end', 'monthly close', 'period end'],
    steps: [
      { step: 'Navigate to Setup → Accounting → Manage Accounting Periods', expected: 'Period list loads with the current open period highlighted' },
      { step: 'Select the period to close and click "Close Period"', expected: 'Pre-close validation report runs; no errors flagged' },
      { step: 'Confirm all journal entries are posted (no pending JEs)', expected: 'Pending-JE count is zero across all entities' },
      { step: 'Run Period-End checklist (revaluation, eliminations, accruals)', expected: 'Each step shows "Complete" — no open exceptions' },
      { step: 'Verify trial balance balances by entity + consolidated', expected: 'TB nets to zero per entity AND consolidated; no orphan accounts' },
      { step: 'Mark the period as Closed (hard close per close policy)', expected: 'Period status is "Closed"; system blocks any further posting attempts to it' },
    ],
  },
  {
    workstream: 'R2R',
    keywords: ['trial balance', 'tb generation', 'consolidated trial'],
    steps: [
      { step: 'Navigate to Reports → Financials → Trial Balance', expected: 'Trial Balance report parameters page loads' },
      { step: 'Select reporting period + entity scope', expected: 'Filters accepted; report ready to run' },
      { step: 'Run report (consolidated + per-entity breakdown)', expected: 'Report renders within the configured performance benchmark' },
      { step: 'Verify totals match GL balance per entity', expected: 'No reconciling items; debits = credits at every grouping level' },
      { step: 'Export to Excel and confirm format is preserved', expected: 'Excel export opens cleanly; columns + totals intact' },
    ],
  },
  {
    workstream: 'P2P',
    keywords: ['po', 'purchase order', 'po creation', 'po approval'],
    steps: [
      { step: 'Log in as the role under test (per Test Owner field above)', expected: 'User lands on the role-appropriate dashboard / center' },
      { step: 'Navigate to Transactions → Purchases → Enter Purchase Orders', expected: 'New PO form opens with default values populated from role + entity' },
      { step: 'Fill required fields (vendor, items, quantity, expected delivery)', expected: 'Fields accept input; running total recalculates as lines are added' },
      { step: 'Save the PO', expected: 'PO# generated; status shows "Pending Approval" if total exceeds the role\'s auto-approve threshold' },
      { step: 'Confirm approval routing (per ns.approvals.poApprovalTiers)', expected: 'PO routed to the correct tier approver per the configured matrix' },
      { step: 'Approve the PO as the configured approver', expected: 'Status transitions to "Approved"; vendor notification email queued' },
      { step: 'Verify audit log captures requester + approver + timestamp', expected: 'Audit trail row written; immutable after the approval transaction' },
    ],
  },
  {
    workstream: 'P2P',
    keywords: ['bill', 'vendor bill', 'payable', 'three-way match', '3-way match'],
    steps: [
      { step: 'Navigate to Transactions → Payables → Enter Bills', expected: 'New bill form opens' },
      { step: 'Reference the source PO + receipt (3-way match scope)', expected: 'PO + receipt lines populated; quantities + prices auto-pulled' },
      { step: 'Verify match status (qty, price, tolerance)', expected: 'Status shows "Matched" if within tolerance; "Hold" otherwise' },
      { step: 'Save the bill', expected: 'Bill# generated; status "Pending Approval" or "Approved" per match outcome' },
      { step: 'Confirm GL impact (AP credit, expense debit per item line)', expected: 'GL preview matches the configured account mapping' },
      { step: 'Verify audit trail (preparer + approver + matching exceptions)', expected: 'Audit row written; exception rationale logged when present' },
    ],
  },
  {
    workstream: 'O2C',
    keywords: ['so', 'sales order', 'order creation', 'so approval'],
    steps: [
      { step: 'Log in as Sales role under test', expected: 'User lands on Sales Center' },
      { step: 'Navigate to Transactions → Sales → Enter Sales Orders', expected: 'New SO form opens with role + entity defaults' },
      { step: 'Fill required fields (customer, items, qty, ship-to)', expected: 'Fields accept input; running total recalculates per line' },
      { step: 'Apply pricing rules + discount (if configured)', expected: 'Pricing matches the price-list tier for the customer' },
      { step: 'Save the SO', expected: 'SO# generated; status per approval policy (Pending/Approved/Hold)' },
      { step: 'Confirm fulfillment-readiness flags (credit limit, hold reasons)', expected: 'Holds flagged on UI when triggered (credit limit, deep discount, etc.)' },
      { step: 'Verify GL impact preview (deferred revenue / inventory commit)', expected: 'GL preview matches the configured revenue + inventory commitment accounts' },
    ],
  },
  {
    workstream: 'O2C',
    keywords: ['invoice', 'invoicing', 'bill customer'],
    steps: [
      { step: 'Navigate to Transactions → Sales → Create Invoices', expected: 'Pending invoice queue loads (orders ready to invoice)' },
      { step: 'Select the source SO + delivery records', expected: 'Items + quantities populate from the linked SO/delivery' },
      { step: 'Confirm tax + currency + revenue recognition fields', expected: 'Tax computes correctly per the tax engine; currency matches SO; rev rec schedule attached when in scope' },
      { step: 'Save the invoice', expected: 'Invoice# generated; AR balance increases on the customer record' },
      { step: 'Verify customer notification (email, portal post)', expected: 'Invoice PDF generated + delivered per the customer\'s preferred channel' },
    ],
  },
  {
    workstream: 'MFG',
    keywords: ['work order', 'production', 'mo', 'manufacturing order', 'wo'],
    steps: [
      { step: 'Navigate to Transactions → Manufacturing → Enter Work Orders', expected: 'Work Order form opens' },
      { step: 'Select assembly item + quantity to build', expected: 'BOM expands; component requirements + cost rolls up automatically' },
      { step: 'Issue components (full or partial, per process)', expected: 'Component inventory decremented; WIP balance increases' },
      { step: 'Log labor + overhead against the operation (if tracked)', expected: 'Labor/OH cost added to the WO total cost' },
      { step: 'Complete the work order (receive finished goods)', expected: 'FG inventory increases; WIP relieved; production variance posted to GL per policy' },
      { step: 'Verify costed BOM matches actual cost (variance analysis)', expected: 'Variance within tolerance OR variance posted to the configured variance account' },
      { step: 'Confirm audit trail captures issuer + completer + timestamps', expected: 'Audit row complete; immutable post-completion' },
    ],
  },
  {
    workstream: 'RTN',
    keywords: ['return', 'rma', 'refund', 'credit memo'],
    steps: [
      { step: 'Navigate to Transactions → Customers → Issue Return Authorization', expected: 'New RMA / Return form opens' },
      { step: 'Reference the source SO / invoice', expected: 'Original line items pull through with prices + quantities' },
      { step: 'Specify return reason, quantity, restocking fee (if applicable)', expected: 'Fee calculated per restocking policy; net refund amount displayed' },
      { step: 'Save the RMA', expected: 'RMA# generated; warehouse can see pending receipt' },
      { step: 'Verify Credit Memo creation upon return receipt', expected: 'CM auto-generated; AR balance decreased; inventory restocked or written off per disposition' },
    ],
  },
];

const DEFAULT_STEPS: ReadonlyArray<{ step: string; expected: string }> = [
  { step: 'Navigate to the relevant module (per scenario description)', expected: 'Module opens; user has the right permissions' },
  { step: 'Create the target record with valid data', expected: 'Record validates + saves; system-assigned ID generated' },
  { step: 'Save and confirm the record persists', expected: 'Reload + retrieve shows the saved values intact' },
  { step: 'Verify the audit log captures actor + action + timestamp', expected: 'Audit row written; immutable after creation' },
  { step: 'Confirm downstream side-effects (notifications, integrations)', expected: 'Configured side-effects fire; no error rows in integration log' },
];

function inferSteps(workstream: string, scenarioName: string): ReadonlyArray<{ step: string; expected: string }> {
  const lowerName = scenarioName.toLowerCase();
  for (const tpl of STEP_TEMPLATES) {
    if (tpl.workstream !== workstream) continue;
    if (tpl.keywords.some((kw) => lowerName.includes(kw))) {
      return tpl.steps;
    }
  }
  return DEFAULT_STEPS;
}

// ─── Pre-conditions ──────────────────────────────────────────────────────────

function inferPreConditions(workstream: string, owner: string, adaptorName: string): string {
  const platform = adaptorName.length > 0 ? adaptorName : 'the ERP';
  const baseLine = `User is logged in to ${platform} as the role specified in the Test Owner field above`;
  switch (workstream) {
    case 'P2P':
      return [
        baseLine,
        'At least one approved Vendor record exists in the role\'s entity',
        'Standard procurement permissions are granted; approval workflow is deployed',
      ].join('\n- ');
    case 'O2C':
      return [
        baseLine,
        'At least one active Customer with valid pricing tier exists',
        'Sales workflow + credit-check policy is deployed',
      ].join('\n- ');
    case 'R2R':
      return [
        baseLine,
        'Open accounting period exists for the test fiscal year',
        'COA + entity structure is fully configured',
      ].join('\n- ');
    case 'MFG':
      return [
        baseLine,
        'BOM + Routing exists for the target assembly item',
        'Manufacturing workflow + work-center config is deployed',
      ].join('\n- ');
    case 'RTN':
      return [
        baseLine,
        'A historic SO + invoice exists to return against',
        'Return workflow + restocking-fee policy is deployed',
      ].join('\n- ');
    default:
      return [
        baseLine,
        'Test data is staged (per the Test Data Required field below)',
      ].join('\n- ');
  }
}

// ─── Acceptance criteria rendering ───────────────────────────────────────────

function normaliseStyle(raw: string | null | undefined): AcceptanceCriteriaStyle {
  const upper = (raw ?? '').toString().toUpperCase();
  if (upper === 'GIVEN_WHEN_THEN') return 'GIVEN_WHEN_THEN';
  if (upper === 'GHERKIN') return 'GHERKIN';
  return 'SIMPLE';
}

function renderAcceptanceCriteria(
  scenario: ParsedScenario,
  style: AcceptanceCriteriaStyle,
): string {
  if (style === 'GHERKIN') {
    return [
      '```gherkin',
      `Feature: ${scenario.scenarioName}`,
      '',
      `  Scenario: ${scenario.scenarioName}`,
      `    Given the pre-conditions listed above are satisfied`,
      `    When ${scenario.description.toLowerCase().replace(/\.$/, '')}`,
      `    Then the expected results in the test steps table all pass`,
      `    And the audit trail captures the actor + action + timestamp`,
      `    And no Critical or High defects are logged for this scenario`,
      '```',
    ].join('\n');
  }
  if (style === 'GIVEN_WHEN_THEN') {
    return [
      '**Given** the pre-conditions listed above are satisfied',
      '',
      `**When** ${scenario.description.toLowerCase().replace(/\.$/, '')}`,
      '',
      '**Then** the expected results in the test steps table all pass',
      '',
      '**And** the audit trail captures the actor + action + timestamp',
      '',
      '**And** no Critical or High defects are logged for this scenario',
    ].join('\n');
  }
  // SIMPLE bullets
  return [
    '- All test steps pass per the Expected Result column',
    `- ${scenario.description}`,
    '- Audit trail captures actor + action + timestamp',
    '- No Critical or High defects are logged for this scenario',
    '- Performance is within the configured benchmark for this operation',
  ].join('\n');
}

// ─── Slug + ID helpers ───────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    || 'scenario';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// ─── Markdown emission ───────────────────────────────────────────────────────

function buildMarkdown(args: {
  testId: string;
  scenario: ParsedScenario;
  owner: string;
  preConditions: string;
  steps: ReadonlyArray<{ step: string; expected: string }>;
  acceptanceMd: string;
  style: AcceptanceCriteriaStyle;
}): string {
  const stepRows = args.steps
    .map((s, i) => `| ${i + 1} | ${s.step} | ${s.expected} |  |  |`)
    .join('\n');

  const styleLabel: Record<AcceptanceCriteriaStyle, string> = {
    SIMPLE: 'Simple bulleted list',
    GIVEN_WHEN_THEN: 'Given / When / Then (BDD-style)',
    GHERKIN: 'Full Gherkin scenario',
  };

  return [
    `# Test Script: ${args.scenario.scenarioName}`,
    '',
    '## Metadata',
    '',
    `- **Test ID:** ${args.testId}`,
    `- **Workstream:** ${args.scenario.workstream}`,
    `- **Scenario:** ${args.scenario.scenarioName}`,
    `- **Description:** ${args.scenario.description}`,
    `- **Test Owner:** ${args.owner}`,
    `- **Pre-conditions:**`,
    `  - ${args.preConditions}`,
    `- **Test Data Required:** _[List sample records, master data, or fixtures the tester must stage before running this case.]_`,
    `- **Acceptance Criteria Style:** ${styleLabel[args.style]}`,
    '',
    '## Test Steps',
    '',
    '| # | Step | Expected Result | Pass/Fail | Notes |',
    '|---|------|-----------------|-----------|-------|',
    stepRows,
    '',
    '## Acceptance Criteria',
    '',
    args.acceptanceMd,
    '',
    '## Defects Found',
    '',
    '| Defect ID | Severity | Description | Status |',
    '|-----------|----------|-------------|--------|',
    '| _[D-001]_ |          |             |        |',
    '',
    '## Sign-off',
    '',
    '- **Tested by:**  _____________________  Date: __________',
    '- **Approved by:**  __________________  Date: __________',
    '',
    '_Linked Defect Log: see `Documentation/Defect_Log_Template.md`._',
    '',
  ].join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateTestScripts(input: TestScriptGeneratorInput): TestScriptGeneratorOutput {
  const raw = (input.scenariosPerWorkstream ?? '').toString();
  const { scenarios, unmatched } = parseScenarios(raw);
  const roles = parseTestRoles((input.testRoles ?? '').toString());
  const style = normaliseStyle(input.acceptanceCriteriaTemplate);
  const adaptorName = (input.adaptorName ?? '').toString();

  // Auto-increment per workstream so test IDs read cleanly per family.
  const counters: Record<string, number> = {};

  const files: Record<string, string> = {};
  const emitted: EmittedTestScript[] = [];

  for (const scenario of scenarios) {
    const next = (counters[scenario.workstream] ?? 0) + 1;
    counters[scenario.workstream] = next;
    const testId = `TC-${scenario.workstream}-${pad2(next)}`;

    const owner = inferTestOwner(scenario.workstream, roles);
    const preConditions = inferPreConditions(scenario.workstream, owner, adaptorName);
    const steps = inferSteps(scenario.workstream, scenario.scenarioName);
    const acceptanceMd = renderAcceptanceCriteria(scenario, style);

    const slug = slugify(scenario.scenarioName);
    const filename = `Documentation/Test_Scripts/${testId}-${slug}.md`;

    const markdown = buildMarkdown({
      testId,
      scenario,
      owner,
      preConditions,
      steps,
      acceptanceMd,
      style,
    });

    files[filename] = markdown;
    emitted.push({
      filename,
      testId,
      workstream: scenario.workstream,
      scenarioName: scenario.scenarioName,
      description: scenario.description,
    });
  }

  return { files, emitted, unmatchedLines: unmatched };
}
