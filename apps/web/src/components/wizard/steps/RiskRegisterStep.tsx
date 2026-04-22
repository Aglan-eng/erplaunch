import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader, Save,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ExportButton } from '@/components/ExportButton';

interface Risk {
  id: string;
  title: string;
  description?: string;
  probability: 'LOW' | 'MEDIUM' | 'HIGH';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'MITIGATED' | 'CLOSED';
  owner?: string;
  mitigation?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRiskScore(probability: string, impact: string): { label: string; color: string } {
  const combos: Record<string, Record<string, { label: string; color: string }>> = {
    HIGH: {
      HIGH: { label: 'Critical', color: 'bg-red-100 text-red-700 border-red-200' },
      MEDIUM: { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200' },
      LOW: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    },
    MEDIUM: {
      HIGH: { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200' },
      MEDIUM: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
      LOW: { label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200' },
    },
    LOW: {
      HIGH: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
      MEDIUM: { label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200' },
      LOW: { label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200' },
    },
  };
  return combos[probability]?.[impact] ?? { label: 'Unknown', color: 'bg-gray-100 text-gray-700 border-gray-200' };
}

function getStatusBadge(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: 'bg-red-100 text-red-700 border-red-200' },
    MITIGATED: { label: 'Mitigated', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    CLOSED: { label: 'Closed', color: 'bg-green-100 text-green-700 border-green-200' },
  };
  return map[status] ?? { label: status, color: 'bg-gray-100 text-gray-700 border-gray-200' };
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

// ─── Add Risk Form ────────────────────────────────────────────────────────────

function AddRiskForm({
  engagementId, onAdded,
}: { engagementId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    probability: 'LOW' | 'MEDIUM' | 'HIGH';
    impact: 'LOW' | 'MEDIUM' | 'HIGH';
    owner: string;
    mitigation: string;
  }>({
    title: '',
    description: '',
    probability: 'MEDIUM',
    impact: 'MEDIUM',
    owner: '',
    mitigation: '',
  });
  const titleError = titleTouched && !form.title.trim() ? 'Risk title is required' : '';

  const mutation = useMutation({
    mutationFn: () => engagementsApi.createRisk(engagementId, form),
    onSuccess: () => {
      setForm({ title: '', description: '', probability: 'MEDIUM', impact: 'MEDIUM', owner: '', mitigation: '' });
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
        Add Risk
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
        New Risk
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <input
            placeholder="Risk title *"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            onBlur={() => setTitleTouched(true)}
            className={cn(
              "w-full rounded-xl border bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2",
              titleError ? "border-red-300 focus:ring-red-400" : "border-gray-200 focus:ring-brand-400"
            )}
          />
          {titleError && <p className="text-xs text-red-500 mt-1">{titleError}</p>}
        </div>
        <textarea
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
          rows={2}
        />
        <select
          value={form.probability}
          onChange={(e) => setForm((f) => ({ ...f, probability: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="LOW">Probability: Low</option>
          <option value="MEDIUM">Probability: Medium</option>
          <option value="HIGH">Probability: High</option>
        </select>
        <select
          value={form.impact}
          onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="LOW">Impact: Low</option>
          <option value="MEDIUM">Impact: Medium</option>
          <option value="HIGH">Impact: High</option>
        </select>
        <input
          placeholder="Owner"
          value={form.owner}
          onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <textarea
          placeholder="Mitigation plan"
          value={form.mitigation}
          onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
          rows={2}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            setOpen(false);
            setForm({ title: '', description: '', probability: 'MEDIUM', impact: 'MEDIUM', owner: '', mitigation: '' });
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
          Add Risk
        </button>
      </div>
    </div>
  );
}

// ─── Risk Row ─────────────────────────────────────────────────────────────────

function RiskRow({
  risk, engagementId, onRefresh,
}: { risk: Risk; engagementId: string; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(risk);

  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => engagementsApi.updateRisk(engagementId, risk.id, form),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['risks', engagementId] });
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.deleteRisk(engagementId, risk.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['risks', engagementId] });
      onRefresh();
    },
  });

  const riskScore = getRiskScore(form.probability, form.impact);
  const statusBadge = getStatusBadge(form.status);

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
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.probability}
              onChange={(e) => setForm((f) => ({ ...f, probability: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
            <select
              value={form.impact}
              onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'OPEN' | 'MITIGATED' | 'CLOSED' }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="OPEN">Open</option>
            <option value="MITIGATED">Mitigated</option>
            <option value="CLOSED">Closed</option>
          </select>
          <input
            placeholder="Owner"
            value={form.owner ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <textarea
            placeholder="Mitigation plan"
            value={form.mitigation ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))}
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

          <div className="flex flex-wrap gap-2 mb-3">
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold border', riskScore.color)}>
              {riskScore.label}
            </span>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold border', statusBadge.color)}>
              {statusBadge.label}
            </span>
          </div>

          {(form.owner || form.mitigation) && (
            <div className="border-t border-gray-100 pt-3 space-y-2 text-xs">
              {form.owner && (
                <p><span className="font-semibold text-gray-700">Owner:</span> {form.owner}</p>
              )}
              {form.mitigation && (
                <p><span className="font-semibold text-gray-700">Mitigation:</span> {form.mitigation}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function RiskRegisterStep({ engagementId }: { engagementId: string }) {
  const { data: risks = [], refetch } = useQuery({
    queryKey: ['risks', engagementId],
    queryFn: () => engagementsApi.listRisks(engagementId),
  });

  const openCount = risks.filter((r: Risk) => r.status === 'OPEN').length;
  const criticalCount = risks.filter((r: Risk) => {
    const score = getRiskScore(r.probability, r.impact);
    return score.label === 'Critical';
  }).length;

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Risk Register</h2>
          <p className="text-sm text-gray-500 mt-1">Identify, assess, and track project risks. Monitor probability and impact scores to prioritize mitigation.</p>
        </div>
        {risks.length > 0 && <ExportButton engagementId={engagementId} type="risks" />}
      </div>

      {/* ── Summary bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{risks.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Risks</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-red-600">{openCount}</p>
          <p className="text-xs text-gray-500 mt-1">Open</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-red-700">{criticalCount}</p>
          <p className="text-xs text-gray-500 mt-1">Critical</p>
        </div>
      </div>

      {/* ── Add Risk Form ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Plus} title="Add Risk" subtitle="Log a new risk to the register." />
        <AddRiskForm engagementId={engagementId} onAdded={() => refetch()} />
      </div>

      {/* ── Risks List ───────────────────────────────────────────────────────── */}
      {risks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No risks logged yet. Create your first risk to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(risks as Risk[]).map((risk) => (
            <RiskRow
              key={risk.id}
              risk={risk}
              engagementId={engagementId}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

    </div>
  );
}
