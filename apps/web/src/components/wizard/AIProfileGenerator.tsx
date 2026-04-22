import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, X, Building2, MapPin, Users, Loader, CircleCheck,
  AlertTriangle, ChevronDown, ChevronUp, Brain,
} from 'lucide-react';
import { engagementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'Retail & E-Commerce',
  'Wholesale & Distribution',
  'Manufacturing',
  'Professional Services & Consulting',
  'Technology & SaaS',
  'Construction & Real Estate',
  'Healthcare',
  'Education',
  'Financial Services',
  'Hospitality & Food Services',
  'Logistics & Transportation',
  'Oil & Gas / Energy',
  'Telecommunications',
  'Non-Profit',
  'Other',
];

const COMPANY_SIZES = [
  { value: 'SMALL', label: 'Small', desc: '1–50 employees, <$10M revenue' },
  { value: 'MEDIUM', label: 'Medium', desc: '50–200 employees, $10M–$50M revenue' },
  { value: 'LARGE', label: 'Large', desc: '200–1,000 employees, $50M–$200M revenue' },
  { value: 'ENTERPRISE', label: 'Enterprise', desc: '1,000+ employees, $200M+ revenue' },
];

const GCC_COUNTRIES = [
  'United Arab Emirates',
  'Saudi Arabia',
  'Qatar',
  'Bahrain',
  'Kuwait',
  'Oman',
];

const OTHER_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'India',
  'Germany',
  'France',
  'Singapore',
  'Japan',
  'South Africa',
  'Egypt',
  'Jordan',
  'Lebanon',
  'Other',
];

// ── Confidence Badge ────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const colors = {
    HIGH: 'bg-green-50 text-green-700 border-green-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    LOW: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', colors[level])}>
      {level === 'HIGH' && <CircleCheck className="h-3 w-3 mr-1" />}
      {level === 'MEDIUM' && <AlertTriangle className="h-3 w-3 mr-1" />}
      {level === 'LOW' && <AlertTriangle className="h-3 w-3 mr-1" />}
      {level}
    </span>
  );
}

// ── Result Panel ────────────────────────────────────────────────────────────

interface GenerateResult {
  answersGenerated: number;
  answersApplied: number;
  confidence: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'>;
  notes: Record<string, string>;
  summary: string;
}

