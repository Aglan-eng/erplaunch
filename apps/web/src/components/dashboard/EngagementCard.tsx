import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, TriangleAlert, CircleX, Clock, Layers, Plus, Trash2, Download, Bird, ShoppingCart, Factory, Package, Briefcase, Heart, CalendarDays, Loader } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn } from '@/lib/utils';
import { engagementsApi } from '@/lib/api';
import { NewVerticalWorkspaceModal } from './NewVerticalWorkspaceModal';

const ICON_MAP: Record<string, React.ElementType> = {
  Bird, ShoppingCart, Factory, Package, Briefcase, Heart,
};

function VerticalIcon({ iconId, className }: { iconId: string; className?: string }) {
  const Icon = ICON_MAP[iconId] ?? Layers;
  return <Icon className={className} />;
}

interface EngagementCardProps {
  engagement: {
    id: string;
    clientName: string;
    status: string;
    updatedAt: string;
    adaptorId?: string;
    profile?: { completeness: Record<string, number>; updatedAt: string } | null;
    conflicts?: Array<{ severity: string }>;
    jobs?: Array<{ status: string; createdAt: string }>;
  };
}

function adaptorLabel(adaptorId?: string): string {
  if (!adaptorId || adaptorId === 'netsuite') return 'NetSuite';
  if (adaptorId === 'odoo') return 'Odoo';
  if (adaptorId.startsWith('custom:')) return `Custom · ${adaptorId.slice('custom:'.length)}`;
  return adaptorId;
}

const STATUS_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery',
  SCOPING: 'Scoping',
  BLUEPRINT: 'Blueprint',
  BUILD: 'Build',
  UAT: 'UAT',
  GO_LIVE: 'Go-Live',
  CLOSED: 'Closed',
};

