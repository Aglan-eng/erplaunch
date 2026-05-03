/**
 * Performance Test Plan generator (Pack T — Test Artifacts, Component 5).
 *
 * Cross-platform — emits Documentation/Performance_Test_Plan.md (+ .html).
 *
 * Pulls testing.performanceBenchmarks (TEXTAREA — one '<operation>:
 * <target>' per line) and testing.loadProfile (TEXTAREA, free-form
 * concurrent-user description) into a ready-for-execution performance
 * plan with: objectives, load profile, benchmark table, test approach
 * (tooling differs per platform), pass criteria, and hypercare handoff.
 *
 * Tooling recommendation switches per adaptor:
 *   - NetSuite → JMeter / k6 / SuiteCloud Load Test
 *   - Odoo     → locust / k6 / Odoo's built-in performance harness
 *   - Other    → JMeter / k6 (vendor-neutral)
 *
 * Sources:
 *   - ISO/IEC 25010 quality model (performance efficiency).
 *   - JMeter / k6 / Locust framework documentation.
 *   - NetSuite SuiteCloud Performance Monitoring (Oracle Help).
 *   - Odoo developer documentation (testing).
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: true, typographer: true });

export interface PerformanceTestPlanGeneratorInput {
  clientName: string;
  /** TEXTAREA testing.performanceBenchmarks. */
  performanceBenchmarks?: string | null;
  /** TEXTAREA testing.loadProfile. */
  loadProfile?: string | null;
  /** "NetSuite" / "Odoo" / etc — flavours tooling + monitoring section. */
  adaptorName?: string;
}

export interface PerformanceTestPlanGeneratorOutput {
  markdown: string;
  html: string;
}

// ─── Benchmark parsing ───────────────────────────────────────────────────────

interface BenchmarkRow {
  operation: string;
  target: string;
}

function parseBenchmarks(raw: string): BenchmarkRow[] {
  const out: BenchmarkRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) {
      // Fall through: treat the whole line as operation with empty target.
      out.push({ operation: trimmed, target: '_[ASSIGN target]_' });
      continue;
    }
    const operation = trimmed.slice(0, colonIdx).trim();
    const target = trimmed.slice(colonIdx + 1).trim();
    out.push({ operation, target: target.length > 0 ? target : '_[ASSIGN target]_' });
  }
  return out;
}

// ─── Tooling per platform ────────────────────────────────────────────────────

interface ToolingProfile {
  toolList: string;
  monitoring: string;
}

function toolingFor(adaptorName: string): ToolingProfile {
  const lower = adaptorName.toLowerCase();
  if (lower === 'netsuite') {
    return {
      toolList:
        'JMeter or k6 against the SuiteScript REST API for synthetic load; SuiteCloud Performance Monitoring for in-tenant traces; Application Performance Management (APM) SuiteApp for production telemetry',
      monitoring:
        'NetSuite Application Performance Management (APM) + SuiteCloud Performance Monitoring for in-tenant traces. New Relic / Datadog APM on all integration endpoints. Alert thresholds: any production transaction > 2× the benchmark target for 5 consecutive minutes triggers a hypercare ticket.',
    };
  }
  if (lower === 'odoo') {
    return {
      toolList:
        'locust or k6 against Odoo XML-RPC / JSON-RPC endpoints for synthetic load; Odoo built-in profiler (`/web/odoo_test`) for individual ORM call traces; PG_STAT_STATEMENTS for database hotspot analysis',
      monitoring:
        'PG_STAT_STATEMENTS + custom Postgres dashboards (Grafana / pgBadger). Application logs to Datadog or self-hosted ELK. Alert thresholds: any production transaction > 2× the benchmark target for 5 consecutive minutes triggers a hypercare ticket.',
    };
  }
  return {
    toolList:
      'JMeter or k6 against the platform\'s REST/RPC API for synthetic load; vendor-native performance traces where available; database query telemetry for hotspot analysis',
    monitoring:
      'Vendor-native APM (where available) plus host-level metrics (CPU, memory, disk I/O). Alert thresholds: any production transaction > 2× the benchmark target for 5 consecutive minutes triggers a hypercare ticket.',
  };
}

// ─── Markdown emission ───────────────────────────────────────────────────────

