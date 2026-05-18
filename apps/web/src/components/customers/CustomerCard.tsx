/**
 * Phase 52.3 — kanban card. Compact view of a single
 * CustomerSummary tuned for the 14-column kanban swimlanes.
 *
 * Draggable via HTML5 native drag-drop — the page wires the
 * `dragstart` payload to `customerId` so the column's `drop`
 * handler can call `PATCH /customers/:id/stage` with the target
 * column's stage.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import type { CustomerSummary } from '@/lib/api';
import { formatArr, healthDotClass, ownerInitials } from './stageMetadata';
import { cn } from '@/lib/utils';

interface CustomerCardProps {
  customer: CustomerSummary;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
}

export function CustomerCard({
  customer,
  draggable = false,
  onDragStart,
  onDragEnd,
}: CustomerCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm transition-shadow',
        draggable ? 'cursor-grab hover:shadow-md active:cursor-grabbing' : '',
      )}
      data-testid={`customer-card-${customer.id}`}
      data-stage={customer.currentStage}
      data-customer-id={customer.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <Link
        to={`/customers/${customer.id}`}
        className="block group"
        data-testid={`customer-card-link-${customer.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-gray-900 group-hover:text-brand-700 truncate">
            {customer.name}
          </span>
          <span
            className={cn('h-2 w-2 rounded-full flex-shrink-0 mt-1.5', healthDotClass(customer.healthBand))}
            title={`Health ${customer.healthScore}`}
            data-testid={`customer-card-health-${customer.id}`}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-1.5 text-xs text-gray-600 truncate"
            title={customer.primaryOwnerName}
          >
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600"
              aria-hidden="true"
            >
              {ownerInitials(customer.primaryOwnerName)}
            </span>
            <span className="truncate">{customer.primaryOwnerName || '—'}</span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {customer.renewalCount > 0 && (
              <span
                className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                title={`${customer.renewalCount} renewal${customer.renewalCount === 1 ? '' : 's'}`}
                data-testid={`customer-card-renewals-${customer.id}`}
              >
                ↻ {customer.renewalCount}
              </span>
            )}
            <span className="text-[11px] font-medium text-gray-500 tabular-nums">
              {formatArr(customer.arr)}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
