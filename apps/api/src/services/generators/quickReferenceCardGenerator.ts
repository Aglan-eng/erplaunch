/**
 * Quick Reference Card generator (Pack U — Training Collateral, Component 3).
 *
 * Cross-platform — emits Documentation/Training/Quick_Reference_Cards/QRC-*.md
 * one file per common task. Task list comes from two sources:
 *
 *   1. Workstream-canonical tasks (universal — always emitted on every
 *      engagement that uses the workstream): create-purchase-order,
 *      enter-vendor-bill, create-customer-invoice, run-trial-balance,
 *      etc. ~12-15 cards in a typical engagement.
 *   2. Per-custom-record tasks (one create + one update-status pair per
 *      record declared in ns.design.customRecords). Cross-platform —
 *      Odoo equivalent reads from a similar custom-record source if
 *      one exists; otherwise this branch is a no-op for Odoo.
 *
 * The platform-specific menu path (NetSuite "Transactions > Purchases >
 * ..." vs Odoo "Purchase > Orders > ...") branches on adaptorName via
 * a per-task lookup map. Tasks with no defined menu path render
 * "_[ASSIGN menu path]_" so the consultant fills it in.
 *
 * Sources:
 *   - SuiteSuccess Quick Reference Card style.
 *   - Odoo OpenAcademy mini-lesson card format.
 *   - Just-in-time learning patterns — 1-page reference cards for
 *     in-the-flow lookups during day-to-day use.
 */

export interface QuickReferenceCardInput {
  clientName: string;
  /** "NetSuite" / "Odoo" / etc. Drives platform-specific menu paths. */
  adaptorName?: string;
  /** Wizard answers — used to detect which optional QRCs are in scope:
   *  - poApprovalInScope (ns.approvals.poApprovalInScope)
   *  - multiCurrencyInScope (ns.foundation.multiCurrencyInScope)
   *  - mfgInScope (any mfg.* answer)
   *  - inventoryInScope (any o2c.fulfillment.* or odoo.inventory.* answer)
   *  - customRecordsAnswer (ns.design.customRecords) */
  poApprovalInScope?: boolean;
  multiCurrencyInScope?: boolean;
  mfgInScope?: boolean;
  inventoryInScope?: boolean;
  /** TEXTAREA ns.design.customRecords — one record per line. NetSuite-only
   *  but non-empty input on Odoo is harmless (we just emit per-record
   *  QRCs without platform-specific menu paths). */
  customRecords?: string | null;
}

export interface EmittedQRC {
  /** Bundle-relative path. */
  filename: string;
  /** Slug used in TC- ID (the QRC title's kebab-case form). */
  slug: string;
  taskName: string;
  audience: string;
}

export interface QuickReferenceCardOutput {
  files: Record<string, string>;
  emitted: EmittedQRC[];
}

// ─── Per-platform menu path lookup ───────────────────────────────────────────

interface MenuPaths {
  netsuite: string;
  odoo: string;
}

function path(netsuite: string, odoo: string): MenuPaths {
  return { netsuite, odoo };
}

