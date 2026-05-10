import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, FileText, Loader2, Sparkles, ExternalLink, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, Eye,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  PermissionDeniedState,
  extractPermissionDenied,
} from '@/components/rbac/PermissionDeniedState';

/**
 * Phase 46.8.3 — Proposal management UI.
 *
 * Lives at /sales/prospects/:id/proposal. Lets the sales rep:
 *   - Generate a new PROPOSAL artifact (creates a GenerationJob;
 *     the existing engagementsApi.createJob does the heavy lifting)
 *   - See every PROPOSAL job ever generated for this engagement
 *     (= version history) with status pills
 *   - Preview each generated document inline (Phase 39.3 deliverable
 *     browser, scoped to the Proposal/ subtree)
 *   - Regenerate (creates a new job; the old ones stay around)
 *
 * Status transitions (DRAFT → SENT → ACCEPTED/DECLINED) are tracked
 * via Phase 46.4-style activity events. The "Send to client" /
 * "Mark accepted" / "Mark declined" buttons emit those activity
 * entries and the UI shows the latest status pill on the version row.
 *
 * Per-prospect pricing inputs (validity period, per-module overrides,
 * "Why Us" template selector) currently route to FirmSettings via
 * Phase 46.8.6's editor. The "Configure" button on the page deep-
 * links there until per-prospect overrides land in a future sweep.
 */

interface Job {
  id: string;
  engagementId: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
}

type ProposalLifecycleStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

interface ActivityEntry {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
}

const PROPOSAL_DOC_LABELS: Record<string, string> = {
  'Cover_Letter.docx': 'Cover Letter',
  'Executive_Summary.html': 'Executive Summary',
  'Solution_Overview.html': 'Solution Overview',
  'Implementation_Approach.html': 'Implementation Approach',
  'Pricing_Schedule.docx': 'Pricing Schedule',
  'Why_Us.docx': 'Why Us',
  'Terms_and_Conditions.docx': 'Terms and Conditions',
};

const STATUS_STYLES: Record<ProposalLifecycleStatus, { chip: string; label: string }> = {
  DRAFT: { chip: 'bg-slate-100 text-slate-600', label: 'Draft' },
  SENT: { chip: 'bg-sky-100 text-sky-700', label: 'Sent' },
  ACCEPTED: { chip: 'bg-emerald-100 text-emerald-700', label: 'Accepted' },
  DECLINED: { chip: 'bg-red-100 text-red-700', label: 'Declined' },
  EXPIRED: { chip: 'bg-amber-100 text-amber-800', label: 'Expired' },
};

