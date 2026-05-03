import MarkdownIt from 'markdown-it';
import type { AdaptorContext, AdaptorQuestion } from './brdGenerator.js';

/** Mirror of brdGenerator.formatAnswer — same input/output contract. */
function fmt(question: AdaptorQuestion, raw: unknown): string {
  if (raw === undefined || raw === null) return '—';
  if (question.inputType === 'BOOLEAN') return raw === true ? 'Yes' : raw === false ? 'No' : '—';
  if (question.inputType === 'SINGLE_SELECT' && question.options) {
    return question.options.find((o) => o.value === raw)?.label ?? String(raw);
  }
  if (question.inputType === 'MULTI_SELECT' && Array.isArray(raw)) {
    if (raw.length === 0) return 'None selected';
    return raw.map((v) => question.options?.find((o) => o.value === v)?.label ?? String(v)).join(', ');
  }
  if (question.inputType === 'TABLE' && Array.isArray(raw)) {
    return raw.length === 0 ? 'None configured' : (raw as string[]).map((r, i) => `${i + 1}. ${r}`).join('\n');
  }
  return String(raw);
}

const md = new MarkdownIt({ html: true, typographer: true });

export interface TrainingManualData {
  clientName: string;
  /** Adaptor context — required so prose flexes per platform. The
   *  detailed training modules in this generator are NetSuite-specific
   *  (menu paths, transaction names) and only render when the adaptor
   *  is NetSuite; other adaptors get a platform-neutral placeholder
   *  pointing at the per-adaptor training that will be issued
   *  separately. */
  adaptor: AdaptorContext;
  answers: Record<string, any>;
  comments?: any[];
  images?: any[];
  aiAdvice?: any[];
}

interface TrainingModule {
  id: string;
  title: string;
  role: string;
  duration: string;
  steps: { step: number; action: string; detail: string; nav: string }[];
  flowPrefix?: string;
}