const MENU_PATHS: Record<string, MenuPaths> = {
  'create-purchase-order': path(
    'Transactions > Purchases > Enter Purchase Orders',
    'Purchase > Orders > Purchase Orders > Create',
  ),
  'approve-purchase-order': path(
    'Home > Reminders > POs Pending Approval',
    'Purchase > Orders > Purchase Orders (filter: To Approve)',
  ),
  'enter-vendor-bill': path(
    'Transactions > Payables > Enter Bills',
    'Accounting > Vendors > Bills > Create',
  ),
  'three-way-match': path(
    'Transactions > Payables > Enter Bills (from Item Receipt)',
    'Accounting > Vendors > Bills (with linked PO + Receipt)',
  ),
  'run-payment-batch': path(
    'Transactions > Bank > Pay Bills',
    'Accounting > Vendors > Payments > Batch Payment',
  ),
  'create-customer-invoice': path(
    'Transactions > Sales > Create Invoices',
    'Accounting > Customers > Invoices > Create',
  ),
  'apply-customer-payment': path(
    'Transactions > Customers > Accept Customer Payments',
    'Accounting > Customers > Payments > Register Payment',
  ),
  'create-sales-order': path(
    'Transactions > Sales > Enter Sales Orders',
    'Sales > Orders > Quotations > New',
  ),
  'run-trial-balance': path(
    'Reports > Financial > Trial Balance',
    'Accounting > Reporting > Trial Balance',
  ),
  'period-close': path(
    'Setup > Accounting > Manage Accounting Periods',
    'Accounting > Accounting > Lock Dates',
  ),
  'multi-currency-revaluation': path(
    'Transactions > Financial > Revalue Open Currency Balances',
    'Accounting > Adviser > Currency Revaluation',
  ),
  'cycle-count': path(
    'Inventory > Counts > Enter Inventory Counts',
    'Inventory > Operations > Physical Inventory',
  ),
  'stock-adjustment': path(
    'Inventory > Adjustments > Adjust Inventory',
    'Inventory > Operations > Inventory Adjustments',
  ),
  'create-work-order': path(
    'Transactions > Manufacturing > Enter Work Orders',
    'Manufacturing > Operations > Manufacturing Orders > Create',
  ),
  'process-return': path(
    'Transactions > Sales > Enter Return Authorizations',
    'Sales > Orders > Returns / RMA',
  ),
  'saved-search-export': path(
    'Lists > Search > Saved Searches',
    'Settings > Technical > Filters / Custom Reports',
  ),
};

interface CommonPitfalls {
  pitfalls: string[];
}

const PITFALLS: Record<string, CommonPitfalls> = {
  'create-purchase-order': {
    pitfalls: [
      'Forgetting to attach a quote document — finance audit needs it for tier-2+ POs.',
      'Selecting the wrong vendor entity when the same vendor trades with multiple group entities.',
      'Saving a PO with $0 lines — system permits it; downstream 3-way-match fails silently.',
    ],
  },
  'approve-purchase-order': {
    pitfalls: [
      'Approving on mobile with truncated line items — open the desktop view for full review.',
      'Approving outside the assigned tier — the audit log flags this for SoD review.',
    ],
  },
  'enter-vendor-bill': {
    pitfalls: [
      'Duplicate bills — always check the vendor invoice number against the open bill list before saving.',
      'Wrong period — bills posted to a closed period get auto-routed to the next open period (may surprise the accountant).',
    ],
  },
  'three-way-match': {
    pitfalls: [
      'Tolerance bypass — only Finance Manager can override; document the reason in the bill memo.',
      'Partial receipts — match the bill against partial receipts only; do not over-bill.',
    ],
  },
  'create-customer-invoice': {
    pitfalls: [
      'Missing tax code — the invoice will save but tax filing reports will reject it.',
      'Wrong revenue period for ASC 606 — verify the rev rec schedule matches the contract terms.',
    ],
  },
  'create-sales-order': {
    pitfalls: [
      'Customer over credit limit — system warns but does not block; route to credit manager.',
      'Wrong currency — pricelist will silently use the customer default which may not match the deal.',
    ],
  },
  'run-trial-balance': {
    pitfalls: [
      'Cross-period drift if subsidiary periods are unaligned — always tick "As of" + lock the period first.',
      'Missing eliminations on consolidated TB — confirm elimination entries posted before running.',
    ],
  },
  'period-close': {
    pitfalls: [
      'Hard close is irreversible without admin override — confirm all sub-ledgers reconciled first.',
      'Multi-entity period close requires every entity to close before consolidation runs.',
    ],
  },
  'create-work-order': {
    pitfalls: [
      'BOM revision mismatch — verify the WO uses the active BOM; old revisions stay in history.',
      'Insufficient component stock at release — system permits release but production will halt.',
    ],
  },
};

// ─── Per-task metadata (audience + steps + duration) ────────────────────────

interface TaskSpec {
  slug: string;
  taskName: string;
  audience: string;
  estimatedTime: string;
  prerequisites: string[];
  steps: string[];
  /** Slug of related test script (TC-<workstream>-<n>) — links to Pack T. */
  relatedTestScriptHint: string;
}

