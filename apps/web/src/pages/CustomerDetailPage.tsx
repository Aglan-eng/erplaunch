/**
 * Phase 52.4 — Customer Detail page.
 *
 * Replaces the Phase 52.2 stub. Four tabs (URL-state via `?tab=`):
 *   - overview (default): header + owner badges + health card +
 *     renewal counter + stage history strip + advance/rollback CTAs
 *   - documents: Proposal + SOW generation buttons (download PDF)
 *   - activity: chronological audit feed with type filters
 *   - settings: form to edit contact + owner assignments + ARR
 *
 * Phase 52.4 scope deliberately stops short of:
 *   - Inline name edit on the header (lives in Settings instead).
 *   - Full-fidelity proposal/SOW editor (the side-panel forms ship
 *     a "generate with defaults" surface; rich editing is later).
 *   - Per-row stored documents history (no Document table on
 *     customerId yet — section renders an explicit empty state).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  FileText,
  Activity as ActivityIcon,
  Settings as SettingsIcon,
  LayoutGrid,
  Wrench,
  Undo2,
  ArrowRight,
  Download,
  Loader2,
  ClipboardList,
  Layers,
  Sparkles,
  Briefcase,
  Folder,
} from 'lucide-react';

import { AppNav } from '../components/AppNav';
import {
  CUSTOMER_STAGES,
  customersApi,
  exportsApi,
  type CustomerActivity,
  type CustomerDetail,
  type CustomerPatch,
  type CustomerStage,
  type ProposalExportBody,
  type SowExportBody,
} from '@/lib/api';
import { HealthCard } from '@/components/customers/HealthCard';
import { OwnerBadge } from '@/components/customers/OwnerBadge';
import { StageHistoryStrip } from '@/components/customers/StageHistoryStrip';
import { StageWidget } from '@/components/customers/widgets';
import { HelpTip } from '@/components/guidance/HelpTip';
import type { DocumentDefinition } from '@/lib/api';
import {
  STAGE_DETAILS_ORDERED,
  formatRelativeTime,
  ownerInitials,
  stageDetail,
} from '@/components/customers/stageMetadata';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'documents' | 'implementation' | 'activity' | 'settings';

function readTab(params: URLSearchParams): Tab {
  const raw = params.get('tab');
  if (
    raw === 'documents' ||
    raw === 'implementation' ||
    raw === 'activity' ||
    raw === 'settings'
  ) {
    return raw;
  }
  return 'overview';
}

interface ToastMessage {
  id: number;
  kind: 'success' | 'error';
  text: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const customerId = id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams);
  const queryClient = useQueryClient();

  const setTab = (next: Tab): void => {
    const np = new URLSearchParams(searchParams);
    if (next === 'overview') np.delete('tab');
    else np.set('tab', next);
    setSearchParams(np, { replace: true });
  };

  const detailQuery = useQuery({
    queryKey: ['customer-detail', customerId],
    queryFn: () => customersApi.detail(customerId),
    enabled: customerId !== '',
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pushToast = (kind: ToastMessage['kind'], text: string): void => {
    const tid = Date.now() + Math.random();
    setToasts((p) => [...p, { id: tid, kind, text }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== tid)), 4000);
  };

  return (
    <div className="min-h-screen bg-gray-50" data-testid="customer-detail-page">
      <AppNav />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link
          to="/customers"
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 mb-3"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All customers
        </Link>

        {detailQuery.isLoading && (
          <div
            className="bg-white border border-gray-200 rounded-lg px-4 py-8 text-center"
            data-testid="customer-detail-loading"
          >
            <p className="text-sm text-gray-500">Loading customer…</p>
          </div>
        )}
        {detailQuery.isError && (
          <div
            className="bg-white border border-rose-200 rounded-lg px-4 py-8 text-center"
            data-testid="customer-detail-error"
          >
            <p className="text-sm text-rose-700">
              Failed to load customer:{' '}
              {detailQuery.error instanceof Error ? detailQuery.error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {detailQuery.data?.customer && (
          <>
            <CustomerHeader
              customer={detailQuery.data.customer}
              onAdvanced={() => detailQuery.refetch()}
              onError={(msg) => pushToast('error', msg)}
              onSuccess={(msg) => pushToast('success', msg)}
            />

            <TabsBar tab={tab} onChange={setTab} />

            {tab === 'overview' && (
              <OverviewTab customer={detailQuery.data.customer} />
            )}
            {tab === 'documents' && (
              <DocumentsTab
                customer={detailQuery.data.customer}
                onSuccess={(msg) => pushToast('success', msg)}
                onError={(msg) => pushToast('error', msg)}
              />
            )}
            {tab === 'implementation' && (
              <ImplementationTab customer={detailQuery.data.customer} />
            )}
            {tab === 'activity' && (
              <ActivityTab customerId={detailQuery.data.customer.id} />
            )}
            {tab === 'settings' && (
              <SettingsTab
                customer={detailQuery.data.customer}
                onSaved={(updated) => {
                  queryClient.setQueryData(['customer-detail', customerId], { customer: updated });
                  pushToast('success', 'Customer details saved');
                }}
                onError={(msg) => pushToast('error', msg)}
              />
            )}
          </>
        )}

        {toasts.length > 0 && (
          <div
            className="fixed bottom-6 right-6 flex flex-col gap-2 z-50"
            data-testid="customer-detail-toasts"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                role="status"
                data-testid={`customer-detail-toast-${t.kind}`}
                className={cn(
                  'rounded-lg px-4 py-2.5 text-sm shadow-lg border max-w-md',
                  t.kind === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                    : 'bg-rose-50 text-rose-900 border-rose-200',
                )}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────

interface CustomerHeaderProps {
  customer: CustomerDetail;
  onAdvanced: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function CustomerHeader({ customer, onAdvanced, onSuccess, onError }: CustomerHeaderProps) {
  const stage = stageDetail(customer.currentStage);
  const stageIdx = CUSTOMER_STAGES.indexOf(customer.currentStage);
  const nextStage =
    stageIdx >= 0 && stageIdx < CUSTOMER_STAGES.length - 3
      ? CUSTOMER_STAGES[stageIdx + 1]
      : null;
  const prevStage = stageIdx > 0 ? CUSTOMER_STAGES[stageIdx - 1] : null;

  const transition = useMutation({
    mutationFn: (vars: { toStage: CustomerStage; reason?: string }) =>
      customersApi.transitionStage(customer.id, vars),
    onSuccess: (resp) => {
      onSuccess(`Moved to ${stageDetail(resp.customer.currentStage).label}`);
      onAdvanced();
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : 'Stage transition failed');
    },
  });

  return (
    <header
      className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-4"
      data-testid="customer-header"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{customer.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                stage.badgeClass,
              )}
              data-testid="customer-header-stage"
            >
              {stage.label}
            </span>
            <HelpTip
              testid="helptip-stage"
              label="Customer lifecycle stage"
              body="Every customer flows through 14 stages, left-to-right: Lead → Qualified → Proposal → Negotiation → Won → Discovery → Scoping → Build → UAT → Go-live → Hypercare → Live SLA → Renewal Due → Renewed. Use Advance to move them forward or Roll back to step them back; every change is logged."
            />
            {customer.renewalCount > 0 && (
              <span
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                data-testid="customer-header-renewals"
                title={`${customer.renewalCount} renewal${customer.renewalCount === 1 ? '' : 's'}`}
              >
                ↻ {customer.renewalCount} renewal{customer.renewalCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {prevStage && (
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt('Reason for rolling back?') ?? undefined;
                transition.mutate({ toStage: prevStage, reason });
              }}
              disabled={transition.isPending}
              data-testid="customer-header-rollback"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Roll back to {stageDetail(prevStage).label}
            </button>
          )}
          {nextStage && (
            <button
              type="button"
              onClick={() => {
                transition.mutate({ toStage: nextStage });
              }}
              disabled={transition.isPending}
              data-testid="customer-header-advance"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Advance to {stageDetail(nextStage).label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Owners
        </span>
        <HelpTip
          testid="helptip-owners"
          label="The four owner roles"
          body="Each customer has four owners. Sales owns Lead→Won. Project Lead owns Discovery→Go-live. CSM owns Hypercare→Renewed. AR owns invoicing the whole time. The highlighted badge is whoever's currently in charge based on the stage."
        />
      </div>
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-2"
        data-testid="customer-header-owners"
      >
        <OwnerBadge
          label="Sales"
          owner={customer.salesOwner}
          editHref={`/customers/${customer.id}?tab=settings`}
          active={customer.primaryOwnerId === customer.salesOwner?.id}
        />
        <OwnerBadge
          label="Project Lead"
          owner={customer.projectLeadOwner}
          editHref={`/customers/${customer.id}?tab=settings`}
          active={customer.primaryOwnerId === customer.projectLeadOwner?.id}
        />
        <OwnerBadge
          label="CSM"
          owner={customer.csmOwner}
          editHref={`/customers/${customer.id}?tab=settings`}
          active={customer.primaryOwnerId === customer.csmOwner?.id}
        />
        <OwnerBadge
          label="AR"
          owner={customer.arOwner}
          editHref={`/customers/${customer.id}?tab=settings`}
        />
      </div>
    </header>
  );
}

// ─── Tabs bar ──────────────────────────────────────────────────────────────

interface TabsBarProps {
  tab: Tab;
  onChange: (next: Tab) => void;
}

function TabsBar({ tab, onChange }: TabsBarProps) {
  const tabs: Array<{ key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'overview', label: 'Overview', icon: LayoutGrid },
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'implementation', label: 'Implementation', icon: Wrench },
    { key: 'activity', label: 'Activity', icon: ActivityIcon },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ];
  return (
    <nav
      className="flex items-center gap-1 border-b border-gray-200 mb-4"
      aria-label="Customer detail tabs"
      data-testid="customer-detail-tabs"
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            data-testid={`customer-detail-tab-${t.key}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
              active
                ? 'text-brand-700 border-brand-500'
                : 'text-gray-500 border-transparent hover:text-gray-900',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────

function OverviewTab({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="space-y-4" data-testid="tab-overview">
      <StageWidget detail={customer} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1">
          <HealthCard breakdown={customer.healthBreakdown} />
        </div>
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Stage history</h2>
        <StageHistoryStrip history={customer.stageHistory} />
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Last activity
            </dt>
            <dd className="text-gray-900">{formatRelativeTime(customer.lastActivityAt)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              ARR
            </dt>
            <dd className="text-gray-900 tabular-nums">
              {customer.arr == null
                ? '—'
                : `$${customer.arr.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Address
            </dt>
            <dd className="text-gray-900">{customer.customerAddress ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              Primary contact
            </dt>
            <dd className="text-gray-900">
              {customer.primaryContactName ?? '—'}
              {customer.primaryContactEmail && (
                <span className="text-gray-500 text-xs ml-2">{customer.primaryContactEmail}</span>
              )}
            </dd>
          </div>
        </dl>
        </div>
      </div>
    </div>
  );
}

// ─── Implementation tab (Phase 54.1) ──────────────────────────────────────

interface ImplementationTabProps {
  customer: CustomerDetail;
}

interface WorkspaceEntry {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  /** When true, the card surfaces the muted "pre-implementation" hint. */
  preImplementation?: boolean;
}

