import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutGrid, BarChart2, AlignLeft, Plus, ChevronRight, X, Mail, Phone,
  UserPlus, Trash2, TriangleAlert, CircleX, CircleCheck, Loader,
  CalendarDays, Users, ArrowRight,
} from 'lucide-react';
import { r2rQuestions, p2pQuestions, o2cQuestions, mfgQuestions, rtnQuestions } from '@ofoq/shared';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Shared question list (mirrors useWizardProgress logic) ──────────────────

const ALL_QUESTIONS = [
  ...r2rQuestions,
  ...p2pQuestions,
  ...o2cQuestions,
  ...mfgQuestions,
  ...rtnQuestions,
];
const REQUIRED_QUESTIONS = ALL_QUESTIONS.filter((q) => q.required);

// ─── Types ──────────────────────────────────────────────────────────────────

interface Member { id: string; name: string; role: string; team: string; email?: string; phone?: string; }
interface Conflict { severity: 'BLOCK' | 'WARN'; }
interface Job { status: string; createdAt: string; }
interface Profile { completeness: Record<string, number>; answers?: Record<string, unknown>; }

interface Engagement {
  id: string;
  clientName: string;
  status: string;
  startDate?: string | null;
  contractEndDate?: string | null;
  createdAt: string;
  updatedAt: string;
  profile?: Profile | null;
  conflicts?: Conflict[];
  jobs?: Job[];
  members?: Member[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STAGES = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'] as const;
type Stage = typeof STAGES[number];

const STAGE_META: Record<Stage, { label: string; color: string; bg: string; border: string; dot: string }> = {
  DISCOVERY:  { label: 'Discovery',  color: 'text-slate-700',  bg: 'bg-slate-50',   border: 'border-slate-200', dot: 'bg-slate-400'  },
  SCOPING:    { label: 'Scoping',    color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200',  dot: 'bg-blue-500'   },
  BUILD:      { label: 'Build',      color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-200',dot: 'bg-violet-500' },
  UAT:        { label: 'UAT',        color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-200', dot: 'bg-amber-500'  },
  GO_LIVE:    { label: 'Go-Live',    color: 'text-green-700',  bg: 'bg-green-50',   border: 'border-green-200', dot: 'bg-green-500'  },
};

// Stage advancement gates — each transition requires minimum questionnaire completion
// and zero BLOCK-level conflicts before the user can advance.
const STAGE_ADVANCE_GATE: Record<Stage, { minProgress: number; label: string }> = {
  DISCOVERY: { minProgress: 25,  label: 'Complete at least 25% of the wizard before moving to Scoping.' },
  SCOPING:   { minProgress: 50,  label: 'Complete at least 50% of the wizard before moving to Build.' },
  BUILD:     { minProgress: 75,  label: 'Complete at least 75% of the wizard before moving to UAT.' },
  UAT:       { minProgress: 90,  label: 'Complete at least 90% of the wizard before going Live.' },
  GO_LIVE:   { minProgress: 100, label: 'Already live.' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProgress(eng: Engagement): number {
  const answers = eng.profile?.answers ?? {};
  if (REQUIRED_QUESTIONS.length === 0) return 0;
  const answered = REQUIRED_QUESTIONS.filter(
    (q) =>
      answers[q.id] !== undefined &&
      answers[q.id] !== null &&
      answers[q.id] !== '' &&
      !(Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)
  );
  return Math.round((answered.length / REQUIRED_QUESTIONS.length) * 100);
}

function getDeadlineRisk(eng: Engagement): 'overdue' | 'at-risk' | 'on-track' | 'none' {
  if (!eng.contractEndDate || eng.status === 'GO_LIVE') return 'none';
  const end = new Date(eng.contractEndDate);
  const today = new Date();
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= 14) return 'at-risk';
  return 'on-track';
}

function getDaysLeft(eng: Engagement): number | null {
  if (!eng.contractEndDate) return null;
  const end = new Date(eng.contractEndDate);
  return Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

interface AdvanceBlocker {
  message: string;
  /** Wizard sidebar section key to navigate to for resolution */
  section: string;
  /** Human-readable label for the link */
  linkLabel: string;
}

interface AdvanceGateResult {
  allowed: boolean;
  blockers: AdvanceBlocker[];
}

function getAdvanceGate(eng: Engagement): AdvanceGateResult {
  const stage = eng.status as Stage;
  const gate = STAGE_ADVANCE_GATE[stage];
  if (!gate) return { allowed: false, blockers: [{ message: 'Unknown stage.', section: 'project', linkLabel: 'Project Setup' }] };

  const blockers: AdvanceBlocker[] = [];
  const progress = getProgress(eng);
  const blockConflicts = eng.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
  const warnConflicts  = eng.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;

  if (progress < gate.minProgress) {
    blockers.push({
      message: `Questionnaire is ${progress}% complete — need ${gate.minProgress}% to advance.`,
      section: 'project',
      linkLabel: 'Open wizard to fill in answers',
    });
  }
  if (blockConflicts > 0) {
    blockers.push({
      message: `${blockConflicts} blocking conflict${blockConflicts > 1 ? 's' : ''} must be resolved before advancing.`,
      section: 'issues',
      linkLabel: `View ${blockConflicts} blocking issue${blockConflicts > 1 ? 's' : ''} →`,
    });
  }
  if (warnConflicts > 0 && blockConflicts === 0 && progress >= gate.minProgress) {
    // Warnings alone don't block but are surfaced in the gate when it's otherwise clear
    blockers.push({
      message: `${warnConflicts} warning${warnConflicts > 1 ? 's' : ''} detected — review before advancing.`,
      section: 'issues',
      linkLabel: `Review ${warnConflicts} warning${warnConflicts > 1 ? 's' : ''} →`,
    });
  }

  return { allowed: blockers.length === 0, blockers };
}

function getHealthScore(eng: Engagement): number {
  let score = 60;
  const progress = getProgress(eng);
  score += Math.round(progress * 0.3);
  const blocks = eng.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
  const warns  = eng.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;
  score -= blocks * 12;
  score -= warns * 4;
  const risk = getDeadlineRisk(eng);
  if (risk === 'overdue') score -= 20;
  else if (risk === 'at-risk') score -= 10;
  const stageIdx = STAGES.indexOf(eng.status as Stage);
  score += stageIdx * 3;
  return Math.max(0, Math.min(100, score));
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn('text-[10px] font-bold tabular-nums', score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-600' : 'text-red-600')}>
        {score}
      </span>
    </div>
  );
}

function DeadlineBadge({ eng }: { eng: Engagement }) {
  const risk = getDeadlineRisk(eng);
  const days = getDaysLeft(eng);
  if (risk === 'none' || days === null) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', {
      'bg-red-100 text-red-700': risk === 'overdue',
      'bg-amber-100 text-amber-700': risk === 'at-risk',
      'bg-green-100 text-green-700': risk === 'on-track',
    })}>
      <CalendarDays className="h-3 w-3" />
      {risk === 'overdue' ? `${Math.abs(days)}d overdue` : `${days}d left`}
    </span>
  );
}

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({ m, onDelete }: { m: Member; onDelete: () => void }) {
  const isOfoq = m.team === 'CONSULTANT';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-2.5">
      <div className={cn('h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold',
        isOfoq ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700')}>
        {m.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
        <p className="text-xs text-gray-500">{m.role}</p>
        <div className="flex items-center gap-3 mt-0.5">
          {m.email && <a href={`mailto:${m.email}`} className="flex items-center gap-1 text-xs text-blue-600 hover:underline"><Mail className="h-3 w-3" />{m.email}</a>}
          {m.phone && <span className="flex items-center gap-1 text-xs text-gray-500"><Phone className="h-3 w-3" />{m.phone}</span>}
        </div>
      </div>
      <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Members Modal ────────────────────────────────────────────────────────────

function MembersModal({ engagement, onClose }: { engagement: Engagement; onClose: () => void }) {
  const qc = useQueryClient();
  const [activeTeam, setActiveTeam] = useState<'CLIENT' | 'CONSULTANT'>('CLIENT');
  const [form, setForm] = useState({ name: '', role: '', email: '', phone: '' });

  const addMutation = useMutation({
    mutationFn: () => engagementsApi.addMember(engagement.id, { ...form, team: activeTeam }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['engagements'] }); setForm({ name: '', role: '', email: '', phone: '' }); },
  });

  const delMutation = useMutation({
    mutationFn: (memberId: string) => engagementsApi.deleteMember(engagement.id, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements'] }),
  });

  const all = engagement.members ?? [];
  const clientTeam = all.filter((m) => m.team !== 'CONSULTANT');
  const ofoqTeam   = all.filter((m) => m.team === 'CONSULTANT');
  const current    = activeTeam === 'CLIENT' ? clientTeam : ofoqTeam;

  const placeholders = activeTeam === 'CLIENT'
    ? { role: 'Role (e.g. CFO, IT Manager)' }
    : { role: 'Role (e.g. Project Manager)' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h3 className="text-base font-bold text-gray-900">Project Committee</h3>
            <p className="text-xs text-gray-500 mt-0.5">{engagement.clientName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>

        {/* Team tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTeam('CLIENT')}
            className={cn('flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors',
              activeTeam === 'CLIENT' ? 'border-blue-500 text-blue-700 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700')}
          >
            <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center">
              <span className="text-[9px] font-black text-blue-700">C</span>
            </div>
            Client Team
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold',
              activeTeam === 'CLIENT' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500')}>
              {clientTeam.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTeam('CONSULTANT')}
            className={cn('flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors',
              activeTeam === 'CONSULTANT' ? 'border-violet-500 text-violet-700 bg-violet-50/50' : 'border-transparent text-gray-500 hover:text-gray-700')}
          >
            <div className="h-5 w-5 rounded-full bg-violet-100 flex items-center justify-center">
              <span className="text-[9px] font-black text-violet-700">O</span>
            </div>
            Ofoq Team
            <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold',
              activeTeam === 'CONSULTANT' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500')}>
              {ofoqTeam.length}
            </span>
          </button>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {current.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">
              {activeTeam === 'CLIENT' ? 'No client-side members yet.' : 'No Ofoq team members yet.'}
            </p>
          )}
          {current.map((m) => (
            <MemberRow key={m.id} m={m} onDelete={() => delMutation.mutate(m.id)} />
          ))}
        </div>

        {/* Add form */}
        <div className="border-t px-6 py-4 bg-gray-50 rounded-b-2xl">
          <p className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: activeTeam === 'CLIENT' ? '#1d4ed8' : '#7c3aed' }}>
            Add {activeTeam === 'CLIENT' ? 'Client' : 'Ofoq'} Member
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Full name *" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <input placeholder={placeholders.role} value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="col-span-2 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <input placeholder="Email" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <input placeholder="Phone" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            <button
              onClick={() => form.name.trim() && addMutation.mutate()}
              disabled={!form.name.trim() || addMutation.isPending}
              className={cn('col-span-2 rounded-lg text-white text-sm font-semibold px-3 py-2 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors',
                activeTeam === 'CLIENT' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-violet-600 hover:bg-violet-700')}
            >
              {addMutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              Add to {activeTeam === 'CLIENT' ? 'Client' : 'Ofoq'} Team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dates Modal ─────────────────────────────────────────────────────────────

function DatesModal({ engagement, onClose }: { engagement: Engagement; onClose: () => void }) {
  const qc = useQueryClient();
  const [startDate, setStartDate] = useState(engagement.startDate ?? '');
  const [contractEndDate, setContractEndDate] = useState(engagement.contractEndDate ?? '');

  const patchMutation = useMutation({
    mutationFn: () => engagementsApi.patch(engagement.id, { startDate: startDate || null, contractEndDate: contractEndDate || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['engagements'] }); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-base font-bold text-gray-900">Project Dates</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Contract End Date</label>
            <input type="date" value={contractEndDate} onChange={(e) => setContractEndDate(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => patchMutation.mutate()} disabled={patchMutation.isPending}
            className="flex-1 rounded-lg bg-brand-600 text-white py-2 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            {patchMutation.isPending && <Loader className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Avatar Stack ─────────────────────────────────────────────────────────────

function AvatarStack({ members, color, max = 4 }: { members: Member[]; color: 'blue' | 'violet'; max?: number }) {
  const shown = members.slice(0, max);
  const rest  = members.length - shown.length;
  const bg    = color === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700';
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((m) => (
        <div key={m.id} title={`${m.name} (${m.role})`}
          className={cn('h-6 w-6 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold flex-shrink-0', bg)}>
          {m.name.charAt(0).toUpperCase()}
        </div>
      ))}
      {rest > 0 && (
        <div className="h-6 w-6 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[9px] font-bold text-gray-500">
          +{rest}
        </div>
      )}
    </div>
  );
}

// ─── Stage Gate Modal ─────────────────────────────────────────────────────────

function StageGateModal({
  engagement,
  nextStage,
  blockers,
  onClose,
}: {
  engagement: Engagement;
  nextStage: Stage;
  blockers: AdvanceBlocker[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const nextMeta = STAGE_META[nextStage];
  const gate = STAGE_ADVANCE_GATE[engagement.status as Stage];
  const progress = getProgress(engagement);

  const goToSection = (section: string) => {
    navigate(`/engagements/${engagement.id}/wizard`, { state: { section } });
    onClose();
  };

  const isBlocking = (b: AdvanceBlocker) =>
    b.message.includes('blocking conflict') || b.message.includes('complete —');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header stripe */}
        <div className="h-1.5 bg-gradient-to-r from-amber-400 to-orange-500" />

        {/* Content */}
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TriangleAlert className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <h3 className="text-base font-bold text-gray-900">Advancement Blocked</h3>
              </div>
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{engagement.clientName}</span>
                {' '}cannot advance to{' '}
                <span className={cn('font-bold', nextMeta.color)}>{nextMeta.label}</span> yet.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Progress snapshot */}
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 mb-4">
            <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1.5">
              <span>Questionnaire Completion</span>
              <span className={progress >= (gate?.minProgress ?? 0) ? 'text-green-600' : 'text-amber-600'}>
                {progress}% / {gate?.minProgress ?? 0}% required
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-gray-200 overflow-visible">
              <div
                className={cn('h-full rounded-full transition-all', progress >= (gate?.minProgress ?? 0) ? 'bg-green-500' : 'bg-amber-500')}
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
              {/* Threshold marker line */}
              {gate && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500 rounded-full"
                  style={{ left: `${gate.minProgress}%` }}
                  title={`${gate.minProgress}% required`}
                />
              )}
            </div>
            {gate && (
              <div className="mt-2 flex justify-between text-[10px] text-gray-400">
                <span>0%</span>
                <span className="font-semibold text-gray-500">{gate.minProgress}% required</span>
                <span>100%</span>
              </div>
            )}
          </div>

          {/* Blockers list — each is a clickable link to its resolution screen */}
          <div className="space-y-2 mb-5">
            {blockers.map((b, i) => {
              const hard = isBlocking(b);
              return (
                <button
                  key={i}
                  onClick={() => goToSection(b.section)}
                  className={cn(
                    'w-full flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left group transition-colors',
                    hard
                      ? 'bg-red-50 border-red-100 hover:bg-red-100 hover:border-red-300'
                      : 'bg-amber-50 border-amber-100 hover:bg-amber-100 hover:border-amber-300'
                  )}
                >
                  {hard
                    ? <CircleX className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    : <TriangleAlert className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs font-medium leading-tight', hard ? 'text-red-700' : 'text-amber-700')}>
                      {b.message}
                    </p>
                    <span className={cn(
                      'text-[11px] font-semibold underline underline-offset-2 mt-0.5 block transition-colors',
                      hard
                        ? 'text-red-500 group-hover:text-red-700'
                        : 'text-amber-500 group-hover:text-amber-700'
                    )}>
                      {b.linkLabel}
                    </span>
                  </div>
                  <ChevronRight className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity', hard ? 'text-red-400' : 'text-amber-400')} />
                </button>
              );
            })}
          </div>

          {/* Secondary CTA — open wizard at default section */}
          <button
            onClick={() => goToSection('project')}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-600 text-white text-sm font-bold px-4 py-2.5 hover:bg-brand-700 transition-colors"
          >
            Open Wizard
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Engagement Card (shared) ─────────────────────────────────────────────────

function EngCard({ eng, onMembersClick, onDatesClick }: {
  eng: Engagement;
  onMembersClick: () => void;
  onDatesClick: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showGateModal, setShowGateModal] = useState(false);
  const progress = getProgress(eng);
  const health = getHealthScore(eng);
  const blocks = eng.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
  const warns  = eng.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;
  const meta = STAGE_META[eng.status as Stage] ?? STAGE_META.DISCOVERY;
  const clientTeam = (eng.members ?? []).filter((m) => m.team !== 'CONSULTANT');
  const ofoqTeam   = (eng.members ?? []).filter((m) => m.team === 'CONSULTANT');

  const advanceMutation = useMutation({
    mutationFn: (next: string) => engagementsApi.patch(eng.id, { status: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engagements'] }),
  });

  const stageIdx = STAGES.indexOf(eng.status as Stage);
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;
  const gate = getAdvanceGate(eng);

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className={cn('rounded-xl border bg-white flex flex-col overflow-hidden hover:shadow-md transition-shadow', meta.border)}>
      {/* Stage colour stripe */}
      <div className={cn('h-1.5', meta.dot)} />

      <div className="p-4 flex flex-col gap-3">

        {/* Client name + stage badge */}
        <div className="flex items-start justify-between gap-2">
          <button onClick={() => navigate(`/engagements/${eng.id}/wizard`)}
            className="text-sm font-bold text-gray-900 hover:text-brand-700 transition-colors text-left leading-tight">
            {eng.clientName}
          </button>
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide flex-shrink-0', meta.bg, meta.color)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />{meta.label}
          </span>
        </div>

        {/* ── Dates row ─────────────────────────────────────────────────────── */}
        <button onClick={onDatesClick}
          className="rounded-lg border border-dashed border-gray-200 hover:border-brand-400 hover:bg-brand-50/40 px-3 py-2 transition-colors text-left">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
            {eng.startDate || eng.contractEndDate ? (
              <div className="flex items-center gap-1 flex-wrap text-xs">
                <span className="font-semibold text-gray-700">{eng.startDate ? fmt(eng.startDate) : '—'}</span>
                <ArrowRight className="h-3 w-3 text-gray-300 flex-shrink-0" />
                <span className={cn('font-semibold',
                  getDeadlineRisk(eng) === 'overdue' ? 'text-red-600' :
                  getDeadlineRisk(eng) === 'at-risk'  ? 'text-amber-600' : 'text-gray-700')}>
                  {eng.contractEndDate ? fmt(eng.contractEndDate) : '—'}
                </span>
                <DeadlineBadge eng={eng} />
              </div>
            ) : (
              <span className="text-xs text-gray-400">Click to set start &amp; end dates</span>
            )}
          </div>
        </button>

        {/* ── Progress + Health ─────────────────────────────────────────────── */}
        <div className="space-y-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
          {/* Bar 1 — Questionnaire completion */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Questionnaire</span>
              <span className={cn(
                'text-[10px] font-bold tabular-nums',
                progress >= (STAGE_ADVANCE_GATE[eng.status as Stage]?.minProgress ?? 0) ? 'text-brand-600' : 'text-amber-600'
              )}>
                {progress}%
                {progress < (STAGE_ADVANCE_GATE[eng.status as Stage]?.minProgress ?? 0) && (
                  <span className="text-gray-400 font-normal"> / {STAGE_ADVANCE_GATE[eng.status as Stage]?.minProgress}% req.</span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', progress >= (STAGE_ADVANCE_GATE[eng.status as Stage]?.minProgress ?? 0) ? 'bg-brand-500' : 'bg-amber-400')}
                style={{ width: `${progress}%` }} />
            </div>
          </div>
          {/* Bar 2 — Composite health score */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Health Score</span>
              <span className="text-[10px] text-gray-400 font-normal">0–100 composite</span>
            </div>
            <HealthBar score={health} />
          </div>
        </div>

        {/* ── Committee ─────────────────────────────────────────────────────── */}
        <button onClick={onMembersClick}
          className="rounded-lg border border-dashed border-gray-200 hover:border-brand-400 hover:bg-brand-50/40 px-3 py-2.5 transition-colors text-left">
          <div className="space-y-2">
            {/* Client team row */}
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-black text-blue-700">C</span>
              </div>
              <span className="text-[10px] font-semibold text-gray-500 w-16">Client</span>
              {clientTeam.length > 0
                ? <AvatarStack members={clientTeam} color="blue" />
                : <span className="text-[10px] text-gray-300 italic">Add members</span>}
            </div>
            {/* Ofoq team row */}
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-black text-violet-700">O</span>
              </div>
              <span className="text-[10px] font-semibold text-gray-500 w-16">Ofoq</span>
              {ofoqTeam.length > 0
                ? <AvatarStack members={ofoqTeam} color="violet" />
                : <span className="text-[10px] text-gray-300 italic">Add members</span>}
            </div>
          </div>
        </button>

        {/* ── Issues ────────────────────────────────────────────────────────── */}
        {(blocks > 0 || warns > 0) && (
          <div className="flex items-center gap-2 flex-wrap">
            {blocks > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                <CircleX className="h-3 w-3" />{blocks} block{blocks !== 1 ? 's' : ''}
              </span>
            )}
            {warns > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <TriangleAlert className="h-3 w-3" />{warns} warn{warns !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-gray-50">
          <button onClick={() => navigate(`/engagements/${eng.id}/wizard`)}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-brand-50 border border-brand-100 px-2 py-1.5 text-[10px] font-semibold text-brand-700 hover:bg-brand-100 transition-colors">
            Open <ArrowRight className="h-3 w-3" />
          </button>
          {nextStage && (
            gate.allowed ? (
              <button
                onClick={() => advanceMutation.mutate(nextStage)}
                disabled={advanceMutation.isPending}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-violet-50 border border-violet-100 px-2 py-1.5 text-[10px] font-semibold text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
              >
                {advanceMutation.isPending ? <Loader className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                {STAGE_META[nextStage as Stage]?.label}
              </button>
            ) : (
              <button
                onClick={() => setShowGateModal(true)}
                title={gate.blockers[0]?.message}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-gray-50 border border-gray-200 border-dashed px-2 py-1.5 text-[10px] font-semibold text-gray-400 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600 transition-colors cursor-not-allowed"
              >
                <TriangleAlert className="h-3 w-3" />
                {STAGE_META[nextStage as Stage]?.label}
              </button>
            )
          )}
          {eng.status === 'GO_LIVE' && (
            <span className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-green-50 border border-green-100 px-2 py-1.5 text-[10px] font-semibold text-green-700">
              <CircleCheck className="h-3 w-3" />Live!
            </span>
          )}
        </div>
      </div>

      {/* Stage Gate Modal */}
      {showGateModal && nextStage && (
        <StageGateModal
          engagement={eng}
          nextStage={nextStage as Stage}
          blockers={gate.blockers}
          onClose={() => setShowGateModal(false)}
        />
      )}
    </div>
  );
}

// ─── View: Kanban ─────────────────────────────────────────────────────────────

function KanbanView({ engagements, onMembersClick, onDatesClick }: {
  engagements: Engagement[];
  onMembersClick: (eng: Engagement) => void;
  onDatesClick: (eng: Engagement) => void;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-0">
      {STAGES.map((stage) => {
        const cards = engagements.filter((e) => e.status === stage);
        const meta = STAGE_META[stage];
        return (
          <div key={stage} className="flex-shrink-0 w-72">
            <div className={cn('flex items-center gap-2 rounded-t-xl px-4 py-3 border border-b-0', meta.bg, meta.border)}>
              <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
              <span className={cn('text-xs font-bold uppercase tracking-widest', meta.color)}>{meta.label}</span>
              <span className={cn('ml-auto text-xs font-bold rounded-full px-2 py-0.5', meta.bg, meta.color, 'border', meta.border)}>
                {cards.length}
              </span>
            </div>
            <div className={cn('rounded-b-xl border border-t-0 p-3 space-y-3 min-h-32', meta.border, 'bg-white/60')}>
              {cards.length === 0 && (
                <p className="text-xs text-gray-300 text-center py-6">No projects</p>
              )}
              {cards.map((eng) => (
                <EngCard key={eng.id} eng={eng}
                  onMembersClick={() => onMembersClick(eng)}
                  onDatesClick={() => onDatesClick(eng)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── View: Pipeline Funnel + Table ─────────────────────────────────────────────

function PipelineView({ engagements, onMembersClick, onDatesClick }: {
  engagements: Engagement[];
  onMembersClick: (eng: Engagement) => void;
  onDatesClick: (eng: Engagement) => void;
}) {
  const navigate = useNavigate();
  const counts = STAGES.map((s) => engagements.filter((e) => e.status === s).length);
  const maxCount = Math.max(...counts, 1);

  return (
    <div className="space-y-8">
      {/* Funnel */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-bold text-gray-700 mb-5">Stage Funnel</h3>
        <div className="space-y-3">
          {STAGES.map((stage, i) => {
            const count = counts[i];
            const meta = STAGE_META[stage];
            const pct = Math.round((count / engagements.length) * 100) || 0;
            const width = Math.max(15, Math.round((count / maxCount) * 100));
            return (
              <div key={stage} className="flex items-center gap-4">
                <span className="w-24 text-xs font-semibold text-gray-500 text-right">{meta.label}</span>
                <div className="flex-1 relative h-8 rounded-lg bg-gray-50 overflow-hidden">
                  <div
                    className={cn('absolute inset-y-0 left-0 rounded-lg flex items-center pl-3 transition-all duration-700', meta.bg, meta.border, 'border')}
                    style={{ width: `${width}%` }}
                  >
                    <span className={cn('text-xs font-bold', meta.color)}>{count} project{count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <span className="w-10 text-xs font-semibold text-gray-400 tabular-nums">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-700">All Projects</h3>
          <span className="text-xs text-gray-400">{engagements.length} total</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3 text-left">Client</th>
                <th className="px-5 py-3 text-left">Stage</th>
                <th className="px-5 py-3 text-left">Progress</th>
                <th className="px-5 py-3 text-left">Health</th>
                <th className="px-5 py-3 text-left">Deadline</th>
                <th className="px-5 py-3 text-left">Members</th>
                <th className="px-5 py-3 text-left">Issues</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {engagements.map((eng) => {
                const meta = STAGE_META[eng.status as Stage] ?? STAGE_META.DISCOVERY;
                const progress = getProgress(eng);
                const health = getHealthScore(eng);
                const blocks = eng.conflicts?.filter((c) => c.severity === 'BLOCK').length ?? 0;
                const warns  = eng.conflicts?.filter((c) => c.severity === 'WARN').length ?? 0;
                const days = getDaysLeft(eng);
                const risk = getDeadlineRisk(eng);
                return (
                  <tr key={eng.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3">
                      <button onClick={() => navigate(`/engagements/${eng.id}/wizard`)}
                        className="font-semibold text-gray-900 hover:text-brand-700 transition-colors text-left">
                        {eng.clientName}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', meta.bg, meta.color)}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 w-28">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-500 tabular-nums w-8">{progress}%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 w-28">
                      <HealthBar score={health} />
                    </td>
                    <td className="px-5 py-3">
                      {eng.contractEndDate ? (
                        <button onClick={() => onDatesClick(eng)} className="text-left">
                          <DeadlineBadge eng={eng} />
                          {risk === 'none' && (
                            <span className="text-xs text-gray-400">{new Date(eng.contractEndDate).toLocaleDateString()}</span>
                          )}
                        </button>
                      ) : (
                        <button onClick={() => onDatesClick(eng)} className="text-xs text-gray-300 hover:text-brand-500 flex items-center gap-1">
                          <Plus className="h-3 w-3" />Set date
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={() => onMembersClick(eng)}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600">
                        <Users className="h-3.5 w-3.5" />{eng.members?.length ?? 0}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        {blocks > 0 && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-600"><CircleX className="h-3 w-3" />{blocks}</span>}
                        {warns > 0  && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600"><TriangleAlert className="h-3 w-3" />{warns}</span>}
                        {blocks === 0 && warns === 0 && <CircleCheck className="h-3.5 w-3.5 text-green-400" />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => navigate(`/engagements/${eng.id}/wizard`)}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors">
                        Open <ArrowRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── View: Timeline ───────────────────────────────────────────────────────────

function TimelineView({ engagements, onDatesClick }: {
  engagements: Engagement[];
  onDatesClick: (eng: Engagement) => void;
}) {
  const navigate = useNavigate();
  // Find global date range
  const allDates = engagements
    .flatMap((e) => [e.startDate, e.contractEndDate, e.createdAt].filter(Boolean) as string[])
    .map((d) => new Date(d).getTime());
  const minTs = allDates.length ? Math.min(...allDates) : Date.now() - 30 * 86400000;
  const maxTs = allDates.length ? Math.max(...allDates) : Date.now() + 180 * 86400000;
  const totalSpan = maxTs - minTs || 1;
  const todayPct = Math.max(0, Math.min(100, ((Date.now() - minTs) / totalSpan) * 100));

  const months: string[] = [];
  const d = new Date(minTs);
  d.setDate(1);
  while (d.getTime() <= maxTs) {
    months.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));
    d.setMonth(d.getMonth() + 1);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Month ruler */}
      <div className="relative border-b border-gray-100 bg-gray-50 px-6 py-2" style={{ paddingLeft: '220px' }}>
        <div className="relative h-5">
          {months.map((m, i) => {
            const pct = (i / Math.max(months.length - 1, 1)) * 100;
            return (
              <span key={m} className="absolute text-[10px] font-semibold text-gray-400 -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${pct}%` }}>{m}</span>
            );
          })}
          {/* Today line */}
          <div className="absolute top-0 bottom-0 w-px bg-red-400/50" style={{ left: `${todayPct}%` }} />
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-50">
        {engagements.map((eng) => {
          const startTs = eng.startDate ? new Date(eng.startDate).getTime() : new Date(eng.createdAt).getTime();
          const endTs = eng.contractEndDate ? new Date(eng.contractEndDate).getTime() : startTs + 90 * 86400000;
          const leftPct = Math.max(0, ((startTs - minTs) / totalSpan) * 100);
          const widthPct = Math.min(100 - leftPct, Math.max(2, ((endTs - startTs) / totalSpan) * 100));
          const meta = STAGE_META[eng.status as Stage] ?? STAGE_META.DISCOVERY;
          const risk = getDeadlineRisk(eng);
          const health = getHealthScore(eng);
          const progress = getProgress(eng);

          return (
            <div key={eng.id} className="flex items-center gap-0 hover:bg-gray-50/50 transition-colors group" style={{ height: 56 }}>
              {/* Label */}
              <div className="flex-shrink-0 w-52 px-4 flex flex-col justify-center border-r border-gray-50">
                <button onClick={() => navigate(`/engagements/${eng.id}/wizard`)}
                  className="text-xs font-bold text-gray-900 hover:text-brand-700 truncate text-left">
                  {eng.clientName}
                </button>
                <span className={cn('text-[10px] font-semibold', meta.color)}>{meta.label}</span>
              </div>

              {/* Bar area */}
              <div className="flex-1 relative px-2" style={{ height: 56 }}>
                {/* Today line */}
                <div className="absolute inset-y-0 w-px bg-red-400/30 pointer-events-none" style={{ left: `calc(${todayPct}% + 8px)` }} />

                {/* Bar */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-7 rounded-lg flex items-center px-3 gap-2 cursor-pointer group/bar"
                  style={{ left: `calc(${leftPct}% + 8px)`, width: `calc(${widthPct}% - 8px)` }}
                  onClick={() => onDatesClick(eng)}
                >
                  {/* Fill bar */}
                  <div className={cn('absolute inset-0 rounded-lg opacity-70', meta.bg, 'border', meta.border)} />
                  {/* Progress overlay */}
                  <div className={cn('absolute inset-y-0 left-0 rounded-lg opacity-30', meta.dot.replace('bg-', 'bg-'))}
                    style={{ width: `${progress}%` }} />
                  {/* Label inside bar */}
                  <div className="relative flex items-center gap-1.5 min-w-0 overflow-hidden">
                    <div className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', meta.dot)} />
                    <span className={cn('text-[10px] font-bold truncate', meta.color)}>{eng.clientName}</span>
                    {risk === 'overdue' && <TriangleAlert className="h-3 w-3 text-red-500 flex-shrink-0" />}
                    {risk === 'at-risk' && <TriangleAlert className="h-3 w-3 text-amber-500 flex-shrink-0" />}
                  </div>
                </div>

                {/* Health dot on the right */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className={cn('text-[10px] font-bold', health >= 70 ? 'text-green-600' : health >= 40 ? 'text-amber-600' : 'text-red-600')}>
                    {health}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-6 py-3 border-t border-gray-50 flex items-center gap-6 bg-gray-50/50">
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <div className="w-6 h-px bg-red-400" />Today
        </div>
        <div className="text-[10px] text-gray-400">Bar width = project duration. Click any bar to edit dates.</div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ViewMode = 'kanban' | 'pipeline' | 'timeline';

export function PipelinePage() {
  const [view, setView] = useState<ViewMode>('kanban');
  const [membersTarget, setMembersTarget] = useState<Engagement | null>(null);
  const [datesTarget, setDatesTarget] = useState<Engagement | null>(null);

  const { data, isLoading } = useQuery<Engagement[]>({
    queryKey: ['engagements'],
    queryFn: engagementsApi.list,
  });

  const engagements: Engagement[] = data ?? [];

  const views: { key: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { key: 'kanban',   icon: LayoutGrid, label: 'Kanban'   },
    { key: 'pipeline', icon: BarChart2,  label: 'Pipeline' },
    { key: 'timeline', icon: AlignLeft,  label: 'Timeline' },
  ];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <>
      {/* View switcher + filter */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {views.map(({ key, icon: Icon, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all',
                view === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{engagements.length} project{engagements.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Views */}
      {view === 'kanban'   && <KanbanView   engagements={engagements} onMembersClick={setMembersTarget} onDatesClick={setDatesTarget} />}
      {view === 'pipeline' && <PipelineView engagements={engagements} onMembersClick={setMembersTarget} onDatesClick={setDatesTarget} />}
      {view === 'timeline' && <TimelineView engagements={engagements} onDatesClick={setDatesTarget} />}

      {/* Modals */}
      {membersTarget && <MembersModal engagement={membersTarget} onClose={() => setMembersTarget(null)} />}
      {datesTarget   && <DatesModal   engagement={datesTarget}   onClose={() => setDatesTarget(null)}   />}
    </>
  );
}
