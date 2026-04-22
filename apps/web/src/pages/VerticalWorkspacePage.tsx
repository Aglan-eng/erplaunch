import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { engagementsApi, verticalsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Bird, ShoppingCart, Factory, Package, Briefcase, Heart,
  TriangleAlert, CheckCircle2, Clock, Layers, Database, ChevronRight,
  Sparkles, Save, AlertCircle,
} from 'lucide-react';

// ─── Icon map matching verticals config ───────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Bird, ShoppingCart, Factory, Package, Briefcase, Heart,
};

function VerticalIcon({ iconId, className }: { iconId: string; className?: string }) {
  const Icon = ICON_MAP[iconId] ?? Layers;
  return <Icon className={className} />;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
};
const STATUS_COLORS: Record<string, string> = {
  DISCOVERY: 'bg-sky-100 text-sky-700',
  SCOPING:   'bg-violet-100 text-violet-700',
  BUILD:     'bg-amber-100 text-amber-700',
  UAT:       'bg-orange-100 text-orange-700',
  GO_LIVE:   'bg-green-100 text-green-700',
};

// ─── Question renderer ────────────────────────────────────────────────────────

interface Question {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean';
  options?: string[];
  placeholder?: string;
  required?: boolean;
  section: string;
}

function QuestionField({ q, value, onChange }: {
  q: Question;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  if (q.type === 'boolean') {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(true)}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
            value === true ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300')}
        >Yes</button>
        <button
          onClick={() => onChange(false)}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
            value === false ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400')}
        >No</button>
      </div>
    );
  }

  if (q.type === 'select') {
    return (
      <select
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
      >
        <option value="">— select —</option>
        {q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (q.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-wrap gap-2">
        {q.options?.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              onClick={() => onChange(active ? selected.filter((s) => s !== o) : [...selected, o])}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-semibold border transition-all',
                active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300',
              )}
            >{o}</button>
          );
        })}
      </div>
    );
  }

  if (q.type === 'textarea') {
    return (
      <textarea
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.placeholder}
        rows={3}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
      />
    );
  }

  return (
    <input
      type="text"
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={q.placeholder}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function VerticalWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [localAnswers, setLocalAnswers] = useState<Record<string, unknown>>({});
  const [saved, setSaved] = useState(false);

  const { data: engagement } = useQuery({
    queryKey: ['engagement', id],
    queryFn: () => engagementsApi.get(id!),
    enabled: !!id,
  });

  const verticalType = (engagement as Record<string, unknown>)?.verticalType as string | null;

  const { data: verticalDef, isLoading: verticalLoading } = useQuery({
    queryKey: ['vertical', verticalType],
    queryFn: () => verticalsApi.get(verticalType!),
    enabled: !!verticalType,
  });

  const { data: verticalSettingsData } = useQuery({
    queryKey: ['verticalSettings', id],
    queryFn: () => engagementsApi.getVerticalSettings(id!),
    enabled: !!id,
  });

  // Sync saved settings into local state once loaded
  React.useEffect(() => {
    if (verticalSettingsData && typeof verticalSettingsData === 'object' && Object.keys(localAnswers).length === 0) {
      setLocalAnswers(verticalSettingsData as Record<string, unknown>);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verticalSettingsData]);

  const { data: risks } = useQuery({
    queryKey: ['risks', id],
    queryFn: () => engagementsApi.listRisks(id!),
    enabled: !!id,
  });

  const saveMutation = useMutation({
    mutationFn: () => engagementsApi.patchVerticalSettings(id!, localAnswers),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['verticalSettings', id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const vertical = verticalDef as Record<string, unknown> | null;

  if (verticalLoading || !vertical) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const questions = (vertical.questions as Question[]) ?? [];
  const modules = (vertical.modules as Array<{ id: string; name: string; reason: string; required: boolean }>) ?? [];
  const risks_ = (vertical.risks as Array<{ id: string; title: string; impact: string; status: string }>) ?? [];
  const timeline = (vertical.timeline as Array<{ stage: string; name: string; weekOffset: number; durationWeeks: number }>) ?? [];

  // Group questions by section
  const sections = Array.from(new Set(questions.map((q) => q.section)));

  const openRisks = ((risks as Array<{ id: string; title: string; impact: string; status: string }>) ?? []).filter((r) => r.status === 'OPEN');

  const answeredCount = questions.filter((q) => {
    const v = localAnswers[q.key];
    return v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && v.length === 0);
  }).length;
  const totalRequired = questions.filter((q) => q.required).length;
  const answeredRequired = questions.filter((q) => q.required).filter((q) => {
    const v = localAnswers[q.key];
    return v !== undefined && v !== '' && v !== null && !(Array.isArray(v) && v.length === 0);
  }).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/engagements/${(engagement as Record<string, unknown>)?.parentEngagementId ?? id}`}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to engagement
            </Link>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-center gap-3">
              <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0', vertical.color as string)}>
                <VerticalIcon iconId={vertical.iconId as string} className={cn('h-4 w-4', vertical.textColor as string)} />
              </div>
              <div>
                {typeof vertical.tag === 'string' && vertical.tag && (
                  <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">{vertical.tag}</span>
                )}
                <h1 className="text-base font-black text-gray-900">{vertical.name as string}</h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', STATUS_COLORS[(engagement as Record<string, unknown>)?.status as string] ?? 'bg-gray-100 text-gray-600')}>
              {STATUS_LABELS[(engagement as Record<string, unknown>)?.status as string] ?? 'Discovery'}
            </span>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all',
                saved ? 'bg-green-500 text-white' : 'bg-brand-600 text-white hover:bg-brand-700',
              )}
            >
              {saved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {saved ? 'Saved' : 'Save answers'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-6">

        {/* ── Left column: questions ── */}
        <div className="col-span-2 space-y-5">

          {/* Progress */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500">Discovery questions</p>
              <p className="text-xs font-bold text-gray-700">{answeredCount} / {questions.length} answered · {answeredRequired} / {totalRequired} required</p>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all"
                style={{ width: `${questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Question sections */}
          {sections.map((section) => (
            <div key={section} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50">
                <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wide">{section}</h2>
              </div>
              <div className="p-5 space-y-5">
                {questions.filter((q) => q.section === section).map((q) => (
                  <div key={q.key}>
                    <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                      {q.label}
                      {q.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <QuestionField
                      q={q}
                      value={localAnswers[q.key]}
                      onChange={(val) => setLocalAnswers((prev) => ({ ...prev, [q.key]: val }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Right column: modules, risks, timeline ── */}
        <div className="space-y-5">

          {/* Recommended modules */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-brand-500" />
              <p className="text-xs font-bold text-gray-700">Recommended Modules</p>
            </div>
            <div className="p-4 space-y-3">
              {modules.map((m) => (
                <div key={m.id as string} className="flex items-start gap-2.5">
                  <div className={cn('h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                    m.required ? 'bg-brand-100' : 'bg-gray-100')}>
                    <div className={cn('h-1.5 w-1.5 rounded-full', m.required ? 'bg-brand-600' : 'bg-gray-400')} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{m.name as string}</p>
                    <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{m.reason as string}</p>
                    {!!m.required && <span className="text-[10px] font-bold text-brand-600">Required</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pre-seeded risks */}
          {openRisks.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                  <p className="text-xs font-bold text-gray-700">Pre-seeded Risks</p>
                </div>
                <Link to={`/engagements/${id}/risks`} className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold flex items-center gap-0.5">
                  Manage <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="p-4 space-y-2.5">
                {openRisks.slice(0, 5).map((r) => {
                  const score = (r.impact as string) ?? 'MEDIUM';
                  const colorMap: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-700', HIGH: 'bg-orange-100 text-orange-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW: 'bg-gray-100 text-gray-500' };
                  return (
                    <div key={r.id as string} className="flex items-start gap-2">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5', colorMap[score] ?? 'bg-gray-100 text-gray-500')}>
                        {score}
                      </span>
                      <p className="text-xs text-gray-700 leading-snug">{r.title as string}</p>
                    </div>
                  );
                })}
                {openRisks.length > 5 && (
                  <p className="text-[11px] text-gray-400 text-center">+{openRisks.length - 5} more risks</p>
                )}
              </div>
            </div>
          )}

          {/* Typical timeline */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-blue-500" />
              <p className="text-xs font-bold text-gray-700">Typical Timeline</p>
            </div>
            <div className="p-4 space-y-2">
              {timeline.map((m, idx) => {
                const stageColors: Record<string, string> = {
                  DISCOVERY: 'bg-sky-100 text-sky-600', SCOPING: 'bg-violet-100 text-violet-600',
                  BUILD: 'bg-amber-100 text-amber-600', UAT: 'bg-orange-100 text-orange-600', GO_LIVE: 'bg-green-100 text-green-600',
                };
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <span className={cn('text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0 w-16 text-center', stageColors[m.stage as string] ?? 'bg-gray-100 text-gray-500')}>
                      {m.stage as string}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-gray-800 truncate">{m.name as string}</p>
                      <p className="text-[10px] text-gray-400">Wk {m.weekOffset as number}–{(m.weekOffset as number) + (m.durationWeeks as number)} ({m.durationWeeks as number}w)</p>
                    </div>
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-50">
                Total: ~{Math.max(...timeline.map((m) => (m.weekOffset as number) + (m.durationWeeks as number)))} weeks
              </p>
            </div>
          </div>

          {/* Data templates */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-violet-500" />
                <p className="text-xs font-bold text-gray-700">Data Templates</p>
              </div>
              <Link to={`/engagements/${id}/data-collection`} className="text-[10px] text-brand-500 hover:text-brand-700 font-semibold flex items-center gap-0.5">
                Manage <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="p-4">
              <p className="text-xs text-gray-500">{(vertical.dataTemplateIds as string[]).length} templates configured for this vertical.</p>
              <Link
                to={`/engagements/${id}/data-collection`}
                className="mt-2 flex items-center gap-1.5 text-xs text-brand-600 font-semibold hover:text-brand-800"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate AI-customised templates
              </Link>
            </div>
          </div>

          {/* External product link */}
          {!!vertical.productUrl && (
            <a
              href={vertical.productUrl as string}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-amber-50 border border-amber-100 rounded-2xl p-4 hover:border-amber-300 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-xs font-bold text-amber-800">OFOQ Custom Solution</p>
              </div>
              <p className="text-[11px] text-amber-700 leading-snug">This vertical uses a specialized OFOQ product. Click to view product documentation.</p>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
