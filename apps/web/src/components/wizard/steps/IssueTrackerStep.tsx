import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader, Save,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ExportButton } from '@/components/ExportButton';

interface Issue {
  id: string;
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  owner?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPriorityBadge(priority: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    CRITICAL: { label: 'Critical', color: 'bg-red-100 text-red-700 border-red-200' },
    HIGH: { label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    MEDIUM: { label: 'Medium', color: 'bg-amber-100 text-amber-700 border-amber-200' },
    LOW: { label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  };
  return map[priority] ?? { label: priority, color: 'bg-gray-100 text-gray-700 border-gray-200' };
}

function getStatusBadge(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Open', color: 'bg-red-100 text-red-700 border-red-200' },
    IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-100 text-blue-700 border-blue-200' },
    RESOLVED: { label: 'Resolved', color: 'bg-amber-100 text-amber-700 border-amber-200' },
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

// ─── Add Issue Form ───────────────────────────────────────────────────────────

function AddIssueForm({
  engagementId, onAdded,
}: { engagementId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    owner: string;
  }>({
    title: '',
    description: '',
    priority: 'MEDIUM',
    owner: '',
  });
  const titleError = titleTouched && !form.title.trim() ? 'Issue title is required' : '';

  const mutation = useMutation({
    mutationFn: () => engagementsApi.createIssue(engagementId, form),
    onSuccess: () => {
      setForm({ title: '', description: '', priority: 'MEDIUM', owner: '' });
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
        Log Issue
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
        New Issue
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <input
            placeholder="Issue title *"
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
          value={form.priority}
          onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="LOW">Priority: Low</option>
          <option value="MEDIUM">Priority: Medium</option>
          <option value="HIGH">Priority: High</option>
          <option value="CRITICAL">Priority: Critical</option>
        </select>
        <input
          placeholder="Owner"
          value={form.owner}
          onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            setOpen(false);
            setForm({ title: '', description: '', priority: 'MEDIUM', owner: '' });
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
          Log Issue
        </button>
      </div>
    </div>
  );
}

// ─── Issue Row ────────────────────────────────────────────────────────────────

function IssueRow({
  issue, engagementId, onRefresh,
}: { issue: Issue; engagementId: string; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(issue);

  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => engagementsApi.updateIssue(engagementId, issue.id, form),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['issues', engagementId] });
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.deleteIssue(engagementId, issue.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', engagementId] });
      onRefresh();
    },
  });

  const priorityBadge = getPriorityBadge(form.priority);
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
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }))}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' }))}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <input
            placeholder="Owner"
            value={form.owner ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <textarea
            placeholder="Resolution"
            value={form.resolution ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))}
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
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold border', priorityBadge.color)}>
              {priorityBadge.label}
            </span>
            <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold border', statusBadge.color)}>
              {statusBadge.label}
            </span>
          </div>

          {(form.owner || form.resolution) && (
            <div className="border-t border-gray-100 pt-3 space-y-2 text-xs">
              {form.owner && (
                <p><span className="font-semibold text-gray-700">Owner:</span> {form.owner}</p>
              )}
              {form.resolution && (
                <p><span className="font-semibold text-gray-700">Resolution:</span> {form.resolution}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function IssueTrackerStep({ engagementId }: { engagementId: string }) {
  const { data: issues = [], refetch } = useQuery({
    queryKey: ['issues', engagementId],
    queryFn: () => engagementsApi.listIssues(engagementId),
  });

  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED_CLOSED'>('ALL');

  const openCount = issues.filter((i: Issue) => i.status === 'OPEN').length;
  const inProgressCount = issues.filter((i: Issue) => i.status === 'IN_PROGRESS').length;
  const resolvedCount = issues.filter((i: Issue) => i.status === 'RESOLVED' || i.status === 'CLOSED').length;

  let filtered = issues as Issue[];
  if (filter === 'OPEN') filtered = issues.filter((i: Issue) => i.status === 'OPEN');
  else if (filter === 'IN_PROGRESS') filtered = issues.filter((i: Issue) => i.status === 'IN_PROGRESS');
  else if (filter === 'RESOLVED_CLOSED') filtered = issues.filter((i: Issue) => i.status === 'RESOLVED' || i.status === 'CLOSED');

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-black text-gray-900">Issue Tracker</h2>
          <p className="text-sm text-gray-500 mt-1">Log, track, and resolve project issues. Assign owners and update status to keep the team aligned.</p>
        </div>
        {issues.length > 0 && <ExportButton engagementId={engagementId} type="issues" />}
      </div>

      {/* ── Summary bar ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-gray-900">{issues.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-red-600">{openCount}</p>
          <p className="text-xs text-gray-500 mt-1">Open</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-blue-600">{inProgressCount}</p>
          <p className="text-xs text-gray-500 mt-1">In Progress</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <p className="text-2xl font-black text-green-600">{resolvedCount}</p>
          <p className="text-xs text-gray-500 mt-1">Resolved</p>
        </div>
      </div>

      {/* ── Add Issue Form ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Plus} title="Log Issue" subtitle="Create a new issue to track." />
        <AddIssueForm engagementId={engagementId} onAdded={() => refetch()} />
      </div>

      {/* ── Filter Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex gap-2 border-b border-gray-200">
        {(['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED_CLOSED'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-2 text-sm font-semibold transition-colors border-b-2',
              filter === f
                ? 'text-brand-700 border-brand-600'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            )}
          >
            {f === 'ALL' ? 'All' : f === 'OPEN' ? 'Open' : f === 'IN_PROGRESS' ? 'In Progress' : 'Resolved+Closed'}
          </button>
        ))}
      </div>

      {/* ── Issues List ──────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No issues in this view. Create an issue to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              engagementId={engagementId}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

    </div>
  );
}
