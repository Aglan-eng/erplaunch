import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, portalApi } from '@/lib/api';
import {
  TriangleAlert, CircleCheck, Clock, Users, CalendarDays,
  BarChart2, BookOpen, AlertCircle, Upload, FolderOpen,
  CheckSquare, Square, ListTodo, CalendarClock, FileCheck,
  ChevronDown, ChevronUp, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PortalBrandedHeader,
  getPortalBrandingStyle,
  type FirmBranding,
} from '@/components/portal/PortalBrandedHeader';
import { PortalSupportFooter } from '@/components/portal/PortalSupportFooter';
import { PortalClientQuestions } from '@/components/portal/PortalClientQuestions';
import { PortalMessaging } from '@/components/portal/PortalMessaging';

// Phase 27 — fallback when the API somehow doesn't return a branding block.
// The DB layer always populates one (DEFAULT_BRANDING in firmBranding.ts),
// so this is defensive for older payloads / mocked test data only.
const DEFAULT_PORTAL_BRANDING: FirmBranding = {
  displayName: 'ERPLaunch',
  logoUrl: null,
  primaryColor: '#4f46e5',
  secondaryColor: '#818cf8',
  supportEmail: null,
};

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
};
const STATUS_COLORS: Record<string, string> = {
  DISCOVERY: 'bg-sky-100 text-sky-700 border-sky-200',
  SCOPING:   'bg-violet-100 text-violet-700 border-violet-200',
  BUILD:     'bg-amber-100 text-amber-700 border-amber-200',
  UAT:       'bg-orange-100 text-orange-700 border-orange-200',
  GO_LIVE:   'bg-green-100 text-green-700 border-green-200',
};
const STAGE_ORDER = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'];

