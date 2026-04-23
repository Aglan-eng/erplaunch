import React, { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, CircleCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { engagementsApi } from '@/lib/api';
import { SectionIntroCard } from '../SectionIntroCard';
import { StepComments } from '../StepComments';
import { ImageUpload } from '../ImageUpload';
import { AIAdvisorPanel } from '../AIAdvisorPanel';
import { Button } from '@/components/ui/Button';
import { useConflictStore } from '@/stores/conflictStore';

// NetSuite-shaped fallback if the adaptor query fails / is still loading —
// preserves the pilot's original behavior for any existing engagement.
const NETSUITE_FALLBACK_EDITIONS: EditionOption[] = [
  { value: 'STARTER', label: 'Starter', description: 'Basic financials, up to 10 users' },
  { value: 'MID_MARKET', label: 'Mid-Market', description: 'Full ERP suite, multi-currency' },
  { value: 'ONEWORLD', label: 'Enterprise / OneWorld', description: 'Multi-entity, unlimited users, advanced analytics' },
];
const NETSUITE_FALLBACK_MODULES: ModuleOption[] = [
  { value: 'ONEWORLD', label: 'OneWorld', description: 'Multi-entity & multi-currency' },
  { value: 'CRM', label: 'CRM', description: 'Customer relationship management' },
  { value: 'ECOMMERCE', label: 'SuiteCommerce', description: 'E-commerce integration' },
  { value: 'WMS', label: 'WMS', description: 'Warehouse management' },
  { value: 'MANUFACTURING', label: 'Manufacturing', description: 'Production planning' },
  { value: 'WORK_ORDERS', label: 'Work Orders', description: 'Work order management & routing' },
  { value: 'WIP_ROUTINGS', label: 'WIP/Routings', description: 'Work-in-progress & routing steps' },
  { value: 'ADVANCED_INVENTORY', label: 'Advanced Inventory', description: 'Multi-location, bins & serial/lot tracking' },
  { value: 'DEMAND_PLANNING', label: 'Demand Planning', description: 'Forecast-based replenishment' },
  { value: 'ADVANCED_PROCUREMENT', label: 'Advanced Procurement', description: 'Vendor RMA, debit memos & automation' },
  { value: 'PSA', label: 'PSA', description: 'Professional services automation' },
];

interface EditionOption { value: string; label: string; description: string }
interface ModuleOption { value: string; label: string; description: string }

interface LicenseProfileStepProps {
  engagementId: string;
  currentLicense: { edition: string; modules: string[] } | null;
}

export function LicenseProfileStep({ engagementId, currentLicense }: LicenseProfileStepProps) {
  const { id: routeEngagementId } = useParams<{ id: string }>();
  const engId = engagementId || routeEngagementId || '';
  const queryClient = useQueryClient();
  const setConflicts = useConflictStore((s) => s.setConflicts);

  const adaptorQuery = useQuery({
    queryKey: ['engagement-adaptor', engId],
    queryFn: () => engagementsApi.getAdaptor(engId),
    enabled: !!engId,
    retry: false,
    staleTime: 60_000,
  });

  // Derive editions + modules from the adaptor (with NetSuite fallback so
  // existing pilot engagements keep working if the adaptor query fails).
  const { editions, modules: moduleCatalog, adaptorName, defaultEdition } = useMemo(() => {
    const license = adaptorQuery.data?.license as {
      editions?: Array<{ id: string; label: string; description?: string; includesModules?: string[] }>;
      modules?: Array<{ id: string; label: string; description?: string }>;
      defaultEditionId?: string;
    } | undefined;
    const manifest = adaptorQuery.data?.manifest as { name?: string } | undefined;

    if (license && Array.isArray(license.editions) && license.editions.length > 0) {
      const eds: EditionOption[] = license.editions.map((e) => ({
        value: e.id,
        label: e.label,
        description: e.description ?? '',
      }));
      const mods: ModuleOption[] = Array.isArray(license.modules)
        ? license.modules.map((m) => ({ value: m.id, label: m.label, description: m.description ?? '' }))
        : [];
      return {
        editions: eds,
        modules: mods,
        adaptorName: manifest?.name ?? 'Platform',
        defaultEdition: license.defaultEditionId ?? eds[0]?.value ?? '',
      };
    }
    return {
      editions: NETSUITE_FALLBACK_EDITIONS,
      modules: NETSUITE_FALLBACK_MODULES,
      adaptorName: 'NetSuite',
      defaultEdition: 'MID_MARKET',
    };
  }, [adaptorQuery.data]);

  const [edition, setEdition] = useState<string>(currentLicense?.edition ?? defaultEdition);
  const [modules, setModules] = useState<string[]>(currentLicense?.modules ?? []);

  // If the adaptor loaded after initial render and the user hasn't touched the
  // edition yet, adopt its default so the picker isn't stuck on "MID_MARKET"
  // for an Odoo engagement.
  useEffect(() => {
    if (!currentLicense?.edition && defaultEdition && !editions.some((e) => e.value === edition)) {
      setEdition(defaultEdition);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultEdition, editions]);

  const mutation = useMutation({
    mutationFn: () => engagementsApi.putLicense(engId, { edition, modules }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['license', engId] });
      queryClient.invalidateQueries({ queryKey: ['engagement', engId] });

      const normalizedConflicts = Array.isArray(data?.conflicts)
        ? data.conflicts.map((c: Record<string, unknown>) => ({
            ...c,
            ruleId: (c.ruleId ?? c.id) as string,
          }))
        : [];
      setConflicts(normalizedConflicts);
      queryClient.refetchQueries({ queryKey: ['conflicts', engId] });
    },
  });

  const toggleModule = (mod: string) => {
    setModules((prev) => (prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]));
  };

  return (
    <div className="max-w-2xl mx-auto">
      <SectionIntroCard
        title="License Profile"
        description={`Define the ${adaptorName} edition and active modules for this client. This drives rule validation throughout the wizard.`}
        icon={<Shield className="h-5 w-5" />}
      />

      <div className="space-y-6">
        {/* Edition */}
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">{adaptorName} Edition</h3>
          <div className="grid grid-cols-1 gap-3">
            {editions.map((ed) => (
              <button
                key={ed.value}
                type="button"
                onClick={() => setEdition(ed.value)}
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  edition === ed.value
                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                    : 'border-gray-200 bg-white hover:border-brand-200 hover:bg-gray-50'
                }`}
              >
                <div
                  className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                    edition === ed.value ? 'border-brand-600 bg-brand-600' : 'border-gray-300'
                  }`}
                >
                  {edition === ed.value && (
                    <div className="h-full w-full rounded-full flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{ed.label}</p>
                  {ed.description && <p className="text-xs text-gray-500 mt-0.5">{ed.description}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Modules */}
        {moduleCatalog.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Licensed Modules</h3>
            <div className="grid grid-cols-2 gap-2">
              {moduleCatalog.map((mod) => {
                const active = modules.includes(mod.value);
                return (
                  <button
                    key={mod.value}
                    type="button"
                    onClick={() => toggleModule(mod.value)}
                    className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                      active ? 'border-brand-400 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <CircleCheck className={`h-4 w-4 mt-0.5 flex-shrink-0 ${active ? 'text-brand-600' : 'text-gray-200'}`} />
                    <div>
                      <p className="text-xs font-semibold text-gray-900">{mod.label}</p>
                      {mod.description && <p className="text-xs text-gray-500">{mod.description}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} size="lg" className="w-full">
          Save License Profile
        </Button>

        {mutation.isSuccess && (
          <p className="text-center text-sm text-green-600 flex items-center justify-center gap-1">
            <CircleCheck className="h-4 w-4" />
            License saved successfully
          </p>
        )}
      </div>

      {/* Comments, Images & AI Advisor */}
      <div className="mt-8 space-y-4">
        <StepComments engagementId={engId} sectionKey="license" />
        <ImageUpload engagementId={engId} sectionKey="license" />
        <AIAdvisorPanel engagementId={engId} sectionKey="license" />
      </div>
    </div>
  );
}
