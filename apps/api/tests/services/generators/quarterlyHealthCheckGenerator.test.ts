/**
 * Phase 45.7 — pure tests for the quarterly health check generator.
 */
import { describe, it, expect } from 'vitest';
import {
  generateQuarterlyHealthCheck,
  type QuarterlyHealthCheckInput,
} from '../../../src/services/generators/quarterlyHealthCheckGenerator.js';

function baseInput(over: Partial<QuarterlyHealthCheckInput> = {}): QuarterlyHealthCheckInput {
  return {
    clientName: 'Acme Industries',
    adaptorId: 'netsuite',
    adaptorName: 'NetSuite',
    license: { edition: 'MID_MARKET', modules: ['ADVANCED_REVENUE'] },
    preparedAt: '2026-05-08',
    resolvedTickets: [
      { severity: 'CRITICAL', createdAt: '2026-04-01T00:00:00Z', firstResolvedAt: '2026-04-01T03:00:00Z', breached: false },
      { severity: 'HIGH', createdAt: '2026-04-10T00:00:00Z', firstResolvedAt: '2026-04-12T00:00:00Z', breached: true },
      { severity: 'MEDIUM', createdAt: '2026-04-15T00:00:00Z', firstResolvedAt: '2026-04-16T00:00:00Z', breached: false },
    ],
    openTickets: [
      { severity: 'HIGH', title: 'Outstanding GL mismatch', daysOpen: 18 },
      { severity: 'LOW', title: 'Cosmetic dashboard tweak', daysOpen: 3 },
    ],
    openIssues: [
      { title: 'Quarterly close docs out of date', priority: 'HIGH', owner: 'Alice' },
      { title: 'Critical reporting gap', priority: 'CRITICAL', owner: null },
    ],
    recentActivity: [
      { action: 'TICKET_OPENED', details: 'Issue with PO approvals', createdAt: '2026-05-01T10:00:00Z' },
      { action: 'STAGE_ADVANCED', details: 'CLOSEOUT → SLA_ACTIVE', createdAt: '2026-04-15T09:00:00Z' },
    ],
    ...over,
  };
}

describe('generateQuarterlyHealthCheck — file inventory', () => {
  it('emits the 5 canonical Documentation files', () => {
    const out = generateQuarterlyHealthCheck(baseInput());
    expect(out['Documentation/Engagement_Summary.md']).toBeDefined();
    expect(out['Documentation/SLA_Performance.md']).toBeDefined();
    expect(out['Documentation/Open_Issues.md']).toBeDefined();
    expect(out['Documentation/Recent_Activity.md']).toBeDefined();
    expect(out['Documentation/Recommended_Actions.md']).toBeDefined();
  });
});

describe('Engagement_Summary content', () => {
  it('mentions client + adaptor + edition + modules', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Engagement_Summary.md'];
    expect(md).toContain('Acme Industries');
    expect(md).toContain('NetSuite');
    expect(md).toContain('MID_MARKET');
    expect(md).toContain('ADVANCED_REVENUE');
  });
});

describe('SLA_Performance content', () => {
  it('reports the resolved/open ticket counts', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/SLA_Performance.md'];
    expect(md).toContain('Tickets resolved in period | 3');
    expect(md).toContain('Tickets currently open | 2');
  });

  it('computes the breach rate', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/SLA_Performance.md'];
    // 1 of 3 = 33.3%
    expect(md).toContain('33.3%');
  });

  it('includes a clean-quarter note when no breaches', () => {
    const md = generateQuarterlyHealthCheck(
      baseInput({
        resolvedTickets: [
          { severity: 'LOW', createdAt: '2026-04-01T00:00:00Z', firstResolvedAt: '2026-04-01T05:00:00Z', breached: false },
        ],
      }),
    )['Documentation/SLA_Performance.md'];
    expect(md).toContain('clean quarter');
  });

  it('counts resolved tickets by severity', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/SLA_Performance.md'];
    expect(md).toContain('| CRITICAL | 1 |');
    expect(md).toContain('| HIGH | 1 |');
    expect(md).toContain('| MEDIUM | 1 |');
  });
});

describe('Open_Issues content', () => {
  it('lists open issues + open tickets', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Open_Issues.md'];
    expect(md).toContain('Quarterly close docs out of date');
    expect(md).toContain('Critical reporting gap');
    expect(md).toContain('Outstanding GL mismatch');
    expect(md).toContain('18');
  });

  it('shows empty-state lines when nothing open', () => {
    const md = generateQuarterlyHealthCheck(
      baseInput({ openIssues: [], openTickets: [] }),
    )['Documentation/Open_Issues.md'];
    expect(md).toContain('No open issues');
    expect(md).toContain('No tickets currently open');
  });
});

describe('Recommended_Actions content', () => {
  it('flags SLA breaches', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Recommended_Actions.md'];
    expect(md).toContain('SLA breach');
  });

  it('flags long-open tickets (14+ days)', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Recommended_Actions.md'];
    expect(md).toContain('14+ days');
  });

  it('flags critical open issues', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Recommended_Actions.md'];
    expect(md).toContain('critical issue');
  });

  it('shows clean-quarter recommendation when nothing flagged', () => {
    const md = generateQuarterlyHealthCheck(
      baseInput({
        resolvedTickets: [
          { severity: 'LOW', createdAt: '2026-04-01T00:00:00Z', firstResolvedAt: '2026-04-01T05:00:00Z', breached: false },
        ],
        openTickets: [],
        openIssues: [],
      }),
    )['Documentation/Recommended_Actions.md'];
    expect(md).toContain('No outstanding risks');
  });
});

describe('Recent_Activity content', () => {
  it('lists each activity row in a table', () => {
    const md = generateQuarterlyHealthCheck(baseInput())['Documentation/Recent_Activity.md'];
    expect(md).toContain('TICKET_OPENED');
    expect(md).toContain('STAGE_ADVANCED');
    expect(md).toContain('2026-05-01');
  });

  it('caps at 30 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      action: 'NOOP',
      details: `entry ${i}`,
      createdAt: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    const md = generateQuarterlyHealthCheck(baseInput({ recentActivity: many }))[
      'Documentation/Recent_Activity.md'
    ];
    // Count "entry N" occurrences — should be 30
    const matches = md.match(/entry \d+/g) ?? [];
    expect(matches).toHaveLength(30);
  });
});
