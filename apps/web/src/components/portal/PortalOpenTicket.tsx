import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LifeBuoy, CircleCheck, AlertTriangle } from 'lucide-react';
import { portalApi } from '@/lib/api';

/**
 * Phase 48.1 — Portal "Open ticket" form.
 *
 * Renders only when the client member is authenticated. Posts a
 * SUPPORT_TICKET PendingSubmission via the existing /portal/submissions
 * route; the SLA team accepts in their queue and the submission becomes
 * a real Ticket row with the SLA breach clock starting at accept time.
 *
 * Severity is exposed as friendly P1-P4 labels. The acceptor + payload
 * schema validate against the canonical CRITICAL/HIGH/MEDIUM/LOW enum.
 *
 * Why a card-then-form rather than always-open: most client visits to
 * the portal don't need a new ticket. Hiding the form behind a "Need
 * help? Open a ticket" CTA keeps the page tidy. The success state
 * resets back to the CTA so a customer can file two tickets in a row.
 */
const SEVERITY_OPTIONS = [
  { value: 'CRITICAL' as const, label: 'P1 — Critical', help: 'System down, urgent business impact' },
  { value: 'HIGH' as const, label: 'P2 — High', help: 'Major feature broken, no workaround' },
  { value: 'MEDIUM' as const, label: 'P3 — Medium', help: 'Workaround exists, non-blocking' },
  { value: 'LOW' as const, label: 'P4 — Low', help: 'Minor issue, cosmetic, or question' },
];

export function PortalOpenTicket({ authenticated }: { authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [description, setDescription] = useState('');
  const [submittedTitle, setSubmittedTitle] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      portalApi.submitSupportTicket({
        title: title.trim(),
        severity,
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      setSubmittedTitle(title.trim());
      setTitle('');
      setDescription('');
      setSeverity('MEDIUM');
      setOpen(false);
    },
  });

  if (!authenticated) return null;

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5"
      data-testid="portal-open-ticket"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <LifeBuoy className="h-4 w-4 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900">Need help?</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Open a support ticket and our team will respond within the SLA window.
          </p>

          {submittedTitle && !open && (
            <div
              className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 flex items-center gap-2"
              data-testid="portal-open-ticket-success"
            >
              <CircleCheck className="h-4 w-4 text-emerald-700 flex-shrink-0" />
              <p className="text-sm text-emerald-900">
                Ticket submitted: <span className="font-semibold">{submittedTitle}</span>. Our
                support team will review it shortly.
              </p>
            </div>
          )}

          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
              data-testid="portal-open-ticket-cta"
            >
              <LifeBuoy className="h-4 w-4" />
              Open a ticket
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim().length === 0) return;
                submit.mutate();
              }}
              className="mt-4 space-y-3"
              data-testid="portal-open-ticket-form"
            >
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                  placeholder="Brief description of the issue"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Severity *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SEVERITY_OPTIONS.map((o) => (
                    <label
                      key={o.value}
                      className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                        severity === o.value
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="severity"
                        value={o.value}
                        checked={severity === o.value}
                        onChange={() => setSeverity(o.value)}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{o.label}</p>
                        <p className="text-xs text-slate-500">{o.help}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={5000}
                  placeholder="What happened? When did it start? Any error messages?"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {submit.isError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-700">
                    Couldn't submit the ticket. Please try again or contact support directly.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={title.trim().length === 0 || submit.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {submit.isPending ? 'Submitting…' : 'Submit ticket'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-2 py-2"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
