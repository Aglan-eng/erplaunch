import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, CheckCircle2, Zap, FileText, Package } from 'lucide-react';
import { engagementsApi } from '@/lib/api';

/**
 * Compact, read-only panel that shows which PlatformAdaptor is driving this
 * engagement and a summary of what it ships (schema coverage, license model,
 * phase plan, generator catalog). Non-breaking — mounts inline in the
 * existing Implementation Summary until Phase 3C routes the wizard through
 * the adaptor for real.
 */
export function AdaptorPanel({ engagementId }: { engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-adaptor', engagementId],
    queryFn: () => engagementsApi.getAdaptor(engagementId),
    enabled: !!engagementId,
    retry: false,
  });

  if (isLoading) {
    return <AdaptorPanelFrame title="Loading adaptor…" body={<div className="h-16 bg-gray-100 rounded animate-pulse" />} />;
  }

  if (error || !data) {
    return (
      <AdaptorPanelFrame
        title="Platform adaptor"
        body={<p className="text-xs text-gray-500">Adaptor metadata unavailable for this engagement.</p>}
      />
    );
  }

  const manifest = data.manifest as { id?: string; name?: string; tagline?: string; vendor?: string; version?: string };
  const schema = data.schema;
  const license = data.license as { editions?: unknown[]; modules?: unknown[]; defaultEditionId?: string } | null;
  const phases = data.phases as { defaultPhases?: unknown[] } | null;
  const generators = Array.isArray(data.generators) ? data.generators : [];

  const flowCount = Array.isArray(schema?.flows) ? schema.flows.length : 0;
  const questionCount = Array.isArray(schema?.flows)
    ? schema.flows.reduce((sum, f) => sum + (Array.isArray(f.sections) ? f.sections.reduce((s, sec) => s + (Array.isArray(sec.questions) ? sec.questions.length : 0), 0) : 0), 0)
    : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 px-6 py-5 border-b border-gray-50 bg-gradient-to-br from-brand-50/40 to-white">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm flex-shrink-0">
          <Layers className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-bold text-gray-900">{manifest.name ?? data.id}</h3>
            <span className="text-[10px] font-mono text-gray-400">{data.id}</span>
            <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${data.source === 'custom' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600'}`}>
              {data.source === 'custom' ? 'Custom' : 'Built-in'}
            </span>
          </div>
          {manifest.tagline && <p className="text-xs text-gray-500 italic mt-0.5">{manifest.tagline}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
            {manifest.vendor && <span>Vendor · {manifest.vendor}</span>}
            {manifest.version && <span>· v{manifest.version}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-50 border-b border-gray-50">
        <PanelStat label="Flows" value={flowCount} icon={<Layers className="h-3 w-3" />} />
        <PanelStat label="Questions" value={questionCount} icon={<FileText className="h-3 w-3" />} />
        <PanelStat label="Editions" value={license?.editions?.length ?? 0} icon={<CheckCircle2 className="h-3 w-3" />} />
        <PanelStat label="Modules" value={license?.modules?.length ?? 0} icon={<Package className="h-3 w-3" />} />
      </div>

      <div className="px-6 py-4 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-gray-500">
          <Zap className="h-3 w-3 text-amber-500" />
          <span className="font-semibold text-gray-700">{phases?.defaultPhases?.length ?? 0}</span>
          <span>phases ·</span>
          <span className="font-semibold text-gray-700">{generators.length}</span>
          <span>generator{generators.length === 1 ? '' : 's'}</span>
          {license?.defaultEditionId && (
            <>
              <span>·</span>
              <span>default edition <span className="font-mono font-semibold text-gray-700">{license.defaultEditionId}</span></span>
            </>
          )}
        </div>

        {generators.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {generators.map((g, idx) => {
              const gen = g as { id?: string; label?: string; kind?: string };
              return (
                <span
                  key={`${gen.id ?? idx}`}
                  title={`${gen.label ?? gen.id}${gen.kind ? ` · ${gen.kind}` : ''}`}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5"
                >
                  {gen.label ?? gen.id}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdaptorPanelFrame({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
      <h3 className="text-sm font-bold text-gray-900 mb-2">{title}</h3>
      {body}
    </div>
  );
}

function PanelStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
