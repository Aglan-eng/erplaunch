import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert, ArrowRight, CircleCheck, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useParams, useLocation } from 'react-router-dom';
import { engagementsApi } from '@/lib/api';
import { WizardSidebar } from './WizardSidebar';
import { WizardTopBar } from './WizardTopBar';
import { LicenseProfileStep } from './steps/LicenseProfileStep';
import { ProjectSetupStep } from './steps/ProjectSetupStep';
import { FlowSectionStep } from './steps/FlowSectionStep';
import { GeneratePanel } from './steps/GeneratePanel';
import { SummaryView } from './steps/SummaryView';
import { RiskRegisterStep } from './steps/RiskRegisterStep';
import { IssueTrackerStep } from './steps/IssueTrackerStep';
import { DecisionLogStep } from './steps/DecisionLogStep';
import { MeetingNotesStep } from './steps/MeetingNotesStep';
import { MigrationTrackerStep } from './steps/MigrationTrackerStep';
import { CustomFieldsStep } from './steps/CustomFieldsStep';
import { StandardRolesStep } from './steps/StandardRolesStep';
import { DataCollectionPage } from '@/pages/DataCollectionPage';
import { AIProfileGenerator } from './AIProfileGenerator';
import { HelpDrawer } from './HelpDrawer';
import { ExampleDrawer } from './ExampleDrawer';
import { ConflictBanner } from './ConflictBanner';
import { useWizardStore } from '@/stores/wizardStore';
import { useConflictStore } from '@/stores/conflictStore';
import { useWizardProgress } from '@/hooks/useWizardProgress';

// ─── Smart Banners ───────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  DISCOVERY: 'Discovery', SCOPING: 'Scoping', BUILD: 'Build', UAT: 'UAT', GO_LIVE: 'Go-Live',
};

