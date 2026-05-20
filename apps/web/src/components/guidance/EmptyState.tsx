/**
 * Phase 53.1 — EmptyState.
 *
 * Drop-in replacement for the bare "no data" placeholders scattered
 * across the app. Every empty state now explains in plain English
 * what populates it and what the user can do next.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Inbox as InboxIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  /** Bold one-line summary of what's missing. */
  headline: string;
  /** 1–2 plain-English sentences explaining what populates this view. */
  explanation: string;
  /** Optional CTA — render a Link when `to` is set, a button when `onClick` is. */
  action?: EmptyStateAction;
  /** Lucide icon component. Defaults to Inbox. */
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  testid?: string;
}

export function EmptyState({
  headline,
  explanation,
  action,
  icon: Icon = InboxIcon,
  className,
  testid,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testid ?? 'empty-state'}
      className={cn(
        'rounded-xl border border-gray-200 bg-white py-12 px-6 text-center',
        className,
      )}
    >
      <Icon className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
      <p
        data-testid={testid ? `${testid}-headline` : 'empty-state-headline'}
        className="mt-3 text-sm font-semibold text-gray-900"
      >
        {headline}
      </p>
      <p
        data-testid={testid ? `${testid}-explanation` : 'empty-state-explanation'}
        className="mt-1 text-xs text-gray-500 max-w-md mx-auto leading-relaxed"
      >
        {explanation}
      </p>
      {action && (action.to || action.onClick) && (
        <div className="mt-4">
          {action.to ? (
            <Link
              to={action.to}
              data-testid={testid ? `${testid}-action` : 'empty-state-action'}
              className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              data-testid={testid ? `${testid}-action` : 'empty-state-action'}
              className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-700"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
