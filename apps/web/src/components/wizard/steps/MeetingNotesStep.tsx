import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, Loader, Save, X,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';

interface ActionItem {
  text: string;
  owner?: string;
  done: boolean;
}

interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  attendees: string[];
  notes?: string;
  actionItems: ActionItem[];
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

// ─── Add Meeting Form ────────────────────────────────────────────────────────

function AddMeetingForm({
  engagementId, onAdded,
}: { engagementId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    meetingDate: '',
    attendees: '',
    notes: '',
    actionItems: [] as ActionItem[],
  });

  const mutation = useMutation({
    mutationFn: () => engagementsApi.createMeeting(engagementId, {
      ...form,
      attendees: form.attendees
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a),
    }),
    onSuccess: () => {
      setForm({ title: '', meetingDate: '', attendees: '', notes: '', actionItems: [] });
      setOpen(false);
      onAdded();
    },
  });

  const addActionItem = () => {
    setForm((f) => ({
      ...f,
      actionItems: [...f.actionItems, { text: '', owner: '', done: false }],
    }));
  };

  const removeActionItem = (idx: number) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.filter((_, i) => i !== idx),
    }));
  };

  const updateActionItem = (idx: number, updates: Partial<ActionItem>) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.map((ai, i) => (i === idx ? { ...ai, ...updates } : ai)),
    }));
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand-200 text-brand-600 hover:bg-brand-50 hover:border-brand-400 py-2.5 text-sm font-semibold transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        New Meeting
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 space-y-2.5">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
        New Meeting
      </p>
      <input
        placeholder="Meeting title *"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      <input
        type="date"
        value={form.meetingDate}
        onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      <input
        placeholder="Attendees (comma-separated)"
        value={form.attendees}
        onChange={(e) => setForm((f) => ({ ...f, attendees: e.target.value }))}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      <textarea
        placeholder="Meeting notes"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
        rows={3}
      />

      {/* Action Items */}
      <div className="pt-2">
        <p className="text-xs font-bold text-gray-700 mb-2">Action Items</p>
        <div className="space-y-2">
          {form.actionItems.map((item, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                placeholder="Action item"
                value={item.text}
                onChange={(e) => updateActionItem(idx, { text: e.target.value })}
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <input
                placeholder="Owner"
                value={item.owner ?? ''}
                onChange={(e) => updateActionItem(idx, { owner: e.target.value })}
                className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                onClick={() => removeActionItem(idx)}
                className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addActionItem}
          className="mt-2 text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1"
        >
          <Plus className="h-3 w-3" />
          Add Action Item
        </button>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => {
            setOpen(false);
            setForm({ title: '', meetingDate: '', attendees: '', notes: '', actionItems: [] });
          }}
          className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={() => form.title.trim() && form.meetingDate && mutation.mutate()}
          disabled={!form.title.trim() || !form.meetingDate || mutation.isPending}
          className="flex-1 rounded-xl bg-brand-600 text-white text-xs font-semibold py-2 flex items-center justify-center gap-1.5 disabled:opacity-50 hover:bg-brand-700 transition-colors"
        >
          {mutation.isPending ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create Meeting
        </button>
      </div>
    </div>
  );
}

// ─── Meeting Row ──────────────────────────────────────────────────────────────

function MeetingRow({
  meeting, engagementId, onRefresh,
}: { meeting: Meeting; engagementId: string; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(meeting);

  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: () => engagementsApi.updateMeeting(engagementId, meeting.id, form),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['meetings', engagementId] });
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => engagementsApi.deleteMeeting(engagementId, meeting.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meetings', engagementId] });
      onRefresh();
    },
  });

  const toggleActionItem = (idx: number) => {
    const updated = [...form.actionItems];
    updated[idx].done = !updated[idx].done;
    setForm((f) => ({ ...f, actionItems: updated }));
    updateMutation.mutate();
  };

  const addActionItem = () => {
    setForm((f) => ({
      ...f,
      actionItems: [...f.actionItems, { text: '', owner: '', done: false }],
    }));
  };

  const removeActionItem = (idx: number) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.filter((_, i) => i !== idx),
    }));
  };

  const updateActionItem = (idx: number, updates: Partial<ActionItem>) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.map((ai, i) => (i === idx ? { ...ai, ...updates } : ai)),
    }));
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow">
      {editing ? (
        <div className="space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="date"
            value={form.meetingDate}
            onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            placeholder="Attendees (comma-separated)"
            value={form.attendees.join(', ')}
            onChange={(e) => setForm((f) => ({
              ...f,
              attendees: e.target.value.split(',').map((a) => a.trim()).filter((a) => a),
            }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <textarea
            placeholder="Meeting notes"
            value={form.notes ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            rows={3}
          />

          <div className="pt-2">
            <p className="text-xs font-bold text-gray-700 mb-2">Action Items</p>
            <div className="space-y-2">
              {form.actionItems.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    placeholder="Action item"
                    value={item.text}
                    onChange={(e) => updateActionItem(idx, { text: e.target.value })}
                    className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <input
                    placeholder="Owner"
                    value={item.owner ?? ''}
                    onChange={(e) => updateActionItem(idx, { owner: e.target.value })}
                    className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <button
                    onClick={() => removeActionItem(idx)}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addActionItem}
              className="mt-2 text-xs text-brand-600 hover:text-brand-700 font-semibold flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Add Action Item
            </button>
          </div>

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
            <div className="flex-1">
              <h4 className="text-sm font-bold text-gray-900">{form.title}</h4>
              <p className="text-xs text-gray-500 mt-0.5">{fmt(form.meetingDate)}</p>
            </div>
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

          {form.attendees.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {form.attendees.map((attendee, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 text-xs font-semibold"
                >
                  {attendee}
                </span>
              ))}
            </div>
          )}

          {form.notes && (
            <p className="text-xs text-gray-600 mb-3 italic">{form.notes}</p>
          )}

          {form.actionItems.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-700 mb-2">Action Items</p>
              <div className="space-y-1.5">
                {form.actionItems.map((item, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleActionItem(idx)}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-400"
                    />
                    <span className={`text-xs ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {item.text}
                    </span>
                    {item.owner && (
                      <span className="text-xs text-gray-500">({item.owner})</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Step ────────────────────────────────────────────────────────────────

export function MeetingNotesStep({ engagementId }: { engagementId: string }) {
  const { data: meetings = [], refetch } = useQuery({
    queryKey: ['meetings', engagementId],
    queryFn: () => engagementsApi.listMeetings(engagementId),
  });

  const sorted = [...(meetings as Meeting[])].sort((a, b) => {
    const aDate = new Date(a.meetingDate).getTime();
    const bDate = new Date(b.meetingDate).getTime();
    return bDate - aDate;
  });

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* ── Page title ──────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-black text-gray-900">Meeting Notes</h2>
        <p className="text-sm text-gray-500 mt-1">Log meetings, track attendees, and document action items with owners and status.</p>
      </div>

      {/* ── Add Meeting Form ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <SectionHeading icon={Plus} title="New Meeting" subtitle="Record a project meeting." />
        <AddMeetingForm engagementId={engagementId} onAdded={() => refetch()} />
      </div>

      {/* ── Meetings List ───────────────────────────────────────────────────── */}
      {meetings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No meetings logged yet. Create your first meeting to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((meeting) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              engagementId={engagementId}
              onRefresh={() => refetch()}
            />
          ))}
        </div>
      )}

    </div>
  );
}
