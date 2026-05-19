/**
 * Phase 52.4 — owner avatar+name badge.
 *
 * Used on the Customer Detail header to show all four owner slots
 * (Sales / Project Lead / CSM / AR) side-by-side. The pencil button
 * is decorative on the overview tab — full editing lives in the
 * Settings tab; the spec mentions a popover user-picker on
 * /customers/:id but that's a follow-up polish pass.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ownerInitials } from './stageMetadata';

interface OwnerBadgeProps {
  label: 'Sales' | 'Project Lead' | 'CSM' | 'AR';
  owner: { id: string; name: string } | null;
  /** Path the pencil button links to. The Phase 52.4 v1 surface
   *  routes the pencil straight to `?tab=settings`; full inline
   *  editing is a later round. */
  editHref: string;
  /** When true, the badge marks itself as the "active stage owner"
   *  per Phase 52 lock #2 so the UI can highlight which one is
   *  currently in the driver's seat. */
  active?: boolean;
}

export function OwnerBadge({ label, owner, editHref, active = false }: OwnerBadgeProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2 transition-colors',
        active ? 'border-brand-300 ring-1 ring-brand-200' : 'border-gray-200',
      )}
      data-testid={`owner-badge-${label.toLowerCase().replace(' ', '-')}`}
      data-active={active}
    >
      <span
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
          owner ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400',
        )}
        aria-hidden="true"
      >
        {owner ? ownerInitials(owner.name) : '·'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
          {label}
        </p>
        <p
          className={cn(
            'text-xs font-medium truncate',
            owner ? 'text-gray-900' : 'text-gray-400 italic',
          )}
        >
          {owner ? owner.name : 'Unassigned'}
        </p>
      </div>
      <Link
        to={editHref}
        className="text-gray-400 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0"
        title={`Edit ${label.toLowerCase()} owner`}
        data-testid={`owner-badge-edit-${label.toLowerCase().replace(' ', '-')}`}
      >
        <Pencil className="h-3 w-3" />
      </Link>
    </div>
  );
}
