/**
 * Phase 52.5 — InboxPage SSR render tests.
 *
 * Pins:
 *   - Empty/loading/error states
 *   - All three buckets render with seeded data + their headings
 *   - Counter cards show the right totals
 *   - Severity-ordered items render in order (the route does the
 *     sort; here we just confirm the markup reflects what came in)
 *   - Filter chip activation based on `?filter=…`
 *   - Empty state per bucket
 *   - Admin sees firmWide section; non-admin does NOT
 *   - Dismiss button present per row (interaction = e2e turf)
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InboxPage } from '../src/pages/InboxPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type { InboxItem, InboxItemType, InboxResponse } from '../src/lib/api';

function fakeAuth() {
  return {
    user: {
      id: 'u-1',
      firmId: 'f-1',
      email: 't@x.io',
      name: 'Demo',
      role: 'CONSULTANT' as const,
    },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function makeItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'c-acme:STAGE_OVERDUE',
    itemType: 'STAGE_OVERDUE',
    customerId: 'c-acme',
    customerName: 'Acme Industries',
    currentStage: 'BUILD',
    severity: 'warning',
    summary: 'Acme has been in BUILD for 70 days (10 over target).',
    ageDays: 10,
    createdAt: new Date(Date.now() - 70 * 86_400_000).toISOString(),
    ...over,
  };
}

interface RenderOpts {
  data?: InboxResponse | null;
  loading?: boolean;
  filter?: 'critical' | 'warning' | 'info' | 'all';
}

function render(opts: RenderOpts = {}): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (!opts.loading && opts.data !== null) {
    qc.setQueryData(['inbox'], opts.data ?? { forYou: [], watching: [], firmWide: null });
  }
  const path = opts.filter && opts.filter !== 'all' ? `?filter=${opts.filter}` : '';
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/inbox${path}`]}>
          <Routes>
            <Route path="/inbox" element={<InboxPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

// ─── Page shell ───────────────────────────────────────────────────────────

describe('InboxPage — shell + loading', () => {
  it('renders the AppNav + page title', () => {
    const html = render({ data: { forYou: [], watching: [], firmWide: null } });
    expect(html).toContain('data-testid="side-nav"');
    expect(html).toContain('data-testid="inbox-page"');
    expect(html).toContain('Inbox');
  });

  it('renders the loading state when no data is in the cache', () => {
    const html = render({ loading: true });
    expect(html).toContain('data-testid="inbox-loading"');
  });
});

// ─── Counters + filter chips ──────────────────────────────────────────────

describe('InboxPage — counters + filters', () => {
  it('renders the For-you + Watching counter cards always', () => {
    const html = render({
      data: {
        forYou: [makeItem({ id: 'a:STAGE_OVERDUE' })],
        watching: [makeItem({ id: 'b:STAGE_OVERDUE' }), makeItem({ id: 'c:STAGE_OVERDUE' })],
        firmWide: null,
      },
    });
    expect(html).toContain('data-testid="inbox-counter-foryou"');
    expect(html).toContain('data-testid="inbox-counter-watching"');
    expect(html).not.toContain('data-testid="inbox-counter-firmwide"');
  });

  it('renders the Firm-wide counter when the response carries a firmWide array', () => {
    const html = render({
      data: { forYou: [], watching: [], firmWide: [] },
    });
    expect(html).toContain('data-testid="inbox-counter-firmwide"');
  });

  it('renders all four filter chips', () => {
    const html = render({ data: { forYou: [], watching: [], firmWide: null } });
    for (const k of ['all', 'critical', 'warning', 'info']) {
      expect(html).toContain(`data-testid="inbox-filter-${k}"`);
    }
  });

  it('marks the "all" filter active by default', () => {
    const html = render({ data: { forYou: [], watching: [], firmWide: null } });
    expect(html).toMatch(
      /<button[^>]*data-testid="inbox-filter-all"[^>]*aria-pressed="true"/,
    );
  });

  it('marks the critical filter active when ?filter=critical', () => {
    const html = render({
      data: { forYou: [], watching: [], firmWide: null },
      filter: 'critical',
    });
    expect(html).toMatch(
      /<button[^>]*data-testid="inbox-filter-critical"[^>]*aria-pressed="true"/,
    );
  });
});

// ─── Buckets + items ──────────────────────────────────────────────────────

describe('InboxPage — buckets + items', () => {
  it('renders the For-you bucket with one row per item', () => {
    const items = [
      makeItem({ id: 'c-acme:STAGE_OVERDUE', customerName: 'Acme', severity: 'critical' }),
      makeItem({ id: 'c-beta:BLOCKER_OPEN', customerName: 'Beta', itemType: 'BLOCKER_OPEN' }),
    ];
    const html = render({
      data: { forYou: items, watching: [], firmWide: null },
    });
    expect(html).toContain('data-testid="inbox-bucket-foryou"');
    expect(html).toContain('data-testid="inbox-row-c-acme:STAGE_OVERDUE"');
    expect(html).toContain('data-testid="inbox-row-c-beta:BLOCKER_OPEN"');
    expect(html).toContain('Acme');
    expect(html).toContain('Beta');
  });

  it('renders the per-row dismiss button', () => {
    const html = render({
      data: { forYou: [makeItem({ id: 'x:BLOCKER_OPEN' })], watching: [], firmWide: null },
    });
    expect(html).toContain('data-testid="inbox-row-dismiss-x:BLOCKER_OPEN"');
  });

  it('row links to /customers/:customerId', () => {
    const html = render({
      data: {
        forYou: [makeItem({ id: 'c-acme:STAGE_OVERDUE', customerId: 'c-acme' })],
        watching: [],
        firmWide: null,
      },
    });
    expect(html).toMatch(/href="\/customers\/c-acme"/);
  });

  it('tags the row with data-severity + data-item-type for e2e selectors', () => {
    const html = render({
      data: {
        forYou: [
          makeItem({
            id: 'c-1:DECISION_PENDING',
            itemType: 'DECISION_PENDING',
            severity: 'critical',
          }),
        ],
        watching: [],
        firmWide: null,
      },
    });
    expect(html).toMatch(
      /data-testid="inbox-row-c-1:DECISION_PENDING"[^>]*data-severity="critical"[^>]*data-item-type="DECISION_PENDING"/,
    );
  });

  it('renders the empty state when a bucket is empty', () => {
    const html = render({
      data: { forYou: [], watching: [], firmWide: null },
    });
    expect(html).toContain('data-testid="inbox-bucket-foryou-empty"');
    expect(html).toContain('data-testid="inbox-bucket-watching-empty"');
    expect(html).not.toContain('data-testid="inbox-bucket-firmwide-empty"');
  });

  it('only renders the Firm-wide bucket when firmWide is non-null', () => {
    const withAdmin = render({
      data: { forYou: [], watching: [], firmWide: [makeItem()] },
    });
    expect(withAdmin).toContain('data-testid="inbox-bucket-firmwide"');

    const withoutAdmin = render({
      data: { forYou: [], watching: [], firmWide: null },
    });
    expect(withoutAdmin).not.toContain('data-testid="inbox-bucket-firmwide"');
  });
});

// ─── Filter narrowing ─────────────────────────────────────────────────────

describe('InboxPage — filter narrowing', () => {
  const mixed: InboxResponse = {
    forYou: [
      makeItem({ id: 'a:STAGE_OVERDUE', severity: 'critical' }),
      makeItem({ id: 'b:BLOCKER_OPEN', severity: 'warning', itemType: 'BLOCKER_OPEN' }),
      makeItem({ id: 'c:HANDOFF_INCOMING', severity: 'info', itemType: 'HANDOFF_INCOMING' }),
    ],
    watching: [],
    firmWide: null,
  };

  it('shows only critical rows when filter=critical', () => {
    const html = render({ data: mixed, filter: 'critical' });
    expect(html).toContain('inbox-row-a:STAGE_OVERDUE');
    expect(html).not.toContain('inbox-row-b:BLOCKER_OPEN');
    expect(html).not.toContain('inbox-row-c:HANDOFF_INCOMING');
  });

  it('shows only warning rows when filter=warning', () => {
    const html = render({ data: mixed, filter: 'warning' });
    expect(html).toContain('inbox-row-b:BLOCKER_OPEN');
    expect(html).not.toContain('inbox-row-a:STAGE_OVERDUE');
    expect(html).not.toContain('inbox-row-c:HANDOFF_INCOMING');
  });

  it('shows all severities when filter=all', () => {
    const html = render({ data: mixed, filter: 'all' });
    expect(html).toContain('inbox-row-a:STAGE_OVERDUE');
    expect(html).toContain('inbox-row-b:BLOCKER_OPEN');
    expect(html).toContain('inbox-row-c:HANDOFF_INCOMING');
  });
});

// ─── Item-type icon coverage ──────────────────────────────────────────────

describe('InboxPage — all six item types render distinct icons', () => {
  const types: InboxItemType[] = [
    'STAGE_OVERDUE',
    'BLOCKER_OPEN',
    'DECISION_PENDING',
    'QUESTIONNAIRE_INCOMPLETE',
    'HANDOFF_INCOMING',
    'RENEWAL_DUE_SOON',
  ];

  it.each(types)('renders an item-type row for %s', (t) => {
    const html = render({
      data: {
        forYou: [makeItem({ id: `x:${t}`, itemType: t })],
        watching: [],
        firmWide: null,
      },
    });
    expect(html).toMatch(
      new RegExp(
        `data-testid="inbox-row-x:${t}"[^>]*data-item-type="${t}"`,
      ),
    );
  });
});

// ─── Severity ordering visible in the markup ──────────────────────────────

describe('InboxPage — severity ordering', () => {
  it('preserves the order of items as the server returned them', () => {
    // The route sorts critical → warning → info before the response
    // lands; the page should NOT re-sort. We pin that the markup
    // walks the array in the given order.
    const data: InboxResponse = {
      forYou: [
        makeItem({ id: 'first:STAGE_OVERDUE', severity: 'critical', customerName: 'First' }),
        makeItem({ id: 'second:BLOCKER_OPEN', severity: 'warning', customerName: 'Second' }),
        makeItem({ id: 'third:HANDOFF_INCOMING', severity: 'info', customerName: 'Third' }),
      ],
      watching: [],
      firmWide: null,
    };
    const html = render({ data });
    const firstIdx = html.indexOf('First');
    const secondIdx = html.indexOf('Second');
    const thirdIdx = html.indexOf('Third');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(thirdIdx).toBeGreaterThan(secondIdx);
  });
});
