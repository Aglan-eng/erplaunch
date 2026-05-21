/**
 * Phase 53.1 — "How ERPLaunch works" guide.
 *
 * A single plain-English page that explains every concept a new
 * user needs to understand. Linked from the AppNav "?" icon, from
 * the OnboardingTour final step, and from a Settings sidebar entry.
 */
import React from 'react';
import { AppShell } from '../components/SideNav';
import { replayTour } from '../components/guidance/OnboardingTour';

interface Section {
  id: string;
  title: string;
  body: React.ReactNode;
}

const STAGES: Array<{ name: string; phase: string; meaning: string }> = [
  { name: 'Lead', phase: 'Sales', meaning: 'A new prospect just came in — Sales decides whether to qualify.' },
  { name: 'Qualified', phase: 'Sales', meaning: 'Worth pursuing — there is a real budget, need, and timeline.' },
  { name: 'Proposal', phase: 'Sales', meaning: 'A document has been sent. Waiting on a response.' },
  { name: 'Negotiation', phase: 'Sales', meaning: 'Pricing or scope is being worked out before they say yes.' },
  { name: 'Won', phase: 'Sales → Delivery', meaning: 'Deal closed. Hands off to a Project Lead for delivery.' },
  { name: 'Discovery', phase: 'Delivery', meaning: 'Understanding the customer\'s real-world processes.' },
  { name: 'Scoping', phase: 'Delivery', meaning: 'Agreeing exactly what will be built and what is out of scope.' },
  { name: 'Build', phase: 'Delivery', meaning: 'Configuration, integrations, customisation. The biggest stage.' },
  { name: 'UAT', phase: 'Delivery', meaning: 'User Acceptance Testing — the customer tries it for real.' },
  { name: 'Go-live', phase: 'Delivery', meaning: 'Cutover week. The customer starts using the new system.' },
  { name: 'Hypercare', phase: 'Delivery → Support', meaning: '30 days of close-watch support before steady state.' },
  { name: 'Live SLA', phase: 'Support', meaning: 'Steady-state support. CSM owns the relationship.' },
  { name: 'Renewal Due', phase: 'Support', meaning: 'Renewal window has opened. CSM needs to close it.' },
  { name: 'Renewed', phase: 'Support', meaning: 'They re-upped. Back to Live SLA until the next window.' },
];