const CANONICAL_TASKS: ReadonlyArray<TaskSpec> = [
  {
    slug: 'create-purchase-order',
    taskName: 'Create a Purchase Order',
    audience: 'Procurement, AP Clerk, Buyer',
    estimatedTime: '3-5 min',
    prerequisites: [
      'Vendor record exists and is approved',
      'Items in scope are set up with default cost + tax',
    ],
    steps: [
      'Navigate to the menu path below.',
      'Click **New** (or platform equivalent).',
      'Select the vendor — payment terms auto-populate.',
      'Add line items: item, quantity, rate, expected delivery.',
      'Save.',
      'Confirm PO number generated and status reads "Pending Approval" if above auto-approve threshold.',
    ],
    relatedTestScriptHint: 'TC-P2P-01',
  },
  {
    slug: 'approve-purchase-order',
    taskName: 'Approve a Purchase Order',
    audience: 'Department Manager, VP Operations, CFO (per tier)',
    estimatedTime: '2-3 min',
    prerequisites: ['PO is in Pending Approval status', 'Approver is in the configured tier'],
    steps: [
      'Open the **Reminders** dashboard portlet.',
      'Click on the pending PO.',
      'Review every line item; verify the vendor + total.',
      'Click **Approve** or **Reject** (with comment if rejecting).',
      'Audit log records actor + timestamp.',
    ],
    relatedTestScriptHint: 'TC-P2P-01',
  },
  {
    slug: 'enter-vendor-bill',
    taskName: 'Enter a Vendor Bill',
    audience: 'AP Clerk',
    estimatedTime: '3-5 min',
    prerequisites: ['Vendor exists', 'PO + Item Receipt exist (for 3-way match path)'],
    steps: [
      'Navigate to the menu path below.',
      'Reference the source PO (3-way match path).',
      'Confirm quantities + prices match (system auto-pulls from PO + Receipt).',
      'Enter vendor invoice number, date, and due date.',
      'Save.',
      'Verify GL posting preview matches the configured account map.',
    ],
    relatedTestScriptHint: 'TC-P2P-02',
  },
  {
    slug: 'three-way-match',
    taskName: 'Resolve a 3-Way Match Hold',
    audience: 'AP Clerk, AP Manager',
    estimatedTime: '5-10 min',
    prerequisites: ['Bill is in Hold status with a match exception'],
    steps: [
      'Open the held bill.',
      'Compare PO qty + Receipt qty + Bill qty side-by-side.',
      'Identify the exception type: quantity / price / tolerance.',
      'Either correct the bill, or escalate to AP Manager for tolerance override.',
      'Document the resolution rationale in the bill memo.',
    ],
    relatedTestScriptHint: 'TC-P2P-02',
  },
  {
    slug: 'run-payment-batch',
    taskName: 'Run a Payment Batch',
    audience: 'AP Clerk, Treasury',
    estimatedTime: '5-10 min',
    prerequisites: ['Approved bills exist', 'Bank account configured'],
    steps: [
      'Navigate to the menu path below.',
      'Filter bills due within the payment window.',
      'Select bills to include in the batch.',
      'Choose the bank account + payment method.',
      'Generate the bank file (export per the configured format).',
      'Upload the bank file to the bank portal.',
    ],
    relatedTestScriptHint: 'TC-P2P-03',
  },
  {
    slug: 'create-customer-invoice',
    taskName: 'Create a Customer Invoice',
    audience: 'AR Clerk',
    estimatedTime: '3-5 min',
    prerequisites: ['Sales Order or delivered fulfillment exists'],
    steps: [
      'Navigate to the menu path below.',
      'Select the source SO / delivery.',
      'Confirm tax + currency + revenue recognition fields.',
      'Save.',
      'Verify AR balance increased on the customer record.',
    ],
    relatedTestScriptHint: 'TC-O2C-02',
  },
  {
    slug: 'apply-customer-payment',
    taskName: 'Apply a Customer Payment',
    audience: 'AR Clerk',
    estimatedTime: '2-3 min',
    prerequisites: ['Open invoice exists for the customer', 'Payment received in the bank'],
    steps: [
      'Open the customer record (or search by invoice number).',
      'Click **Accept Payment** (or platform equivalent).',
      'Enter payment method, amount, and reference number.',
      'Apply against open invoices (system suggests the oldest).',
      'Save — AR balance decreases automatically.',
    ],
    relatedTestScriptHint: 'TC-O2C-02',
  },
  {
    slug: 'create-sales-order',
    taskName: 'Create a Sales Order',
    audience: 'Sales, AR Clerk, Customer Service',
    estimatedTime: '3-5 min',
    prerequisites: ['Customer record exists with valid pricing tier'],
    steps: [
      'Navigate to the menu path below.',
      'Select the customer — terms + currency auto-populate.',
      'Add line items + verify pricing (pricelist auto-applies).',
      'Apply discount if authorised (above threshold routes to approval).',
      'Save.',
      'Confirm SO number + status (Pending Approval / Approved / Hold).',
    ],
    relatedTestScriptHint: 'TC-O2C-01',
  },
  {
    slug: 'run-trial-balance',
    taskName: 'Run a Trial Balance',
    audience: 'Finance, CFO, Auditor',
    estimatedTime: '3-5 min',
    prerequisites: ['Period exists; sub-ledgers reconciled before close'],
    steps: [
      'Navigate to the menu path below.',
      'Select the reporting period.',
      'Choose entity scope (single / consolidated).',
      'Run.',
      'Drill down on any account showing variance.',
      'Export to Excel for further review.',
    ],
    relatedTestScriptHint: 'TC-R2R-02',
  },
  {
    slug: 'period-close',
    taskName: 'Close an Accounting Period',
    audience: 'Finance Manager, CFO',
    estimatedTime: '15-30 min',
    prerequisites: [
      'All journals posted',
      'All sub-ledgers reconciled',
      'Bank reconciliations complete',
    ],
    steps: [
      'Navigate to the menu path below.',
      'Run the pre-close checklist (no pending JEs, no unreconciled accounts).',
      'For multi-entity: confirm every child entity period is also closed.',
      'Click **Close** (hard close if policy requires).',
      'Run TB to confirm period balances.',
      'Document close in the engagement log.',
    ],
    relatedTestScriptHint: 'TC-R2R-01',
  },
];

