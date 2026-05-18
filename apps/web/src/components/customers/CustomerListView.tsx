/**
 * Phase 52.3 — list view of the Customers page.
 *
 * Sortable table with the columns the spec calls for. Sort state is
 * lifted to the parent (CustomersPage) so it can survive in URL
 * state. We use simple pagination — virtualisation is over-spec for
 * the realistic firm scale (low hundreds of customers) and adds
 * test surface for no payoff.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CustomerSummary } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  formatArr,
  formatRelativeTime,
  healthDotClass,
  ownerInitials,
  stageDetail,
} from './stageMetadata';

export type ListSortField = 'name' | 'stage' | 'health' | 'lastActivity';
export type ListSortOrder = 'asc' | 'desc';

interface CustomerListViewProps {
  customers: CustomerSummary[];
  sortField: ListSortField;
  sortOrder: ListSortOrder;
  onSortChange: (field: ListSortField) => void;
}

interface Column {
  key: ListSortField | 'owner' | 'renewals' | 'arr';
  label: string;
  sortable: boolean;
  align?: 'left' | 'right';
}

const COLUMNS: ReadonlyArray<Column> = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'stage', label: 'Stage', sortable: true },
  { key: 'owner', label: 'Owner', sortable: false },
  { key: 'health', label: 'Health', sortable: true },
  { key: 'renewals', label: 'Renewals', sortable: false, align: 'right' },
  { key: 'lastActivity', label: 'Last activity', sortable: true },
  { key: 'arr', label: 'ARR', sortable: false, align: 'right' },
];

export function CustomerListView({
  customers,
  sortField,
  sortOrder,
  onSortChange,
}: CustomerListViewProps) {
  return (
    <div
      className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
      data-testid="customers-list-view"
    >
      <table className="min-w-full text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            {COLUMNS.map((col) => {
              const isActive = col.sortable && col.key === sortField;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.key as ListSortField)}
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-gray-900',
                        isActive ? 'text-gray-900' : '',
                      )}
                      data-testid={`customers-list-sort-${col.key}`}
                    >
                      {col.label}
                      {isActive &&
                        (sortOrder === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </button>
                  ) : (
                    <span>{col.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {customers.map((c) => (
            <tr
              key={c.id}
              className="hover:bg-gray-50 cursor-pointer"
              data-testid={`customers-list-row-${c.id}`}
            >
              <td className="px-3 py-2.5">
                <Link
                  to={`/customers/${c.id}`}
                  className="font-medium text-gray-900 hover:text-brand-700"
                >
                  {c.name}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    stageDetail(c.currentStage).badgeClass,
                  )}
                >
                  {stageDetail(c.currentStage).label}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-gray-700">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                    {ownerInitials(c.primaryOwnerName)}
                  </span>
                  <span className="truncate">{c.primaryOwnerName || '—'}</span>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-gray-700">
                  <span className={cn('h-2 w-2 rounded-full', healthDotClass(c.healthBand))} />
                  <span className="tabular-nums">{c.healthScore}</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-right">
                {c.renewalCount > 0 ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    ↻ {c.renewalCount}
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-gray-600">{formatRelativeTime(c.lastActivityAt)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {formatArr(c.arr)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
