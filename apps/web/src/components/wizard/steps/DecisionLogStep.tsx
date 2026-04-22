import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader, Save,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { ExportButton } from '@/components/ExportButton';

interface Decision {
  id: string;
  title: string;
  description?: string;
  decidedBy?: string;
  decidedAt?: string;
  rationale?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="h-9 w-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
        <Icon className="h-4.5 w-4.5 text-brand-600" />
      </div>
      <div>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

// ─── Add Decision Form ────────────────────────────────────────────────────────

function AddDecisionForm({
  engagementId, onAdded,
}: { engagementId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    decidedBy: '',
    decidedAt: '',
    rationale: '',
  });

  const mutation = useMutation({
    mutationFn: () => engagementsApi.createDecision(engagementId, form),
    onSuccess: () => {
      setForm({ title: '', description: '', decidedBy: '', decidedAt: '', rationale: '' });
      setOpen(false);
      onAdded();
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand-200 text-brand-600 hover:bg-brand-50 hover:border-brand-400 py-2.5 text-sm font-semibold transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Log Decision
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
        New Decision
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Decision title *"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <textarea
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
          rows={2}
        />
        <input
          placeholder="Decided by"
          value={form.decidedBy}
          onChange={(e) => setForm((f) => ({ ...f, decidedBy: e.target.value }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <input
          type="date"
          placeholder="Decided at"
          value={form.decidedAt}
          onChange={(e) => setForm((f) => ({ ...f, decidedAt: e.target.value }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <textarea
          placeholder="Rationale"
          value={form.rationale}
          onChange={(e) => setForm((f) => ({ ...f, rationale: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
          rows={2}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            setOpen(false);
            setForm({ title: '', description: '', decidedBy: '', decidedAt: '', rationale: '' });
          }}
          className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => form.title.trim() && mutation.mutate()}
          disabled={!form.title.trim() || mutation.isPending}
          className="flex-1 rounded-xl bg-brand-600 text-white text-xs font-semibold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand-700 transition-colors"
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Log Decision
        </button>
      </div>
    </div>
  );
}

// ─── Decision Row ─────────────────────────────────────────────────────────────

function DecisionRow({
  decision, engagementId, onRefresh,
}: { decision: Decision; engagementId: string; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(decision);

  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => engagementsApi.updateDecision(engagementId, decision.id, form),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['decisions', engagementId] });
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.deleteDecision(engagementId, decision.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decisions', engagementId] });
      onRefresh();
    },
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      {editing ? (
        <div className="space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <textarea
            value={form.description ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            rows={2}
          />
          <input
            placeholder="Decided by"
            value={form.decidedBy ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, decidedBy: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="date"
            value={form.decidedAt ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, decidedAt: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <textarea
            placeholder="Rationale"
            value={form.rationale ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, rationale: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            rows={2}
          />
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setEditing(false)}
              className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              className="flex-1 rounded-xl bg-brand-600 text-white text-xs font-semibold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand-700"
            >
              {updateMutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-3 mb-3">
            <h4 className="text-sm font-bold text-gray-900">{form.title}</h4>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {form.description && (
            <p className="text-xs text-gray-600 mb-3">{form.description}</p>
          )}

          <div className="border-t border-gray-100 pt-3 space-y-2 text-xs">
            {(form.decidedBy || form.decidedAt) && (
              <p className="text-gray-600">
                <span className="font-semibold text-gray-700">Decided:</span>
                {form.decidedBy && <span> by {form.decidedBy}</span>}
                {form.decidedAt && <span> on {fmt(form.decidedAt)}</span>}
              </p>
            )}
            {form.rationale && (
              <p><span className="font-semibold text-gray-700">Rationale:</span> {form.rationale}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function DecisionLogStep({ engagementId }: { engagementId: string }) {
  const { data: decisions = [], refetch } = useQuery({
    queryKey: ['decisions', engagementId],
    queryFn: () => engagementsApi.listDecisions(engagementId),
  });

  const sorted = [...(decisions as Decision[])].sort((a, b) => {
    const aDate = new Date(a.createdAt).getTime();
    const bDate = new Date(b.createdAt).getTime();
    return bDate - aDate;
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Decision Log</h2>
          <p className="text-sm text-gray-500 mt-1">Document key project decisions, rationale, and who decided. Track decisions chronologically for future reference.</p>
        </div>
        {decisions.length > 0 && <ExportButton engagementId={engagementId} type="decisions" />}
      </div>

      {/* ── Add Decision Form ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Plus} title="Log Decision" subtitle="Record a new decision." />
        <AddDecisionForm engagementId={engagementId} onAdded={() => refetch()} />
      </div>

      {/* ── Decisions List ───────────────────────────────────────────────────── */}
      {decisions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No decisions logged yet. Create your first decision to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((decision) => (
            <DecisionRow
              key={decision.id}
              decision={decision}
              engagementId={engagementId}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

    </div>
  );
}
