/**
 * Phase 55.1 — Projects view.
 *
 * Delivery-stage customers (DISCOVERY..HYPERCARE) framed as
 * implementation projects. Row click → /customers/:id?tab=implementation.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, Folder } from 'lucide-react';

import { AppShell } from '../components/SideNav';
import { customersApi, type CustomerStage } from '../lib/api';
import { cn } from '@/lib/utils';

const DELIVERY_STAGES: ReadonlyArray<CustomerStage> = [
  'DISCOVERY',
  'SCOPING',
  'BUILD',
  'UAT',
  'GOLIVE',
  'HYPERCARE',
];

const STAGE_LABEL: Record<CustomerStage, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  DISCOVERY: 'Discovery',
  SCOPING: 'Scoping',
  BUILD: 'Build',
  UAT: 'UAT',
  GOLIVE: 'Go-live',
  HYPERCARE: 'Hypercare',
  LIVE_SLA: 'Live SLA',
  RENEWAL_DUE: 'Renewal Due',
  RENEWED: 'Renewed',
  LOST: 'Lost',
  CHURNED: 'Churned',
};

const BAND_BG: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-50 text-rose-700',
  yellow: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
};

export function ProjectsPage() {
  const q = useQuery({
    queryKey: ['customers-projects'],
    queryFn: () => customersApi.list({ stages: [...DELIVERY_STAGES], sort: 'stage', order: 'asc' }),
  });

  const projects = q.data?.customers ?? [];

  return (
    <AppShell>
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-8" data-testid="projects-page">
        <header className="mb-6 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-brand-600" />
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Projects</h1>
        </header>
        <p className="text-sm text-gray-500 mb-6">
          Active implementations — customers in Discovery through Hypercare. Click a row to open
          the customer's Implementation workspace.
        </p>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {q.isLoading ? (
            <div className="px-6 py-8 text-sm text-gray-500" data-testid="projects-loading">
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div className="px-6 py-12 text-center" data-testid="projects-empty">
              <Folder className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-gray-900">No active projects</p>
              <p className="text-xs text-gray-500 mt-1">
                Projects appear here once a customer moves from Won into Discovery.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="projects-table">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">Customer</th>
                  <th className="text-left px-4 py-2 font-semibold">Stage</th>
                  <th className="text-left px-4 py-2 font-semibold">Project Lead</th>
                  <th className="text-right px-4 py-2 font-semibold">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-brand-50/30 transition-colors"
                    data-testid={`projects-row-${p.id}`}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/customers/${p.id}?tab=implementation`}
                        className="text-sm font-medium text-gray-900 hover:text-brand-700"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{STAGE_LABEL[p.currentStage]}</td>
                    <td className="px-4 py-2.5 text-gray-700">{p.primaryOwnerName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize tabular-nums',
                          BAND_BG[p.healthBand],
                        )}
                      >
                        {p.healthScore} · {p.healthBand}
                      </span>
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
