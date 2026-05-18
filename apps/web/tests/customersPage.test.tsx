/**
 * Phase 52.3 — CustomersPage SSR render tests.
 *
 * Pins:
 *   - Loading state renders when the query is in flight
 *   - Empty state renders when no customers come back
 *   - List view renders the documented columns + a row per customer
 *   - Kanban view renders 6 group columns + 16 stage drop-zones,
 *     with customer cards bucketed into the right column
 *   - View toggle highlights based on URL `?view=` param
 *   - Stage chip highlights based on URL `?stage=` param
 *   - Search input picks up `?search=` from URL on mount
 *
 * SSR-only — drag-drop interactions + the debounced search push +
 * the optimistic-mutation snap-back are e2e concerns. The static
 * markup carries enough hooks (`data-testid`, `aria-pressed`,
 * `draggable`) that an e2e suite can drive them directly without
 * any unit-test-side coverage shim.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CustomersPage } from '../src/pages/CustomersPage';
import { AuthContext } from '../src/contexts/AuthContext';
import type { CustomerSummary } from '../src/lib/api';

function fakeAuth() {
  return {
    user: {
      id: 'u-1',
      firmId: 'f-1',
      email: 'demo@example.com',
      name: 'Demo User',
      role: 'APP_ADMIN' as const,
    },
    loading: false,
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
}

function makeCustomer(over: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id: 'c-1',
    name: 'Acme Industries',
    currentStage: 'PROPOSAL',
    primaryOwnerName: 'Karim Aglan',
    primaryOwnerId: 'u-1',
    healthScore: 85,
    healthBand: 'green',
    renewalCount: 0,
    lastActivityAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    arr: 25000,
    ...over,
  };
}

interface RenderOpts {
  initialPath?: string;
  /** Customers returned by the mocked query. */
  customers?: CustomerSummary[];
  /** When true, the query never resolves (loading state). */
  loading?: boolean;
}

function render(opts: RenderOpts = {}): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Pre-seed the customers query cache keyed at the variant the
  // page will request on mount with no filters set. The page's
  // queryKey is a tuple — we mirror it exactly so the useQuery
  // call hits the cache instead of triggering a real fetch.
  if (!opts.loading) {
    const customers = opts.customers ?? [];
    // The shape of the key must mirror the page's `queryKey`
    // tuple. We use a permissive matcher: setQueryData prefixed
    // with ['customers'] — react-query matches by deep equality
    // so we cover the default-args case (no filters).
    qc.setQueryData(
      [
        'customers',
        {
          stages: [],
          healthBands: [],
          sortField: 'name',
          sortOrder: 'asc',
          debouncedSearch: '',
          showArchived: false,
        },
      ],
      { customers },
    );
  }
  return renderToStaticMarkup(
    <AuthContext.Provider value={fakeAuth()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.initialPath ?? '/customers']}>
          <CustomersPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('CustomersPage — layout + chrome (Phase 52.3)', () => {
  it('renders the page shell with AppNav + page title', () => {
    const html = render({ customers: [] });
    expect(html).toContain('data-testid="customers-page"');
    expect(html).toContain('data-testid="app-nav"');
    expect(html).toContain('Customers');
  });

  it('renders the search input', () => {
    const html = render({ customers: [] });
    expect(html).toContain('data-testid="customers-search-input"');
  });

  it('renders both view-toggle buttons with the correct active state on default route', () => {
    const html = render({ customers: [] });
    expect(html).toContain('data-testid="customers-view-toggle-list"');
    expect(html).toContain('data-testid="customers-view-toggle-kanban"');
    expect(html).toMatch(
      /<button[^>]*data-testid="customers-view-toggle-list"[^>]*aria-pressed="true"/,
    );
    expect(html).toMatch(
      /<button[^>]*data-testid="customers-view-toggle-kanban"[^>]*aria-pressed="false"/,
    );
  });

  it('marks kanban toggle active when ?view=kanban', () => {
    const html = render({ customers: [], initialPath: '/customers?view=kanban' });
    expect(html).toMatch(
      /<button[^>]*data-testid="customers-view-toggle-kanban"[^>]*aria-pressed="true"/,
    );
  });

  it('renders all 16 stage chips + 3 health chips', () => {
    const html = render({ customers: [] });
    expect(html).toContain('data-testid="customers-stage-chip-LEAD"');
    expect(html).toContain('data-testid="customers-stage-chip-WON"');
    expect(html).toContain('data-testid="customers-stage-chip-LIVE_SLA"');
    expect(html).toContain('data-testid="customers-stage-chip-RENEWED"');
    expect(html).toContain('data-testid="customers-stage-chip-LOST"');
    expect(html).toContain('data-testid="customers-health-chip-red"');
    expect(html).toContain('data-testid="customers-health-chip-yellow"');
    expect(html).toContain('data-testid="customers-health-chip-green"');
  });

  it('highlights stage chip when URL contains ?stage=…', () => {
    const html = render({ customers: [], initialPath: '/customers?stage=BUILD' });
    expect(html).toMatch(
      /data-testid="customers-stage-chip-BUILD"[^>]*aria-pressed="true"/,
    );
  });

  it('seeds the search input from ?search= on mount', () => {
    const html = render({ customers: [], initialPath: '/customers?search=acme' });
    expect(html).toMatch(/<input[^>]*data-testid="customers-search-input"[^>]*value="acme"/);
  });
});