function buildMarkdown(args: {
  clientName: string;
  adaptorName: string;
  benchmarks: BenchmarkRow[];
  loadProfile: string;
  tooling: ToolingProfile;
}): string {
  const platform = args.adaptorName.length > 0 ? args.adaptorName : 'ERP';
  const date = new Date().toLocaleDateString();

  const benchmarkRowsMd =
    args.benchmarks.length === 0
      ? '| _(no benchmarks captured)_ | _[ASSIGN]_ | _[ASSIGN]_ | ⏳ |'
      : args.benchmarks
          .map(
            (b) =>
              `| ${b.operation} | ${b.target} | UAT environment (full-copy sandbox) | ⏳ Pending |`,
          )
          .join('\n');

  const loadProfileBlock =
    args.loadProfile.trim().length > 0
      ? args.loadProfile
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0)
          .map((l) => `- ${l}`)
          .join('\n')
      : '_[ASSIGN concurrent-user load profile during discovery]_';

  return [
    `# Performance Test Plan — ${args.clientName}`,
    '',
    `**Platform:** ${platform}  `,
    `**Date:** ${date}  `,
    `**Prepared by:** ERPLaunch`,
    '',
    '## 1. Objectives',
    '',
    '1. Validate response times under expected production load.',
    '2. Identify performance bottlenecks before go-live.',
    '3. Establish baseline for hypercare monitoring.',
    '',
    '## 2. Load Profile',
    '',
    loadProfileBlock,
    '',
    '## 3. Performance Benchmarks',
    '',
    '| Operation | Target | Test Environment | Pass/Fail |',
    '|-----------|--------|------------------|-----------|',
    benchmarkRowsMd,
    '',
    '## 4. Test Approach',
    '',
    `1. **Tooling:** ${args.tooling.toolList}.`,
    '2. **Test Scenarios:** Mirror production transaction mix — read-heavy reporting + write-heavy posting in the ratios captured during discovery.',
    '3. **Test Data Volume:** Match production scale (entity count × transaction history × master-data record counts).',
    '4. **Concurrent Users:** Per the Load Profile section.',
    '5. **Test Duration:** 30-minute steady-state load + 8h soak test (memory leak detection).',
    '',
    '## 5. Pass Criteria',
    '',
    '- All benchmarks met under steady-state load.',
    '- No transactions error out under peak load (error rate < 0.1%).',
    '- Database CPU < 70% under peak.',
    '- Application server memory stable (no leaks observed over 8h soak).',
    '- 95th-percentile response times within 1.5× the benchmark target (no long tail).',
    '',
    '## 6. Hypercare Monitoring Handoff',
    '',
    `Performance baseline established by this plan transitions to ongoing monitoring on ${platform}: ${args.tooling.monitoring}`,
    '',
    '## 7. Sign-off',
    '',
    '- **Performance Lead:** ___________________________  Date: __________',
    '- **Client PM:** ___________________________________  Date: __________',
    '- **Consultant PM:** ______________________________  Date: __________',
    '',
    '_Generated by ERPLaunch — Pack T (Test Artifacts)._',
    '',
  ].join('\n');
}

// ─── HTML wrapper ────────────────────────────────────────────────────────────

function buildHtml(markdown: string, clientName: string, adaptorName: string): string {
  const body = md.render(markdown);
  const platform = adaptorName.length > 0 ? adaptorName : 'ERP';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Test Plan — ${clientName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
    .page { max-width: 960px; margin: 40px auto; padding: 0 24px 80px; }
    h1 { font-size: 28px; font-weight: 800; color: #0f172a; margin-bottom: 12px; }
    h2 { font-size: 18px; font-weight: 700; color: #0f172a; margin: 28px 0 12px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    p { color: #475569; line-height: 1.7; margin-bottom: 12px; font-size: 14px; }
    ol, ul { margin: 12px 0 16px 24px; }
    li { color: #475569; line-height: 1.7; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 16px; }
    thead { background: #1e40af; color: white; }
    thead th { padding: 12px 16px; text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody td { padding: 12px 16px; vertical-align: top; color: #334155; line-height: 1.5; }
    strong { color: #0f172a; }
    em { color: #64748b; }
    .footer { margin-top: 60px; text-align: center; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="page">
    <p style="font-size: 12px; color: #64748b; margin-bottom: 8px;">${platform} implementation</p>
    ${body}
    <div class="footer">Generated by ERPLaunch &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function generatePerformanceTestPlan(
  input: PerformanceTestPlanGeneratorInput,
): PerformanceTestPlanGeneratorOutput {
  const benchmarks = parseBenchmarks((input.performanceBenchmarks ?? '').toString());
  const loadProfile = (input.loadProfile ?? '').toString();
  const adaptorName = (input.adaptorName ?? '').toString();
  const tooling = toolingFor(adaptorName);

  const markdown = buildMarkdown({
    clientName: input.clientName,
    adaptorName,
    benchmarks,
    loadProfile,
    tooling,
  });

  const html = buildHtml(markdown, input.clientName, adaptorName);

  return { markdown, html };
}