export function SalesProposalPage() {
  const { id } = useParams<{ id: string }>();
  const engagementId = id ?? '';
  const qc = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['proposal-jobs', engagementId],
    queryFn: async (): Promise<Job[]> => {
      const all = (await engagementsApi.listJobs(engagementId)) as Job[];
      return all.filter((j) => j.type === 'PROPOSAL').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    enabled: !!engagementId,
    refetchInterval: (q) => {
      // Poll while any job is QUEUED/RUNNING.
      const data = q.state.data as Job[] | undefined;
      return data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 2000 : false;
    },
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const activityQuery = useQuery({
    queryKey: ['proposal-activity', engagementId],
    queryFn: async (): Promise<ActivityEntry[]> => {
      const all = (await engagementsApi.getActivity(engagementId)) as ActivityEntry[];
      return all.filter((a) =>
        ['PROPOSAL_GENERATED', 'PROPOSAL_SENT', 'PROPOSAL_ACCEPTED', 'PROPOSAL_DECLINED'].includes(a.action),
      );
    },
    enabled: !!engagementId,
    retry: (count, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) return false;
      return count < 3;
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => engagementsApi.createJob(engagementId, 'PROPOSAL'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal-jobs', engagementId] });
      qc.invalidateQueries({ queryKey: ['proposal-activity', engagementId] });
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (action: 'PROPOSAL_SENT' | 'PROPOSAL_ACCEPTED' | 'PROPOSAL_DECLINED') =>
      engagementsApi.logActivity(engagementId, action, ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposal-activity', engagementId] });
    },
  });

  const denied = extractPermissionDenied(jobsQuery.error);
  if (denied) {
    return (
      <PermissionDeniedState
        requiredRole={denied.requiredRole}
        verb="edit"
        resourceLabel="this prospect's proposal"
      />
    );
  }

  if (!engagementId) {
    return <p className="p-8 text-sm text-slate-500">Missing prospect id.</p>;
  }

  const jobs = jobsQuery.data ?? [];
  const latestStatus = deriveProposalStatus(jobs[0], activityQuery.data ?? []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-5">
          <Link
            to="/sales/pipeline"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 mb-3"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to pipeline
          </Link>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <FileText className="h-5 w-5 text-indigo-600" />
                <h1 className="text-2xl font-bold text-slate-900">Proposal</h1>
                {latestStatus && <StatusPill status={latestStatus} />}
              </div>
              <p className="text-sm text-slate-500">
                Generate a 7-document proposal bundle from the Discovery Lite answers and your
                firm's pricing defaults.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/settings/sales-templates"
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Configure templates
              </Link>
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || jobsQuery.isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                data-testid="proposal-generate"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : jobs.length > 0 ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {jobs.length > 0 ? 'Regenerate' : 'Generate proposal'}
              </button>
            </div>
          </div>
        </div>

        {/* Lifecycle action bar */}
        {jobs[0]?.status === 'COMPLETE' && (
          <LifecycleBar
            currentStatus={latestStatus}
            onAction={(action) => lifecycleMutation.mutate(action)}
            pending={lifecycleMutation.isPending}
          />
        )}

        {/* Version history */}
        {jobsQuery.isLoading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 flex items-center justify-center text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading proposal history…
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState onGenerate={() => generateMutation.mutate()} pending={generateMutation.isPending} />
        ) : (
          <div className="space-y-3">
            {jobs.map((job, idx) => (
              <ProposalVersionCard
                key={job.id}
                engagementId={engagementId}
                job={job}
                isLatest={idx === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function deriveProposalStatus(
  latestJob: Job | undefined,
  activity: ReadonlyArray<ActivityEntry>,
): ProposalLifecycleStatus | null {
  if (!latestJob) return null;
  if (latestJob.status !== 'COMPLETE') return 'DRAFT';
  // Walk the activity log looking for ACCEPTED / DECLINED / SENT
  // entries newer than the latest job creation.
  const jobMs = new Date(latestJob.createdAt).getTime();
  const newer = activity.filter((a) => new Date(a.createdAt).getTime() >= jobMs);
  if (newer.find((a) => a.action === 'PROPOSAL_ACCEPTED')) return 'ACCEPTED';
  if (newer.find((a) => a.action === 'PROPOSAL_DECLINED')) return 'DECLINED';
  if (newer.find((a) => a.action === 'PROPOSAL_SENT')) return 'SENT';
  return 'DRAFT';
}

function StatusPill({ status }: { status: ProposalLifecycleStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider', s.chip)}
      data-testid={`proposal-status-${status}`}
    >
      {s.label}
    </span>
  );
}

function LifecycleBar({
  currentStatus,
  onAction,
  pending,
}: {
  currentStatus: ProposalLifecycleStatus | null;
  onAction: (action: 'PROPOSAL_SENT' | 'PROPOSAL_ACCEPTED' | 'PROPOSAL_DECLINED') => void;
  pending: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-2">
      <p className="text-xs text-slate-500 mr-2">Mark proposal as:</p>
      <button
        type="button"
        onClick={() => onAction('PROPOSAL_SENT')}
        disabled={pending || currentStatus === 'SENT'}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200 disabled:opacity-40"
        data-testid="proposal-mark-sent"
      >
        Sent to client
      </button>
      <button
        type="button"
        onClick={() => onAction('PROPOSAL_ACCEPTED')}
        disabled={pending || currentStatus === 'ACCEPTED'}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 disabled:opacity-40"
        data-testid="proposal-mark-accepted"
      >
        Accepted
      </button>
      <button
        type="button"
        onClick={() => onAction('PROPOSAL_DECLINED')}
        disabled={pending || currentStatus === 'DECLINED'}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-40"
        data-testid="proposal-mark-declined"
      >
        Declined
      </button>
    </div>
  );
}

function EmptyState({ onGenerate, pending }: { onGenerate: () => void; pending: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center mb-4">
        <FileText className="h-7 w-7 text-indigo-600" />
      </div>
      <p className="text-base font-semibold text-slate-700 mb-2">No proposal generated yet</p>
      <p className="text-sm text-slate-500 max-w-md mx-auto mb-4">
        Once you have Discovery Lite answers, click below to generate the cover letter, executive
        summary, solution overview, pricing schedule, and supporting docs in one go.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={pending}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
        data-testid="proposal-empty-generate"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Generate proposal
      </button>
    </div>
  );
}

function ProposalVersionCard({
  engagementId,
  job,
  isLatest,
}: {
  engagementId: string;
  job: Job;
  isLatest: boolean;
}) {
  const [expanded, setExpanded] = useState(isLatest);
  const filesQuery = useQuery({
    queryKey: ['proposal-files', engagementId, job.id],
    queryFn: () => engagementsApi.listJobFiles(engagementId, job.id),
    enabled: expanded && job.status === 'COMPLETE',
  });

  return (
    <div
      className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
      data-testid={`proposal-version-${job.id}`}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <JobStatusIcon status={job.status} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              Proposal {isLatest && <span className="text-xs text-indigo-600 ml-1">(latest)</span>}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Generated{' '}
              {new Date(job.createdAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {job.completedAt && (
                <>
                  {' · finished in '}
                  {Math.max(
                    1,
                    Math.round(
                      (new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000,
                    ),
                  )}
                  s
                </>
              )}
            </p>
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500">
          {job.status}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/30">
          {job.status !== 'COMPLETE' ? (
            <p className="text-xs text-slate-500 italic">
              Files appear here once generation finishes.
            </p>
          ) : filesQuery.isLoading ? (
            <p className="text-xs text-slate-400 inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading files…
            </p>
          ) : (
            <ProposalFileList
              engagementId={engagementId}
              jobId={job.id}
              tree={filesQuery.data as FileTreeNode | undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface FileTreeNode {
  name: string;
  type: 'dir' | 'file';
  size?: number;
  children?: FileTreeNode[];
}

function ProposalFileList({
  engagementId,
  jobId,
  tree,
}: {
  engagementId: string;
  jobId: string;
  tree: FileTreeNode | undefined;
}) {
  const files = useMemo(() => collectProposalFiles(tree), [tree]);

  if (files.length === 0) {
    return (
      <div className="text-xs text-slate-500 italic flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        No proposal files found.
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="proposal-file-list">
      {files.map((f) => {
        const filename = f.split('/').pop() ?? f;
        const label = PROPOSAL_DOC_LABELS[filename] ?? filename;
        const url = engagementsApi.jobFileUrl(engagementId, jobId, f);
        const isHtml = filename.endsWith('.html');
        return (
          <a
            key={f}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-white transition-colors"
            data-testid={`proposal-file-${filename}`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isHtml ? (
                <Eye className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
              )}
              <span className="text-sm text-slate-800 truncate">{label}</span>
              <span className="text-[10px] text-slate-400 font-mono truncate">{filename}</span>
            </span>
            <ExternalLink className="h-3 w-3 text-slate-400 flex-shrink-0" />
          </a>
        );
      })}
    </div>
  );
}

function collectProposalFiles(tree: FileTreeNode | undefined): string[] {
  if (!tree) return [];
  const out: string[] = [];
  const walk = (node: FileTreeNode, prefix: string) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === 'file') {
      // Only include files under the Proposal/ directory.
      if (path.startsWith('Proposal/')) out.push(path);
      return;
    }
    for (const c of node.children ?? []) walk(c, path);
  };
  // tree itself can be the root dir (name=''); start from its children
  // when present so we don't double-prefix.
  if (tree.type === 'dir') {
    for (const c of tree.children ?? []) walk(c, tree.name === '' ? '' : tree.name);
  } else {
    walk(tree, '');
  }
  return out.sort();
}

function JobStatusIcon({ status }: { status: Job['status'] }) {
  if (status === 'COMPLETE') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === 'FAILED') return <AlertTriangle className="h-4 w-4 text-red-500" />;
  return <Clock className="h-4 w-4 text-amber-500" />;
}

// Re-export the pure helper for tests.
export { collectProposalFiles, deriveProposalStatus };
export type { ActivityEntry };
