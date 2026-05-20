/**
 * Phase 53.1 — OnboardingTour.
 *
 * Five-step welcome overlay shown on first login. The tour state
 * lives in localStorage (`erplaunch.hasSeenTour=1`) — clearing it
 * via Settings → Help → "Replay tour" re-arms the overlay.
 *
 * The overlay is intentionally lightweight: a darkened backdrop +
 * centered tooltip card. No DOM-anchored highlight rings (those add
 * a layout-measurement dependency we don't need for v1).
 */
import React, { useEffect, useState } from 'react';
import { Inbox, Users, BarChart3, Settings as SettingsIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'erplaunch.hasSeenTour';

interface TourStep {
  title: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: ReadonlyArray<TourStep> = [
  {
    title: 'Welcome to ERPLaunch',
    body: 'ERPLaunch runs your whole customer lifecycle — from first lead to renewal — in one place. Five quick stops, then you are ready to go.',
    icon: BarChart3,
  },
  {
    title: 'Inbox — your daily home',
    body: 'What needs your attention today. Overdue stages, open blockers, decisions waiting on you, renewals coming up.',
    icon: Inbox,
  },
  {
    title: 'Customers — every deal in one list',
    body: 'Every customer with the stage they are at. Switch between list and kanban; drag a card to move them forward.',
    icon: Users,
  },
  {
    title: 'Reports — the five questions you need answered',
    body: 'Pipeline (are we filling the funnel), Delivery (who is slipping), Customer Health (who is at risk), Renewals (90-day exposure), Utilization (who is overloaded).',
    icon: BarChart3,
  },
  {
    title: 'Settings — your firm',
    body: 'Branding, document templates, ERP adaptors, tickets, email domain — all in one tabbed view.',
    icon: SettingsIcon,
  },
];

/**
 * Public helper — clears the seen-flag so the tour re-shows on next
 * mount. Wired to the "Replay tour" button on the Help tab.
 */
export function replayTour(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / disabled storage — best-effort */
  }
  // Force a soft reload so the OnboardingTour mounts fresh.
  if (typeof window !== 'undefined') window.location.assign('/inbox?welcome=1');
}

export function hasSeenTour(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* best-effort */
  }
}

interface OnboardingTourProps {
  /** When true, force-show the tour regardless of the seen-flag.
   *  Used by `?welcome=1` from the Google OAuth callback. */
  forceShow?: boolean;
}

export function OnboardingTour({ forceShow = false }: OnboardingTourProps) {
  const initialOpen = forceShow || !hasSeenTour();
  const [open, setOpen] = useState(initialOpen);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) markSeen();
  }, [open]);

  if (!open) return null;
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const close = (): void => {
    markSeen();
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ERPLaunch onboarding tour"
      data-testid="onboarding-tour"
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex items-start gap-4">
          <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              data-testid={`onboarding-tour-step-${step}-title`}
              className="text-base font-bold text-gray-900"
            >
              {current.title}
            </h2>
            <p
              data-testid={`onboarding-tour-step-${step}-body`}
              className="mt-1 text-sm text-gray-600 leading-relaxed"
            >
              {current.body}
            </p>
          </div>
        </div>

        <div className="px-6 pb-4 flex items-center gap-1.5" data-testid="onboarding-tour-dots">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-6 rounded-full transition-colors',
                i === step ? 'bg-brand-600' : 'bg-gray-200',
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        <div className="px-6 py-4 bg-gray-50 flex items-center justify-between border-t border-gray-100">
          <button
            type="button"
            onClick={close}
            data-testid="onboarding-tour-skip"
            className="text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                data-testid="onboarding-tour-back"
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
            )}
            {isLast ? (
              <Link
                to="/help"
                onClick={close}
                data-testid="onboarding-tour-finish"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Finish + read the guide
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                data-testid="onboarding-tour-next"
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { STORAGE_KEY as _onboardingTourStorageKey };
