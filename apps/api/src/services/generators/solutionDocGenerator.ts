import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export interface SolutionDocData {
  clientName: string;
  license: { edition: string; modules: string[] };
  answers: Record<string, any>;
  conflicts: any[];
  comments?: any[];
  images?: any[];
  aiAdvice?: any[];
}

export function generateSolutionDoc(data: SolutionDocData): string {
  const { clientName, license, answers, conflicts } = data;
  const now = new Date().toLocaleDateString();
  const blocks = conflicts.filter(c => c.severity === 'BLOCK');
  const warnings = conflicts.filter(c => c.severity === 'WARN');

  // ── Helpers ────────────────────────────────────────────────────────────────
  const yn = (key: string) => answers[key] === true ? 'Yes' : answers[key] === false ? 'No' : '—';
  const val = (key: string, fallback = '—') => answers[key] ?? fallback;
  const hasFlow = (prefix: string) => Object.keys(answers).some(k => k.startsWith(prefix));

  const appendRichContent = (prefix: string) => {
    let out = '';
    const flowComments = data.comments?.filter(c => c.sectionKey.startsWith(prefix));
    const flowImages = data.images?.filter(img => img.sectionKey.startsWith(prefix));
    const flowAdvice = data.aiAdvice?.filter(a => a.sectionKey.startsWith(prefix) && a.advice);

    if (flowComments?.length || flowImages?.length || flowAdvice?.length) {
      out += `#### Design Notes & AI Recommendations\n\n`;
      
      if (flowComments?.length) {
        out += `**Consultant Notes:**\n`;
        flowComments.forEach(c => out += `> ${c.text.replace(/\n/g, '\n> ')}\n\n`);
      }

      if (flowAdvice?.length) {
        out += `**Configuration & Best Practices:**\n`;
        flowAdvice.forEach(a => {
          if (a.advice.suggestions?.length) {
            a.advice.suggestions.forEach((s: any) => out += `- **${s.title}**: ${s.description}\n`);
          }
        });
        out += `\n`;
      }

      if (flowImages?.length) {
        out += `**Attachments:**\n\n`;
        flowImages.forEach(img => out += `![${img.originalName}](/uploads/${img.engagementId}/${img.filename})\n\n`);
      }
    }
    return out;
  };

  let doc = '';

  // ── SECTION 1: Document Control ────────────────────────────────────────────
  doc += `# NetSuite Solution Design Document\n\n`;
  doc += `## Document Control\n\n`;
  doc += `| Field | Detail |\n| :--- | :--- |\n`;
  doc += `| **Client** | ${clientName} |\n`;
  doc += `| **Document Status** | Draft |\n`;
  doc += `| **Prepared By** | Ofoq NetSuite Accelerator |\n`;
  doc += `| **Date** | ${now} |\n`;
  doc += `| **License Edition** | ${license.edition.replace('_', ' ')} |\n`;
  doc += `| **Modules Provisioned** | ${license.modules.join(', ') || '—'} |\n\n`;

  doc += `### Revision History\n\n`;
  doc += `| Version | Date | Author | Change Description |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| 1.0 | ${now} | Ofoq Accelerator | Initial auto-generated draft |\n\n`;

  doc += `---\n\n`;

  // ── SECTION 2: Project Overview ─────────────────────────────────────────────
  doc += `## 1. Project Overview\n\n`;
  doc += `### 1.1 Background\n\n`;
  doc += `This Solution Design Document (SDD) defines the agreed configuration of NetSuite for **${clientName}**. `;
  doc += `It serves as the single source of truth between the implementation team and the client, covering functional design decisions, `;
  doc += `system behaviour, and technical specifications for all in-scope workstreams.\n\n`;

  doc += `### 1.2 Scope of Implementation\n\n`;
  const activeFlows: string[] = [];
  if (hasFlow('r2r.')) activeFlows.push('Record to Report (R2R)');
  if (hasFlow('p2p.')) activeFlows.push('Procure to Pay (P2P)');
  if (hasFlow('o2c.')) activeFlows.push('Order to Cash (O2C)');
  if (hasFlow('mfg.')) activeFlows.push('Manufacturing (MFG)');
  if (hasFlow('rtn.')) activeFlows.push('Returns Management (RTN)');

  doc += activeFlows.map(f => `- ${f}`).join('\n');
  doc += `\n\n`;

  doc += `### 1.3 Assumptions & Constraints\n\n`;
  doc += `- All configuration is based on answers captured during the discovery workshop.\n`;
  doc += `- NetSuite ${license.edition.replace('_', ' ')} edition is confirmed.\n`;
  doc += `- Sandbox availability is assumed prior to configuration start.\n`;
  if (blocks.length > 0) doc += `- **${blocks.length} blocking configuration issue(s) remain open** — see Section 7.\n`;
  doc += `\n---\n\n`;

  // ── SECTION 3: Organisational Setup ────────────────────────────────────────
  doc += `## 2. Organisational & Account Setup\n\n`;
  doc += `### 2.1 Entity Structure\n\n`;
  doc += `| Setting | Configuration |\n| :--- | :--- |\n`;
  doc += `| Multi-Entity / OneWorld | ${yn('r2r.entities.multiEntity')} |\n`;
  doc += `| Multi-Currency | ${yn('r2r.currencies.isMultiCurrency')} |\n`;
  doc += `| Base Currency | ${val('r2r.currencies.baseCurrency')} |\n`;
  doc += `| Fiscal Year Start | ${val('r2r.accountingPeriods.fiscalYearStart')} |\n`;
  doc += `| Accounting Basis | ${answers['r2r.accountingPeriods.cashBased'] === true ? 'Cash' : 'Accrual'} |\n\n`;

  doc += `### 2.2 Segmentation\n\n`;
  doc += `| Dimension | Enabled |\n| :--- | :--- |\n`;
  doc += `| Departments | ${yn('r2r.segmentation.useDepartments')} |\n`;
  doc += `| Classes | ${yn('r2r.segmentation.useClasses')} |\n`;
  doc += `| Locations | ${yn('r2r.segmentation.useLocations')} |\n\n`;
  doc += `---\n\n`;

  // ── SECTION 4: Workstream Designs ───────────────────────────────────────────
  doc += `## 3. Workstream Configuration Design\n\n`;

  // R2R
  if (hasFlow('r2r.')) {
    doc += `### 3.1 Record to Report (R2R)\n\n`;
    doc += `#### Bank & Treasury\n`;
    doc += `- Bank Account Count: **${val('r2r.bankTransactions.bankAccountCount')}**\n`;
    doc += `- Auto Exchange Rate Updates: **${yn('r2r.currencies.autoExchangeRateUpdate')}**\n`;
    doc += `- Intercompany Journal Entries: **${yn('r2r.journalEntries.intercompanyJE')}**\n\n`;
    doc += `#### Period Close\n`;
    doc += `- Hard Period Close Enforced: **${yn('r2r.fiscalClose.hardClose')}**\n\n`;
    doc += `#### Reporting\n`;
    doc += `- Revenue Recognition: **${yn('r2r.reporting.revenueRecognition')}**\n\n`;
    doc += appendRichContent('r2r.');
  }

  // P2P
  if (hasFlow('p2p.')) {
    doc += `### 3.2 Procure to Pay (P2P)\n\n`;
    doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
    doc += `| Formal Purchase Orders | ${yn('p2p.purchasing.usePurchaseOrders')} |\n`;
    doc += `| PO Approval Required | ${yn('p2p.purchasing.poApprovalRequired')} |\n`;
    doc += `| Budget Check on POs | ${yn('p2p.purchasing.budgetCheck')} |\n`;
    doc += `| Formal Receiving | ${yn('p2p.receiving.formalReceiving')} |\n`;
    doc += `| 3-Way Matching | ${yn('p2p.receiving.threeWayMatch')} |\n`;
    doc += `| Bill Approval Required | ${yn('p2p.bills.billApprovalRequired')} |\n`;
    doc += `| Employee Expense Claims | ${yn('p2p.expenses.employeeExpenses')} |\n`;
    doc += `| Bank File Export | ${yn('p2p.payments.bankFileExport')} |\n\n`;
    doc += appendRichContent('p2p.');
  }

  // O2C
  if (hasFlow('o2c.')) {
    doc += `### 3.3 Order to Cash (O2C)\n\n`;
    doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
    doc += `| Customer Credit Limits | ${yn('o2c.customers.creditLimits')} |\n`;
    doc += `| Foreign Currency Pricing | ${yn('o2c.pricing.foreignCurrencyPricing')} |\n`;
    doc += `| SO Approval Required | ${yn('o2c.salesOrders.soApprovalRequired')} |\n`;
    doc += `| Pick-Pack-Ship | ${yn('o2c.fulfillment.pickPackShip')} |\n`;
    doc += `| Multi-Location Fulfillment | ${yn('o2c.fulfillment.multipleLocations')} |\n`;
    doc += `| Revenue Recognition | ${yn('o2c.invoicing.revenueRecognition')} |\n`;
    doc += `| Dunning Letters | ${yn('o2c.collections.dunningLetters')} |\n\n`;
    doc += appendRichContent('o2c.');
  }

  // MFG
  if (hasFlow('mfg.')) {
    doc += `### 3.4 Manufacturing (MFG)\n\n`;
    doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
    doc += `| Production Flow | ${val('mfg.productionFlow.type').replace('_', ' ')} |\n`;
    doc += `| Labor/Machine Cost Tracking | ${yn('mfg.productionFlow.trackLabor')} |\n`;
    doc += `| Multi-BOM | ${yn('mfg.bom.multiBom')} |\n`;
    doc += `| Phantom Assemblies | ${yn('mfg.bom.usePhantoms')} |\n`;
    doc += `| Outsourced Manufacturing | ${yn('mfg.outsourced.useOutsourced')} |\n`;
    doc += `| Demand Planning | ${yn('mfg.demand.useDemandPlanning')} |\n\n`;
    doc += appendRichContent('mfg.');
  }

  // RTN
  if (hasFlow('rtn.')) {
    doc += `### 3.5 Returns Management (RTN)\n\n`;
    doc += `| Configuration Point | Setting |\n| :--- | :--- |\n`;
    doc += `| Customer RMA Required | ${yn('rtn.customerReturns.useRMA')} |\n`;
    doc += `| Refund Policy | ${val('rtn.customerReturns.refundPolicy', '—').replace('_', ' ')} |\n`;
    doc += `| Vendor Return Authorization | ${yn('rtn.vendorReturns.useVendorRMA')} |\n`;
    doc += `| Quality Inspection Required | ${yn('rtn.processing.inspectionRequired')} |\n`;
    doc += `| Restocking Fees | ${yn('rtn.processing.restockingFees')} |\n\n`;
    if (answers['rtn.processing.restockingFees'] === true) {
      doc += `> **Restocking Fee Rate:** ${val('rtn.processing.feePercentage', 'TBD')}%\n\n`;
    }
    doc += appendRichContent('rtn.');
  }

  doc += `---\n\n`;

  // ── SECTION 5: Technical Specifications ─────────────────────────────────────
  doc += `## 4. Technical Specifications\n\n`;
  doc += `### 4.1 Custom Objects (SDF)\n\n`;
  doc += `The following custom records and fields will be generated as NetSuite SDF XML objects:\n\n`;
  doc += `| Object Type | Record ID | Purpose |\n| :--- | :--- | :--- |\n`;
  if (answers['mfg.productionFlow.type'] === 'WIP_ROUTINGS') {
    doc += `| Custom Record | customrecord_nsix_wip_log | WIP Production Log |\n`;
  }
  doc += `| Custom Form | Standard per workstream | To be defined during build phase |\n\n`;

  doc += `### 4.2 SuiteScript Customisations\n\n`;
  doc += `| Script Type | Trigger | Business Purpose |\n| :--- | :--- | :--- |\n`;
  doc += `| User Event | Before Submit | Validation and auto-population of standard fields |\n`;
  if (answers['p2p.purchasing.poApprovalRequired'] === true) {
    doc += `| Workflow | PO Approval | Route PO to approval based on threshold rules |\n`;
  }
  if (answers['o2c.salesOrders.soApprovalRequired'] === true) {
    doc += `| Workflow | SO Approval | Route Sales Orders to approval based on value or type |\n`;
  }
  doc += `\n---\n\n`;

  // ── SECTION 6: Roles & Permissions ──────────────────────────────────────────
  doc += `## 5. User Roles & Access\n\n`;
  doc += `| Role | Functional Area | Key Permissions |\n| :--- | :--- | :--- |\n`;
  doc += `| Finance Manager | R2R, P2P | Period close, journal entries, AP payments |\n`;
  doc += `| Procurement Manager | P2P | PO approval, vendor management |\n`;
  doc += `| Sales Manager | O2C | SO approval, pricing, credit management |\n`;
  if (hasFlow('mfg.')) doc += `| Production Manager | MFG | Work orders, BOM management, demand planning |\n`;
  if (hasFlow('rtn.')) doc += `| Warehouse Manager | RTN | RMA processing, returns inspection |\n`;
  doc += `| System Administrator | All | Full access for configuration and support |\n\n`;
  doc += `---\n\n`;

  // ── SECTION 7: Risks & Open Items ───────────────────────────────────────────
  doc += `## 6. Risks, Conflicts & Open Items\n\n`;
  if (blocks.length === 0 && warnings.length === 0) {
    doc += `> ✅ No implementation risks or conflicts detected at this time.\n\n`;
  } else {
    doc += `| Ref | Severity | Description | Resolution |\n| :--- | :--- | :--- | :--- |\n`;
    blocks.forEach((b, i) => doc += `| C-${i + 1} | CRITICAL | ${b.message} | ${b.resolution} |\n`);
    warnings.forEach((w, i) => doc += `| W-${i + 1} | MODERATE | ${w.message} | ${w.resolution} |\n`);
    doc += `\n`;
  }
  doc += `---\n\n`;

  // ── SECTION 8: Go-Live Plan ──────────────────────────────────────────────────
  doc += `## 7. Deployment & Go-Live Plan\n\n`;
  doc += `| Phase | Activity | Owner | Status |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| Discovery | Business requirements captured | Ofoq Consultant | ✅ Complete |\n`;
  doc += `| Design | Solution document reviewed & signed | Client + Consultant | ☐ Pending |\n`;
  doc += `| Build | Configuration in Sandbox | Implementation Team | ☐ Not Started |\n`;
  doc += `| UAT | User acceptance testing | Client Business Users | ☐ Not Started |\n`;
  doc += `| Go-Live | Production cutover | All | ☐ Not Started |\n\n`;
  doc += `---\n\n`;

  // ── SECTION 9: Sign-off ──────────────────────────────────────────────────────
  doc += `## 8. Document Sign-off\n\n`;
  doc += `By signing below, the parties confirm that this Solution Design Document accurately reflects the agreed implementation scope:\n\n`;
  doc += `| Role | Name | Signature | Date |\n| :--- | :--- | :--- | :--- |\n`;
  doc += `| Client Project Sponsor | | | |\n`;
  doc += `| Client Finance Lead | | | |\n`;
  doc += `| Implementation Lead (Ofoq) | | | |\n`;
  doc += `| NetSuite Project Manager | | | |\n\n`;

  return doc;
}