function ResultPanel({ result, onClose }: { result: GenerateResult; onClose: () => void }) {
  const [showDetails, setShowDetails] = useState(false);

  const confidenceCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const level of Object.values(result.confidence ?? {})) {
    if (level in confidenceCounts) confidenceCounts[level]++;
  }

  const totalAnswers = result.answersGenerated ?? Object.keys(result.confidence ?? {}).length;

  return (
    <div className="space-y-4">
      {/* Success header */}
      <div className="rounded-xl bg-green-50 border border-green-200 p-4">
        <div className="flex items-start gap-3">
          <CircleCheck className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-green-900">Profile Generated Successfully</p>
            <p className="text-xs text-green-700 mt-1">
              {result.answersApplied} new answers applied to your questionnaire ({totalAnswers} total generated).
              Existing answers were preserved.
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      {result.summary && (
        <div className="rounded-xl bg-white border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="h-4 w-4 text-brand-600" />
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider">AI Summary</p>
          </div>
          <p className="text-sm text-gray-700">{result.summary}</p>
        </div>
      )}

      {/* Confidence breakdown */}
      <div className="rounded-xl bg-white border border-gray-200 p-4">
        <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">Confidence Breakdown</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 rounded-lg bg-green-50">
            <p className="text-2xl font-black text-green-700">{confidenceCounts.HIGH}</p>
            <p className="text-xs text-green-600 mt-1">High confidence</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-amber-50">
            <p className="text-2xl font-black text-amber-700">{confidenceCounts.MEDIUM}</p>
            <p className="text-xs text-amber-600 mt-1">Medium confidence</p>
          </div>
          <div className="text-center p-3 rounded-lg bg-red-50">
            <p className="text-2xl font-black text-red-700">{confidenceCounts.LOW}</p>
            <p className="text-xs text-red-600 mt-1">Low — review needed</p>
          </div>
        </div>
      </div>

      {/* Toggle detail list */}
      {Object.keys(result.confidence ?? {}).length > 0 && (
        <>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {showDetails ? 'Hide' : 'Show'} confidence details ({totalAnswers} answers)
          </button>

          {showDetails && (
            <div className="rounded-xl bg-white border border-gray-200 max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Question</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600">Confidence</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(result.confidence).map(([key, level]) => (
                    <tr key={key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700 font-mono">{key}</td>
                      <td className="px-3 py-2 text-center">
                        <ConfidenceBadge level={level} />
                      </td>
                      <td className="px-3 py-2 text-gray-500">{result.notes?.[key] ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <button
        onClick={onClose}
        className="w-full rounded-lg bg-brand-600 text-white text-sm font-semibold py-2.5 hover:bg-brand-700 transition-colors"
      >
        Continue to Questionnaire
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface AIProfileGeneratorProps {
  engagementId: string;
  clientName: string;
  onClose?: () => void;
}

export function AIProfileGenerator({ engagementId, clientName, onClose }: AIProfileGeneratorProps) {
  const queryClient = useQueryClient();

  const [industry, setIndustry] = useState('');
  const [customIndustry, setCustomIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [country, setCountry] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);

  const generateMutation = useMutation({
    mutationFn: () =>
      engagementsApi.generateProfile(engagementId, {
        industry: industry === 'Other' ? customIndustry : industry,
        companySize,
        country,
        additionalContext: additionalContext || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
      // Invalidate and refetch profile so the wizard store picks up new answers
      queryClient.invalidateQueries({ queryKey: ['profile', engagementId] });
      queryClient.invalidateQueries({ queryKey: ['conflicts', engagementId] });
      queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    },
  });

  const isValid = industry && companySize && country && (industry !== 'Other' || customIndustry);

  if (result) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-brand-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900">AI Profile Results</h2>
              <p className="text-xs text-gray-500">for {clientName}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <ResultPanel result={result} onClose={() => { setResult(null); onClose?.(); }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-brand-600 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">AI Profile Generator</h2>
            <p className="text-xs text-gray-500">Auto-fill the entire questionnaire in seconds</p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="rounded-xl bg-gradient-to-r from-violet-50 to-brand-50 border border-violet-200 p-4 mb-6">
        <p className="text-sm text-violet-800">
          Enter basic client details below and AI will generate recommended answers for <strong>all</strong> questionnaire sections
          based on industry best practices, company size patterns, and regional requirements.
          Existing answers will be preserved.
        </p>
      </div>

      <div className="space-y-5">
        {/* Industry */}
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
            <Building2 className="h-4 w-4 text-gray-400" />
            Industry
          </label>
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="">Select industry…</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
          {industry === 'Other' && (
            <input
              type="text"
              placeholder="Enter your industry…"
              value={customIndustry}
              onChange={(e) => setCustomIndustry(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
            />
          )}
        </div>

        {/* Company Size */}
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
            <Users className="h-4 w-4 text-gray-400" />
            Company Size
          </label>
          <div className="grid grid-cols-2 gap-2">
            {COMPANY_SIZES.map((sz) => (
              <button
                key={sz.value}
                type="button"
                onClick={() => setCompanySize(sz.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-all',
                  companySize === sz.value
                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                )}
              >
                <p className="text-sm font-semibold text-gray-900">{sz.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{sz.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Country */}
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
            <MapPin className="h-4 w-4 text-gray-400" />
            Primary Country
          </label>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="">Select country…</option>
            <optgroup label="GCC Countries">
              {GCC_COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </optgroup>
            <optgroup label="Other Regions">
              {OTHER_COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Additional Context (optional) */}
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 mb-2">
            <Brain className="h-4 w-4 text-gray-400" />
            Additional Context <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="E.g. 'Multi-entity across UAE and KSA, heavy project-based billing, currently on Oracle ERP…'"
            rows={3}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none resize-none"
          />
        </div>

        {/* Error state */}
        {generateMutation.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">
              Failed to generate profile. {(generateMutation.error as Error)?.message || 'Please try again.'}
            </p>
          </div>
        )}

        {/* Generate button */}
        <button
          onClick={() => generateMutation.mutate()}
          disabled={!isValid || generateMutation.isPending}
          className={cn(
            'w-full rounded-xl py-3.5 text-sm font-bold transition-all flex items-center justify-center gap-2',
            isValid && !generateMutation.isPending
              ? 'bg-gradient-to-r from-violet-600 to-brand-600 text-white hover:from-violet-700 hover:to-brand-700 shadow-lg shadow-brand-200'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          )}
        >
          {generateMutation.isPending ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              Generating profile… This may take 15–30 seconds
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate Full Profile with AI
            </>
          )}
        </button>

        <p className="text-center text-xs text-gray-400">
          AI generates best-practice recommendations based on industry patterns.
          All answers can be reviewed and edited after generation.
        </p>
      </div>
    </div>
  );
}