const RISK_COLORS: Record<string, { badge: string; dot: string }> = {
  CRITICAL: { badge: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-400'    },
  HIGH:     { badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-400' },
  MEDIUM:   { badge: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-400'  },
  LOW:      { badge: 'bg-gray-100 text-gray-600 border-gray-200',       dot: 'bg-gray-300'   },
};

const TODO_PRIORITY_STYLES: Record<string, string> = {
  HIGH:   'bg-red-100 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-700 border-amber-200',
  LOW:    'bg-gray-100 text-gray-500 border-gray-200',
};

const DATA_STATUS_STYLES: Record<string, { label: string; style: string }> = {
  PENDING:    { label: 'Pending',    style: 'bg-gray-100 text-gray-500 border-gray-200' },
  IN_REVIEW:  { label: 'In Review',  style: 'bg-amber-100 text-amber-700 border-amber-200' },
  APPROVED:   { label: 'Approved',   style: 'bg-green-100 text-green-700 border-green-200' },
  REJECTED:   { label: 'Rejected',   style: 'bg-red-100 text-red-700 border-red-200' },
  UPLOADED:   { label: 'Uploaded',   style: 'bg-blue-100 text-blue-700 border-blue-200' },
};

// ─── Local helpers ────────────────────────────────────────────────────────────

const MEMBER_KEY = 'ofoq_portal_member';

async function fetchPortalData(token: string, memberToken?: string) {
  const url = memberToken
    ? `/engagements/portal/${token}?member=${encodeURIComponent(memberToken)}`
    : `/engagements/portal/${token}`;
  const r = await api.get(url);
  return r.data.data;
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ title, icon, badge, children, collapsible = false }: {
  title: string; icon: React.ReactNode; badge?: React.ReactNode; children: React.ReactNode; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div
        className={cn('px-6 py-4 border-b border-gray-50 flex items-center gap-3', collapsible && 'cursor-pointer')}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
      >
        <div className="h-8 w-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 flex-shrink-0">
          {icon}
        </div>
        <h2 className="text-sm font-bold text-gray-900 flex-1">{title}</h2>
        {badge}
        {collapsible && (open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />)}
      </div>
      {(!collapsible || open) && <div className="px-6 py-5">{children}</div>}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function PortalSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="h-1 w-full bg-gradient-to-r from-brand-500 via-blue-400 to-brand-600" />
      <div className="h-[108px] bg-white border-b border-gray-100 animate-pulse" />
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {[1,2,3,4].map((i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
            <div className="h-14 bg-gray-50 border-b border-gray-100" />
            <div className="p-6 space-y-3">
              <div className="h-3 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Data Collection Item ─────────────────────────────────────────────────────

function DataCollectionItem({ item, token, memberToken }: { item: any; token: string; memberToken: string | null }) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const statusInfo = DATA_STATUS_STYLES[item.status] ?? DATA_STATUS_STYLES.PENDING;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      // Phase 30 — staging flow:
      //   1. Upload to /portal/data-files/staged → stagedFileId
      //   2. Submit /portal/submissions DATA_FILE → goes to consultant
      //      pending review.
      // The legacy /portal/:token/data-collection/:itemId/upload endpoint
      // still exists for backwards compat but the SPA no longer calls it.
      const staged = await portalApi.uploadStagedFile(file);
      await portalApi.submitDataFile({
        stagedFileId: staged.stagedFileId,
        dataCollectionItemId: item.id,
        originalFilename: staged.originalName,
        sizeBytes: staged.sizeBytes,
      });
      setUploaded(true);
      // Refresh the portal payload — item status will be unchanged until
      // consultant accepts (Phase 30 keeps DataCollectionItem.status
      // PENDING until accept), but a refresh keeps the rest of the UI
      // consistent.
      qc.invalidateQueries({ queryKey: ['portal', token] });
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const canUpload = item.status !== 'APPROVED';

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="mt-1 flex-shrink-0">
        {item.status === 'APPROVED' ? (
          <FileCheck className="h-4 w-4 text-green-500" />
        ) : (
          <FolderOpen className="h-4 w-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{item.name}</p>
            {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', statusInfo.style)}>
                {statusInfo.label}
              </span>
              {item.fileCount > 0 && (
                <span className="text-[10px] text-gray-400">{item.fileCount} file{item.fileCount !== 1 ? 's' : ''} uploaded</span>
              )}
              {item.dueDate && (
                <span className="text-[10px] text-gray-400">
                  Due {new Date(item.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
            {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
          </div>
          {canUpload && memberToken && (
            <div>
              <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? (
                  <><Clock className="h-3.5 w-3.5 animate-spin" />Uploading…</>
                ) : uploaded ? (
                  <><CircleCheck className="h-3.5 w-3.5" />Uploaded!</>
                ) : (
                  <><Upload className="h-3.5 w-3.5" />Upload File</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Todo Item ────────────────────────────────────────────────────────────────

function TodoItem({ todo, token, memberToken }: { todo: any; token: string; memberToken: string | null }) {
  const qc = useQueryClient();
  const isDone = !!todo.completedAt;

  // Phase 5A: portal_token cookie is the auth credential. Legacy memberToken
  // kept only as a hint for disabled state (replaced by authenticatedMember).
  const completeMutation = useMutation({
    mutationFn: () => api.patch(`/engagements/portal/${token}/todos/${todo.id}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', token] }),
  });
  const reopenMutation = useMutation({
    mutationFn: () => api.patch(`/engagements/portal/${token}/todos/${todo.id}/reopen`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', token] }),
  });

  const priorityStyle = TODO_PRIORITY_STYLES[todo.priority] ?? TODO_PRIORITY_STYLES.MEDIUM;

  return (
    <div className={cn('flex items-start gap-3 p-3 rounded-xl border transition-all', isDone ? 'bg-gray-50 border-gray-100 opacity-70' : 'bg-white border-gray-200')}>
      <button
        onClick={() => isDone ? reopenMutation.mutate() : completeMutation.mutate()}
        disabled={completeMutation.isPending || reopenMutation.isPending || !memberToken}
        className="mt-0.5 flex-shrink-0 disabled:cursor-not-allowed"
        title={!memberToken ? 'Sign in to complete tasks' : isDone ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {isDone
          ? <CheckSquare className="h-5 w-5 text-green-500" />
          : <Square className={cn('h-5 w-5', memberToken ? 'text-gray-300 hover:text-brand-400' : 'text-gray-200')} />
        }
      </button>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold', isDone ? 'line-through text-gray-400' : 'text-gray-900')}>
          {todo.title}
        </p>
        {todo.description && <p className="text-xs text-gray-500 mt-0.5">{todo.description}</p>}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', priorityStyle)}>{todo.priority}</span>
          {todo.assignedTo && <span className="text-[10px] text-gray-400">→ {todo.assignedTo}</span>}
          {todo.dueDate && (
            <span className={cn('text-[10px] font-medium',
              new Date(todo.dueDate) < new Date() && !isDone ? 'text-red-500' : 'text-gray-400')}>
              Due {new Date(todo.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {isDone && todo.completedBy && (
            <span className="text-[10px] text-green-600">✓ Completed by {todo.completedBy}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ClientPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();

  // Member auth: from URL param (invite link) or localStorage (repeat visitor)
  const [memberToken, setMemberToken] = useState<string | null>(() => {
    const fromUrl = searchParams.get('member');
    if (fromUrl) {
      localStorage.setItem(MEMBER_KEY + '_' + token, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(MEMBER_KEY + '_' + token);
  });

  // Persist memberToken to localStorage if it came from URL
  useEffect(() => {
    const fromUrl = searchParams.get('member');
    if (fromUrl) setMemberToken(fromUrl);
  }, [searchParams]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['portal', token, memberToken],
    queryFn: () => fetchPortalData(token!, memberToken ?? undefined),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) return <PortalSkeleton />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-sm px-4">
          <div className="h-20 w-20 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
            <TriangleAlert className="h-9 w-9 text-red-300" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Portal link not found</h1>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            This link may have expired or been revoked. Please contact your implementation team.
          </p>
        </div>
      </div>
    );
  }

  const { engagement, authenticatedMember, members, risks, issues, decisions, todos, meetings, dataCollection } = data;
  // Phase 27 — branding was already in the API payload (portal.ts:235);
  // this just consumes it. Fallback covers older payloads / test mocks.
  const branding: FirmBranding = (data.branding as FirmBranding | undefined) ?? DEFAULT_PORTAL_BRANDING;
  const portalStyle = getPortalBrandingStyle(branding);
  const ps = engagement?.portalSettings ?? {};

  const stageIndex    = STAGE_ORDER.indexOf(engagement?.status ?? 'DISCOVERY');
  const openRisks     = (risks     as Array<any>).filter((r: any) => r.status === 'OPEN');
  const openIssues    = (issues    as Array<any>).filter((i: any) => ['OPEN','IN_PROGRESS'].includes(i.status));
  const recentDecs    = (decisions as Array<any>).slice(0, 5);
  const clientMembers = (members   as Array<any>).filter((m: any) => m.team === 'CLIENT' || !m.team);
  const ofoqMembers   = (members   as Array<any>).filter((m: any) => m.team === 'CONSULTANT');
  const todoList      = (todos     as Array<any>) ?? [];
  const openTodos     = todoList.filter((t: any) => !t.completedAt);
  const doneTodos     = todoList.filter((t: any) => t.completedAt);
  const meetingList   = (meetings  as Array<any>) ?? [];
  const dataItems     = (dataCollection as Array<any>) ?? [];

  const daysLeft = engagement?.contractEndDate
    ? Math.ceil((new Date(engagement.contractEndDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const hasBlockers = openRisks.some((r: any) => (r.riskScore ?? r.impact) === 'CRITICAL') ||
                      openIssues.some((i: any) => i.priority === 'CRITICAL');
  const allClear    = openRisks.length === 0 && openIssues.length === 0;

  const pendingUploads = dataItems.filter((d: any) => d.status === 'PENDING').length;
  const pendingTodos   = openTodos.length;

  return (
    <div className="min-h-screen bg-gray-50" style={portalStyle}>

      {/* Phase 27 — gradient accent strip uses firm primary→secondary colours */}
      <div className="h-1 w-full bg-gradient-to-r from-[var(--portal-primary)] to-[var(--portal-secondary)]" />

      {/* Header */}
      <header className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-3xl mx-auto px-6 py-5">
          {/* Phase 27 — branded header tile + displayName prefix surfaced via
              the shared PortalBrandedHeader component. The right-slot keeps
              the existing status-badge + on-track / needs-attention / active
              indicator + today's-date column unchanged. */}
          <PortalBrandedHeader
            branding={branding}
            clientName={engagement?.clientName}
            rightSlot={
              <div className="flex flex-col items-end gap-1.5">
                <span className={cn('text-xs font-bold px-3 py-1 rounded-full border', STATUS_COLORS[engagement?.status] ?? 'bg-gray-100 text-gray-600 border-gray-200')}>
                  {STATUS_LABELS[engagement?.status] ?? engagement?.status}
                </span>
                {allClear ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600">
                    <CircleCheck className="h-3 w-3" /> On track
                  </span>
                ) : hasBlockers ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500">
                    <AlertCircle className="h-3 w-3" /> Needs attention
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-500">
                    <Clock className="h-3 w-3" /> Active items
                  </span>
                )}
                <p className="text-[10px] text-gray-400">{today}</p>
              </div>
            }
          />

          {/* Authenticated member banner */}
          {authenticatedMember ? (
            <div className="mt-4 flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-xl px-4 py-2.5">
              <div className="h-7 w-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-brand-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-brand-800">Signed in as {authenticatedMember.name}</p>
                <p className="text-[10px] text-brand-500">{authenticatedMember.role} · {authenticatedMember.email}</p>
              </div>
              {(pendingTodos > 0 || pendingUploads > 0) && (
                <div className="ml-auto flex items-center gap-2">
                  {pendingTodos > 0 && (
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                      {pendingTodos} open action{pendingTodos !== 1 ? 's' : ''}
                    </span>
                  )}
                  {pendingUploads > 0 && (
                    <span className="text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                      {pendingUploads} pending upload{pendingUploads !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
              <User className="h-4 w-4 text-amber-600 flex-shrink-0" />
              <p className="text-xs text-amber-900 flex-1">
                Viewing as a guest. Sign in with your email to complete action items and upload files.
              </p>
              <a
                href={`/portal/${token}/login`}
                className="ml-auto text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors whitespace-nowrap"
              >
                Sign in
              </a>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-4">

        {/* Custom welcome message */}
        {ps.customMessage && (
          <div className="bg-gradient-to-r from-brand-50 to-blue-50 border border-brand-100 rounded-2xl px-6 py-4">
            <p className="text-sm text-brand-800 leading-relaxed">{ps.customMessage}</p>
          </div>
        )}

        {/* Stage Progress */}
        {ps.showStage !== false && (
          <Section title="Project Stage" icon={<BarChart2 className="h-4 w-4" />}>
            <div className="flex items-end gap-2">
              {STAGE_ORDER.map((stage, idx) => {
                const done   = stageIndex >= idx;
                const active = engagement?.status === stage;
                return (
                  <div key={stage} className="flex flex-col items-center gap-2 flex-1">
                    <div className={cn(
                      'h-2 w-full rounded-full transition-all duration-500',
                      done ? (active ? 'bg-brand-500' : 'bg-brand-300') : 'bg-gray-100'
                    )} />
                    <span className={cn('text-[10px] font-semibold whitespace-nowrap',
                      active ? 'text-brand-600' : done ? 'text-gray-500' : 'text-gray-300'
                    )}>
                      {STATUS_LABELS[stage]}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Timeline */}
        {ps.showTimeline !== false && (engagement?.startDate || engagement?.contractEndDate) && (
          <Section title="Project Timeline" icon={<CalendarDays className="h-4 w-4" />}>
            <div className="flex items-start gap-10 flex-wrap">
              {engagement?.startDate && (
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Start Date</p>
                  <p className="text-base font-bold text-gray-900">
                    {new Date(engagement.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              )}
              {engagement?.contractEndDate && (
                <div>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">Contract End</p>
                  <p className="text-base font-bold text-gray-900">
                    {new Date(engagement.contractEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  {daysLeft !== null && (
                    <p className={cn('text-xs font-bold mt-1',
                      daysLeft < 0 ? 'text-red-500' : daysLeft <= 14 ? 'text-amber-500' : 'text-green-600'
                    )}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} days remaining`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Action Items (Todos) */}
        {ps.showTodos !== false && todoList.length > 0 && (
          <Section
            title={`Action Items`}
            icon={<ListTodo className="h-4 w-4" />}
            badge={
              openTodos.length > 0 ? (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                  {openTodos.length} open
                </span>
              ) : (
                <span className="text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                  All done!
                </span>
              )
            }
            collapsible
          >
            {!memberToken && (
              <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                Use your personalised portal link to check off completed items.
              </p>
            )}
            <div className="space-y-2">
              {openTodos.map((todo: any) => (
                <TodoItem key={todo.id} todo={todo} token={token!} memberToken={memberToken} />
              ))}
              {doneTodos.length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs font-semibold text-gray-400 cursor-pointer hover:text-gray-600 transition-colors list-none flex items-center gap-1">
                    <ChevronDown className="h-3 w-3" />{doneTodos.length} completed item{doneTodos.length !== 1 ? 's' : ''}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {doneTodos.map((todo: any) => (
                      <TodoItem key={todo.id} todo={todo} token={token!} memberToken={memberToken} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </Section>
        )}

        {/* Phase 29 — Questions for you (client wizard answering).
            PortalClientQuestions returns null when no questions to show
            so this slot collapses cleanly. The Section wrapper inside
            PortalClientQuestions provides the visual frame. */}
        {!!authenticatedMember && (
          <PortalClientQuestions token={token!} authenticated={!!authenticatedMember} />
        )}

        {/* Phase 31 — Messaging (Q&A threads). Section renders only when
            authenticated. PortalMessaging shows the empty-with-CTA state
            if no threads exist yet, or the thread list / detail view
            otherwise. */}
        {!!authenticatedMember && (
          <PortalMessaging token={token!} authenticated={!!authenticatedMember} />
        )}

        {/* Data Collection */}
        {ps.showDataCollection !== false && dataItems.length > 0 && (
          <Section
            title="Data Collection"
            icon={<FolderOpen className="h-4 w-4" />}
            badge={
              pendingUploads > 0 ? (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                  {pendingUploads} pending
                </span>
              ) : undefined
            }
            collapsible
          >
            {!memberToken && (
              <p className="text-xs text-gray-400 mb-3 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                Use your personalised portal link to upload files.
              </p>
            )}
            <div className="space-y-2">
              {dataItems.map((item: any) => (
                <DataCollectionItem key={item.id} item={item} token={token!} memberToken={memberToken} />
              ))}
            </div>
          </Section>
        )}

        {/* Committee */}
        {(ps.showClientTeam !== false || ps.showConsultantTeam !== false) && members?.length > 0 && (
          <Section title="Project Committee" icon={<Users className="h-4 w-4" />}>
            <div className={cn('gap-8', clientMembers.length > 0 && ofoqMembers.length > 0 ? 'grid grid-cols-2' : 'flex')}>
              {ps.showClientTeam !== false && clientMembers.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-blue-600 uppercase tracking-wider mb-3">Client Team</p>
                  <div className="space-y-3">
                    {clientMembers.map((m: any) => (
                      <div key={m.id} className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-blue-700 text-xs font-bold flex-shrink-0">
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                          {m.role && <p className="text-xs text-gray-400">{m.role}</p>}
                          {m.email && <a href={`mailto:${m.email}`} className="text-xs text-blue-500 hover:underline">{m.email}</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ps.showConsultantTeam !== false && ofoqMembers.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-violet-600 uppercase tracking-wider mb-3">Implementation Team</p>
                  <div className="space-y-3">
                    {ofoqMembers.map((m: any) => (
                      <div key={m.id} className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-100 to-violet-200 flex items-center justify-center text-violet-700 text-xs font-bold flex-shrink-0">
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                          {m.role && <p className="text-xs text-gray-400">{m.role}</p>}
                          {m.email && <a href={`mailto:${m.email}`} className="text-xs text-violet-500 hover:underline">{m.email}</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Open Risks */}
        {ps.showRisks !== false && openRisks.length > 0 && (
          <Section title={`Open Risks (${openRisks.length})`} icon={<TriangleAlert className="h-4 w-4" />} collapsible>
            <div className="space-y-2.5">
              {openRisks.map((r: any) => {
                const level = r.riskScore ?? r.impact ?? 'LOW';
                const style = RISK_COLORS[level] ?? RISK_COLORS.LOW;
                return (
                  <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className={cn('mt-1.5 h-2 w-2 rounded-full flex-shrink-0', style.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">{r.title}</p>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', style.badge)}>{level}</span>
                      </div>
                      {r.description && <p className="text-xs text-gray-500">{r.description}</p>}
                      {r.mitigation && <p className="text-xs text-gray-400 mt-1 italic">Mitigation: {r.mitigation}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Open Issues */}
        {ps.showIssues !== false && openIssues.length > 0 && (
          <Section title={`Open Issues (${openIssues.length})`} icon={<Clock className="h-4 w-4" />} collapsible>
            <div className="space-y-2.5">
              {openIssues.map((i: any) => {
                const style = RISK_COLORS[i.priority] ?? RISK_COLORS.LOW;
                return (
                  <div key={i.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className={cn('mt-1.5 h-2 w-2 rounded-full flex-shrink-0', style.dot)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-semibold text-gray-900">{i.title}</p>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', style.badge)}>{i.priority}</span>
                      </div>
                      {i.description && <p className="text-xs text-gray-500">{i.description}</p>}
                      {i.assignedTo && <p className="text-xs text-gray-400 mt-1">Assigned: <span className="font-semibold">{i.assignedTo}</span></p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Meetings */}
        {ps.showMeetings === true && meetingList.length > 0 && (
          <Section title="Meetings" icon={<CalendarClock className="h-4 w-4" />} collapsible>
            <div className="space-y-2.5">
              {meetingList.map((m: any) => {
                const meetingDate = m.date ?? m.scheduledAt;
                return (
                  <div key={m.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="h-2 w-2 rounded-full bg-brand-300 mt-2 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{m.title}</p>
                      {meetingDate && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(meetingDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                      {m.notes && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{m.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Recent Decisions */}
        {ps.showDecisions === true && recentDecs.length > 0 && (
          <Section title="Recent Decisions" icon={<BookOpen className="h-4 w-4" />} collapsible>
            <div className="space-y-2.5">
              {recentDecs.map((d: any) => (
                <div key={d.id} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="h-1.5 w-1.5 rounded-full bg-brand-400 mt-2 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{d.title}</p>
                    {d.rationale && <p className="text-xs text-gray-500 mt-0.5">{d.rationale}</p>}
                    <p className="text-[10px] text-gray-400 mt-1">
                      {d.decidedBy && `${d.decidedBy} · `}
                      {d.decidedAt ? new Date(d.decidedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* All-clear state */}
        {ps.showRisks !== false && ps.showIssues !== false && openRisks.length === 0 && openIssues.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="h-14 w-14 rounded-full bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center mx-auto mb-4 shadow-sm">
              <CircleCheck className="h-7 w-7 text-green-500" />
            </div>
            <p className="text-sm font-bold text-gray-800">No open risks or issues</p>
            <p className="text-xs text-gray-400 mt-1">Your project is on track — great work!</p>
          </div>
        )}

        <PortalSupportFooter branding={branding} className="mt-8 text-center" />

        <div className="text-center py-4">
          <p className="text-[10px] text-gray-300 font-medium">Powered by ERPLaunch</p>
        </div>
      </main>
    </div>
  );
}
