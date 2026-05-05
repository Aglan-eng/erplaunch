import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, Users, UserPlus, Trash2, Mail, Phone,
  Pencil, CircleCheck, Loader, ArrowRight, Save, Link, Copy as CopyIcon,
  Send, ListTodo, Plus, X, CheckSquare,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { HelpTip } from '@/components/ui/HelpTip';

interface Member {
  id: string;
  name: string;
  role: string;
  team: string;
  email?: string;
  phone?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function deadlineInfo(endDate: string | null | undefined): { label: string; color: string } | null {
  if (!endDate) return null;
  const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000);
  if (days < 0)   return { label: `${Math.abs(days)}d overdue`, color: 'text-red-600 bg-red-50 border-red-200' };
  if (days <= 14) return { label: `${days}d remaining`,        color: 'text-amber-600 bg-amber-50 border-amber-200' };
  return           { label: `${days}d remaining`,              color: 'text-green-700 bg-green-50 border-green-200' };
}

// ─── Section Heading ─────────────────────────────────────────────────────────

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

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({
  m, engagementId, onDelete, onUpdated, isDeleting,
}: {
  m: Member; engagementId: string; onDelete: () => void; onUpdated: () => void; isDeleting: boolean;
}) {
  const isOfoq = m.team === 'CONSULTANT';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: m.name, role: m.role, team: m.team, email: m.email ?? '', phone: m.phone ?? '' });
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => engagementsApi.updateMember(engagementId, m.id, {
      name: form.name.trim() || undefined,
      role: form.role.trim() || undefined,
      team: form.team || undefined,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', engagementId] });
      onUpdated();
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-50/40 px-4 py-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Full name"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
          />
          <input
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            placeholder="Role / title"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
          />
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email (optional)"
            type="email"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
          />
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="Phone (optional)"
            className="px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 font-medium">Team:</label>
          <select
            value={form.team}
            onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))}
            className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
          >
            <option value="CLIENT">Client</option>
            <option value="CONSULTANT">Consultant</option>
          </select>
          <div className="flex-1" />
          <button
            onClick={() => setEditing(false)}
            className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600"
          >Cancel</button>
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !form.name.trim()}
            className="px-3 py-1 text-xs rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50 flex items-center gap-1"
          >
            {updateMutation.isPending ? <Loader className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save
          </button>
        </div>
        {updateMutation.isError && (
          <p className="text-xs text-red-500">Failed to save — please try again.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-2.5 group">
      <div className={cn(
        'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
        isOfoq ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
      )}>
        {m.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
        <p className="text-xs text-gray-500">{m.role}</p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {m.email && (
            <a href={`mailto:${m.email}`}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <Mail className="h-3 w-3" />{m.email}
            </a>
          )}
          {m.phone && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <Phone className="h-3 w-3" />{m.phone}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => { setForm({ name: m.name, role: m.role, team: m.team, email: m.email ?? '', phone: m.phone ?? '' }); setEditing(true); }}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-all"
        title="Edit member"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all disabled:opacity-50"
      >
        {isDeleting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ─── Add Member Form ──────────────────────────────────────────────────────────

function AddMemberForm({
  team, engagementId, onAdded,
}: { team: 'CLIENT' | 'CONSULTANT'; engagementId: string; onAdded: () => void }) {
  const isOfoq = team === 'CONSULTANT';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '' });
  const [touched, setTouched] = useState({ name: false, email: false });
  const nameError = touched.name && !form.name.trim() ? 'Name is required' : '';
  const emailError = touched.email && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'Invalid email format' : '';

  const mutation = useMutation({
    mutationFn: () => engagementsApi.addMember(engagementId, { ...form, team }),
    onSuccess: () => {
      setForm({ name: '', role: '', email: '', phone: '' });
      setOpen(false);
      onAdded();
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs font-semibold transition-colors',
          isOfoq
            ? 'border-violet-200 text-violet-500 hover:bg-violet-50 hover:border-violet-400'
            : 'border-blue-200 text-blue-500 hover:bg-blue-50 hover:border-blue-400'
        )}
      >
        <UserPlus className="h-3.5 w-3.5" />
        Add {isOfoq ? 'Consultant' : 'Client'} Team Member
      </button>
    );
  }

  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-2.5',
      isOfoq ? 'border-violet-200 bg-violet-50/50' : 'border-blue-200 bg-blue-50/50'
    )}>
      <p className={cn('text-xs font-bold uppercase tracking-wider', isOfoq ? 'text-violet-700' : 'text-blue-700')}>
        New {isOfoq ? 'Consultant' : 'Client'} Member
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <input
            placeholder="Full name *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            className={cn(
              "w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
              nameError ? "border-red-300 focus:ring-red-400" : "border-gray-200 focus:ring-brand-400"
            )}
          />
          {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
        </div>
        <input
          placeholder={isOfoq ? 'Role (e.g. Project Manager)' : 'Role (e.g. CFO)'}
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          className="col-span-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <div>
          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            className={cn(
              "w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2",
              emailError ? "border-red-300 focus:ring-red-400" : "border-gray-200 focus:ring-brand-400"
            )}
          />
          {emailError && <p className="text-xs text-red-500 mt-1">{emailError}</p>}
        </div>
        <input
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => { setOpen(false); setForm({ name: '', role: '', email: '', phone: '' }); }}
          className="flex-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => form.name.trim() && mutation.mutate()}
          disabled={!form.name.trim() || mutation.isPending}
          className={cn(
            'flex-1 rounded-lg text-white text-xs font-semibold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors',
            isOfoq ? 'bg-violet-600 hover:bg-violet-700' : 'bg-blue-600 hover:bg-blue-700'
          )}
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Add Member
        </button>
      </div>
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function ProjectSetupStep({ engagementId }: { engagementId: string }) {
  const qc = useQueryClient();

  // ── Engagement data ────────────────────────────────────────────────────────
  const { data: eng } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => engagementsApi.get(engagementId),
  });

  // ── Client name editing ────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  useEffect(() => { if (eng?.clientName) setNameVal(eng.clientName); }, [eng?.clientName]);

  const nameMutation = useMutation({
    mutationFn: () => engagementsApi.patch(engagementId, { clientName: nameVal.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['engagement', engagementId] }); qc.invalidateQueries({ queryKey: ['engagements'] }); setEditingName(false); },
  });

  // ── Dates ──────────────────────────────────────────────────────────────────
  const [startDate, setStartDate]           = useState('');
  const [contractEndDate, setContractEndDate] = useState('');
  const [datesDirty, setDatesDirty]         = useState(false);

  useEffect(() => {
    if (eng) {
      setStartDate(eng.startDate ?? '');
      setContractEndDate(eng.contractEndDate ?? '');
      setDatesDirty(false);
    }
  }, [eng]);

  const datesMutation = useMutation({
    mutationFn: () => engagementsApi.patch(engagementId, {
      startDate: startDate || null,
      contractEndDate: contractEndDate || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      qc.invalidateQueries({ queryKey: ['engagements'] });
      setDatesDirty(false);
    },
  });

  // ── Members ────────────────────────────────────────────────────────────────
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', engagementId],
    queryFn: () => engagementsApi.getMembers(engagementId),
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (memberId: string) => engagementsApi.deleteMember(engagementId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', engagementId] });
      qc.invalidateQueries({ queryKey: ['engagements'] });
      setDeletingId(null);
    },
  });

  const handleDelete = (memberId: string) => {
    setDeletingId(memberId);
    deleteMutation.mutate(memberId);
  };

  const refreshMembers = () => {
    qc.invalidateQueries({ queryKey: ['members', engagementId] });
    qc.invalidateQueries({ queryKey: ['engagements'] });
  };

  const clientTeam = members.filter((m) => m.team !== 'CONSULTANT');
  const ofoqTeam   = members.filter((m) => m.team === 'CONSULTANT');
  const deadline   = deadlineInfo(contractEndDate || eng?.contractEndDate);

  // ── Stage info ─────────────────────────────────────────────────────────────
  const STAGES = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'];
  const STAGE_LABELS: Record<string, string> = {
    DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
  };
  const STAGE_COLORS: Record<string, string> = {
    DISCOVERY: 'bg-slate-100 text-slate-700',
    SCOPING:   'bg-blue-100 text-blue-700',
    BUILD:     'bg-violet-100 text-violet-700',
    UAT:       'bg-amber-100 text-amber-700',
    GO_LIVE:   'bg-green-100 text-green-700',
  };

  const advanceMutation = useMutation({
    mutationFn: (next: string) => engagementsApi.patch(engagementId, { status: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['engagement', engagementId] });
      qc.invalidateQueries({ queryKey: ['engagements'] });
    },
  });

  const stageIdx = STAGES.indexOf(eng?.status ?? 'DISCOVERY');
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-black text-gray-900">Project Setup</h2>
        <p className="text-sm text-gray-500 mt-1">Configure project details, timeline, and team for this engagement.</p>
      </div>

      {/* ── Client Name ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Pencil} title="Client Name" subtitle="The organisation you are implementing NetSuite for." />
        {editingName ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') nameMutation.mutate(); if (e.key === 'Escape') setEditingName(false); }}
              className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <button onClick={() => nameMutation.mutate()} disabled={nameMutation.isPending || !nameVal.trim()}
              className="rounded-xl bg-brand-600 text-white px-4 py-2 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5">
              {nameMutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
            <button onClick={() => { setEditingName(false); setNameVal(eng?.clientName ?? ''); }}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-gray-900">{eng?.clientName}</span>
            <button onClick={() => setEditingName(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Project Stage ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={ArrowRight} title="Project Stage" subtitle="Current implementation phase. Advance when the team is ready." />
        <div className="flex items-center gap-3 flex-wrap">
          {STAGES.map((s, i) => (
            <React.Fragment key={s}>
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold',
                eng?.status === s ? STAGE_COLORS[s] : 'bg-gray-50 text-gray-400')}>
                {eng?.status === s && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                {STAGE_LABELS[s]}
              </span>
              {i < STAGES.length - 1 && <ArrowRight className="h-3 w-3 text-gray-200 flex-shrink-0" />}
            </React.Fragment>
          ))}
        </div>
        {nextStage && (
          <button
            onClick={() => advanceMutation.mutate(nextStage)}
            disabled={advanceMutation.isPending}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {advanceMutation.isPending ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Advance to {STAGE_LABELS[nextStage]}
          </button>
        )}
        {eng?.status === 'GO_LIVE' && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 text-green-700 px-5 py-2.5 text-sm font-semibold">
            <CircleCheck className="h-4 w-4" /> Project is Live!
          </div>
        )}
      </div>

      {/* ── Project Dates ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={CalendarDays} title="Project Timeline" subtitle="Set the start and contract end dates to track deadlines." />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setDatesDirty(true); }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
              Contract End Date
            </label>
            <input
              type="date"
              value={contractEndDate}
              onChange={(e) => { setContractEndDate(e.target.value); setDatesDirty(true); }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        </div>

        {/* Deadline indicator */}
        {deadline && (
          <div className={cn('mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold', deadline.color)}>
            <CalendarDays className="h-3.5 w-3.5" />
            {contractEndDate && fmt(contractEndDate)}
            <span className="opacity-70">·</span>
            {deadline.label}
          </div>
        )}

        {/* Duration summary */}
        {startDate && contractEndDate && (
          <p className="mt-2 text-xs text-gray-400">
            Project duration:{' '}
            <span className="font-semibold text-gray-600">
              {Math.ceil((new Date(contractEndDate).getTime() - new Date(startDate).getTime()) / 86400000)} days
            </span>
            {' '}({fmt(startDate)} → {fmt(contractEndDate)})
          </p>
        )}

        {datesDirty && (
          <button
            onClick={() => datesMutation.mutate()}
            disabled={datesMutation.isPending}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {datesMutation.isPending ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Dates
          </button>
        )}
      </div>

      {/* ── Committee ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading
          icon={Users}
          title="Project Committee"
          subtitle="Track stakeholders and team members on both sides of the implementation."
        />

        <div className="space-y-6">

          {/* ── Client Team ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-black text-blue-700">C</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700">Client Team</h4>
              <span className="rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold px-2 py-0.5 border border-blue-100">
                {clientTeam.length} {clientTeam.length === 1 ? 'member' : 'members'}
              </span>
            </div>
            <div className="space-y-2">
              {clientTeam.map((m) => (
                <MemberRow
                  key={m.id}
                  m={m}
                  engagementId={engagementId}
                  onDelete={() => handleDelete(m.id)}
                  onUpdated={refreshMembers}
                  isDeleting={deletingId === m.id}
                />
              ))}
              <AddMemberForm team="CLIENT" engagementId={engagementId} onAdded={refreshMembers} />
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* ── Ofoq Team ───────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-5 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                <span className="text-[9px] font-black text-violet-700">O</span>
              </div>
              <h4 className="text-sm font-bold text-gray-700">Consultant Team</h4>
              <span className="rounded-full bg-violet-50 text-violet-600 text-[10px] font-bold px-2 py-0.5 border border-violet-100">
                {ofoqTeam.length} {ofoqTeam.length === 1 ? 'member' : 'members'}
              </span>
            </div>
            <div className="space-y-2">
              {ofoqTeam.map((m) => (
                <MemberRow
                  key={m.id}
                  m={m}
                  engagementId={engagementId}
                  onDelete={() => handleDelete(m.id)}
                  onUpdated={refreshMembers}
                  isDeleting={deletingId === m.id}
                />
              ))}
              <AddMemberForm team="CONSULTANT" engagementId={engagementId} onAdded={refreshMembers} />
            </div>
          </div>

        </div>
      </div>

      {/* ── Client Portal ─────────────────────────────────────────────────────── */}
      <ClientPortalCard engagementId={engagementId} />

    </div>
  );
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0',
        checked ? 'bg-brand-600' : 'bg-gray-200',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      )} />
    </button>
  );
}

