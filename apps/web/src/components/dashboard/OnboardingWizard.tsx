import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, Check, Layers, Users, Wand2, Plus, X, ArrowRight, BookOpen,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  computeStepCompletion,
  dismissOnboarding,
  type StepCompletion,
} from '@/lib/onboardingHelpers';

/**
 * Phase 41.5 — first-engagement onboarding wizard.
 *
 * Sits on the dashboard above the engagement list when the firm has
 * zero engagements. Walks the firm admin through the four moves they
 * need to land their first client:
 *   1. Pick your ERP   (NetSuite / Odoo / "Bring your own")
 *   2. Add your first client + dates
 *   3. Invite your client to the portal
 *   4. Walk through Discovery questions (open the wizard)
 *
 * Steps gated on the previous step — step 3 and 4 require an
 * engagement to have been created. The wizard is dismissable via
 * "Skip for now" (per-user localStorage flag — same shape as the
 * Phase 40.1 email-verification banner) and auto-hides as soon as
 * the firm has at least one engagement, so it disappears the moment
 * the consultant starts doing real work.
 *
 * State arithmetic lives in lib/onboardingHelpers.ts so it's
 * unit-tested without React; this component is layout + handlers
 * only.
 */

interface OnboardingWizardProps {
  engagementCount: number;
  hasInvitedClient: boolean;
  hasOpenedWizard: boolean;
  adaptorPreferenceSet: boolean;
  onCreateEngagement: () => void;
  onDismiss: () => void;
}

export function OnboardingWizard({
  engagementCount,
  hasInvitedClient,
  hasOpenedWizard,
  adaptorPreferenceSet,
  onCreateEngagement,
  onDismiss,
}: OnboardingWizardProps) {
  const completion = computeStepCompletion({
    adaptorPreferenceSet,
    engagementCount,
    hasInvitedClient,
    hasOpenedWizard,
  });
  const { user } = useAuth();
  const [dismissing, setDismissing] = useState(false);

  function handleDismiss() {
    setDismissing(true);
    if (user) {
      const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
      dismissOnboarding(user.id, storage);
    }
    onDismiss();
  }

  return (
    <div
      className="bg-gradient-to-br from-violet-50 via-white to-brand-50 border border-violet-100 rounded-2xl p-6 mb-6 shadow-sm"
      data-testid="onboarding-wizard"
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-brand-500 flex items-center justify-center flex-shrink-0 shadow">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">
              Welcome to ERPLaunch
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {completion.completedCount === 0
                ? "Let's get your first client engagement off the ground in four steps."
                : `${completion.completedCount} of 4 done — keep going.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/60 flex-shrink-0"
          data-testid="onboarding-skip"
        >
          <X className="h-3 w-3" />
          Skip for now
        </button>
      </div>

      <div className="space-y-2">
        <Step
          n={1}
          completed={completion.step1}
          enabled
          icon={Layers}
          title="Pick your ERP"
          description="NetSuite, Odoo, or bring your own — adaptors define what your wizard asks."
          ctaLabel="Browse adaptors"
          ctaTo="/custom-adaptors"
        />
        <Step
          n={2}
          completed={completion.step2}
          enabled
          icon={Plus}
          title="Add your first client engagement"
          description="Client name, contract dates, and the ERP you'll be implementing."
          ctaLabel="Create engagement"
          onCtaClick={onCreateEngagement}
        />
        <Step
          n={3}
          completed={completion.step3}
          enabled={completion.step2}
          icon={Users}
          title="Invite your client to the portal"
          description="They submit answers, files, and questions; you accept what's ready in Pending Review."
          ctaLabel={completion.step2 ? 'Open engagement' : 'Create an engagement first'}
          ctaTo={completion.step2 ? '/dashboard' : undefined}
        />
        <Step
          n={4}
          completed={completion.step4}
          enabled={completion.step2}
          icon={Wand2}
          title="Walk through Discovery questions"
          description="Capture the client's processes, decisions, and risks — the wizard generates the BRD from your answers."
          ctaLabel={completion.step2 ? 'Open wizard' : 'Create an engagement first'}
          ctaTo={completion.step2 ? '/dashboard' : undefined}
        />
      </div>

      {completion.completedCount === 4 && (
        <div className="mt-5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-emerald-900">
            Onboarding complete. The wizard will hide as soon as you reload.
          </p>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-violet-100 flex items-center justify-between gap-2">
        <Link
          to="https://docs.erplaunch.com/getting-started"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
        >
          <BookOpen className="h-3 w-3" />
          Read the getting-started guide
        </Link>
        <p className="text-[11px] text-slate-400">
          {completion.completedCount}/4 complete
        </p>
      </div>
    </div>
  );
}

// ─── Sub-component: Step ─────────────────────────────────────────────────────

function Step({
  n,
  completed,
  enabled,
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaTo,
  onCtaClick,
}: {
  n: number;
  completed: boolean;
  enabled: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTo?: string;
  onCtaClick?: () => void;
}) {
  const isInteractive = enabled && (!!ctaTo || !!onCtaClick);

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3.5 rounded-xl border transition-colors',
        completed
          ? 'bg-emerald-50/40 border-emerald-200'
          : enabled
          ? 'bg-white border-slate-200 hover:border-violet-200'
          : 'bg-slate-50 border-slate-100 opacity-70'
      )}
      data-testid={`onboarding-step-${n}`}
    >
      {/* Step indicator */}
      <div
        className={cn(
          'h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0',
          completed
            ? 'bg-emerald-500 text-white'
            : enabled
            ? 'bg-violet-100 text-violet-700'
            : 'bg-slate-200 text-slate-400'
        )}
      >
        {completed ? (
          <Check className="h-4 w-4" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-[10px] font-bold uppercase tracking-wider',
              completed ? 'text-emerald-700' : enabled ? 'text-violet-700' : 'text-slate-400'
            )}
          >
            Step {n}
          </span>
          {completed && (
            <span className="text-[10px] font-semibold text-emerald-600">Done</span>
          )}
        </div>
        <p className="text-sm font-bold text-slate-900 mt-0.5">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>

      {isInteractive && !completed && (
        <div className="flex-shrink-0">
          {ctaTo ? (
            <Link
              to={ctaTo}
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 px-2 py-1 rounded-md hover:bg-violet-50"
              data-testid={`onboarding-step-${n}-cta`}
            >
              {ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={onCtaClick}
              className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900 px-2 py-1 rounded-md hover:bg-violet-50"
              data-testid={`onboarding-step-${n}-cta`}
            >
              {ctaLabel}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export for the dashboard's quick access; the helper module
// itself owns the canonical export.
export type { StepCompletion };
