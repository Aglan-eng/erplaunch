import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, CircleCheck } from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { SectionIntroCard } from '../SectionIntroCard';
import { StepComments } from '../StepComments';
import { ImageUpload } from '../ImageUpload';
import { AIAdvisorPanel } from '../AIAdvisorPanel';
import { Button } from '@/components/ui/Button';
import { useConflictStore } from '@/stores/conflictStore';

const EDITIONS = [
  { value: 'STARTER', label: 'Starter', description: 'Basic financials, up to 10 users' },
  { value: 'MID_MARKET', label: 'Mid-Market', description: 'Full ERP suite, multi-currency' },
  { value: 'ONEWORLD', label: 'Enterprise / OneWorld', description: 'Multi-entity, unlimited users, advanced analytics' },
];

const MODULES = [
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

interface LicenseProfileStepProps {
  engagementId: string;
  currentLicense: { edition: string; modules: string[] } | null;
}

export function LicenseProfileStep({ engagementId, currentLicense }: LicenseProfileStepProps) {
  const queryClient = useQueryClient();
  const setConflicts = useConflictStore((s) => s.setConflicts);

  const [edition, setEdition] = useState<string>(currentLicense?.edition ?? 'MID_MARKET');
  const [modules, setModules] = useState<string[]>(currentLicense?.modules ?? []);

  const mutation = useMutation({
    mutationFn: () => engagementsApi.putLicense(engagementId, { edition, modules }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['license', engagementId] });
      queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });

      // Same pattern as useAnswerMutation: push normalised conflicts directly into
      // the Zustand store and the React Query cache to avoid the DB-read race.
      if (import.meta.env.DEV) console.debug('[LicenseProfileStep] putLicense response data:', data);
      const normalizedConflicts = Array.isArray(data?.conflicts)
        ? data.conflicts.map((c: Record<string, unknown>) => ({
            ...c,
            ruleId: (c.ruleId ?? c.id) as string,
          }))
        : [];

      if (import.meta.env.DEV) console.debug('[LicenseProfileStep] setting conflicts:', normalizedConflicts);
      setConflicts(normalizedConflicts);
      queryClient.refetchQueries({ queryKey: ['conflicts', engagementId] });
    },
  });

  const toggleModule = (mod: string) => {
    setModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  };

  return (
    <div className="max-w-2xl mx-auto">
      <SectionIntroCard
        title="License Profile"
        description="Define the NetSuite edition and active modules for this client. This drives rule validation throughout the wizard."
        icon={<Shield className="h-5 w-5" />}
      />

      <div className="space-y-6">
        {/* Edition */}
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">NetSuite Edition</h3>
          <div className="grid grid-cols-1 gap-3">
            {EDITIONS.map((ed) => (
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
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                  edition === ed.value ? 'border-brand-600 bg-brand-600' : 'border-gray-300'
                }`}>
                  {edition === ed.value && (
                    <div className="h-full w-full rounded-full flex items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white" />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{ed.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{ed.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Modules */}
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Licensed Modules</h3>
          <div className="grid grid-cols-2 gap-2">
            {MODULES.map((mod) => {
              const active = modules.includes(mod.value);
              return (
                <button
                  key={mod.value}
                  type="button"
                  onClick={() => toggleModule(mod.value)}
                  className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-all ${
                    active
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <CircleCheck
                    className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                      active ? 'text-brand-600' : 'text-gray-200'
                    }`}
                  />
                  <div>
                    <p className="text-xs font-semibold text-gray-900">{mod.label}</p>
                    <p className="text-xs text-gray-500">{mod.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          size="lg"
          className="w-full"
        >
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
        <StepComments engagementId={engagementId} sectionKey="license" />
        <ImageUpload engagementId={engagementId} sectionKey="license" />
        <AIAdvisorPanel engagementId={engagementId} sectionKey="license" />
      </div>
    </div>
  );
}