function buildModules(answers: Record<string, any>): TrainingModule[] {
  const modules: TrainingModule[] = [];
  const yn = (key: string) => answers[key] === true;

  // ── CORE: Always include ────────────────────────────────────────────────────
  modules.push({
    id: 'MOD-001',
    title: 'NetSuite Navigation & Basics',
    role: 'All Users',
    duration: '1 hour',
    steps: [
      { step: 1, action: 'Login to NetSuite', detail: 'Navigate to your NetSuite URL. Enter your email and password. Use SSO if configured.', nav: 'Home page' },
      { step: 2, action: 'Navigate using the Menu Bar', detail: 'Use the top navigation bar to reach any module. Use the Global Search bar (top-right) to find any record by name or ID.', nav: 'All menus' },
      { step: 3, action: 'Understand the Dashboard', detail: 'Dashboards show saved searches, KPI tiles, and reminders. Portlets can be added, removed, and rearranged per user preference.', nav: 'Home > Dashboard' },
      { step: 4, action: 'Edit your Profile & Preferences', detail: 'Set your default date format, currency, and language. Review notification settings.', nav: 'Home > Set Preferences' },
    ],
  });

  // ── R2R ────────────────────────────────────────────────────────────────────
  if (Object.keys(answers).some(k => k.startsWith('r2r.'))) {
    modules.push({
      id: 'MOD-002',
      title: 'Chart of Accounts & Journal Entries',
      role: 'Finance / Accounting',
      duration: '2 hours',
      flowPrefix: 'r2r',
      steps: [
        { step: 1, action: 'View the Chart of Accounts', detail: 'Review all GL accounts configured for the company. Filter by type (Income, Expense, Asset, Liability, Equity).', nav: 'Accounts > Chart of Accounts' },
        { step: 2, action: 'Create a Manual Journal Entry', detail: 'Click New > Journal Entry. Select the period, add debit and credit lines ensuring they balance to zero. Memo is mandatory.', nav: 'Transactions > Financial > Make Journal Entries' },
        { step: 3, action: 'Approve a Journal Entry', detail: 'Pending journals appear in your Approval Reminders. Open, review, and click Approve or Reject.', nav: 'Transactions > Financial > Approve Journal Entries' },
        ...(yn('r2r.journalEntries.intercompanyJE') ? [
          { step: 4, action: 'Create an Intercompany Journal Entry', detail: 'Select the source subsidiary, add lines across subsidiaries. NetSuite auto-generates the elimination entry.', nav: 'Transactions > Financial > Make Intercompany Journal Entries' },
        ] : []),
      ],
    });

    if (yn('r2r.fiscalClose.hardClose')) {
      modules.push({
        id: 'MOD-003',
        title: 'Period & Year-End Close',
        role: 'Finance Manager',
        duration: '1.5 hours',
        flowPrefix: 'r2r',
        steps: [
          { step: 1, action: 'Run the Period Close Checklist', detail: 'Review pending journals, unapproved transactions, and unreconciled accounts for the period.', nav: 'Setup > Accounting > Manage Accounting Periods' },
          { step: 2, action: 'Lock a Period', detail: 'Once all transactions are posted and approved, click Lock Period to prevent further posting. This is irreversible without admin override.', nav: 'Setup > Accounting > Manage Accounting Periods' },
          { step: 3, action: 'Run Trial Balance Report', detail: 'Generate the Trial Balance for the closed period to confirm all accounts balance correctly.', nav: 'Reports > Financial > Trial Balance' },
        ],
      });
    }
  }

  // ── P2P ────────────────────────────────────────────────────────────────────
  if (yn('p2p.purchasing.usePurchaseOrders')) {
    modules.push({
      id: 'MOD-004',
      title: 'Creating & Approving Purchase Orders',
      role: 'Procurement / Finance',
      duration: '2 hours',
      flowPrefix: 'p2p',
      steps: [
        { step: 1, action: 'Create a Purchase Order', detail: 'Click New > Purchase Order. Select the Vendor. The system will auto-populate payment terms. Add line items (item, quantity, rate). Click Save.', nav: 'Transactions > Purchases > Enter Purchase Orders' },
        { step: 2, action: 'Submit PO for Approval', detail: 'After saving, the PO moves to Pending Approval status. The assigned approver receives a task notification.', nav: 'Approval inbox or email notification' },
        { step: 3, action: 'Approve or Reject a PO', detail: 'Open the PO from your Reminders dashboard. Review all lines. Click Approve to release to vendor or Reject with a comment.', nav: 'Home > Reminders > POs Pending Approval' },
        ...(yn('p2p.receiving.formalReceiving') ? [
          { step: 4, action: 'Receive Goods Against a PO', detail: 'Open the approved PO. Click Receive. Enter quantities received. Save to create an Item Receipt which updates inventory automatically.', nav: 'Transactions > Purchases > Receive Orders' },
        ] : []),
        ...(yn('p2p.receiving.threeWayMatch') ? [
          { step: 5, action: 'Enter a Vendor Bill (3-Way Match)', detail: 'From the Item Receipt, click Bill. The system checks PO quantity, receipt quantity, and bill quantity match. Any discrepancy highlights in red.', nav: 'Transactions > Payables > Enter Bills' },
        ] : []),
      ],
    });
  }

  if (yn('p2p.expenses.employeeExpenses')) {
    modules.push({
      id: 'MOD-005',
      title: 'Submitting Employee Expense Reports',
      role: 'All Staff',
      duration: '1 hour',
      flowPrefix: 'p2p',
      steps: [
        { step: 1, action: 'Create a New Expense Report', detail: 'Click New > Expense Report. Select the purpose, expense period, and your department. Enter each expense on a new line with the category, date, and amount.', nav: 'Transactions > Employees > Enter Expense Reports' },
        { step: 2, action: 'Attach Receipts', detail: 'Click the Files tab and attach receipt images or PDFs for each claim line. Without receipts, the report may be rejected by Finance.', nav: 'Files subtab on Expense Report' },
        { step: 3, action: 'Submit for Approval', detail: 'Click Submit for Approval. Your line manager will receive a task notification to review.', nav: 'Submit for Approval button' },
      ],
    });
  }

  // ── O2C ────────────────────────────────────────────────────────────────────
  if (Object.keys(answers).some(k => k.startsWith('o2c.'))) {
    modules.push({
      id: 'MOD-006',
      title: 'Sales Orders & Invoicing',
      role: 'Sales / Finance',
      duration: '2 hours',
      flowPrefix: 'o2c',
      steps: [
        { step: 1, action: 'Create a Sales Order', detail: 'Navigate to Enter Sales Orders. Select the customer. The system auto-fills shipping address, payment terms, and currency. Add line items and confirm quantities.', nav: 'Transactions > Sales > Enter Sales Orders' },
        { step: 2, action: 'Approve a Sales Order', detail: 'High-value orders route to the sales manager for approval. Check the Approval Reminders on the dashboard.', nav: 'Home > Reminders' },
        { step: 3, action: 'Create a Customer Invoice', detail: 'From the fulfilled sales order, click Invoice. Verify the amounts and click Save to generate and send the invoice.', nav: 'Transactions > Sales > Create Invoices' },
        { step: 4, action: 'Apply a Customer Payment', detail: 'Open the invoice. Click Accept Payment. Select the payment method, enter the amount received, and save to clear the outstanding balance.', nav: 'Transactions > Sales > Accept Payments' },
      ],
    });

    if (yn('o2c.fulfillment.pickPackShip')) {
      modules.push({
        id: 'MOD-007',
        title: 'Warehouse Fulfillment (Pick-Pack-Ship)',
        role: 'Warehouse Staff',
        duration: '1.5 hours',
        flowPrefix: 'o2c',
        steps: [
          { step: 1, action: 'Generate a Pick List', detail: 'Navigate to the Fulfillment Queue. Select orders ready to ship. Click Print Pick Tickets to generate the warehouse picking document.', nav: 'Warehouse > Fulfillment > Pick Tickets' },
          { step: 2, action: 'Pack the Order', detail: 'After picking, select the items fulfilled and click Create Packing Slip. Record the box count and any special packaging notes.', nav: 'Warehouse > Fulfillment > Pack Orders' },
          { step: 3, action: 'Ship the Order', detail: 'Create the Item Fulfillment record, enter the carrier and tracking number, then click Save. This triggers the invoice.', nav: 'Warehouse > Fulfillment > Fulfill Orders' },
        ],
      });
    }
  }

  // ── MFG ────────────────────────────────────────────────────────────────────
  if (Object.keys(answers).some(k => k.startsWith('mfg.'))) {
    modules.push({
      id: 'MOD-008',
      title: 'Production & Work Orders',
      role: 'Production / Planning',
      duration: '2.5 hours',
      flowPrefix: 'mfg',
      steps: [
        { step: 1, action: 'Create a Work Order', detail: 'Navigate to Enter Work Orders. Select the finished goods item. The system auto-fills the BOM components. Enter the quantity and planned date.', nav: 'Transactions > Manufacturing > Enter Work Orders' },
        { step: 2, action: 'Release the Work Order to the Shop Floor', detail: 'Click Release. The status changes to In Progress and the BOM components are reserved from inventory.', nav: 'Work Order > Release button' },
        ...(answers['mfg.productionFlow.type'] === 'WIP_ROUTINGS' ? [
          { step: 3, action: 'Log Production Operations (Labor)', detail: 'Open the Work Order. Click Operations. For each routing step, enter the actual hours worked by the operator. This posts labor cost to WIP.', nav: 'Work Order > Operations subtab' },
        ] : []),
        { step: 4, action: 'Complete the Work Order', detail: 'Once production is finished, click Complete. The system receives finished goods to inventory and clears WIP costs. Review the production variance report.', nav: 'Work Order > Complete button' },
      ],
    });
  }

  // ── RTN ────────────────────────────────────────────────────────────────────
  if (yn('rtn.customerReturns.useRMA')) {
    modules.push({
      id: 'MOD-009',
      title: 'Processing Customer Returns (RMA)',
      role: 'Customer Service / Warehouse',
      duration: '1 hour',
      flowPrefix: 'rtn',
      steps: [
        { step: 1, action: 'Create a Return Merchandise Authorization (RMA)', detail: 'Open the original sales order or invoice. Click Return. Select the items and quantities being returned. Save to create the RMA.', nav: 'Transactions > Sales > Enter Return Authorizations' },
        { step: 2, action: 'Receive the Returned Item', detail: 'When the customer ships back the item, open the RMA and click Receive. Create the Item Receipt to bring the goods back into inventory.', nav: 'RMA > Receive button' },
        { step: 3, action: 'Issue the Credit Memo / Refund', detail: 'From the RMA, click Credit. Review the credit memo amount. Apply it to an open invoice or process a cash refund to the customer.', nav: 'RMA > Credit button' },
      ],
    });
  }

  return modules;
}