// ─── Client Portal Card ───────────────────────────────────────────────────────

interface PortalSettings {
  showStage: boolean;
  showTimeline: boolean;
  showClientTeam: boolean;
  showConsultantTeam: boolean;
  showRisks: boolean;
  showIssues: boolean;
  showDecisions: boolean;
  showDataCollection: boolean;
  showTodos: boolean;
  showMeetings: boolean;
  customMessage: string;
}

const DEFAULT_SETTINGS: PortalSettings = {
  showStage: true, showTimeline: true,
  showClientTeam: true, showConsultantTeam: true,
  showRisks: true, showIssues: true, showDecisions: false,
  showDataCollection: true, showTodos: true, showMeetings: false,
  customMessage: '',
};

interface PortalToggle {
  key: keyof PortalSettings;
  label: string;
  description: string;
  guidance: { title: string; body: string; bullets?: string[]; note?: string };
}

const SECTION_TOGGLES: PortalToggle[] = [
  {
    key: 'showStage',
    label: 'Project Stage',
    description: 'Current phase and progress bar',
    guidance: {
      title: 'What the client sees',
      body: 'Displays the current implementation phase (e.g., "Discovery", "Build", "UAT") with a visual progress bar showing % complete. This is the single most powerful motivator for clients — seeing progress keeps them engaged.',
      bullets: [
        'Phase name + completion % drawn from the phases you configure',
        'Colour changes as project health updates (green = on track, amber = at risk)',
        'Turn OFF only if the project is in a sensitive holding phase and showing "0%" would be discouraging',
      ],
      note: '✅ Recommended: ON for all active engagements',
    },
  },
  {
    key: 'showTimeline',
    label: 'Project Timeline',
    description: 'Start date, contract end, days left',
    guidance: {
      title: 'What the client sees',
      body: 'Shows the project start date, contract end date, and a live countdown of days remaining. Clients use this to plan their own resourcing and internal approvals.',
      bullets: [
        'Pulled from the dates you set in Project Setup — keep them accurate',
        'Days remaining turns amber when <30 days and red when overdue',
        'Turn OFF during contract renegotiations or when timeline is not yet agreed',
      ],
      note: '✅ Recommended: ON once go-live date is confirmed',
    },
  },
  {
    key: 'showClientTeam',
    label: 'Client Team',
    description: 'Client-side stakeholders and contacts',
    guidance: {
      title: 'What the client sees',
      body: 'Lists all members flagged as "Client Team" — name, title, email, and phone. This helps the client see who on their own side is accountable for the project.',
      bullets: [
        'Only shows members with team = CLIENT in your committee',
        'Useful for onboarding new client staff who need to know the key contacts',
        'Turn OFF if the client contact list is confidential or still being confirmed',
      ],
    },
  },
  {
    key: 'showConsultantTeam',
    label: 'Implementation Team',
    description: 'Your consultants and project managers',
    guidance: {
      title: 'What the client sees',
      body: 'Shows your consulting team members with their names, roles, and contact details. Clients feel more confident when they know exactly who is working on their project.',
      bullets: [
        'Shows members flagged as CONSULTANT in your committee',
        'Recommended to always show — builds trust and accountability',
        'Ensure each consultant\'s email is filled in so clients can reach them directly',
      ],
      note: '✅ Recommended: ON for all engagements',
    },
  },
  {
    key: 'showDataCollection',
    label: 'Data Collection',
    description: 'Upload requests — client submits files',
    guidance: {
      title: 'What the client sees',
      body: 'Shows the data collection checklist with upload buttons. Clients can see which data files are needed (e.g., Chart of Accounts, Customer Master, Open AP), their due dates, and current status.',
      bullets: [
        'Client can upload files directly from the portal — no email needed',
        'Status updates automatically: Pending → Uploaded → Validated',
        'This is one of the highest-value portal features — eliminates email back-and-forth for data gathering',
        'Only turn OFF if data collection has not started yet and you don\'t want to show empty items',
      ],
      note: '⭐ High value: Turn ON as soon as data templates are ready',
    },
  },
  {
    key: 'showTodos',
    label: 'Action Items',
    description: 'Client-facing todo list with completion',
    guidance: {
      title: 'What the client sees',
      body: 'Displays the action items you create for the client — things they need to do, provide, or approve. Clients can check off completed items directly from the portal.',
      bullets: [
        'Create action items from the "Manage Action Items" panel below',
        'Each item can have a priority (High/Medium/Low), due date, and assignee',
        'Completed items move to a separate section, keeping the list clean',
        'Great for steering committee prep — create items before each meeting',
      ],
      note: '⭐ High value: Use this instead of emailing lists of tasks',
    },
  },
  {
    key: 'showRisks',
    label: 'Open Risks',
    description: 'Risk register — open items only',
    guidance: {
      title: 'What the client sees',
      body: 'Shows risks that are currently Open or Escalated — closed/mitigated risks are hidden. This keeps the client aware of active threats without overwhelming them.',
      bullets: [
        'Only open and escalated risks are shown — resolved ones are hidden',
        'Shows risk title, severity (High/Medium/Low), and owner',
        'Turn ON when you want client visibility to help drive mitigation (e.g., resource risks they control)',
        'Turn OFF during initial phases when risks are still being identified and the list looks alarming',
      ],
      note: '💡 Best practice: Turn ON from Build phase onwards',
    },
  },
  {
    key: 'showIssues',
    label: 'Open Issues',
    description: 'Issue tracker — open & in-progress only',
    guidance: {
      title: 'What the client sees',
      body: 'Displays the active issues log — only Open and In-Progress items are shown. Issues are problems that have already occurred and need resolution.',
      bullets: [
        'Closed issues are hidden to avoid clutter',
        'Shows issue title, priority, and assigned owner',
        'Useful when clients need to take action to resolve an issue (e.g., provide a decision, sign off on a workaround)',
        'Consider turning OFF if issue count is high and might undermine client confidence early in the project',
      ],
    },
  },
  {
    key: 'showDecisions',
    label: 'Recent Decisions',
    description: 'Decision log — last 5 entries',
    guidance: {
      title: 'What the client sees',
      body: 'Shows the 5 most recent decisions logged — what was decided, the rationale, and who made it. This creates a transparent audit trail that protects both sides.',
      bullets: [
        'Only the 5 most recent decisions are shown to keep it scannable',
        'Extremely useful for clients who forget what was agreed in steering committee',
        'Helps avoid scope creep disputes — client can see "we agreed X on Y date"',
        'Turn ON from Discovery phase onwards once key design decisions start being made',
      ],
      note: '✅ Recommended: ON from Discovery onwards',
    },
  },
  {
    key: 'showMeetings',
    label: 'Meetings',
    description: 'Upcoming meetings and recent notes',
    guidance: {
      title: 'What the client sees',
      body: 'Shows upcoming meeting schedules and notes from recent sessions (last 7 days). Clients can review what was discussed and what\'s coming next.',
      bullets: [
        'Shows meetings from the last 7 days plus all future meetings',
        'Include meeting notes so clients don\'t need to find the recording',
        'Great for keeping client sponsors informed even when they can\'t attend every session',
        'Turn ON once regular cadence meetings (weekly status, steering committee) are scheduled',
      ],
    },
  },
];