const CONDITIONAL_TASKS: ReadonlyArray<{ flag: keyof QuickReferenceCardInput; spec: TaskSpec }> = [
  {
    flag: 'multiCurrencyInScope',
    spec: {
      slug: 'multi-currency-revaluation',
      taskName: 'Run Multi-Currency Revaluation',
      audience: 'Finance, Controller',
      estimatedTime: '5-10 min',
      prerequisites: ['FX rates loaded for the close period', 'Multi-currency config enabled'],
      steps: [
        'Navigate to the menu path below.',
        'Select the period + entities to revalue.',
        'Confirm the FX rates loaded for the period.',
        'Run revaluation — system creates unrealized FX entries.',
        'Review the journal posted to the FX gain/loss account.',
      ],
      relatedTestScriptHint: 'TC-R2R-02',
    },
  },
  {
    flag: 'mfgInScope',
    spec: {
      slug: 'create-work-order',
      taskName: 'Create a Work Order',
      audience: 'Production Planner, Manufacturing Manager',
      estimatedTime: '5-10 min',
      prerequisites: ['Item with active BOM', 'Component stock available (or release allows shortage)'],
      steps: [
        'Navigate to the menu path below.',
        'Select the assembly item — BOM auto-expands.',
        'Enter quantity to build + planned start date.',
        'Save.',
        'Release the WO — components are reserved.',
        'On completion: report production + post finished goods to inventory.',
      ],
      relatedTestScriptHint: 'TC-MFG-01',
    },
  },
  {
    flag: 'inventoryInScope',
    spec: {
      slug: 'cycle-count',
      taskName: 'Run a Cycle Count',
      audience: 'Inventory Manager, Warehouse Staff',
      estimatedTime: '15-30 min',
      prerequisites: ['Cycle count plan defined for the bin/zone'],
      steps: [
        'Navigate to the menu path below.',
        'Generate the cycle count list for the target bin.',
        'Print or load on handheld scanner.',
        'Count physical inventory + record in the system.',
        'Reconcile variance with on-hand quantity.',
        'Post adjustments — variance posts to the configured GL account.',
      ],
      relatedTestScriptHint: 'TC-INV-01',
    },
  },
  {
    flag: 'inventoryInScope',
    spec: {
      slug: 'stock-adjustment',
      taskName: 'Make a Stock Adjustment',
      audience: 'Inventory Manager',
      estimatedTime: '3-5 min',
      prerequisites: ['Authorisation per the SoD matrix'],
      steps: [
        'Navigate to the menu path below.',
        'Select the item + location + adjustment reason.',
        'Enter the quantity delta (positive or negative).',
        'Save — variance posts to GL adjustment account immediately.',
        'Audit log records actor + timestamp + reason.',
      ],
      relatedTestScriptHint: 'TC-INV-01',
    },
  },
];

