/**
 * Phase 56.2 — Accounts list page.
 *
 * The Customers sidebar item routes here. One row per company; click
 * a row to drill into the account's projects.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Briefcase, AlertTriangle } from 'lucide-react';

import { AppShell } from '../components/SideNav';
import { accountsApi, type AccountSummary } from '../lib/api';
import { NewMenu } from '../components/accounts/NewMenu';
import { cn } from '@/lib/utils';

const BAND_BG: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-50 text-rose-700',
  yellow: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
};

export function AccountsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });
  const accounts: AccountSummary[] = q.data?.accounts ?? [];

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  return (
    <AppShell>
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8" data-testid="accounts-page">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-5 w-5 text-brand-600" />
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Customers</h1>
            </div>
            <p className="text-sm text-gray-500">
              Companies your firm works with. Each customer can have one or more projects.
            </p>
          </div>
          <NewMenu accounts={accounts} onSuccess={invalidate} />
        </header>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {q.isLoading ? (
            <div className="px-6 py-8 text-sm text-gray-500" data-testid="accounts-loading">
              Loading customers…
            </div>
          ) : accounts.length === 0 ? (
            <div className="px-6 py-12 text-center" data-testid="accounts-empty">
              <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">No customers yet</p>
              <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                Hit the <span className="font-semibold">+ New</span> button to create your first
                lead or customer.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="accounts-table">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Company</th>
                  <th className="text-left px-4 py-2 font-semibold">Primary contact</th>
                  <th className="text-right px-4 py-2 font-semibold">Projects</th>
                  <th className="text-right px-4 py-2 font-semibold">Worst health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => (
                  <tr
                    key={a.id}
                    className="hover:bg-brand-50/30 transition-colors"
                    data-testid={`accounts-row-${a.id}`}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/accounts/${a.id}`}
                        className="text-sm font-medium text-gray-900 hover:text-brand-700"
                        data-testid={`accounts-row-${a.id}-link`}
                      >
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {a.primaryContactName ?? '—'}
                      {a.primaryContactEmail && (
                        <span className="text-gray-500 text-xs ml-2">{a.primaryContactEmail}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1.5 text-gray-900">
                        <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                        {a.projectCount}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {a.worstHealthBand ? (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize tabular-nums',
                            BAND_BG[a.worstHealthBand],
                          )}
                        >
                          {a.worstHealth} · {a.worstHealthBand}
                        </span>
                      ) : (
                        <span className="text-gray-400 inline-flex items-center gap-1 text-xs">
                          <AlertTriangle className="h-3 w-3" />
                          no projects
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </AppShell>
  );
}
