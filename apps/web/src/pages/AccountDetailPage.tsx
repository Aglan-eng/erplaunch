/**
 * Phase 56.2 — Account detail (the company).
 *
 * Shows company info + the list of Projects under this account.
 * Each project links to `/customers/:id` (the existing Project-
 * detail page; intentionally not renamed in 56.2).
 */
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Briefcase, ChevronLeft, Mail, Phone, MapPin } from 'lucide-react';

import { AppShell } from '../components/SideNav';
import { accountsApi, type AccountSummary, type ProjectInAccount } from '../lib/api';
import { NewMenu } from '../components/accounts/NewMenu';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
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

const STAGE_BG: Record<string, string> = {
  LEAD: 'bg-sky-50 text-sky-700',
  QUALIFIED: 'bg-sky-50 text-sky-700',
  PROPOSAL: 'bg-indigo-50 text-indigo-700',
  NEGOTIATION: 'bg-indigo-50 text-indigo-700',
  WON: 'bg-emerald-50 text-emerald-700',
  DISCOVERY: 'bg-violet-50 text-violet-700',
  SCOPING: 'bg-violet-50 text-violet-700',
  BUILD: 'bg-amber-50 text-amber-800',
  UAT: 'bg-amber-50 text-amber-800',
  GOLIVE: 'bg-orange-50 text-orange-700',
  HYPERCARE: 'bg-rose-50 text-rose-700',
  LIVE_SLA: 'bg-emerald-50 text-emerald-700',
  RENEWAL_DUE: 'bg-amber-50 text-amber-800',
  RENEWED: 'bg-emerald-50 text-emerald-700',
  LOST: 'bg-gray-100 text-gray-600',
  CHURNED: 'bg-gray-100 text-gray-600',
};

const BAND_BG: Record<'red' | 'yellow' | 'green', string> = {
  red: 'bg-rose-50 text-rose-700',
  yellow: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
};

const KIND_LABEL: Record<string, string> = {
  INITIAL_IMPLEMENTATION: 'Initial implementation',
  PHASE_2: 'Phase 2',
  MODULE_ROLLOUT: 'Module rollout',
  OTHER: 'Other',
};

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const accountId = id ?? '';
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['account', accountId],
    queryFn: () => accountsApi.get(accountId),
    enabled: accountId !== '',
  });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApi.list() });

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['account', accountId] });
    void qc.invalidateQueries({ queryKey: ['accounts'] });
  };

  const summaryList: AccountSummary[] = accounts.data?.accounts ?? [];

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-6 lg:px-8 py-8" data-testid="account-detail-page">
        <Link
          to="/accounts"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mb-3"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All customers
        </Link>

        {detail.isLoading && (
          <div
            className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center"
            data-testid="account-detail-loading"
          >
            <p className="text-sm text-gray-500">Loading customer…</p>
          </div>
        )}

        {detail.isError && (
          <div
            className="bg-white border border-rose-200 rounded-xl px-5 py-8 text-center"
            data-testid="account-detail-error"
          >
            <p className="text-sm text-rose-700">Failed to load customer.</p>
          </div>
        )}

        {detail.data && (
          <>
            <header className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center flex-shrink-0">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h1
                      className="text-xl font-bold text-gray-900 truncate"
                      data-testid="account-detail-name"
                    >
                      {detail.data.account.name}
                    </h1>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {detail.data.projects.length}{' '}
                      {detail.data.projects.length === 1 ? 'project' : 'projects'}
                    </p>
                  </div>
                </div>
                <NewMenu
                  accounts={summaryList}
                  onSuccess={invalidate}
                  defaultAccountId={accountId}
                />
              </div>
              <dl className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <ContactRow
                  icon={MapPin}
                  label="Address"
                  value={detail.data.account.address}
                  testid="account-detail-address"
                />
                <ContactRow
                  icon={Mail}
                  label="Email"
                  value={detail.data.account.primaryContactEmail}
                  testid="account-detail-email"
                />
                <ContactRow
                  icon={Building2}
                  label="Primary contact"
                  value={detail.data.account.primaryContactName}
                  testid="account-detail-contact"
                />
                <ContactRow
                  icon={Phone}
                  label="Phone"
                  value={detail.data.account.primaryContactPhone}
                  testid="account-detail-phone"
                />
              </dl>
            </header>

            <section
              className="bg-white border border-gray-200 rounded-xl p-5"
              data-testid="account-detail-projects"
            >
              <header className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                  <Briefcase className="h-4 w-4 text-brand-600" />
                  Projects
                </h2>
              </header>
              {detail.data.projects.length === 0 ? (
                <p
                  className="text-sm text-gray-500 py-4"
                  data-testid="account-detail-projects-empty"
                >
                  No projects yet. Use the <span className="font-semibold">+ New</span> menu
                  above to create the first one.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {detail.data.projects.map((p) => (
                    <ProjectRow key={p.id} project={p} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  testid,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  testid: string;
}) {
  return (
    <div className="flex items-start gap-2" data-testid={testid}>
      <Icon className="h-3.5 w-3.5 mt-0.5 text-gray-400 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          {label}
        </div>
        <div className="text-gray-900 truncate">{value ?? '—'}</div>
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectInAccount }) {
  return (
    <li
      className="flex items-center justify-between gap-3 py-2.5"
      data-testid={`account-project-row-${project.id}`}
    >
      <div className="min-w-0 flex-1">
        <Link
          to={`/customers/${project.id}`}
          className="text-sm font-semibold text-gray-900 hover:text-brand-700"
        >
          {project.projectName}
        </Link>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {KIND_LABEL[project.projectKind] ?? project.projectKind}
        </div>
      </div>
      <span
        className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
          STAGE_BG[project.currentStage] ?? 'bg-gray-100 text-gray-600',
        )}
      >
        {STAGE_LABEL[project.currentStage] ?? project.currentStage}
      </span>
      {project.healthBand && (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums',
            BAND_BG[project.healthBand],
          )}
        >
          {project.health}
        </span>
      )}
      <Link
        to={`/customers/${project.id}?tab=implementation`}
        className="text-[11px] font-semibold text-brand-700 hover:underline flex-shrink-0"
      >
        Open →
      </Link>
    </li>
  );
}