function StageSuggestionBanner({ nextStage, overall, onAdvance, isAdvancing, onDismiss }: {
  nextStage: string; overall: number; onAdvance: () => void; isAdvancing: boolean; onDismiss: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto mb-4">
      <div className="rounded-xl bg-gradient-to-r from-violet-50 to-brand-50 border border-violet-200 px-5 py-3.5 flex items-center gap-4">
        <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Zap className="h-4 w-4 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-violet-900">Ready to advance!</p>
          <p className="text-xs text-violet-600 mt-0.5">
            Questionnaire is {overall}% complete — consider moving to <span className="font-semibold">{STAGE_LABELS[nextStage]}</span> stage.
          </p>
        </div>
        <button
          onClick={onAdvance}
          disabled={isAdvancing}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold px-3 py-2 hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          <ArrowRight className="h-3.5 w-3.5" />Advance to {STAGE_LABELS[nextStage]}
        </button>
        <button onClick={onDismiss} className="text-violet-400 hover:text-violet-600 flex-shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function DeadlineReminderBanner({ daysLeft, contractEndDate, onDismiss }: {
  daysLeft: number; contractEndDate: string; onDismiss: () => void;
}) {
  const isOverdue = daysLeft < 0;
  return (
    <div className="max-w-2xl mx-auto mb-4">
      <div className={cn(
        'rounded-xl border px-5 py-3.5 flex items-center gap-4',
        isOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
      )}>
        <TriangleAlert className={cn('h-5 w-5 flex-shrink-0', isOverdue ? 'text-red-500' : 'text-amber-500')} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-bold', isOverdue ? 'text-red-900' : 'text-amber-900')}>
            {isOverdue ? `Contract overdue by ${Math.abs(daysLeft)} days` : `Contract ends in ${daysLeft} days`}
          </p>
          <p className={cn('text-xs mt-0.5', isOverdue ? 'text-red-600' : 'text-amber-600')}>
            Contract end date: {new Date(contractEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button onClick={onDismiss} className={cn('flex-shrink-0', isOverdue ? 'text-red-400 hover:text-red-600' : 'text-amber-400 hover:text-amber-600')}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Activity Feed View ──────────────────────────────────────────────────────

function ActivityFeedView({ engagementId }: { engagementId: string }) {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activity', engagementId],
    queryFn: () => engagementsApi.listActivity(engagementId),
    enabled: !!engagementId,
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-8 text-center">
        <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
        <p className="mt-3 text-sm text-gray-500">Loading activity…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-black text-gray-900">Activity Feed</h2>
        <p className="text-sm text-gray-500 mt-1">View all recent activity and changes in this engagement.</p>
      </div>

      {activities.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 shadow-sm text-center">
          <p className="text-sm text-gray-500">No activity recorded yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(activities as Array<any>).map((activity: any, idx: number) => (
            <div key={idx} className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-brand-500 mt-2 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{activity.description || 'Activity'}</p>
                  {activity.timestamp && (
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(activity.timestamp).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// All valid flow.section keys
const ALL_SECTION_KEYS = new Set([
  'overview', 'project', 'ai-profile',
  'risks', 'issues', 'decisions', 'meetings', 'migration', 'activity',
  'r2r.entities', 'r2r.segmentation', 'r2r.accountingPeriods', 'r2r.currencies',
  'r2r.bankTransactions', 'r2r.tax', 'r2r.journalEntries', 'r2r.fiscalClose', 'r2r.reporting',
  'p2p.vendors', 'p2p.purchasing', 'p2p.receiving', 'p2p.bills', 'p2p.payments', 'p2p.expenses',
  'o2c.customers', 'o2c.pricing', 'o2c.salesOrders', 'o2c.fulfillment', 'o2c.invoicing', 'o2c.collections',
  'mfg.productionFlow', 'mfg.bom', 'mfg.outsourced', 'mfg.demand',
  'mfg.workOrders', 'mfg.inventory', 'mfg.costing', 'mfg.quality',
  'rtn.customerReturns', 'rtn.vendorReturns', 'rtn.processing',
]);

// Map URL path suffixes to wizard section keys
const PATH_SECTION_MAP: Record<string, string> = {
  'data-collection': 'data-collection',
  'wizard': 'project',
};

export function WizardShell() {
  const { id: engagementId } = useParams<{ id: string }>();
  const location = useLocation();
  const { currentSection, setAnswers } = useWizardStore();
  const setCurrentSection = useWizardStore((s) => s.setCurrentSection);
  const setConflicts = useConflictStore((s) => s.setConflicts);

  // Sync URL path to wizard section on mount / navigation
  useEffect(() => {
    const pathSegment = location.pathname.split('/').pop() ?? '';
    const mappedSection = PATH_SECTION_MAP[pathSegment];
    if (mappedSection && mappedSection !== currentSection) {
      setCurrentSection(mappedSection);
    }
  // Only run when the URL path changes (not on every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // If navigation carried a section hint (e.g. from the Stage Gate Modal), jump to it
  useEffect(() => {
    const stateSection = (location.state as { section?: string } | null)?.section;
    if (!stateSection) return;
    const [flowPrefix, sectionId] = stateSection.split('.');
    const isAdaptorFlowSection =
      !!sectionId && ['r2r', 'p2p', 'o2c', 'mfg', 'rtn'].includes(flowPrefix);
    if (ALL_SECTION_KEYS.has(stateSection) || isAdaptorFlowSection) {
      setCurrentSection(stateSection);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const answers = useWizardStore((s) => s.answers);

  // Load engagement
  const { data: engagement, isLoading } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => engagementsApi.get(engagementId!),
    enabled: !!engagementId,
  });

  // Load profile
  const { data: profile } = useQuery({
    queryKey: ['profile', engagementId],
    queryFn: () => engagementsApi.getProfile(engagementId!),
    enabled: !!engagementId,
  });

  // Load license
  const { data: license } = useQuery({
    queryKey: ['license', engagementId],
    queryFn: () => engagementsApi.getLicense(engagementId!),
    enabled: !!engagementId,
  });

  // Load conflicts — staleTime:0 so any invalidation or refetch always hits the server
  const { data: conflictsData } = useQuery({
    queryKey: ['conflicts', engagementId],
    queryFn: async () => {
      const eng = await engagementsApi.get(engagementId!);
      return eng?.conflicts ?? [];
    },
    enabled: !!engagementId,
    staleTime: 0,
  });

  // Sync answers into store when profile loads
  useEffect(() => {
    if (profile?.answers) {
      setAnswers(profile.answers as Record<string, unknown>);
    }
  }, [profile, setAnswers]);

  // Sync conflicts into store — Array.isArray guard handles the initial undefined
  // state and correctly syncs an empty array (resolved all conflicts).
  useEffect(() => {
    if (import.meta.env.DEV) console.debug('[WizardShell] conflictsData changed:', conflictsData);
    if (Array.isArray(conflictsData)) setConflicts(conflictsData);
  }, [conflictsData, setConflicts]);

  const { sectionProgress, overall } = useWizardProgress(answers);
  const licenseComplete = !!(license?.edition);
  // Project setup is "complete" when at minimum a start date is set and at least one member added
  const projectSetupComplete = !!(engagement?.startDate && engagement?.contractEndDate);

  // Smart banner dismiss state
  const [stageBannerDismissed, setStageBannerDismissed] = useState(false);
  const [deadlineBannerDismissed, setDeadlineBannerDismissed] = useState(false);

  // Status workflow
  const STAGE_ORDER = ['DISCOVERY', 'SCOPING', 'BUILD', 'UAT', 'GO_LIVE'];
  const queryClient = useQueryClient();
  const advanceStageMutation = useMutation({
    mutationFn: (nextStatus: string) =>
      engagementsApi.patch(engagementId!, { status: nextStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  const currentStageIndex = STAGE_ORDER.indexOf(engagement?.status ?? 'DISCOVERY');
  const nextStage = currentStageIndex < STAGE_ORDER.length - 1 ? STAGE_ORDER[currentStageIndex + 1] : null;

  const handleAdvanceStage = () => {
    if (nextStage) advanceStageMutation.mutate(nextStage);
  };

  // Smart banner conditions
  const showStageSuggestion = !stageBannerDismissed && overall >= 80 && !!nextStage && engagement?.status !== 'GO_LIVE';
  const daysLeft = engagement?.contractEndDate
    ? Math.ceil((new Date(engagement.contractEndDate).getTime() - Date.now()) / 86_400_000)
    : null;
  const showDeadlineReminder = !deadlineBannerDismissed && daysLeft !== null && daysLeft <= 14 && engagement?.status !== 'GO_LIVE';

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-brand-600 border-t-transparent rounded-full mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Loading engagement…</p>
        </div>
      </div>
    );
  }

  if (!engagement || !engagementId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Engagement not found.</p>
      </div>
    );
  }

  const renderContent = () => {
    if (currentSection === 'project') {
      return <ProjectSetupStep engagementId={engagementId} />;
    }

    if (currentSection === 'license') {
      return (
        <LicenseProfileStep
          engagementId={engagementId}
          currentLicense={license ?? null}
        />
      );
    }

    if (currentSection === 'risks') {
      return <RiskRegisterStep engagementId={engagementId} />;
    }

    if (currentSection === 'issues') {
      return <IssueTrackerStep engagementId={engagementId} />;
    }

    if (currentSection === 'decisions') {
      return <DecisionLogStep engagementId={engagementId} />;
    }

    if (currentSection === 'meetings') {
      return <MeetingNotesStep engagementId={engagementId} />;
    }

    if (currentSection === 'migration') {
      return <MigrationTrackerStep engagementId={engagementId} />;
    }

    // Phase 23 — Customizations group. Custom Fields + Phase 25 Roles;
    // future Phase 26 will add Templates here under the same
    // `customizations.*` namespace.
    if (currentSection === 'customizations.customFields') {
      return <CustomFieldsStep engagementId={engagementId} />;
    }

    if (currentSection === 'customizations.roles') {
      return <StandardRolesStep engagementId={engagementId} />;
    }

    if (currentSection === 'activity') {
      return (
        <ActivityFeedView engagementId={engagementId} />
      );
    }

    if (currentSection === 'data-collection') {
      return <DataCollectionPage />;
    }

    if (currentSection === 'ai-profile') {
      return (
        <AIProfileGenerator
          engagementId={engagementId}
          clientName={engagement.clientName}
          onClose={() => setCurrentSection('project')}
        />
      );
    }

    if (currentSection === 'generate') {
      return <GeneratePanel engagementId={engagementId} />;
    }

    if (currentSection === 'overview') {
      return <SummaryView />;
    }

    // Any recognised flow.section key → generic FlowSectionStep. Either the
    // NetSuite legacy whitelist, or any "<flow>.<section>" pair where flow is
    // one of the wizard's known prefixes (r2r/p2p/o2c/mfg/rtn) — the latter
    // lets adaptor-authored sections (odoo.company, myerp.sales, etc.) render
    // without us having to maintain a static enumeration per adaptor.
    const [flowPrefix, sectionId] = currentSection.split('.');
    const isAdaptorFlowSection =
      !!sectionId && ['r2r', 'p2p', 'o2c', 'mfg', 'rtn'].includes(flowPrefix);
    if (ALL_SECTION_KEYS.has(currentSection) || isAdaptorFlowSection) {
      return (
        <FlowSectionStep sectionKey={currentSection} engagementId={engagementId} />
      );
    }

    return (
      <div className="text-center text-sm text-gray-400 mt-16">
        Section "{currentSection}" is not yet available.
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <WizardTopBar
        clientName={engagement.clientName}
        overallProgress={overall}
        status={engagement.status}
        nextStage={nextStage}
        onAdvanceStage={handleAdvanceStage}
        isAdvancing={advanceStageMutation.isPending}
      />

      <div className="flex flex-1 overflow-hidden">
        <WizardSidebar
          engagementId={engagementId!}
          sectionProgress={sectionProgress}
          licenseComplete={licenseComplete}
          projectSetupComplete={projectSetupComplete}
        />

        <main className="flex-1 overflow-y-auto scrollbar-thin px-8 py-8">
          {currentSection !== 'generate' && currentSection !== 'ai-profile' && (
            <>
              {showStageSuggestion && (
                <StageSuggestionBanner
                  nextStage={nextStage!}
                  overall={overall}
                  onAdvance={handleAdvanceStage}
                  isAdvancing={advanceStageMutation.isPending}
                  onDismiss={() => setStageBannerDismissed(true)}
                />
              )}
              {showDeadlineReminder && (
                <DeadlineReminderBanner
                  daysLeft={daysLeft!}
                  contractEndDate={engagement.contractEndDate!}
                  onDismiss={() => setDeadlineBannerDismissed(true)}
                />
              )}
              <div className="max-w-2xl mx-auto mb-6">
                <ConflictBanner />
              </div>
            </>
          )}
          {renderContent()}
        </main>
      </div>

      <HelpDrawer />
      <ExampleDrawer />
    </div>
  );
}
