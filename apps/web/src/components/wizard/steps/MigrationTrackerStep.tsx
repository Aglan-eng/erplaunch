import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Loader,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface MigrationItem {
  id: string;
  objectName: string;
  source?: string;
  recordCount?: number;
  owner?: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'LOADED' | 'VERIFIED';
  notes?: string;
  createdAt: string;
}

const DEFAULT_OBJECTS = [
  'Customers',
  'Items',
  'Vendors',
  'Chart of Accounts',
  'Open Balances',
  'Open Transactions',
  'Employees',
  'Contacts',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusColor(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    NOT_STARTED: { label: 'Not Started', color: 'bg-gray-100 text-gray-700' },
    IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
    READY: { label: 'Ready', color: 'bg-amber-100 text-amber-700' },
    LOADED: { label: 'Loaded', color: 'bg-violet-100 text-violet-700' },
    VERIFIED: { label: 'Verified', color: 'bg-green-100 text-green-700' },
  };
  return map[status] ?? { label: status, color: 'bg-gray-100 text-gray-700' };
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

// ─── Add Migration Item Form ──────────────────────────────────────────────────

function AddMigrationItemForm({
  engagementId, onAdded,
}: { engagementId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    objectName: '',
    source: '',
    recordCount: '',
    owner: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: () => engagementsApi.createMigrationItem(engagementId, {
      objectName: form.objectName,
      source: form.source || undefined,
      recordCount: form.recordCount ? parseInt(form.recordCount) : undefined,
      owner: form.owner || undefined,
      notes: form.notes || undefined,
      status: 'NOT_STARTED',
    }),
    onSuccess: () => {
      setForm({ objectName: '', source: '', recordCount: '', owner: '', notes: '' });
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
        Add Object
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
        New Migration Object
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Object name *"
          value={form.objectName}
          onChange={(e) => setForm((f) => ({ ...f, objectName: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <input
          placeholder="Source system"
          value={form.source}
          onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <input
          placeholder="Record count"
          type="number"
          value={form.recordCount}
          onChange={(e) => setForm((f) => ({ ...f, recordCount: e.target.value }))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <input
          placeholder="Owner"
          value={form.owner}
          onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <textarea
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="col-span-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
          rows={2}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => {
            setOpen(false);
            setForm({ objectName: '', source: '', recordCount: '', owner: '', notes: '' });
          }}
          className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => form.objectName.trim() && mutation.mutate()}
          disabled={!form.objectName.trim() || mutation.isPending}
          className="flex-1 rounded-xl bg-brand-600 text-white text-xs font-semibold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand-700 transition-colors"
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add Object
        </button>
      </div>
    </div>
  );
}

// ─── Migration Item Row ───────────────────────────────────────────────────────

function MigrationItemRow({
  item, engagementId, onRefresh,
}: { item: MigrationItem; engagementId: string; onRefresh: () => void }) {
  const qc = useQueryClient();

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) =>
      engagementsApi.updateMigrationItem(engagementId, item.id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['migration', engagementId] });
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.deleteMigrationItem(engagementId, item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['migration', engagementId] });
      onRefresh();
    },
  });

  const statusInfo = getStatusColor(item.status);

  return (
    <div className="grid grid-cols-7 gap-3 items-center bg-white border-b border-gray-100 p-4 hover:bg-gray-50/50">
      <div>
        <p className="text-sm font-semibold text-gray-900">{item.objectName}</p>
        {item.source && <p className="text-xs text-gray-500 mt-0.5">{item.source}</p>}
      </div>

      <div className="text-sm text-gray-600">
        {item.recordCount ? `${item.recordCount.toLocaleString()}` : '—'}
      </div>

      <div className="text-sm text-gray-600">
        {item.owner ?? '—'}
      </div>

      <div>
        <select
          value={item.status}
          onChange={(e) => updateStatusMutation.mutate(e.target.value)}
          disabled={updateStatusMutation.isPending}
          className={cn(
            'rounded-lg px-2.5 py-1.5 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-400',
            statusInfo.color,
            'border border-current/20'
          )}
        >
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="READY">Ready</option>
          <option value="LOADED">Loaded</option>
          <option value="VERIFIED">Verified</option>
        </select>
      </div>

      {item.notes && (
        <div className="text-xs text-gray-600 line-clamp-2" title={item.notes}>
          {item.notes}
        </div>
      )}

      <div className="col-span-1" />

      <button
        onClick={() => deleteMutation.mutate()}
        disabled={deleteMutation.isPending}
        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50 justify-self-end"
      >
        {deleteMutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function MigrationTrackerStep({ engagementId }: { engagementId: string }) {
  const { data: items = [], refetch } = useQuery({
    queryKey: ['migration', engagementId],
    queryFn: () => engagementsApi.listMigrationItems(engagementId),
  });

  const verifiedCount = (items as MigrationItem[]).filter((i) => i.status === 'VERIFIED').length;
  const totalCount = items.length;

  const qc = useQueryClient();
  const addDefaultsMutation = useMutation({
    mutationFn: async () => {
      const existing = (items as MigrationItem[]).map((i) => i.objectName);
      const toAdd = DEFAULT_OBJECTS.filter((o) => !existing.includes(o));

      await Promise.all(
        toAdd.map((name) =>
          engagementsApi.createMigrationItem(engagementId, {
            objectName: name,
            status: 'NOT_STARTED',
          })
        )
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['migration', engagementId] });
      refetch();
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-black text-gray-900">Migration Tracker</h2>
        <p className="text-sm text-gray-500 mt-1">Track migration progress through the pipeline: Not Started → In Progress → Ready → Loaded → Verified.</p>
      </div>

      {/* ── Progress bar ──────────────────────────────────────────────────────── */}
      {totalCount > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-gray-900">Overall Progress</p>
            <span className="text-sm font-bold text-gray-700">{verifiedCount} of {totalCount} Verified</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className="bg-green-500 h-full transition-all duration-300"
              style={{ width: `${(verifiedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Add Object Form ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Plus} title="Add Object" subtitle="Add a new object to the migration plan." />
        <AddMigrationItemForm engagementId={engagementId} onAdded={() => refetch()} />
      </div>

      {/* ── Add Default Objects Button ────────────────────────────────────────── */}
      {items.length < DEFAULT_OBJECTS.length && (
        <div className="text-center">
          <button
            onClick={() => addDefaultsMutation.mutate()}
            disabled={addDefaultsMutation.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 px-5 py-2.5 text-sm font-semibold hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {addDefaultsMutation.isPending ? <Loader className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Common NetSuite Objects
          </button>
        </div>
      )}

      {/* ── Migration Items Table ────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No objects added yet. Add objects to build your migration plan.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-7 gap-3 items-center bg-gray-50 border-b border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-600 uppercase">Object</p>
            <p className="text-xs font-bold text-gray-600 uppercase">Records</p>
            <p className="text-xs font-bold text-gray-600 uppercase">Owner</p>
            <p className="text-xs font-bold text-gray-600 uppercase">Status</p>
            <p className="text-xs font-bold text-gray-600 uppercase">Notes</p>
            <p />
            <p />
          </div>

          {/* Table rows */}
          {(items as MigrationItem[]).map((item) => (
            <MigrationItemRow
              key={item.id}
              item={item}
              engagementId={engagementId}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

    </div>
  );
}