const PRE_WON_STAGES: ReadonlyArray<string> = [
  'LEAD',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
];

function ImplementationTab({ customer }: ImplementationTabProps) {
  const isPreWon = PRE_WON_STAGES.includes(customer.currentStage);
  const id = customer.id;
  const back = `from=customer&customerId=${id}`;

  const entries: WorkspaceEntry[] = [
    {
      id: 'data-collection',
      title: 'Discovery & Data Collection',
      description:
        'Run the discovery questionnaire and capture the customer\'s real-world processes. Feeds every downstream generator.',
      icon: ClipboardList,
      to: `/engagements/${id}/data-collection?${back}`,
    },
    {
      id: 'documents',
      title: 'Generate Documents',
      description:
        'The full document generator surface — proposals, SOWs, status reports, configuration workbooks, runbooks, and more.',
      icon: Sparkles,
      to: `/engagements/${id}/documents?${back}`,
    },
    {
      id: 'status-report',
      title: 'Status Report',
      description:
        'Roll-up of risks, issues, decisions, and progress per stage. Print-optimised for sponsor meetings.',
      icon: Briefcase,
      to: `/engagements/${id}/status-report?${back}`,
    },
    {
      id: 'vertical-workspace',
      title: 'Vertical Workspace',
      description:
        'Industry-specific accelerator workspace — pre-built modules, flows, and data shapes for the customer\'s vertical.',
      icon: Layers,
      to: `/engagements/${id}/vertical?${back}`,
    },
    {
      id: 'jobs',
      title: 'Generation Jobs',
      description:
        'Browse outputs from past generation runs — solution design bundles, NetSuite SDF projects, deliverable ZIPs.',
      icon: Folder,
      to: `/engagements/${id}/jobs/latest?${back}`,
    },
  ];

  return (
    <div className="space-y-4" data-testid="tab-implementation">
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <header className="flex items-start gap-3 mb-2">
          <Wrench className="h-5 w-5 text-brand-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">
              Implementation workspace
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Discovery, document generation, and delivery tooling for{' '}
              <span className="font-semibold text-gray-700">{customer.name}</span>. Everything
              here is scoped to this customer.
            </p>
          </div>
        </header>
        {isPreWon && (
          <div
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            data-testid="implementation-prewon-note"
          >
            This customer is still at the{' '}
            <span className="font-semibold">{stageDetail(customer.currentStage).label}</span>{' '}
            stage. Implementation tooling unlocks fully once the deal moves to Won — but
            you can still poke around below.
          </div>
        )}
      </section>

      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="implementation-entries"
      >
        {entries.map((entry) => (
          <WorkspaceCard key={entry.id} entry={entry} muted={isPreWon} />
        ))}
      </div>
    </div>
  );
}