const SECTIONS: Section[] = [
  {
    id: 'lifecycle',
    title: 'The 14-stage customer lifecycle',
    body: (
      <>
        <p>
          Every customer flows through the same 14 stages, from the first time
          you hear their name to the day they sign for a second year. Stages run
          left-to-right and you can also roll back when something changes.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left py-1.5 font-semibold">Stage</th>
                <th className="text-left py-1.5 font-semibold">Owned by</th>
                <th className="text-left py-1.5 font-semibold">What it means</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {STAGES.map((s) => (
                <tr key={s.name}>
                  <td className="py-1.5 font-semibold text-gray-900">{s.name}</td>
                  <td className="py-1.5 text-gray-500">{s.phase}</td>
                  <td className="py-1.5 text-gray-700">{s.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-gray-500 text-xs">
          A few customers never make it through — Lost (sales fell through) and
          Churned (a live customer left) are the two terminal stages.
        </p>
      </>
    ),
  },
  {
    id: 'owners',
    title: 'The four owner roles',
    body: (
      <>
        <p>
          Each customer has four owner slots. As the customer moves through the
          lifecycle, the active owner changes — and the badge in the customer
          detail header highlights whichever one is currently in charge.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-gray-700">
          <li><strong>Sales</strong> — leads, qualifies, sends proposal, closes. Owns Lead through Won.</li>
          <li><strong>Project Lead</strong> — owns delivery. Discovery, Scoping, Build, UAT, Go-live.</li>
          <li><strong>CSM (Customer Success Manager)</strong> — takes over post-go-live. Hypercare, Live SLA, Renewals.</li>
          <li><strong>AR (Accounts Receivable)</strong> — invoicing + collections through the whole lifecycle.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'health',
    title: 'What the health score means',
    body: (
      <>
        <p>
          A 0–100 score that tells you at a glance whether a customer is in good
          shape. It combines four signals:
        </p>
        <ul className="mt-3 space-y-1 text-sm text-gray-700 list-disc list-inside">
          <li><strong>Questionnaire completion</strong> — how much of Discovery has been filled in (30 points)</li>
          <li><strong>Open blockers</strong> — fewer is better (25 points)</li>
          <li><strong>Time stuck in stage</strong> — past the target is bad (25 points)</li>
          <li><strong>Pending decisions older than 14 days</strong> — fewer is better (20 points)</li>
        </ul>
        <p className="mt-3 text-sm text-gray-700">
          <strong>Red</strong> = under 30 (act now). <strong>Yellow</strong> = 30–69 (watch).
          <strong> Green</strong> = 70 or above (healthy).
        </p>
      </>
    ),
  },
  {
    id: 'inbox',
    title: 'Your Inbox — three buckets',
    body: (
      <>
        <ul className="space-y-2 text-sm text-gray-700">
          <li><strong>For You</strong> — every alert tied to a customer you currently own at this stage. This is your action list.</li>
          <li><strong>Watching</strong> — customers where you have another role (e.g. Sales sees a Build-stage customer they used to own). You can keep an eye but it is not your job.</li>
          <li><strong>Firm-wide</strong> — admins only. Every alert anywhere in the firm.</li>
        </ul>
        <p className="mt-3 text-sm text-gray-700">
          Six things can trigger an alert: stage overdue, open blocker, pending
          decision, incomplete questionnaire, an incoming handoff, and a
          renewal within 90 days.
        </p>
      </>
    ),
  },
  {
    id: 'documents',
    title: 'Documents and PDFs',
    body: (
      <>
        <p>
          The Documents tab on every customer generates branded PDFs from your
          firm's Brand Pack — Proposal and SOW today, more types coming. The
          renderer uses your fonts, colours and logo so every document looks
          like it came from you, not a generic template.
        </p>
      </>
    ),
  },
  {
    id: 'reports',
    title: 'The five Reports dashboards',
    body: (
      <ul className="space-y-2 text-sm text-gray-700">
        <li><strong>Pipeline</strong> — are we filling the funnel? Stage-by-stage counts and conversion.</li>
        <li><strong>Delivery</strong> — who is slipping vs on-track, what's blocking them, when go-lives are forecasted.</li>
        <li><strong>Customer Health</strong> — distribution across red/yellow/green, churn-risk list.</li>
        <li><strong>Renewals</strong> — next 90 days, ARR at risk, who needs a renewal quote.</li>
        <li><strong>Utilization</strong> — per-owner active customer count + role split. Catches overloaded people early.</li>
      </ul>
    ),
  },
];

export function HelpPage() {
  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="help-page">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">How ERPLaunch works</h1>
          <p className="text-sm text-gray-500 mt-1">
            A plain-English tour of the concepts behind the app. If you ever
            feel unsure what something means, come back here.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={replayTour}
              data-testid="help-replay-tour"
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Replay the welcome tour
            </button>
          </div>
        </header>

        <nav
          aria-label="Sections"
          data-testid="help-toc"
          className="mb-6 flex flex-wrap gap-2 text-xs"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-testid={`help-toc-${s.id}`}
              className="rounded-full bg-white border border-gray-200 px-3 py-1 text-gray-600 hover:text-gray-900 hover:border-gray-300"
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={s.id}
              data-testid={`help-section-${s.id}`}
              className="bg-white border border-gray-200 rounded-xl p-6"
            >
              <h2 className="text-lg font-bold text-gray-900 mb-2">{s.title}</h2>
              <div className="text-sm text-gray-700 leading-relaxed">{s.body}</div>
            </section>
          ))}
        </div>
      </main>
    </AppShell>
  );
}