export function generateSolutionDocHtml(data: SolutionDocData): string {
  const content = md.render(generateSolutionDoc(data));
  const activeFlows = [
    data.answers['r2r.entities.multiEntity'] !== undefined ? 'R2R' : null,
    data.answers['p2p.purchasing.usePurchaseOrders'] !== undefined ? 'P2P' : null,
    data.answers['o2c.customers.creditLimits'] !== undefined ? 'O2C' : null,
    data.answers['mfg.productionFlow.type'] !== undefined ? 'MFG' : null,
    data.answers['rtn.customerReturns.useRMA'] !== undefined ? 'RTN' : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solution Design Document — ${data.clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 900px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1d4ed8 100%); color: white; padding: 48px 48px 36px; border-radius: 20px; margin-bottom: 40px; }
    .header-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; opacity: 0.6; text-transform: uppercase; margin-bottom: 12px; }
    .header h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .sub { opacity: 0.75; font-size: 15px; margin-bottom: 24px; }
    .badges { display: flex; gap: 10px; flex-wrap: wrap; }
    .badge { background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); padding: 5px 14px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 44px 0 20px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #1e40af; margin: 28px 0 12px; }
    h4 { font-size: 13px; font-weight: 600; color: #475569; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    p { color: #475569; line-height: 1.75; margin-bottom: 14px; font-size: 14px; }
    blockquote { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: 14px; color: #166534; }
    ul, ol { padding-left: 24px; margin-bottom: 14px; }
    li { color: #475569; line-height: 1.75; font-size: 14px; margin-bottom: 4px; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 40px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
    thead { background: #0f172a; color: white; }
    thead th { padding: 11px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:hover { background: #fafbfc; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 600; color: #0f172a; }
    strong { color: #0f172a; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #1e40af; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-badge">NetSuite Implementation</div>
      <h1>Solution Design Document</h1>
      <div class="sub">${data.clientName}</div>
      <div class="badges">
        <span class="badge">📋 ${data.license.edition.replace('_', ' ')}</span>
        ${activeFlows.map(f => `<span class="badge">✓ ${f}</span>`).join('')}
        <span class="badge">📅 ${new Date().toLocaleDateString()}</span>
      </div>
    </div>
    ${content}
    <div class="footer">Generated by Ofoq NetSuite Accelerator &copy; ${new Date().getFullYear()} — Confidential</div>
  </div>
</body>
</html>`;
}