export function EngagementCard({ engagement }: EngagementCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showVerticalModal, setShowVerticalModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.delete(engagement.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engagements'] });
    },
  });

  // Phase 47.2 — Quick-download for the Microsoft Project Schedule XML.
  // Strategy: try the latest-existing endpoint first (instant download
  // when a recent job is on disk). On 404 / NO_PROJECT_PLAN, fire a
  // fresh MS_PROJECT_PLAN job and poll until COMPLETE, then trigger the
  // browser download. We intentionally don't block the kanban click —
  // generation is fast (<1s for the schedule) and the loading state
  // sits on the icon itself.
  async function handleProjectPlanDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (planLoading) return;
    setPlanError(null);
    setPlanLoading(true);
    try {
      const baseUrl = import.meta.env.VITE_API_URL || '';
      const latestUrl = `${baseUrl}/api/v1/engagements/${engagement.id}/project-plan/latest.xml`;
      let downloadUrl: string | null = null;
      try {
        const probe = await fetch(latestUrl, { credentials: 'include' });
        if (probe.ok) {
          downloadUrl = latestUrl;
        }
      } catch {
        // Fall through to generate path.
      }
      if (!downloadUrl) {
        const job = await engagementsApi.createJob(engagement.id, 'MS_PROJECT_PLAN');
        const jobId = (job as { id: string }).id;
        // Poll the job until COMPLETE (or FAILED). Cap at 30s — schedule
        // generation is sub-second; anything past 30s is a backend issue.
        const startMs = Date.now();
        for (;;) {
          const fresh = (await engagementsApi.getJob(engagement.id, jobId)) as {
            status: string;
            errorMessage?: string | null;
          };
          if (fresh.status === 'COMPLETE') break;
          if (fresh.status === 'FAILED') {
            throw new Error(fresh.errorMessage ?? 'Project plan generation failed.');
          }
          if (Date.now() - startMs > 30_000) {
            throw new Error('Project plan generation timed out after 30s.');
          }
          await new Promise((r) => setTimeout(r, 800));
        }
        downloadUrl = `${baseUrl}/api/v1/engagements/${engagement.id}/jobs/${jobId}/files/Project_Plan.xml`;
      }
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${engagement.clientName} - Project Plan.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Project plan download failed.');
    } finally {
      setPlanLoading(false);
    }
  }

  const completeness = engagement.profile?.completeness ?? {};
  const values = Object.values(completeness).filter((v) => typeof v === 'number') as number[];
  const avgProgress = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

  const blocks = engagement.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
  const warns = engagement.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;

  const lastJob = engagement.jobs?.[0];

  // Load vertical workspaces for this engagement
  const { data: verticalWorkspaces } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ['verticalWorkspaces', engagement.id],
    queryFn: () => engagementsApi.listVerticalWorkspaces(engagement.id),
  });

  const hasVerticals = (verticalWorkspaces?.length ?? 0) > 0;

  return (
    <>
      <div className="w-full rounded-xl border border-gray-100 bg-white shadow-sm hover:shadow-md hover:border-brand-200 transition-all duration-200 overflow-hidden">
        {/* Main card */}
        <button
          onClick={() => navigate(`/engagements/${engagement.id}/wizard`)}
          className="group w-full p-5 text-left block"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-gray-900 truncate group-hover:text-brand-700 transition-colors">
                {engagement.clientName}
              </h3>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <Badge variant="default">{STATUS_LABELS[engagement.status] ?? engagement.status}</Badge>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                  title={`Platform adaptor: ${engagement.adaptorId ?? 'netsuite'}`}
                >
                  <Layers className="h-2.5 w-2.5" />
                  {adaptorLabel(engagement.adaptorId)}
                </span>
                {blocks > 0 && (
                  <Badge variant="block">
                    <CircleX className="h-3 w-3" />
                    {blocks} block{blocks !== 1 ? 's' : ''}
                  </Badge>
                )}
                {warns > 0 && (
                  <Badge variant="warn">
                    <TriangleAlert className="h-3 w-3" />
                    {warns} warning{warns !== 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
              {/* Phase 47.2 — quick-download for the Microsoft Project
                  Schedule XML. Click → either grab the latest existing
                  /project-plan/latest.xml or kick off a fresh job and
                  poll until ready. Loading state shows a spinner on the
                  icon itself so the click target stays in place. */}
              <button
                onClick={handleProjectPlanDownload}
                disabled={planLoading}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-all disabled:opacity-100 disabled:text-brand-500"
                title={
                  planLoading
                    ? 'Generating project plan…'
                    : 'Download Microsoft Project schedule (XML)'
                }
              >
                {planLoading ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarDays className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const url = `/api/v1/engagements/${engagement.id}/export/all`;
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${engagement.clientName}-export.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-300 hover:text-brand-500 hover:bg-brand-50 transition-all"
                title="Export engagement data"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all"
                title="Delete project"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-brand-500 transition-colors" />
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-gray-500">Questionnaire</span>
              <span className="text-xs font-medium text-gray-700">{avgProgress}%</span>
            </div>
            <ProgressBar value={avgProgress} size="sm" color={avgProgress === 100 ? 'green' : 'brand'} />
          </div>

          {/* Phase 47.2 — Project plan download error surface. Uses <span>
              not <p> because we're nested inside a <button> and only
              phrasing content is valid HTML there. */}
          {planError && (
            <span className="mt-2 block text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
              {planError}
            </span>
          )}

          {/* Footer */}
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="h-3 w-3" />
              {new Date(engagement.updatedAt).toLocaleDateString()}
            </div>
            {lastJob && (
              <span
                className={cn('text-xs font-medium px-1.5 py-0.5 rounded', {
                  'bg-green-50 text-green-600': lastJob.status === 'COMPLETE',
                  'bg-amber-50 text-amber-600': lastJob.status === 'RUNNING' || lastJob.status === 'QUEUED',
                  'bg-red-50 text-red-600': lastJob.status === 'FAILED',
                })}
              >
                {lastJob.status}
              </span>
            )}
          </div>
        </button>

        {/* Vertical workspaces section */}
        <div className="border-t border-gray-50 bg-gray-50/50 px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <Layers className="h-3 w-3" /> Vertical Workspaces
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); setShowVerticalModal(true); }}
              className="flex items-center gap-0.5 text-[10px] font-semibold text-brand-600 hover:text-brand-800 transition-colors"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>

          {hasVerticals ? (
            <div className="flex flex-wrap gap-2">
              {(verticalWorkspaces ?? []).map((ws) => {
                const meta = ws.verticalMeta as Record<string, unknown> | null;
                return (
                  <button
                    key={ws.id as string}
                    onClick={(e) => { e.stopPropagation(); navigate(`/engagements/${ws.id}/vertical`); }}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-all hover:shadow-sm',
                      meta ? `${meta.color as string} border-transparent` : 'bg-gray-100 text-gray-600 border-gray-200',
                    )}
                  >
                    {meta && (
                      <VerticalIcon iconId={meta.iconId as string} className={cn('h-3 w-3', meta.textColor as string)} />
                    )}
                    <span className={meta ? (meta.textColor as string) : 'text-gray-600'}>
                      {meta ? meta.name as string : ws.clientName as string}
                    </span>
                    {!!meta?.tag && (
                      <span className="text-[8px] font-black text-amber-600 opacity-70">★</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-400">No vertical workspaces — click Add to link a specialized implementation</p>
          )}
        </div>
      </div>

      {showVerticalModal && (
        <NewVerticalWorkspaceModal
          engagementId={engagement.id}
          onClose={() => setShowVerticalModal(false)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-50 mx-auto mb-4">
              <Trash2 className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-center text-base font-semibold text-gray-900 mb-1">Delete Project</h3>
            <p className="text-center text-sm text-gray-500 mb-6">
              Are you sure you want to delete <span className="font-medium text-gray-700">"{engagement.clientName}"</span>? This action cannot be undone and all associated data will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-sm font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
