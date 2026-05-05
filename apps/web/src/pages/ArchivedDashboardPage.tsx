import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Archive, Loader, RotateCcw, CircleCheck } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { selectArchived, previousStatusLabel, type ArchivedEngagement } from './archivedEngagements';

/**
 * Phase 38.4 — read-only list of archived engagements with one-click restore.
 *
 * The page hits GET /engagements?includeArchived=true (the only place that
 * passes the flag), filters client-side to ARCHIVED rows, and shows a
 * compact table with a Restore button per row. Restore calls
 * POST /engagements/:id/unarchive and on success invalidates the
 * `engagements` query so the main dashboard picks up the row again on next
 * navigation.
 */
export function ArchivedDashboardPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [toastFor, setToastFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ArchivedEngagement[]>({
    queryKey: ['engagements', 'archived'],
    queryFn: () => engagementsApi.list({ includeArchived: true }) as Promise<ArchivedEngagement[]>,
  });
  const archived = useMemo(() => selectArchived(data ?? []), [data]);

  const restoreMutation = useMutation({
    mutationFn: (id: string) => engagementsApi.unarchive(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['engagements'] });
      qc.invalidateQueries({ queryKey: ['engagements', 'archived'] });
      const restored = archived.find((e) => e.id === id);
      setToastFor(restored ? restored.clientName : 'Engagement');
      setTimeout(() => setToastFor(null), 3000);
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all active:scale-95"
              title="Back to dashboard"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-gray-400" />
              <h1 className="text-base font-black text-slate-900 tracking-tight">Archived Engagements</h1>
            </div>
          </div>
          <Link to="/dashboard" className="text-sm text-gray-500 hover:text-gray-900">
            ← Back to dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-7">
        {isLoading ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Loader className="h-5 w-5 text-gray-400 animate-spin mx-auto" />
            <p className="text-sm text-gray-400 mt-3">Loading archived engagements…</p>
          </div>
        ) : archived.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
            <Archive className="h-8 w-8 text-gray-300 mx-auto" />
            <p className="text-sm font-semibold text-gray-700 mt-3">No archived engagements</p>
            <p className="text-xs text-gray-500 mt-1">
              Archived engagements show up here. Use the kebab menu on an engagement page to archive it.
            </p>
            <Link
              to="/dashboard"
              className="inline-block mt-4 text-xs font-semibold text-brand-600 hover:text-brand-800"
            >
              ← Back to dashboard
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50/60 border-b border-gray-100">
                <tr>
                  <th className="text-left text-[10px] font-black text-gray-500 uppercase tracking-widest px-5 py-3">Client</th>
                  <th className="text-left text-[10px] font-black text-gray-500 uppercase tracking-widest px-5 py-3">Archived</th>
                  <th className="text-left text-[10px] font-black text-gray-500 uppercase tracking-widest px-5 py-3">Previously</th>
                  <th className="text-right text-[10px] font-black text-gray-500 uppercase tracking-widest px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {archived.map((eng) => (
                  <tr key={eng.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900">{eng.clientName}</td>
                    <td className="px-5 py-3 text-xs text-gray-500">
                      {new Date(eng.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-500">{previousStatusLabel(eng.previousStatus)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => restoreMutation.mutate(eng.id)}
                        disabled={restoreMutation.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
                      >
                        {restoreMutation.isPending && restoreMutation.variables === eng.id
                          ? <Loader className="h-3.5 w-3.5 animate-spin" />
                          : <RotateCcw className="h-3.5 w-3.5" />}
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {toastFor && (
          <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 text-sm font-semibold">
            <CircleCheck className="h-4 w-4" />
            Restored {toastFor}
          </div>
        )}
      </main>
    </div>
  );
}
