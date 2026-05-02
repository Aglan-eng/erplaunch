import type { AdaptorContext } from './brdGenerator.js';

export interface ImplementationPlanData {
  clientName: string;
  /** Adaptor context — required so phase/role/assumption prose flexes
   *  per platform. Same shape as BRDData.adaptor. */
  adaptor: AdaptorContext;
  license: { edition: string; modules: string[] };
  answers: Record<string, any>;
  conflicts: any[];
}

export function generateImplementationPlanHtml(data: ImplementationPlanData): string {
  const { clientName, adaptor, license, answers, conflicts } = data;
  const now = new Date().toLocaleDateString();

  // Helpers
  // Schema-aware: walk the active adaptor's questions to find any
  // migration / opening-balance / multi-currency / multi-company /
  // integration triggers. Replaces the old check that only matched
  // NetSuite-style answer keys (r2r.bankTransactions.hasOpeningBalances,
  // r2r.currencies.isMultiCurrency) and silently skipped Phase 3 / 4
  // for every Odoo engagement. Falls back to the legacy hardcoded keys
  // when adaptor.flows is unavailable so the NetSuite path is preserved.
  const adaptorFlows = adaptor.flows ?? [];
  const matchAnsweredId = (predicate: (id: string) => boolean): boolean => {
    if (adaptorFlows.length === 0) return false;
    for (const flow of adaptorFlows) {
      for (const section of flow.sections) {
        for (const q of section.questions) {
          if (!predicate(q.id)) continue;
          const v = answers[q.id];
          if (v !== undefined && v !== null && v !== false && !(typeof v === 'string' && v.trim() === '')) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const hasDataMigration =
    // Schema match on any data-migration / opening-balance / import keyword
    matchAnsweredId((id) => /opening|migration|import|coa|chart/i.test(id)) ||
    // Legacy NetSuite-style hardcoded check (preserves NetSuite path)
    answers['r2r.bankTransactions.hasOpeningBalances'] === true ||
    Object.keys(answers).some(k => k.includes('import') || k.includes('migration'));

  const hasIntegration =
    // Schema match on any multi-currency / multi-company / integration
    // trigger across the active adaptor's questions
    matchAnsweredId((id) => /multiCurrency|multiCompany|reportingCurrency|integration/i.test(id)) ||
    // Legacy NetSuite-style hardcoded check
    answers['r2r.currencies.isMultiCurrency'] === true ||
    license.modules.includes('ADVANCED_INVENTORY');

  // Phase durations
  const phases: Array<{ name: string; description: string; duration: string; owner: string; show: boolean }> = [
    { name: 'Phase 1', description: 'Discovery & Scoping', duration: '1–2 weeks', owner: 'Project Lead', show: true },
    { name: 'Phase 2', description: `${adaptor.name} Configuration`, duration: `${2 + Math.max(0, (license.modules?.length ?? 1) - 1)} weeks`, owner: `${adaptor.name} Admin`, show: true },
    { name: 'Phase 3', description: 'Data Migration', duration: '1–2 weeks', owner: 'Data Analyst', show: hasDataMigration },
    { name: 'Phase 4', description: 'Integration Setup', duration: '1–3 weeks', owner: 'Integration Developer', show: hasIntegration },
    { name: 'Phase 5', description: 'UAT', duration: '1–2 weeks', owner: 'QA Lead / Client PM', show: true },
    { name: 'Phase 6', description: 'End-User Training', duration: '1 week', owner: 'Trainer', show: true },
    { name: 'Phase 7', description: 'Go-Live & Hypercare', duration: '1–2 weeks', owner: 'Project Lead', show: true },
  ];

  const visiblePhases = phases.filter(p => p.show);

  // Build milestones
  const milestones: Array<{ name: string; week: string; owner: string }> = [
    { name: 'Project Kickoff', week: 'Week 1', owner: 'Project Lead' },
    { name: 'Requirements Sign-off', week: 'End of Phase 1', owner: 'Client Lead' },
    { name: 'Configuration Complete', week: 'End of Phase 2', owner: `${adaptor.name} Admin` },
  ];

  if (hasDataMigration) {
    milestones.push({ name: 'Data Migration Complete', week: 'End of Phase 3', owner: 'Data Analyst' });
  }

  milestones.push({ name: 'UAT Sign-off', week: 'End of Phase 5', owner: 'QA Lead' });
  milestones.push({ name: 'Training Complete', week: 'End of Phase 6', owner: 'Trainer' });
  milestones.push({ name: 'Go-Live', week: 'End of Phase 7', owner: 'Project Lead' });

  // Resource plan
  const roles: Array<{ role: string; show: boolean }> = [
    { role: 'Implementation Lead', show: true },
    { role: `${adaptor.name} Administrator`, show: true },
    { role: 'Finance Subject Matter Expert', show: true },
    { role: 'Integration Developer', show: hasIntegration },
    { role: 'Manufacturing SME', show: license.modules?.includes('MANUFACTURING') ?? false },
    { role: 'End-User Trainer', show: true },
  ];

  const visibleRoles = roles.filter(r => r.show);

  // Risk summary
  const blockingRisks = conflicts.filter(c => c.severity === 'BLOCK');
  const warningRisks = conflicts.filter(c => c.severity === 'WARN');

  // Cutover Plan — closes the long-standing p4.cutover-references-in-plan
  // gap in the lifecycle harness. Reads adaptor-aware migration answers
  // when present (Odoo's Pack 7 migration flow asks these explicitly;
  // NetSuite's schema doesn't gather them today, so NS engagements get
  // TBD placeholders the consultant must fill in). Whether or not
  // answers are present, the section ALWAYS renders so the harness
  // sees "Cutover" in the file and the consultant sees the slot exists.
  //
  // Adaptor-aware prose: NetSuite engagements say "the NetSuite cutover",
  // Odoo engagements say "the Odoo cutover" — surfaced in the section
  // intro so the document reads as platform-specific guidance, not a
  // generic checklist. Custom adaptors get "the {adaptor.name} cutover".
  const cutoverStyleRaw =
    answers['odoo.migration.cutoverStyle'] ??
    answers['ns.migration.cutoverStyle'] ?? // future-proof: NS will get this when the migration flow ships
    null;
  const cutoverStyleLabel = ((): string => {
    if (typeof cutoverStyleRaw !== 'string' || cutoverStyleRaw.length === 0) return 'TBD';
    const map: Record<string, string> = {
      BIG_BANG: 'Big bang (single weekend / week — all modules + entities go live together)',
      PHASED_MODULE: 'Phased by module (Accounting first, then Inventory, then Sales, etc.)',
      PHASED_ENTITY: 'Phased by entity (one company at a time)',
      PARALLEL_RUN: 'Parallel run (legacy + new system run together for N weeks)',
    };
    return map[cutoverStyleRaw] ?? cutoverStyleRaw;
  })();
  const parallelRunDays =
    answers['odoo.migration.parallelRunDays'] ?? answers['ns.migration.parallelRunDays'] ?? null;
  const preFreezeDays =
    answers['odoo.migration.preFreezeDays'] ?? answers['ns.migration.preFreezeDays'] ?? null;
  const cutoverWindowHours =
    answers['odoo.migration.cutoverWindowHours'] ?? answers['ns.migration.cutoverWindowHours'] ?? null;
  const showParallelRunRow = cutoverStyleRaw === 'PARALLEL_RUN';
  const formatNumberOrTbd = (v: unknown, suffix: string): string => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return `${v} ${suffix}`;
    if (typeof v === 'string' && v.trim().length > 0 && !Number.isNaN(Number(v))) {
      const n = Number(v);
      if (n > 0) return `${n} ${suffix}`;
    }
    return 'TBD';
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Implementation Plan — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 900px; margin: 40px auto; padding: 0 24px 80px; }
    .header { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #1d4ed8 100%); color: white; padding: 48px 48px 36px; border-radius: 20px; margin-bottom: 40px; }
    .header-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.2em; opacity: 0.6; text-transform: uppercase; margin-bottom: 12px; }
    .header h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .sub { opacity: 0.75; font-size: 15px; margin-bottom: 24px; }
    h2 { font-size: 20px; font-weight: 800; color: #0f172a; margin: 36px 0 16px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    h3 { font-size: 15px; font-weight: 700; color: #1e40af; margin: 24px 0 12px; }
    p { color: #475569; line-height: 1.75; margin-bottom: 14px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.07); margin-bottom: 24px; }
    thead { background: #0f172a; color: white; }
    thead th { padding: 11px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:hover { background: #fafbfc; }
    tbody td { padding: 11px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    tbody td:first-child { font-weight: 600; color: #0f172a; }
    strong { color: #0f172a; }
    ul { padding-left: 24px; margin-bottom: 14px; }
    li { color: #475569; line-height: 1.75; font-size: 14px; margin-bottom: 8px; }
    .badge { background: rgba(13, 110, 253, 0.1); border: 1px solid rgba(13, 110, 253, 0.3); padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #0d6efd; display: inline-block; margin-right: 8px; margin-bottom: 4px; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 20px; }
    .total-row { background: #f8fafc; font-weight: 600; }
    .risk-block { background: #fee2e2; border-left: 4px solid #dc2626; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px; }
    .risk-warn { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px; }
    .risk-none { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px; }
    .risk-severity-critical { color: #dc2626; font-weight: 600; }
    .risk-severity-moderate { color: #f59e0b; font-weight: 600; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-badge">${adaptor.name} Implementation</div>
      <h1>Implementation Plan</h1>
      <div class="sub">${clientName}</div>
      <div style="margin-top: 20px;">
        <span class="badge">📋 ${adaptor.editionLabel}</span>
        <span class="badge">📅 ${now}</span>
      </div>
    </div>

    <!-- Project Overview -->
    <h2>Project Overview</h2>
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Client Name</td>
          <td>${clientName}</td>
        </tr>
        <tr>
          <td>Edition</td>
          <td>${adaptor.editionLabel}</td>
        </tr>
        <tr>
          <td>Modules</td>
          <td>${license.modules?.join(', ') || 'Standard'}</td>
        </tr>
        <tr>
          <td>Generated Date</td>
          <td>${now}</td>
        </tr>
      </tbody>
    </table>

    <!-- Workstreams in Scope — schema-driven from adaptor.flows -->
    ${(() => {
      const scopeFlows = adaptorFlows
        .map((flow) => {
          const answeredCount = flow.sections.reduce((sum, s) =>
            sum + s.questions.filter((q) => {
              const v = answers[q.id];
              return v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
            }).length, 0);
          return { flow, answeredCount };
        })
        .filter((x) => x.answeredCount > 0);
      if (scopeFlows.length === 0) return '';
      return `
    <h2>Workstreams in Scope</h2>
    <table>
      <thead><tr><th>Workstream</th><th>Discovery Coverage</th></tr></thead>
      <tbody>
        ${scopeFlows.map(({ flow, answeredCount }) => `
        <tr><td>${flow.label}</td><td>${answeredCount} discovery answer${answeredCount === 1 ? '' : 's'} captured</td></tr>
        `).join('')}
      </tbody>
    </table>`;
    })()}

    <!-- Phase Timeline -->
    <h2>Phase Timeline</h2>
    <table>
      <thead>
        <tr>
          <th>Phase</th>
          <th>Description</th>
          <th>Duration</th>
          <th>Owner</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${visiblePhases.map(p => `
        <tr>
          <td>${p.name}</td>
          <td>${p.description}</td>
          <td>${p.duration}</td>
          <td>${p.owner}</td>
          <td>☐ Not Started</td>
        </tr>
        `).join('')}
        <tr class="total-row">
          <td colspan="2">Estimated Total Duration</td>
          <td colspan="3">${2 + 2 + (hasDataMigration ? 1.5 : 0) + (hasIntegration ? 2 : 0) + 1.5 + 1 + 1.5} weeks (approx.)</td>
        </tr>
      </tbody>
    </table>

    <!-- Key Milestones -->
    <h2>Key Milestones Checklist</h2>
    <table>
      <thead>
        <tr>
          <th>Milestone</th>
          <th>Target Week / Phase</th>
          <th>Owner</th>
          <th>Done</th>
        </tr>
      </thead>
      <tbody>
        ${milestones.map(m => `
        <tr>
          <td>${m.name}</td>
          <td>${m.week}</td>
          <td>${m.owner}</td>
          <td style="text-align: center;">☐</td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- Resource Plan -->
    <h2>Resource Plan</h2>
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Functional Area</th>
          <th>Key Responsibilities</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Implementation Lead</td>
          <td>Overall</td>
          <td>Project governance, timeline, communication, risk management</td>
        </tr>
        <tr>
          <td>${adaptor.name} Administrator</td>
          <td>Configuration</td>
          <td>System setup, customization, security, user access</td>
        </tr>
        <tr>
          <td>Finance Subject Matter Expert</td>
          <td>Finance</td>
          <td>GL setup, period close, reporting requirements, compliance</td>
        </tr>
        ${hasIntegration ? `
        <tr>
          <td>Integration Developer</td>
          <td>Integration</td>
          <td>API integrations, middleware, data sync, external systems</td>
        </tr>
        ` : ''}
        ${license.modules?.includes('MANUFACTURING') ? `
        <tr>
          <td>Manufacturing SME</td>
          <td>Manufacturing</td>
          <td>BOM design, work order setup, demand planning</td>
        </tr>
        ` : ''}
        <tr>
          <td>End-User Trainer</td>
          <td>Training</td>
          <td>Training design, delivery, documentation, user enablement</td>
        </tr>
      </tbody>
    </table>

    <!-- Risk Summary -->
    <h2>Risk Summary</h2>
    ${blockingRisks.length === 0 && warningRisks.length === 0 ? `
    <div class="risk-none">
      <strong>Status: No Critical Risks Identified</strong>
      <p style="margin-top: 8px;">The current configuration has passed all compatibility checks.</p>
    </div>
    ` : `
    ${blockingRisks.length > 0 ? `
    <h3 style="color: #dc2626;">Critical Issues (${blockingRisks.length})</h3>
    ${blockingRisks.map((r, i) => `
    <div class="risk-block">
      <p><span class="risk-severity-critical">CRITICAL</span> — ${r.message}</p>
      <p style="margin-top: 6px; font-size: 13px; color: #7f1d1d;"><strong>Mitigation:</strong> ${r.resolution}</p>
    </div>
    `).join('')}
    ` : ''}
    ${warningRisks.length > 0 ? `
    <h3 style="color: #f59e0b;">Warnings (${warningRisks.length})</h3>
    ${warningRisks.map((r, i) => `
    <div class="risk-warn">
      <p><span class="risk-severity-moderate">MODERATE</span> — ${r.message}</p>
      <p style="margin-top: 6px; font-size: 13px; color: #92400e;"><strong>Mitigation:</strong> ${r.resolution}</p>
    </div>
    `).join('')}
    ` : ''}
    `}

    <!-- Cutover Plan — adaptor-aware, reads Pack 7 migration answers when present -->
    <h2>Cutover Plan</h2>
    <p>This section captures the high-level shape of the ${adaptor.name} cutover.
      ${hasDataMigration
        ? `Detailed dependencies, freeze windows, and go/no-go criteria are tracked alongside the data-migration workstream and revisited at each migration dry-run.`
        : `Detailed dependencies, freeze windows, and go/no-go criteria will be developed during build and tracked through hypercare.`}
    </p>
    <table>
      <thead>
        <tr>
          <th>Cutover dimension</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Cutover style</td>
          <td>${cutoverStyleLabel}</td>
        </tr>
        <tr>
          <td>Pre-cutover freeze period</td>
          <td>${formatNumberOrTbd(preFreezeDays, 'day(s)')}</td>
        </tr>
        <tr>
          <td>Cutover execution window</td>
          <td>${formatNumberOrTbd(cutoverWindowHours, 'hour(s)')}</td>
        </tr>
        ${showParallelRunRow ? `
        <tr>
          <td>Parallel-run duration</td>
          <td>${formatNumberOrTbd(parallelRunDays, 'day(s)')}</td>
        </tr>
        ` : ''}
        <tr>
          <td>Cutover dependencies</td>
          <td>${blockingRisks.length + warningRisks.length > 0
            ? `${blockingRisks.length + warningRisks.length} open risk(s) tracked in the Risk Summary above must be closed before cutover.`
            : 'None recorded — confirm during cutover dress-rehearsal.'}</td>
        </tr>
        <tr>
          <td>Go/no-go criteria</td>
          <td>TBD per workstream — finalised during cutover dress-rehearsal and signed off by ${adaptor.name} Admin + Client Lead.</td>
        </tr>
      </tbody>
    </table>

    <!-- Standard Assumptions -->
    <h2>Standard Assumptions</h2>
    <ul>
      <li>Client will provide a dedicated project manager and subject matter experts</li>
      <li>All data migration files will be provided in agreed CSV format</li>
      <li>UAT will be completed within the agreed timeframe</li>
      <li>Scope changes after requirements sign-off are subject to change control</li>
      <li>Go-live date is contingent on successful UAT sign-off</li>
      <li>The ${adaptor.name} account will be provisioned and accessible before configuration begins</li>
    </ul>

    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()} — Confidential</div>
  </div>
</body>
</html>`;
}