function renderModules(modules: TrainingModule[], data: TrainingManualData): string {
  return modules.map(mod => {
    let out = `### ${mod.id}: ${mod.title}\n\n`;
    out += `> **Target Role:** ${mod.role} &nbsp;|&nbsp; **Estimated Duration:** ${mod.duration}\n\n`;
    out += `| Step | Action | Detailed Instructions | NetSuite Navigation |\n`;
    out += `| :--- | :--- | :--- | :--- |\n`;
    mod.steps.forEach(s => {
      out += `| ${s.step} | **${s.action}** | ${s.detail} | \`${s.nav}\` |\n`;
    });
    out += `\n`;

    if (mod.flowPrefix) {
      const flowComments = data.comments?.filter(c => c.sectionKey.startsWith(mod.flowPrefix! + '.'));
      const flowImages = data.images?.filter(img => img.sectionKey.startsWith(mod.flowPrefix! + '.'));
      if (flowComments?.length || flowImages?.length) {
        out += `#### Implementation Notes & Reference Materials\n\n`;
        if (flowComments?.length) {
          flowComments.forEach(c => out += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`);
        }
        if (flowImages?.length) {
          flowImages.forEach(img => out += `![${img.originalName}](/uploads/${img.engagementId}/${img.filename})\n\n`);
        }
      }
    }
    return out;
  }).join('');
}

export function generateTrainingManual(data: TrainingManualData): string {
  const { clientName, adaptor, answers } = data;
  const isNetSuite = adaptor.id === 'netsuite';
  const modules = buildModules(answers);
  const now = new Date().toLocaleDateString();

  let doc = `# ${adaptor.name} Training Manual\n\n`;
  doc += `**Client:** ${clientName}  \n**Date:** ${now}  \n**Prepared by:** ERPLaunch\n\n`;
  doc += `---\n\n`;

  doc += `## Introduction\n\n`;
  doc += `This Training Manual has been prepared specifically for **${clientName}** based on the business processes configured during the ${adaptor.name} discovery and design phases. `;
  doc += `Each module addresses a specific business role and the associated ${adaptor.name} transactions they will perform day-to-day.\n\n`;

  // Pack U — index sections cross-referencing the per-role training
  // guides + quick reference cards + matrix + schedule + KT checklist.
  // These sit at the top of the manual so consultants and end users
  // see the role-targeted starting points before the consolidated
  // platform-wide content.
  doc += `## Pack U Index — Role-Targeted Starting Points\n\n`;
  doc += `This consolidated manual is the platform-wide reference. For role-targeted entry points, ` +
    `start with the per-role guide for your function — each one carries its own curriculum, ` +
    `hands-on lab, and assessment scoped to the day-to-day tasks for that role.\n\n`;
  doc += `### Per-Role Training Guides\n\n`;
  doc += `Auto-generated per role declared in the engagement wizard. One file per role under ` +
    `\`Documentation/Training/<Role_Slug>_Training_Guide.md\`. Each guide carries 3-7 modules + ` +
    `hands-on lab + assessment criteria.\n\n`;
  doc += `> See \`Documentation/Training/\` for the full set on this engagement.\n\n`;
  doc += `### Quick Reference Cards (1-page-per-task)\n\n`;
  doc += `Auto-generated for the ~12-18 most common day-to-day tasks. Each card shows: ` +
    `audience, prerequisites, numbered steps, common pitfalls, the ${adaptor.name}-specific menu path, ` +
    `and cross-references to the matching test script + role training guide.\n\n`;
  doc += `> Browse \`Documentation/Training/Quick_Reference_Cards/\` — files are named ` +
    `\`QRC-<task-slug>.md\`.\n\n`;
  doc += `### Training Matrix (who-trains-what)\n\n`;
  doc += `\`Documentation/Training_Matrix.md\` shows per-role × per-workstream coverage in a single ` +
    `grid (Required / View / N/A) plus total training hours per role. Use it for cohort-planning ` +
    `conversations with the client PM.\n\n`;
  doc += `### Training Schedule\n\n`;
  doc += `\`Documentation/Training_Schedule.md\` carries the session-by-session schedule, ` +
    `auto-staggered from 4 weeks pre-go-live to 1 week pre-go-live. Pre-training prerequisites ` +
    `+ post-training validation checklists are at the bottom of that document.\n\n`;
  doc += `### Knowledge Transfer Checklist\n\n`;
  doc += `\`Documentation/KT_Checklist.md\` is the formal transition gate from consultant team to ` +
    `client-internal BAU support. Complete before go-live + 30 days. Tickbox lists per area: ` +
    `documentation handoff, configuration knowledge, operational run-books, training cascade ` +
    `status, and BAU transition (on-call rotation + SLAs).\n\n`;
  doc += `---\n\n`;

  if (isNetSuite) {
    // Detailed step-by-step training is NetSuite-only for now. Each step
    // references a specific NetSuite menu path; localising to other adaptors
    // is a per-adaptor follow-up (Odoo training would live in a separate
    // generator with its own menu vocabulary).
    doc += `### How to Use This Manual\n\n`;
    doc += `- Work through modules relevant to your role.\n`;
    doc += `- Each step can be followed directly in the NetSuite Sandbox environment during training.\n`;
    doc += `- The **NetSuite Navigation** column shows the exact menu path to reach each screen.\n\n`;
    doc += `---\n\n`;

    doc += `## Table of Contents\n\n`;
    modules.forEach(m => {
      doc += `- [${m.id}: ${m.title}](#${m.id.toLowerCase()}-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')})\n`;
    });
    doc += `\n---\n\n`;

    doc += `## Training Modules\n\n`;
    doc += renderModules(modules, data);

    doc += `---\n\n`;
    doc += `## Quick Reference Card\n\n`;
    doc += `| Task | NetSuite Path |\n| :--- | :--- |\n`;
    doc += `| Create Journal Entry | Transactions > Financial > Make Journal Entries |\n`;
    if (answers['p2p.purchasing.usePurchaseOrders']) {
      doc += `| Create Purchase Order | Transactions > Purchases > Enter Purchase Orders |\n`;
    }
    if (Object.keys(answers).some(k => k.startsWith('o2c.'))) {
      doc += `| Create Sales Order | Transactions > Sales > Enter Sales Orders |\n`;
    }
    if (Object.keys(answers).some(k => k.startsWith('mfg.'))) {
      doc += `| Create Work Order | Transactions > Manufacturing > Enter Work Orders |\n`;
    }
    if (answers['rtn.customerReturns.useRMA']) {
      doc += `| Create Return Authorization | Transactions > Sales > Enter Return Authorizations |\n`;
    }
    doc += `| Run a Report | Reports > [Module] > [Report Name] |\n`;
    doc += `| Global Search | Search bar at the top-right of any page |\n\n`;
  } else {
    // Non-NetSuite branch. Detailed step-by-step training is still a
    // per-adaptor follow-up (each platform has its own menu vocabulary)
    // so we don't emit hardcoded NetSuite menu paths here. What we DO
    // emit, schema-driven, is a "Wizard Configuration Summary" that
    // surfaces every flow the consultant captured during discovery —
    // grouping by flow + section, listing each populated question
    // with its formatted answer. This gives the consultant a real
    // training reference (what was decided per area) instead of a
    // bare "training will follow" placeholder.
    doc += `### How to Use This Manual\n\n`;
    doc += `Detailed step-by-step ${adaptor.name} training will be issued separately as part of the platform-specific configuration plan that accompanies this engagement. `;
    doc += `That document includes role-specific menu paths, transaction screens, and the day-to-day flows your team will perform in ${adaptor.name}.\n\n`;
    doc += `The Wizard Configuration Summary below captures the discovery decisions that drive every training module. Use it as a reference when running role-based training sessions.\n\n`;
    doc += `---\n\n`;

    doc += `## Wizard Configuration Summary\n\n`;
    let any = false;
    for (const flow of adaptor.flows ?? []) {
      const renderedSections = flow.sections
        .map((s) => ({
          section: s,
          answered: s.questions.filter((q) => {
            const v = answers[q.id];
            return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
          }),
        }))
        .filter((x) => x.answered.length > 0);
      if (renderedSections.length === 0) continue;
      any = true;
      doc += `### ${flow.label}\n\n`;
      if (flow.description) doc += `_${flow.description}_\n\n`;
      for (const { section, answered } of renderedSections) {
        doc += `**${section.label}**\n\n`;
        for (const q of answered) {
          doc += `- ${q.label}: **${fmt(q, answers[q.id])}**\n`;
        }
        doc += `\n`;
      }
    }
    if (!any) {
      doc += `_No wizard answers have been captured yet. Run the discovery wizard before scheduling training._\n\n`;
    }
    doc += `---\n\n`;
  }

  doc += `## Training Sign-off\n\n`;
  doc += `| Participant Name | Role | Date Trained | Trainer Initials |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| | | | |\n| | | | |\n| | | | |\n\n`;

  return doc;
}

export function generateTrainingManualHtml(data: TrainingManualData): string {
  const modules = buildModules(data.answers);
  const content = md.render(generateTrainingManual(data));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Manual — ${data.clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 960px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #065f46 0%, #059669 100%); color: white; padding: 44px 48px 32px; border-radius: 20px; margin-bottom: 40px; }
    .header-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; opacity: 0.65; text-transform: uppercase; margin-bottom: 12px; }
    .header h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .sub { opacity: 0.8; font-size: 15px; margin-bottom: 22px; }
    .badges { display: flex; gap: 10px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 5px 14px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 44px 0 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 16px; font-weight: 700; color: #065f46; margin: 32px 0 12px; background: #f0fdf4; padding: 10px 16px; border-radius: 8px; border-left: 4px solid #22c55e; }
    h4 { font-size: 13px; font-weight: 600; color: #475569; margin: 20px 0 8px; }
    p, li { color: #475569; line-height: 1.75; font-size: 14px; margin-bottom: 8px; }
    ul, ol { padding-left: 24px; margin-bottom: 14px; }
    blockquote { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 10px 16px; border-radius: 0 8px 8px 0; margin: 12px 0; font-size: 13px; color: #1e40af; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 40px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
    thead { background: #065f46; color: white; }
    thead th { padding: 11px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:hover { background: #fafbfc; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.6; }
    tbody td:first-child { font-weight: 700; color: #065f46; white-space: nowrap; }
    code { background: #f1f5f9; padding: 2px 8px; border-radius: 5px; font-size: 11px; color: #0f172a; font-family: 'Courier New', monospace; }
    strong { color: #0f172a; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-badge">${data.adaptor.name} Implementation</div>
      <h1>Training Manual</h1>
      <div class="sub">${data.clientName}</div>
      <div class="badges">
        <span class="badge">📚 ${modules.length} Modules</span>
        <span class="badge">📅 ${new Date().toLocaleDateString()}</span>
        <span class="badge">⚡ Role-Based</span>
      </div>
    </div>
    ${content}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()} — For Training Use Only</div>
  </div>
</body>
</html>`;
}