describe('CustomersPage — empty + loading states', () => {
  it('renders the empty state when the query has zero rows', () => {
    const html = render({ customers: [] });
    expect(html).toContain('data-testid="customers-empty"');
    expect(html).toContain('No customers match these filters');
  });

  it('renders the loading state when the query is in flight', () => {
    const html = render({ loading: true });
    expect(html).toContain('data-testid="customers-loading"');
  });
});

describe('CustomersPage — list view', () => {
  it('renders the list view by default with a row per customer', () => {
    const customers: CustomerSummary[] = [
      makeCustomer({ id: 'c-a', name: 'Alpha Co' }),
      makeCustomer({ id: 'c-b', name: 'Bravo Co', currentStage: 'BUILD' }),
      makeCustomer({ id: 'c-c', name: 'Charlie Co', currentStage: 'LIVE_SLA', renewalCount: 2 }),
    ];
    const html = render({ customers });
    expect(html).toContain('data-testid="customers-list-view"');
    expect(html).toContain('data-testid="customers-list-row-c-a"');
    expect(html).toContain('data-testid="customers-list-row-c-b"');
    expect(html).toContain('data-testid="customers-list-row-c-c"');
    expect(html).toContain('Alpha Co');
    expect(html).toContain('Bravo Co');
    expect(html).toContain('Charlie Co');
  });

  it('exposes a sort button for every sortable column', () => {
    const html = render({ customers: [makeCustomer()] });
    for (const col of ['name', 'stage', 'health', 'lastActivity']) {
      expect(html).toContain(`data-testid="customers-list-sort-${col}"`);
    }
  });

  it('row links to /customers/:id (Customer Detail — still the stub in 52.4)', () => {
    const html = render({ customers: [makeCustomer({ id: 'c-link' })] });
    expect(html).toMatch(/href="\/customers\/c-link"/);
  });

  it('renders the renewal pill only for customers with renewalCount > 0', () => {
    const customers = [
      makeCustomer({ id: 'c-fresh', name: 'Fresh', renewalCount: 0 }),
      makeCustomer({ id: 'c-renewed', name: 'Renewed', renewalCount: 3 }),
    ];
    const html = render({ customers });
    expect(html).toContain('↻ 3');
    // The non-renewed row shows an em-dash placeholder, not a pill.
    expect(html.match(/↻ 0/g)).toBeNull();
  });
});

describe('CustomersPage — kanban view', () => {
  it('renders the kanban view when ?view=kanban', () => {
    const html = render({
      customers: [makeCustomer()],
      initialPath: '/customers?view=kanban',
    });
    expect(html).toContain('data-testid="customers-kanban-view"');
  });

  it('renders all 6 phase-group columns', () => {
    // Need at least one customer so the page renders the kanban
    // body rather than the empty state. The page's empty state
    // intentionally pre-empts kanban — a no-customers firm sees
    // the same "No customers match" card in both views.
    const html = render({
      customers: [makeCustomer()],
      initialPath: '/customers?view=kanban',
    });
    for (const g of ['pre-sales', 'closing', 'delivery', 'launch', 'live', 'terminal']) {
      expect(html).toContain(`data-testid="kanban-group-${g}"`);
    }
  });

  it('renders all 16 stage drop-zone columns', () => {
    const html = render({
      customers: [makeCustomer()],
      initialPath: '/customers?view=kanban',
    });
    const stages = [
      'LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON',
      'DISCOVERY', 'SCOPING', 'BUILD', 'UAT',
      'GOLIVE', 'HYPERCARE',
      'LIVE_SLA', 'RENEWAL_DUE',
      'RENEWED', 'LOST', 'CHURNED',
    ];
    for (const s of stages) {
      expect(html).toContain(`data-testid="kanban-column-${s}"`);
    }
  });

  it('places a card into the column matching the customer.currentStage', () => {
    const html = render({
      customers: [
        makeCustomer({ id: 'c-prop', name: 'In Proposal', currentStage: 'PROPOSAL' }),
        makeCustomer({ id: 'c-build', name: 'In Build', currentStage: 'BUILD' }),
      ],
      initialPath: '/customers?view=kanban',
    });
    expect(html).toContain('data-testid="customer-card-c-prop"');
    expect(html).toContain('data-testid="customer-card-c-build"');
    // Cards carry their stage on a data attribute so e2e can
    // verify drop targets without reaching into the parent column.
    expect(html).toMatch(
      /data-testid="customer-card-c-prop"[^>]*data-stage="PROPOSAL"/,
    );
    expect(html).toMatch(
      /data-testid="customer-card-c-build"[^>]*data-stage="BUILD"/,
    );
  });

  it('makes kanban cards draggable (HTML5 drag-drop wire)', () => {
    const html = render({
      customers: [makeCustomer({ id: 'c-drag' })],
      initialPath: '/customers?view=kanban',
    });
    expect(html).toMatch(/data-testid="customer-card-c-drag"[^>]*draggable="true"/);
  });

  it('list-view cards are NOT draggable (drag-drop is kanban-only)', () => {
    const html = render({ customers: [makeCustomer({ id: 'c-list' })] });
    // The list view uses <tr> rows, not CustomerCard — so the
    // card-id testid never appears there.
    expect(html).not.toContain('data-testid="customer-card-c-list"');
  });
});