const ALWAYS_ON_LATE: ReadonlyArray<TaskSpec> = [
  {
    slug: 'process-return',
    taskName: 'Process a Customer Return',
    audience: 'Customer Service, AR Clerk',
    estimatedTime: '5-10 min',
    prerequisites: ['Original SO + invoice exists', 'Customer has requested return'],
    steps: [
      'Navigate to the menu path below.',
      'Reference the original SO/invoice.',
      'Specify return reason + qty + condition.',
      'Save the RMA.',
      'On receipt: create item receipt + credit memo.',
      'Apply credit memo to outstanding balance.',
    ],
    relatedTestScriptHint: 'TC-RTN-01',
  },
  {
    slug: 'saved-search-export',
    taskName: 'Run + Export a Saved Search',
    audience: 'Anyone with read access to the source records',
    estimatedTime: '2-5 min',
    prerequisites: ['Saved search exists or you have permission to create one'],
    steps: [
      'Navigate to the menu path below.',
      'Open the saved search by name.',
      'Adjust filters if needed (e.g., date range).',
      'Click **Run** — review results in browser.',
      'Click **Export to CSV/Excel** — downloads a file.',
      'Open + verify the export — column headers should match the search.',
    ],
    relatedTestScriptHint: 'TC-R2R-02',
  },
];

// ─── Custom-record QRCs (one create + one update-status pair per record) ────

function customRecordSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function parseCustomRecords(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // First word(s) before any "(" or "—" — same convention as Pack K.
    const m = trimmed.match(/^([^(—\-]+)/);
    const name = (m ? m[1] : trimmed).trim();
    if (name.length > 0) out.push(name);
  }
  return out;
}

function customRecordTasks(records: string[]): TaskSpec[] {
  const out: TaskSpec[] = [];
  for (const record of records) {
    const slug = customRecordSlug(record);
    out.push({
      slug: `create-${slug}-record`,
      taskName: `Create a ${record} Record`,
      audience: 'Per the role assigned to this record\'s create permission',
      estimatedTime: '2-5 min',
      prerequisites: [
        `Permission CREATE on the ${record} custom record (see Pack C role permissions)`,
      ],
      steps: [
        `Navigate to **Lists > Custom > ${record}** (NetSuite) or **Settings > Technical > Database Structure** (Odoo equivalent).`,
        'Click **New**.',
        'Fill all required fields (marked with `*`).',
        'Save.',
        'Confirm record ID generated + status defaults per the workflow state machine.',
      ],
      relatedTestScriptHint: '—',
    });
    out.push({
      slug: `update-${slug}-status`,
      taskName: `Update ${record} Status`,
      audience: 'Per the role assigned to the state-machine transition (see Pack W workflow)',
      estimatedTime: '1-3 min',
      prerequisites: [
        `Open ${record} in a state that allows transition`,
        'Approve permission per the configured workflow',
      ],
      steps: [
        `Open the ${record} record.`,
        'Click the **Approve** or **Transition** button (label per workflow design).',
        'Enter optional comment.',
        'Save — workflow advances state + audit log records the transition.',
      ],
      relatedTestScriptHint: '—',
    });
  }
  return out;
}