function ClientPortalCard({ engagementId }: { engagementId: string }) {
  const qc = useQueryClient();
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newTodoPriority, setNewTodoPriority] = useState('MEDIUM');
  const [newTodoDue, setNewTodoDue] = useState('');
  const [newTodoAssignedTo, setNewTodoAssignedTo] = useState('');
  const [inviteResult, setInviteResult] = useState<{ sent: number; total: number; message: string } | null>(null);

  // Load portal settings
  const { data: settingsData, isLoading: settingsLoading } = useQuery<PortalSettings>({
    queryKey: ['portalSettings', engagementId],
    queryFn: () => engagementsApi.getPortalSettings(engagementId),
  });
  const settings: PortalSettings = settingsData ?? DEFAULT_SETTINGS;

  // Load portal todos
  interface PortalTodoLite {
    id: string; title: string; priority?: string; assignedTo?: string;
    dueDate?: string; completedAt?: string | null; completedBy?: string;
  }
  interface MemberLite { id: string; name: string; team?: string; email?: string }

  const { data: todosData } = useQuery<PortalTodoLite[]>({
    queryKey: ['portalTodos', engagementId],
    queryFn: () => engagementsApi.listPortalTodos(engagementId),
    enabled: showTodos,
  });
  const todos = todosData ?? [];

  // Load members (to suggest assignees)
  const { data: membersData } = useQuery<MemberLite[]>({
    queryKey: ['members', engagementId],
    queryFn: () => engagementsApi.getMembers(engagementId),
  });
  const clientMembersWithEmail = (membersData ?? []).filter((m) => m.team === 'CLIENT' && m.email);

  // Settings mutation
  const saveMutation = useMutation({
    mutationFn: (patch: Partial<PortalSettings>) => engagementsApi.patchPortalSettings(engagementId, patch as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portalSettings', engagementId] }),
  });
  const handleToggle = (key: keyof PortalSettings, value: boolean) => saveMutation.mutate({ [key]: value });
  const handleMessageChange = (msg: string) => saveMutation.mutate({ customMessage: msg });

  // Generate portal link
  const generateMutation = useMutation({
    mutationFn: () => engagementsApi.generatePortalToken(engagementId),
    onSuccess: (data: { url?: string }) => setPortalUrl(data.url ?? null),
  });
  const copyUrl = () => {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Send portal invites
  const inviteMutation = useMutation({
    mutationFn: () => engagementsApi.sendPortalInvites(engagementId),
    onSuccess: (data: { sent: number; total: number; message: string }) => setInviteResult(data),
  });

  // Todo mutations
  const createTodoMutation = useMutation({
    mutationFn: () => engagementsApi.createPortalTodo(engagementId, {
      title: newTodoTitle, priority: newTodoPriority,
      dueDate: newTodoDue || undefined, assignedTo: newTodoAssignedTo || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portalTodos', engagementId] });
      setNewTodoTitle(''); setNewTodoDue(''); setNewTodoAssignedTo(''); setNewTodoPriority('MEDIUM');
    },
  });
  const deleteTodoMutation = useMutation({
    mutationFn: (todoId: string) => engagementsApi.deletePortalTodo(engagementId, todoId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portalTodos', engagementId] }),
  });

  const PRIORITY_COLORS: Record<string, string> = {
    HIGH: 'text-red-600 bg-red-50 border-red-200',
    MEDIUM: 'text-amber-600 bg-amber-50 border-amber-200',
    LOW: 'text-gray-500 bg-gray-50 border-gray-200',
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 pb-5">
        <SectionHeading
          icon={Link}
          title="Client Portal"
          subtitle="Share project info, action items, and upload requests with your client."
        />

        {/* Link area */}
        {portalUrl ? (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <p className="flex-1 text-xs text-gray-600 font-mono truncate">{portalUrl}</p>
              <button
                onClick={copyUrl}
                className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors"
              >
                {copied ? <><CircleCheck className="h-3.5 w-3.5 text-green-500" />Copied!</> : <><CopyIcon className="h-3.5 w-3.5" />Copy</>}
              </button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <a
                href={portalUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5 transition-colors"
              >
                <ArrowRight className="h-3.5 w-3.5" />Preview Portal
              </a>
              <span className="text-gray-200">·</span>
              <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
                className="text-xs font-semibold text-gray-400 hover:text-gray-600 underline-offset-2 hover:underline transition-colors disabled:opacity-50">
                {generateMutation.isPending ? 'Regenerating…' : 'Regenerate link'}
              </button>
              <span className="text-gray-200">·</span>
              <button onClick={() => setShowSettings((s) => !s)}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline transition-colors">
                {showSettings ? 'Hide settings' : 'Portal settings'}
              </button>
              <span className="text-gray-200">·</span>
              <button onClick={() => setShowTodos((s) => !s)}
                className="text-xs font-semibold text-brand-600 hover:text-brand-700 underline-offset-2 hover:underline transition-colors flex items-center gap-1">
                <ListTodo className="h-3 w-3" />{showTodos ? 'Hide action items' : 'Manage action items'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-5 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors">
              {generateMutation.isPending ? <><Loader className="h-4 w-4 animate-spin" />Generating…</> : <><Link className="h-4 w-4" />Generate Portal Link</>}
            </button>
            <button onClick={() => setShowSettings((s) => !s)}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
              {showSettings ? 'Hide settings ↑' : 'Configure what clients can see →'}
            </button>
          </div>
        )}

        {/* Send Portal Invites */}
        {portalUrl && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-800">Kick-off Portal Access</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {clientMembersWithEmail.length > 0
                    ? `Send personalised invite emails to ${clientMembersWithEmail.length} client member${clientMembersWithEmail.length !== 1 ? 's' : ''} with email addresses.`
                    : 'Add email addresses to client members to enable email invites.'
                  }
                </p>
              </div>
              <button
                onClick={() => { setInviteResult(null); inviteMutation.mutate(); }}
                disabled={inviteMutation.isPending || clientMembersWithEmail.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-40 transition-colors flex-shrink-0"
              >
                {inviteMutation.isPending
                  ? <><Loader className="h-4 w-4 animate-spin" />Sending…</>
                  : <><Send className="h-4 w-4" />Send Invites</>
                }
              </button>
            </div>
            {inviteResult && (
              <div className={cn('mt-2 rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-1.5',
                inviteResult.sent > 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700')}>
                <CircleCheck className="h-3.5 w-3.5 flex-shrink-0" />
                {inviteResult.message}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Items (Todos) panel */}
      {showTodos && (
        <div className="border-t border-gray-100 bg-gray-50/40 px-6 py-5 space-y-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
            <ListTodo className="h-3.5 w-3.5" />Client Action Items
          </p>

          {/* Add new todo */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newTodoTitle.trim() && createTodoMutation.mutate()}
                placeholder="New action item title…"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white"
              />
              <select value={newTodoPriority} onChange={(e) => setNewTodoPriority(e.target.value)}
                className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none">
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div className="flex gap-2">
              <input type="date" value={newTodoDue} onChange={(e) => setNewTodoDue(e.target.value)}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 flex-1" />
              <input value={newTodoAssignedTo} onChange={(e) => setNewTodoAssignedTo(e.target.value)}
                placeholder="Assigned to (name)…"
                list={`members-${engagementId}`}
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-300 flex-1" />
              <datalist id={`members-${engagementId}`}>
                {(membersData ?? []).filter((m) => m.team === 'CLIENT').map((m) => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
              <button
                onClick={() => newTodoTitle.trim() && createTodoMutation.mutate()}
                disabled={!newTodoTitle.trim() || createTodoMutation.isPending}
                className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />Add
              </button>
            </div>
          </div>

          {/* Todo list */}
          {todos.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-3">No action items yet — add one above.</p>
          ) : (
            <div className="space-y-2">
              {todos.map((todo) => (
                <div key={todo.id} className={cn('flex items-start gap-3 p-3 rounded-xl border bg-white',
                  todo.completedAt ? 'opacity-60 border-gray-100' : 'border-gray-200')}>
                  <CheckSquare className={cn('h-4 w-4 mt-0.5 flex-shrink-0', todo.completedAt ? 'text-green-500' : 'text-gray-300')} />
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-semibold', todo.completedAt ? 'line-through text-gray-400' : 'text-gray-800')}>
                      {todo.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', PRIORITY_COLORS[todo.priority ?? ''])}>
                        {todo.priority}
                      </span>
                      {todo.assignedTo && <span className="text-[10px] text-gray-400">→ {todo.assignedTo}</span>}
                      {todo.dueDate && <span className="text-[10px] text-gray-400">Due {new Date(todo.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                      {todo.completedAt && todo.completedBy && <span className="text-[10px] text-green-600">✓ {todo.completedBy}</span>}
                    </div>
                  </div>
                  <button onClick={() => deleteTodoMutation.mutate(todo.id)}
                    className="p-1 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings panel */}
      {showSettings && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-6 py-5 space-y-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Portal Visibility Settings</p>
          {settingsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400"><Loader className="h-4 w-4 animate-spin" />Loading…</div>
          ) : (
            <div className="space-y-3">
              {SECTION_TOGGLES.map(({ key, label, description, guidance }) => (
                <div key={key} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-800">{label}</p>
                      <HelpTip
                        title={guidance.title}
                        body={guidance.body}
                        bullets={guidance.bullets}
                        note={guidance.note}
                      />
                    </div>
                    <p className="text-xs text-gray-500">{description}</p>
                  </div>
                  <Toggle checked={!!settings[key as keyof PortalSettings]}
                    onChange={(v) => handleToggle(key, v)} disabled={saveMutation.isPending} />
                </div>
              ))}
              <div className="pt-3 border-t border-gray-200">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Welcome Message <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <textarea rows={2} placeholder="Add a welcome note shown at the top of the portal…"
                  defaultValue={settings.customMessage} onBlur={(e) => handleMessageChange(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
              </div>
              {saveMutation.isPending && (
                <p className="text-xs text-brand-500 font-medium flex items-center gap-1.5"><Loader className="h-3 w-3 animate-spin" />Saving…</p>
              )}
              {saveMutation.isSuccess && !saveMutation.isPending && (
                <p className="text-xs text-green-600 font-medium flex items-center gap-1.5"><CircleCheck className="h-3 w-3" />Settings saved</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