function WorkspaceCard({
  entry,
  muted,
}: {
  entry: WorkspaceEntry;
  muted: boolean;
}) {
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      data-testid={`implementation-entry-${entry.id}`}
      className={cn(
        'group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/30',
        muted && 'opacity-90',
      )}
    >
      <div className="flex-shrink-0 h-9 w-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center group-hover:bg-brand-100">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 group-hover:text-brand-700">
          {entry.title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{entry.description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-brand-600 flex-shrink-0 mt-1" />
    </Link>
  );
}

// ─── Documents tab ─────────────────────────────────────────────────────────

interface DocumentsTabProps {
  customer: CustomerDetail;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function DocumentsTab({ customer, onSuccess, onError }: DocumentsTabProps) {
  const [pending, setPending] = useState<'proposal' | 'sow' | null>(null);

  const triggerDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  };

  const generateProposal = async (): Promise<void> => {
    setPending('proposal');
    try {
      const body: ProposalExportBody = {
        customer: {
          name: customer.name,
          address: customer.customerAddress ?? undefined,
          contactName: customer.primaryContactName ?? undefined,
        },
        proposal: {
          title: `NetSuite Implementation Proposal — ${customer.name}`,
          date: new Date().toISOString().slice(0, 10),
          preparedBy: customer.salesOwner?.name ?? 'Sales team',
          summary:
            `Proposal prepared for **${customer.name}** outlining the scope, deliverables, ` +
            `timeline, and commercials of the proposed engagement.`,
          scope: ['NetSuite Financial Management', 'Inventory + integrations', 'Hypercare'],
          approach:
            '- Frame the current state in weeks 1-2.\n' +
            '- Build the new state in weeks 3-12.\n' +
            '- Land go-live in weeks 13-16.',
          deliverables: [
            { name: 'Solution Design Document', description: 'Configuration spec.' },
            { name: 'Cutover Runbook', description: 'Hour-by-hour go-live plan.' },
            { name: 'Training materials', description: 'Per-role guides + QRGs.' },
          ],
          timeline: [
            { phase: 'Frame', weeks: 2, description: 'Discovery + design sign-off.' },
            { phase: 'Build', weeks: 8, description: 'Configuration + integrations.' },
            { phase: 'Land', weeks: 6, description: 'UAT + go-live + hypercare.' },
          ],
          pricing: {
            lineItems: [
              { description: 'License (annual)', qty: 1, unitPrice: 48000, total: 48000 },
              { description: 'Users', qty: 10, unitPrice: 1200, total: 12000 },
              { description: 'Implementation services', qty: 1, unitPrice: 150000, total: 150000 },
            ],
            subtotal: 210_000,
            total: 210_000,
            currency: 'USD',
          },
          terms: '30% on signing, 40% on solution-design sign-off, 30% on go-live.',
        },
      };
      const blob = await exportsApi.proposal(body);
      triggerDownload(blob, `${customer.name} — Proposal.pdf`);
      onSuccess('Proposal PDF generated');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Proposal generation failed');
    } finally {
      setPending(null);
    }
  };

  const generateSow = async (): Promise<void> => {
    setPending('sow');
    try {
      const body: SowExportBody = {
        customer: {
          name: customer.name,
          address: customer.customerAddress ?? undefined,
          contactName: customer.primaryContactName ?? undefined,
        },
        sow: {
          title: `NetSuite Implementation — Statement of Work`,
          effectiveDate: new Date().toISOString().slice(0, 10),
          projectOverview: `Statement of work for ${customer.name}'s NetSuite implementation engagement.`,
          inScope: ['Financials configuration', 'Inventory + integrations', '30-day hypercare'],
          outOfScope: ['Legacy system data archival', 'Out-of-spec custom developments'],
          deliverables: [
            { id: 'DLV-1', name: 'Solution Design Document', description: 'Configuration spec.', acceptanceCriteria: 'Signed off by client finance + ops leads.' },
            { id: 'DLV-2', name: 'Cutover Runbook', description: 'Go-live plan.', acceptanceCriteria: 'Dry-run executed with zero P1 issues.' },
            { id: 'DLV-3', name: 'Hypercare Handoff', description: 'Operating runbook.', acceptanceCriteria: 'Operator handoff checklist signed.' },
          ],
          milestones: [
            { name: 'Kickoff', targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), paymentPercent: 30 },
            { name: 'Solution Design sign-off', targetDate: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10), paymentPercent: 20 },
            { name: 'UAT delivered', targetDate: new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10), paymentPercent: 20 },
            { name: 'Go-live', targetDate: new Date(Date.now() + 110 * 86_400_000).toISOString().slice(0, 10), paymentPercent: 20 },
            { name: 'Hypercare exit', targetDate: new Date(Date.now() + 140 * 86_400_000).toISOString().slice(0, 10), paymentPercent: 10 },
          ],
          assumptions: [
            'Client sponsor commits 4 hours per week.',
            'Data exports arrive by week 2 in agreed templates.',
          ],
          changeOrderProcess:
            'Changes affecting scope, timeline, or fees require a signed Change Order from both parties.',
          fees: {
            fixedFee: 150_000,
            currency: 'USD',
            paymentTerms: 'Net 30 from milestone sign-off.',
          },
          termAndTermination:
            'Effective from the Effective Date through Hypercare Exit. Either party may terminate for convenience with 30 days notice.',
          signatures: {
            firmSignatoryName: customer.salesOwner?.name ?? 'Managing Director',
            firmSignatoryTitle: 'Managing Director',
            customerSignatoryName: customer.primaryContactName ?? customer.name,
            customerSignatoryTitle: 'Chief Financial Officer',
          },
        },
      };
      const blob = await exportsApi.sow(body);
      triggerDownload(blob, `${customer.name} — SOW.pdf`);
      onSuccess('SOW PDF generated');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'SOW generation failed');
    } finally {
      setPending(null);
    }
  };

  const catalogQuery = useQuery({
    queryKey: ['exports-catalog'],
    queryFn: () => exportsApi.catalog(),
    staleTime: 5 * 60 * 1000,
  });

  const handleGenerate = (docId: string): void => {
    if (docId === 'proposal') void generateProposal();
    else if (docId === 'sow') void generateSow();
  };

  const pendingDocId: string | null =
    pending === 'proposal' ? 'proposal' : pending === 'sow' ? 'sow' : null;

  const allDocs = catalogQuery.data?.documents ?? [];
  const currentStageDocs = allDocs.filter((d) => d.stage === customer.currentStage);
  const docsByStage = new Map<string, DocumentDefinition[]>();
  for (const d of allDocs) {
    const arr = docsByStage.get(d.stage) ?? [];
    arr.push(d);
    docsByStage.set(d.stage, arr);
  }

  return (
    <div className="space-y-4" data-testid="tab-documents">
      <section
        className="bg-white border border-gray-200 rounded-xl p-5"
        data-testid="documents-current-stage"
      >
        <header className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold text-gray-900">
            For this stage — {stageDetail(customer.currentStage).label}
          </h2>
          <HelpTip
            testid="documents-current-stage-help"
            label="Why these documents?"
            body={`These are the documents typically produced during the ${stageDetail(customer.currentStage).label} stage. Documents not yet built will show a "Coming soon" badge.`}
          />
        </header>
        {catalogQuery.isLoading ? (
          <p className="text-sm text-gray-500" data-testid="documents-current-stage-loading">
            Loading catalog…
          </p>
        ) : currentStageDocs.length === 0 ? (
          <p
            className="text-sm text-gray-500 mt-2"
            data-testid="documents-current-stage-empty"
          >
            No documents are defined for this stage. Terminal stages (Lost, Churned, Renewed)
            and post-go-live stages without a doc template fall here for now.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentStageDocs.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                pendingDocId={pendingDocId}
                onGenerate={handleGenerate}
              />
            ))}
          </div>
        )}
      </section>

      <details
        className="bg-white border border-gray-200 rounded-xl overflow-hidden"
        data-testid="documents-all-stages"
      >
        <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-gray-700 hover:bg-gray-50">
          All documents
        </summary>
        <div className="px-5 py-4 space-y-6 border-t border-gray-100">
          {Array.from(docsByStage.entries()).map(([stage, docs]) => (
            <div key={stage} data-testid={`documents-stage-group-${stage}`}>
              <h3 className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
                {stageDetail(stage as CustomerStage).label}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {docs.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    pendingDocId={pendingDocId}
                    onGenerate={handleGenerate}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <div
        className="bg-white border border-gray-200 rounded-xl px-5 py-6 text-center"
        data-testid="documents-history-empty"
      >
        <FileText className="h-7 w-7 text-gray-300 mx-auto mb-2" />
        <p className="text-sm font-medium text-gray-900">No saved documents yet</p>
        <p className="text-xs text-gray-500 mt-1">
          Generated PDFs download to your machine. Stored-document history lands in a later phase.
        </p>
      </div>
    </div>
  );
}

interface DocumentCardProps {
  doc: DocumentDefinition;
  pendingDocId: string | null;
  onGenerate: (docId: string) => void;
}

function DocumentCard({ doc, pendingDocId, onGenerate }: DocumentCardProps) {
  const isAvailable = doc.status === 'available';
  const isPending = pendingDocId === doc.id;
  return (
    <div
      className={cn(
        'rounded-lg border p-3 flex items-start gap-3',
        isAvailable ? 'border-gray-200 bg-white' : 'border-gray-150 bg-gray-50',
      )}
      data-testid={`documents-card-${doc.id}`}
      data-doc-status={doc.status}
    >
      <FileText
        className={cn('h-4 w-4 mt-0.5 flex-shrink-0', isAvailable ? 'text-brand-600' : 'text-gray-400')}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={cn(
              'text-sm font-semibold',
              isAvailable ? 'text-gray-900' : 'text-gray-500',
            )}
          >
            {doc.name}
          </p>
          {!isAvailable && (
            <span
              className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
              data-testid={`documents-card-${doc.id}-badge`}
            >
              Coming soon
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{doc.description}</p>
        {isAvailable && (
          <button
            type="button"
            onClick={() => onGenerate(doc.id)}
            disabled={pendingDocId !== null}
            data-testid={`documents-card-${doc.id}-generate`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Generate PDF
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Activity tab ─────────────────────────────────────────────────────────

const ACTIVITY_TYPE_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'STAGE_TRANSITION', label: 'Stage transitions' },
  { key: 'OWNER_HANDOFF', label: 'Owner handoffs' },
  { key: 'CUSTOMER_EDITED', label: 'Edits' },
  { key: 'BRAND_PACK_INGESTED', label: 'Brand pack' },
];

function ActivityTab({ customerId }: { customerId: string }) {
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const activityQuery = useQuery({
    queryKey: ['customer-activity', customerId, typeFilter.join(',')],
    queryFn: () =>
      customersApi.activity(customerId, {
        types: typeFilter.length > 0 ? typeFilter : undefined,
        limit: 200,
      }),
  });

  const toggleType = (k: string): void => {
    setTypeFilter((prev) => (prev.includes(k) ? prev.filter((t) => t !== k) : [...prev, k]));
  };

  return (
    <div className="space-y-3" data-testid="tab-activity">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
          Filter
        </span>
        {ACTIVITY_TYPE_OPTIONS.map((opt) => {
          const active = typeFilter.includes(opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => toggleType(opt.key)}
              data-testid={`activity-type-chip-${opt.key}`}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700 border-transparent'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
              )}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {activityQuery.isLoading ? (
        <div className="text-sm text-gray-500 py-6 text-center bg-white border border-gray-200 rounded-xl">
          Loading activity…
        </div>
      ) : activityQuery.data && activityQuery.data.activities.length > 0 ? (
        <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {activityQuery.data.activities.map((a) => (
            <ActivityRow key={a.id} activity={a} />
          ))}
        </ul>
      ) : (
        <div
          className="bg-white border border-gray-200 rounded-xl py-12 text-center"
          data-testid="activity-empty"
        >
          <ActivityIcon className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-900">No activity yet</p>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: CustomerActivity }) {
  const isRollback = activity.isRollback;
  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        isRollback ? 'border-l-4 border-rose-400' : '',
      )}
      data-testid={`activity-row-${activity.id}`}
      data-rollback={isRollback}
    >
      <span
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold flex-shrink-0',
          isRollback ? 'bg-rose-100 text-rose-700' : 'bg-gray-100 text-gray-600',
        )}
        aria-hidden="true"
      >
        {isRollback ? <Undo2 className="h-3.5 w-3.5" /> : ownerInitials(activity.actorName)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">{activity.summary}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {activity.actorName} · {formatRelativeTime(activity.createdAt)}
        </p>
      </div>
    </li>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────

interface SettingsTabProps {
  customer: CustomerDetail;
  onSaved: (next: CustomerDetail) => void;
  onError: (msg: string) => void;
}

function SettingsTab({ customer, onSaved, onError }: SettingsTabProps) {
  const [form, setForm] = useState({
    customerName: customer.name,
    customerAddress: customer.customerAddress ?? '',
    primaryContactName: customer.primaryContactName ?? '',
    primaryContactEmail: customer.primaryContactEmail ?? '',
    primaryContactPhone: customer.primaryContactPhone ?? '',
    arr: customer.arr == null ? '' : String(customer.arr),
    salesOwnerUserId: customer.salesOwner?.id ?? '',
    projectLeadUserId: customer.projectLeadOwner?.id ?? '',
    csmUserId: customer.csmOwner?.id ?? '',
    arOwnerUserId: customer.arOwner?.id ?? '',
  });
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: CustomerPatch = {
        customerName: form.customerName,
        customerAddress: form.customerAddress.trim() || null,
        primaryContactName: form.primaryContactName.trim() || null,
        primaryContactEmail: form.primaryContactEmail.trim() || null,
        primaryContactPhone: form.primaryContactPhone.trim() || null,
        arr: form.arr.trim() === '' ? null : Number(form.arr),
        salesOwnerUserId: form.salesOwnerUserId.trim() || null,
        projectLeadUserId: form.projectLeadUserId.trim() || null,
        csmUserId: form.csmUserId.trim() || null,
        arOwnerUserId: form.arOwnerUserId.trim() || null,
      };
      const resp = await customersApi.update(customer.id, patch);
      onSaved(resp.customer);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (
    name: keyof typeof form,
    label: string,
    type: 'text' | 'email' | 'number' = 'text',
    placeholder?: string,
  ): React.ReactElement => (
    <div>
      <label className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
        {label}
      </label>
      <input
        type={type}
        name={name as string}
        value={form[name]}
        onChange={(e) => setForm((p) => ({ ...p, [name]: e.target.value }))}
        placeholder={placeholder}
        data-testid={`settings-field-${name}`}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
      />
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 max-w-2xl"
      data-testid="tab-settings"
    >
      <div className="grid grid-cols-2 gap-4">
        {field('customerName', 'Customer name')}
        {field('customerAddress', 'Address')}
        {field('primaryContactName', 'Primary contact name')}
        {field('primaryContactEmail', 'Primary contact email', 'email')}
        {field('primaryContactPhone', 'Primary contact phone')}
        {field('arr', 'ARR (USD)', 'number', '25000')}
        {field('salesOwnerUserId', 'Sales owner (userId)', 'text', 'u-…')}
        {field('projectLeadUserId', 'Project lead (userId)', 'text', 'u-…')}
        {field('csmUserId', 'CSM (userId)', 'text', 'u-…')}
        {field('arOwnerUserId', 'AR owner (userId)', 'text', 'u-…')}
      </div>
      <p className="text-[11px] text-gray-500">
        Owner fields take a user id from your firm. Full user-picker UI lands in a follow-up.
      </p>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          data-testid="settings-save"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save changes
        </button>
      </div>
    </form>
  );
}

// Silence unused-effect import warnings — `useEffect` shipped to keep the
// page hook-friendly for future polish (e.g. refetch on focus).
void useEffect;
void useMemo;
void STAGE_DETAILS_ORDERED;