// ─── Markdown emission ──────────────────────────────────────────────────────

function buildMarkdown(args: {
  task: TaskSpec;
  adaptorName: string;
  menuPath?: MenuPaths;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'the ERP';
  const platformLower = args.adaptorName.toLowerCase();
  const resolvedMenuPath = args.menuPath
    ? platformLower === 'netsuite'
      ? args.menuPath.netsuite
      : platformLower === 'odoo'
        ? args.menuPath.odoo
        : '_[ASSIGN platform menu path]_'
    : '_[ASSIGN platform menu path]_';

  const pitfallList = (PITFALLS[args.task.slug]?.pitfalls ?? [
    'No platform-specific pitfalls captured — record any tester observations here during UAT.',
  ])
    .map((p) => `- ${p}`)
    .join('\n');

  const stepsList = args.task.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prereqList = args.task.prerequisites.map((p) => `- ${p}`).join('\n');

  return [
    `# ${args.task.taskName} — Quick Reference`,
    '',
    `**Platform:** ${platform}  `,
    `**Audience:** ${args.task.audience}  `,
    `**Estimated Time:** ${args.task.estimatedTime}`,
    '',
    '## Prerequisites',
    '',
    prereqList,
    '',
    '## Steps',
    '',
    stepsList,
    '',
    '## Common Pitfalls',
    '',
    pitfallList,
    '',
    '## Where to Find It',
    '',
    `- **Menu Path (${platform}):** \`${resolvedMenuPath}\``,
    '',
    '## Related Resources',
    '',
    `- Test script: \`Documentation/Test_Scripts/${args.task.relatedTestScriptHint}-*.md\``,
    '- Full role training: see `Documentation/Training/<Role>_Training_Guide.md`',
    '- Defect log: `Documentation/Defect_Log_Template.md`',
    '',
    '_Generated by ERPLaunch — Pack U (Training Collateral)._',
    '',
  ].join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generateQuickReferenceCards(
  input: QuickReferenceCardInput,
): QuickReferenceCardOutput {
  const adaptorName = (input.adaptorName ?? '').toString();

  const tasks: TaskSpec[] = [...CANONICAL_TASKS];

  // Conditional tasks fire when the matching scope flag is set. We emit
  // approve-purchase-order only when poApprovalInScope; this keeps QRC
  // count realistic per engagement.
  if (input.poApprovalInScope === true) {
    // approve-purchase-order is already in CANONICAL_TASKS — leave it.
    // Future: gate other approval-specific QRCs here.
  } else {
    // Strip approve-purchase-order when no approval workflow exists.
    const idx = tasks.findIndex((t) => t.slug === 'approve-purchase-order');
    if (idx >= 0) tasks.splice(idx, 1);
  }

  for (const conditional of CONDITIONAL_TASKS) {
    if (input[conditional.flag] === true) {
      // Dedup against CANONICAL_TASKS in case of overlap.
      if (!tasks.some((t) => t.slug === conditional.spec.slug)) {
        tasks.push(conditional.spec);
      }
    }
  }

  // Always-on late tasks (process-return + saved-search-export) — these
  // round out every engagement.
  for (const late of ALWAYS_ON_LATE) {
    if (!tasks.some((t) => t.slug === late.slug)) {
      tasks.push(late);
    }
  }

  // Per-custom-record tasks.
  const customRecordsRaw = (input.customRecords ?? '').toString();
  const customRecords = parseCustomRecords(customRecordsRaw);
  tasks.push(...customRecordTasks(customRecords));

  const files: Record<string, string> = {};
  const emitted: EmittedQRC[] = [];

  for (const task of tasks) {
    const filename = `Documentation/Training/Quick_Reference_Cards/QRC-${task.slug}.md`;
    const md = buildMarkdown({
      task,
      adaptorName,
      menuPath: MENU_PATHS[task.slug],
    });
    files[filename] = md;
    emitted.push({
      filename,
      slug: task.slug,
      taskName: task.taskName,
      audience: task.audience,
    });
  }

  return { files, emitted };
}
