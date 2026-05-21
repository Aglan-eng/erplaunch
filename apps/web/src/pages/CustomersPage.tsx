/**
 * Phase 52.3 — Customers page (real).
 *
 * Replaces the Phase 52.2 stub. Lifts URL state for filters / view
 * mode / sort so reloads preserve the user's view. Coordinates the
 * list ↔ kanban views, the search input (debounced), and the
 * optimistic stage-transition flow with snap-back on PATCH failure.
 *
 * Desktop-only per Phase 52 lock #5 — mobile breakpoints land in a
 * later Phase 53 pass.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Search, X } from 'lucide-react';

import { AppShell } from '../components/SideNav';
import {
  CUSTOMER_STAGES,
  customersApi,
  type CustomerStage,
  type CustomerSummary,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { CustomerListView, type ListSortField, type ListSortOrder } from '@/components/customers/CustomerListView';
import { CustomerKanbanView } from '@/components/customers/CustomerKanbanView';
import { STAGE_DETAILS_ORDERED, stageDetail } from '@/components/customers/stageMetadata';

type ViewMode = 'list' | 'kanban';
type HealthBand = 'red' | 'yellow' | 'green';

// ─── URL-state helpers ─────────────────────────────────────────────────────

function readStages(params: URLSearchParams): CustomerStage[] {
  const raw = params.get('stage');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CustomerStage => (CUSTOMER_STAGES as readonly string[]).includes(s));
}

function readHealth(params: URLSearchParams): HealthBand[] {
  const raw = params.get('health');
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is HealthBand => s === 'red' || s === 'yellow' || s === 'green');
}

function readViewMode(params: URLSearchParams): ViewMode {
  return params.get('view') === 'kanban' ? 'kanban' : 'list';
}

function readSortField(params: URLSearchParams): ListSortField {
  const raw = params.get('sort');
  return raw === 'stage' || raw === 'health' || raw === 'lastActivity' ? raw : 'name';
}

function readSortOrder(params: URLSearchParams): ListSortOrder {
  return params.get('order') === 'desc' ? 'desc' : 'asc';
}

// ─── Debounced search hook ────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ─── Tiny inline toast (no global toast lib in this repo yet) ──────────────

interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // URL-derived state
  const viewMode = readViewMode(searchParams);
  const stages = readStages(searchParams);
  const healthBands = readHealth(searchParams);
  const sortField = readSortField(searchParams);
  const sortOrder = readSortOrder(searchParams);
  const showArchived = searchParams.get('archived') === 'true';

  // Search input has its own local state + debounce — typing
  // shouldn't immediately push to URL/network.
  const initialSearch = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(initialSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  // Push search → URL once debounced.
  useEffect(() => {
    const current = searchParams.get('search') ?? '';
    if (debouncedSearch === current) return;
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch.trim().length === 0) {
      next.delete('search');
    } else {
      next.set('search', debouncedSearch.trim());
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const queryKey = useMemo(
    () => ['customers', { stages, healthBands, sortField, sortOrder, debouncedSearch, showArchived }],
    [stages, healthBands, sortField, sortOrder, debouncedSearch, showArchived],
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: () =>
      customersApi.list({
        stages: stages.length > 0 ? stages : undefined,
        health: healthBands.length > 0 ? healthBands : undefined,
        sort: sortField,
        order: sortOrder,
        search: debouncedSearch.trim() || undefined,
        archived: showArchived,
      }),
  });

  // Optimistic stage transition for the kanban drag-drop. On
  // success we patch the cached list in place; on error we roll
  // back and surface a toast.
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pushToast = (kind: ToastMessage['kind'], text: string): void => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const transition = useMutation({
    mutationFn: (vars: { id: string; toStage: CustomerStage }) =>
      customersApi.transitionStage(vars.id, { toStage: vars.toStage }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ customers: CustomerSummary[] }>(queryKey);
      if (previous) {
        queryClient.setQueryData<{ customers: CustomerSummary[] }>(queryKey, {
          customers: previous.customers.map((c) =>
            c.id === vars.id ? { ...c, currentStage: vars.toStage } : c,
          ),
        });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      pushToast('error', `Couldn't move card — ${msg}`);
    },
    onSuccess: (resp) => {
      // The server returns the canonical summary including the
      // potentially-bumped renewalCount + recomputed health.
      queryClient.setQueryData<{ customers: CustomerSummary[] }>(queryKey, (prev) =>
        prev
          ? {
              customers: prev.customers.map((c) =>
                c.id === resp.customer.id ? resp.customer : c,
              ),
            }
          : prev,
      );
      pushToast('success', `Moved to ${stageDetail(resp.customer.currentStage).label}`);
    },
  });

  const handleMove = (id: string, toStage: CustomerStage): void => {
    transition.mutate({ id, toStage });
  };

  const customers = data?.customers ?? [];

  // ─── Filter chip handlers ────────────────────────────────────────────────

  const setUrlParam = (key: string, value: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const toggleStage = (stage: CustomerStage): void => {
    const has = stages.includes(stage);
    const nextStages = has ? stages.filter((s) => s !== stage) : [...stages, stage];
    setUrlParam('stage', nextStages.length > 0 ? nextStages.join(',') : null);
  };

  const toggleHealth = (band: HealthBand): void => {
    const has = healthBands.includes(band);
    const nextBands = has ? healthBands.filter((b) => b !== band) : [...healthBands, band];
    setUrlParam('health', nextBands.length > 0 ? nextBands.join(',') : null);
  };

  const setView = (mode: ViewMode): void => setUrlParam('view', mode === 'list' ? null : 'kanban');

  const setSortField = (field: ListSortField): void => {
    if (field === sortField) {
      setUrlParam('order', sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setUrlParam('sort', field);
      setUrlParam('order', 'asc');
    }
  };

  const clearAllFilters = (): void => {
    const next = new URLSearchParams();
    if (viewMode === 'kanban') next.set('view', 'kanban');
    setSearchParams(next, { replace: true });
    setSearchInput('');
  };

  const activeFilterCount = stages.length + healthBands.length + (debouncedSearch.trim() ? 1 : 0);

  return (
    <AppShell>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-testid="customers-page">
        <header className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Customers</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {isLoading
                ? 'Loading…'
                : `${customers.length} customer${customers.length === 1 ? '' : 's'} visible`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search customers…"
                data-testid="customers-search-input"
                aria-label="Search customers"
                className="w-64 pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            {/* View toggle */}
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setView('list')}
                data-testid="customers-view-toggle-list"
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  viewMode === 'list' ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900',
                )}
                aria-pressed={viewMode === 'list'}
              >
                <List className="h-3.5 w-3.5" />
                List
              </button>
              <button
                type="button"
                onClick={() => setView('kanban')}
                data-testid="customers-view-toggle-kanban"
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  viewMode === 'kanban' ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:text-gray-900',
                )}
                aria-pressed={viewMode === 'kanban'}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Kanban
              </button>
            </div>
          </div>
        </header>

        {/* Filter chips row */}
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="customers-filter-row">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">
            Stage
          </span>
          {STAGE_DETAILS_ORDERED.map((s) => {
            const active = stages.includes(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStage(s.key)}
                data-testid={`customers-stage-chip-${s.key}`}
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors border',
                  active
                    ? cn(s.badgeClass, 'border-transparent')
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                )}
                aria-pressed={active}
              >
                {s.label}
              </button>
            );
          })}
          <span className="mx-2 h-4 w-px bg-gray-200" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-400">
            Health
          </span>
          {(['green', 'yellow', 'red'] as const).map((band) => {
            const active = healthBands.includes(band);
            const ring =
              band === 'green' ? 'bg-emerald-50 text-emerald-700' :
              band === 'yellow' ? 'bg-amber-50 text-amber-700' :
              'bg-rose-50 text-rose-700';
            return (
              <button
                key={band}
                type="button"
                onClick={() => toggleHealth(band)}
                data-testid={`customers-health-chip-${band}`}
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border transition-colors capitalize',
                  active ? cn(ring, 'border-transparent') : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                )}
                aria-pressed={active}
              >
                {band}
              </button>
            );
          })}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              data-testid="customers-clear-filters"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            >
              <X className="h-3 w-3" />
              Clear ({activeFilterCount})
            </button>
          )}
        </div>

        {/* Body */}
        {isError ? (
          <div
            className="bg-white border border-rose-200 rounded-lg px-4 py-8 text-center"
            data-testid="customers-error"
          >
            <p className="text-sm text-rose-700">
              Failed to load customers: {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        ) : isLoading ? (
          <div
            className="bg-white border border-gray-200 rounded-lg px-4 py-8 text-center"
            data-testid="customers-loading"
          >
            <p className="text-sm text-gray-500">Loading customers…</p>
          </div>
        ) : customers.length === 0 ? (
          <div
            className="bg-white border border-gray-200 rounded-lg px-4 py-16 text-center"
            data-testid="customers-empty"
          >
            <p className="text-sm font-medium text-gray-900">No customers match these filters</p>
            <p className="text-xs text-gray-500 mt-1">
              Try clearing filters or switching to {viewMode === 'list' ? 'kanban' : 'list'} view.
            </p>
          </div>
        ) : viewMode === 'kanban' ? (
          <CustomerKanbanView customers={customers} onMove={handleMove} />
        ) : (
          <CustomerListView
            customers={customers}
            sortField={sortField}
            sortOrder={sortOrder}
            onSortChange={setSortField}
          />
        )}

        {/* Toasts */}
        {toasts.length > 0 && (
          <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50" data-testid="customers-toasts">
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                className={cn(
                  'rounded-lg px-4 py-2.5 text-sm shadow-lg border max-w-md',
                  t.kind === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border-rose-200',
                )}
                data-testid={`customers-toast-${t.kind}`}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
