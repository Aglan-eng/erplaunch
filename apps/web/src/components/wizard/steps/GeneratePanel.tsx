import React, { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Zap, Download, Loader, CircleCheck, CircleX, Code, Package, Archive, FileText } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { SectionIntroCard } from '../SectionIntroCard';
import { Button } from '@/components/ui/Button';
import { useConflictStore } from '@/stores/conflictStore';
import { ConflictBanner } from '../ConflictBanner';

interface GeneratePanelProps {
  engagementId: string;
}

interface Job {
  id: string;
  type: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  outputUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export function GeneratePanel({ engagementId }: GeneratePanelProps) {
  const hasBlocks = useConflictStore((s) => s.hasBlocks());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Phase 6: surface the active adaptor's generator catalog so the Generate
  // panel can (a) advertise what the pack will actually contain and
  // (b) customize its copy for non-NetSuite engagements.
  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: !!engagementId,
    retry: false,
    staleTime: 60_000,
  });
  const generatorsQuery = useQuery({
    queryKey: ['engagement-generators', engagementId],
    queryFn: () => engagementsApi.getGenerators(engagementId),
    enabled: !!engagementId,
    retry: false,
    staleTime: 60_000,
  });

  const adaptorSource = adaptorQuery.data?.source ?? 'built-in';
  const adaptorId = adaptorQuery.data?.id ?? 'netsuite';
  const isNetSuite = adaptorId === 'netsuite';
  const adaptorName = useMemo(() => {
    const manifest = adaptorQuery.data?.manifest as { name?: string } | undefined;
    return manifest?.name ?? (isNetSuite ? 'NetSuite' : 'Platform');
  }, [adaptorQuery.data, isNetSuite]);
  const generators = generatorsQuery.data ?? [];

  // Poll job status when active
  const { data: jobData } = useQuery({
    queryKey: ['job', engagementId, activeJobId],
    queryFn: () => engagementsApi.getJob(engagementId, activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const job = query.state.data as Job | undefined;
      if (!job) return 1500;
      return job.status === 'COMPLETE' || job.status === 'FAILED' ? false : 1500;
    },
  });

  const job = jobData as Job | undefined;

  // List previous jobs
  const { data: jobsData, refetch: refetchJobs } = useQuery({
    queryKey: ['jobs', engagementId],
    queryFn: () => engagementsApi.listJobs(engagementId),
  });

  const jobs = (jobsData as Job[] | undefined) ?? [];

  const createJobMutation = useMutation({
    mutationFn: (type: string) => engagementsApi.createJob(engagementId, type),
    onSuccess: (data: Job) => {
      setActiveJobId(data.id);
      refetchJobs();
    },
  });

  const isRunning = job?.status === 'QUEUED' || job?.status === 'RUNNING';

  return (
    <div className="max-w-2xl mx-auto">
      <SectionIntroCard
        title="Generate Package"
        description={
          isNetSuite
            ? 'Generate a NetSuite SDF deployment package + platform-neutral documentation (BRD, Solution Design, UAT, Training, Implementation Plan, Risk Register).'
            : `Generate the documentation pack for this ${adaptorName} engagement — BRD, Solution Design, UAT, Training, Implementation Plan, Risk Register. NetSuite-only artifacts (SDF, SuiteScript) are skipped for non-NetSuite adaptors.`
        }
        icon={<Zap className="h-5 w-5" />}
      />

      {/* Generator catalog preview — what will land in the pack */}
      {generators.length > 0 && (
        <div className="mt-4 bg-white rounded-xl border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <FileText className="h-4 w-4 text-brand-500" />
            <h4 className="text-sm font-semibold text-gray-900">
              {adaptorSource === 'custom' ? 'Custom adaptor catalog' : `${adaptorName} catalog`}
            </h4>
            <span className="text-[10px] font-mono text-gray-400">{adaptorId}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {generators.map((g) => (
              <span
                key={g.id}
                title={`${g.label} · ${g.kind} · ${g.outputMime}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-0.5"
              >
                {g.label}
              </span>
            ))}
          </div>
          {!isNetSuite && (
            <p className="mt-2 text-[11px] text-gray-400 italic">
              Phase 6 ships platform-neutral documents for any non-NetSuite adaptor.
              Adaptor-native generators (Odoo XML-RPC push, Dynamics extensions,
              etc.) land in a later phase.
            </p>
          )}
        </div>
      )}

      {/* Conflict summary */}
      <ConflictBanner />

      {hasBlocks && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
          <CircleX className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Cannot generate</p>
            <p className="text-sm text-red-700 mt-0.5">
              Resolve all blocking issues in the wizard before generating the package.
            </p>
          </div>
        </div>
      )}

      {/* Generate button */}
      <div className="mt-6 flex gap-3">
        <Button
          onClick={() => createJobMutation.mutate('BUSINESS_PROFILE')}
          loading={createJobMutation.isPending || isRunning}
          disabled={hasBlocks}
          size="lg"
          className="flex-1"
        >
          <Zap className="h-4 w-4" />
          {isRunning ? 'Generating…' : 'Generate Business Profile JSON'}
        </Button>
      </div>

      {/* Active job status */}
      {job && (
        <div className="mt-4">
          <JobStatusCard job={job} engagementId={engagementId} isNetSuite={isNetSuite} />
        </div>
      )}

      {/* Previous jobs */}
      {jobs.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Previous Jobs</h3>
          <div className="space-y-2">
            {jobs.slice(0, 5).map((j: Job) => (
              <JobStatusCard key={j.id} job={j} compact engagementId={engagementId} isNetSuite={isNetSuite} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function JobStatusCard({ job, compact, engagementId, isNetSuite }: { job: Job; compact?: boolean; engagementId: string; isNetSuite: boolean }) {
  const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  return (
    <div className={`rounded-lg border bg-white p-4 ${
      job.status === 'COMPLETE' ? 'border-green-200' :
      job.status === 'FAILED' ? 'border-red-200' :
      'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {job.status === 'QUEUED' || job.status === 'RUNNING' ? (
            <Loader className="h-4 w-4 animate-spin text-brand-500" />
          ) : job.status === 'COMPLETE' ? (
            <CircleCheck className="h-4 w-4 text-green-500" />
          ) : (
            <CircleX className="h-4 w-4 text-red-500" />
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">
              {job.type.replace('_', ' ')}
            </p>
            {!compact && (
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(job.createdAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        {job.status === 'COMPLETE' && job.outputUrl && (
          <div className="flex flex-col items-end gap-1.5">
            {/* Full package download */}
            <a
              href={`${baseUrl}/api/v1/engagements/${engagementId}/jobs/${job.id}/download`}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition-colors shadow-sm"
            >
              <Archive className="h-4 w-4" />
              Download Full Package
            </a>
            <div className="w-full border-t border-gray-100 my-1" />
            <p className="text-xs text-gray-400 self-end">Individual files:</p>
            {/* Documentation */}
            <a
              href={`${baseUrl}${job.outputUrl}/Documentation/BRD.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              BRD
            </a>
            <a
              href={`${baseUrl}${job.outputUrl}/Documentation/Solution_Design.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Solution Design
            </a>
            <a
              href={`${baseUrl}${job.outputUrl}/Documentation/Training_Manual.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Training Manual
            </a>
            <a
              href={`${baseUrl}${job.outputUrl}/Documentation/UAT_Plan.html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              UAT Plan
            </a>

            {/* NetSuite-only deployment scripts — hidden for non-NetSuite
                adaptors where SDF + SuiteScript aren't emitted by the runner. */}
            {isNetSuite && (
              <>
                {!compact && <div className="w-full border-t border-gray-100 my-0.5" />}
                <a
                  href={`${baseUrl}${job.outputUrl}/SDF/AccountConfiguration/features.xml`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 border border-orange-200 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
                >
                  <Package className="h-3.5 w-3.5" />
                  SDF Config XML
                </a>
                <a
                  href={`${baseUrl}${job.outputUrl}/SuiteScript/NSIX_UE_CustomisationBase.js`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  <Code className="h-3.5 w-3.5" />
                  SuiteScript
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {job.status === 'FAILED' && job.errorMessage && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 rounded p-2">{job.errorMessage}</p>
      )}
    </div>
  );
}
