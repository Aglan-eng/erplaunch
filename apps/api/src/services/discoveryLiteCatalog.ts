/**
 * Phase 46.2 — Discovery Lite question catalog.
 *
 * Hardcoded list of 12-15 lite questions that take a prospect from
 * "we want an ERP" to "the sales rep can scope a proposal". Pure
 * data — no DB calls — so the catalog is testable and can be
 * round-tripped to the frontend via the route layer.
 *
 * Question types intentionally narrow:
 *   - text: free-form short answer
 *   - long_text: multi-line / paragraph
 *   - single_select: pick one from `options`
 *   - multi_select: pick any subset of `options`
 *   - number: numeric (with optional min/max)
 *
 * Module questions are special — when an engagement's adaptor
 * advertises modules, the route layer hydrates the options at
 * read time. The catalog leaves `options` empty for these and
 * marks them with adaptorAware: true.
 */

export type DiscoveryLiteQuestionType =
  | 'text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'number';

export interface DiscoveryLiteQuestion {
  id: string;
  label: string;
  helpText?: string;
  type: DiscoveryLiteQuestionType;
  required?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
  /** When true, the route layer fills `options` at read time from
   *  the engagement's selected adaptor catalog. */
  adaptorAware?: boolean;
  /** Numeric guards — applied client-side and re-enforced server-side. */
  min?: number;
  max?: number;
}

export const DISCOVERY_LITE_QUESTIONS: ReadonlyArray<DiscoveryLiteQuestion> = [
  {
    id: 'companySize.employees',
    label: 'Approximate headcount',
    helpText: 'Including contractors and part-time staff.',
    type: 'single_select',
    required: true,
    options: [
      { value: '1-25', label: '1–25' },
      { value: '26-100', label: '26–100' },
      { value: '101-500', label: '101–500' },
      { value: '501-2000', label: '501–2,000' },
      { value: '2000+', label: '2,000+' },
    ],
  },
  {
    id: 'companySize.revenueRange',
    label: 'Annual revenue range (USD)',
    type: 'single_select',
    options: [
      { value: 'pre-revenue', label: 'Pre-revenue / Series A' },
      { value: '1m-10m', label: '$1M – $10M' },
      { value: '10m-50m', label: '$10M – $50M' },
      { value: '50m-250m', label: '$50M – $250M' },
      { value: '250m+', label: '$250M+' },
    ],
  },
  {
    id: 'company.industry',
    label: 'Industry / vertical',
    helpText: 'Pick the closest match. We use this to surface relevant case studies.',
    type: 'single_select',
    required: true,
    options: [
      { value: 'saas', label: 'SaaS / Software' },
      { value: 'manufacturing', label: 'Manufacturing' },
      { value: 'retail-ecom', label: 'Retail / E-commerce' },
      { value: 'professional-services', label: 'Professional services' },
      { value: 'healthcare', label: 'Healthcare / Life sciences' },
      { value: 'financial-services', label: 'Financial services' },
      { value: 'logistics', label: 'Logistics / Supply chain' },
      { value: 'nonprofit', label: 'Non-profit / Public sector' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'currentSystem',
    label: 'What system are you using today?',
    helpText: 'If you have multiple, list the primary one.',
    type: 'single_select',
    options: [
      { value: 'none', label: 'None / spreadsheets' },
      { value: 'quickbooks', label: 'QuickBooks' },
      { value: 'xero', label: 'Xero' },
      { value: 'sage', label: 'Sage' },
      { value: 'sap', label: 'SAP' },
      { value: 'oracle', label: 'Oracle' },
      { value: 'dynamics', label: 'Microsoft Dynamics' },
      { value: 'netsuite-existing', label: 'NetSuite (re-implementation)' },
      { value: 'other', label: 'Other / custom-built' },
    ],
  },
  {
    id: 'painPoints',
    label: 'Top pain points (pick up to 3)',
    helpText: 'What\'s pushing you to evaluate a new ERP right now?',
    type: 'multi_select',
    required: true,
    options: [
      { value: 'manual-reconciliation', label: 'Manual reconciliation & spreadsheets' },
      { value: 'reporting-lag', label: 'Slow / inaccurate reporting' },
      { value: 'multi-entity-consolidation', label: 'Multi-entity consolidation pain' },
      { value: 'inventory-visibility', label: 'No real-time inventory visibility' },
      { value: 'compliance-audit', label: 'Compliance / audit burden' },
      { value: 'integration-gaps', label: 'Disconnected systems / integration gaps' },
      { value: 'scaling-bottleneck', label: 'Current system can\'t scale' },
      { value: 'forecasting', label: 'Forecasting & cash visibility' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'modules.interest',
    label: 'Modules of interest',
    helpText: 'Roughly which areas you\'d want this engagement to cover.',
    type: 'multi_select',
    required: true,
    adaptorAware: true,
    // Default options when no adaptor context is available (e.g.
    // self-serve before an adaptor has been picked). Adaptor-aware
    // hydration overwrites these at read time.
    options: [
      { value: 'gl-ar-ap', label: 'General Ledger / AR / AP' },
      { value: 'inventory', label: 'Inventory' },
      { value: 'order-management', label: 'Order Management' },
      { value: 'procurement', label: 'Procurement / Purchasing' },
      { value: 'crm', label: 'CRM' },
      { value: 'projects', label: 'Project Accounting' },
      { value: 'manufacturing', label: 'Manufacturing' },
      { value: 'fixed-assets', label: 'Fixed Assets' },
      { value: 'advanced-revenue', label: 'Revenue Recognition (ASC 606)' },
      { value: 'budgeting-fp-and-a', label: 'Budgeting / FP&A' },
    ],
  },
  {
    id: 'geography.multiEntity',
    label: 'Are you operating across multiple entities or countries?',
    type: 'single_select',
    required: true,
    options: [
      { value: 'single', label: 'Single entity, single country' },
      { value: 'single-country-multi-entity', label: 'Multiple entities in one country' },
      { value: 'multi-country', label: 'Multiple countries' },
    ],
  },
  {
    id: 'timeline.targetGoLive',
    label: 'When would you like to be live?',
    type: 'single_select',
    required: true,
    options: [
      { value: 'asap', label: 'ASAP (within 90 days)' },
      { value: '3-6m', label: '3 – 6 months' },
      { value: '6-12m', label: '6 – 12 months' },
      { value: '12m+', label: 'Beyond 12 months' },
      { value: 'tbd', label: 'Not yet decided' },
    ],
  },
  {
    id: 'budget.range',
    label: 'Approximate budget range (USD)',
    helpText: 'Implementation services + first-year licenses combined.',
    type: 'single_select',
    options: [
      { value: 'under-50k', label: 'Under $50K' },
      { value: '50k-150k', label: '$50K – $150K' },
      { value: '150k-500k', label: '$150K – $500K' },
      { value: '500k-1m', label: '$500K – $1M' },
      { value: '1m+', label: '$1M+' },
      { value: 'tbd', label: 'Not yet defined' },
    ],
  },
  {
    id: 'decisionMaker.name',
    label: 'Who has final sign-off authority?',
    helpText: 'Title is fine if you\'d rather not name them.',
    type: 'text',
  },
  {
    id: 'decisionMaker.process',
    label: 'How does sign-off typically happen?',
    type: 'single_select',
    options: [
      { value: 'single-signer', label: 'Single signer (CEO/CFO)' },
      { value: 'committee', label: 'Steering committee approval' },
      { value: 'board', label: 'Board / investors' },
      { value: 'rfp', label: 'Formal RFP process' },
    ],
  },
  {
    id: 'integrations.touchpoints',
    label: 'Which systems will need to integrate?',
    helpText: 'Free text — list the top 3-5 (e.g., Salesforce, Shopify, ADP).',
    type: 'long_text',
  },
  {
    id: 'scope.locations',
    label: 'How many locations are in scope?',
    type: 'number',
    min: 1,
    max: 5000,
  },
  {
    id: 'scope.users',
    label: 'How many users will need access?',
    helpText: 'Includes occasional users (read-only).',
    type: 'number',
    min: 1,
    max: 50_000,
  },
];

/**
 * Map of question id → required flag. Used by the completion check
 * so the catalog stays the single source of truth.
 */
export const REQUIRED_QUESTION_IDS: ReadonlyArray<string> =
  DISCOVERY_LITE_QUESTIONS.filter((q) => q.required).map((q) => q.id);

/**
 * Pure helper — given a partial answer set, returns the subset of
 * required ids that are still empty/missing. The route layer uses
 * this to gate "mark complete" until every required question has a
 * value.
 */
export function missingRequiredAnswers(answers: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const id of REQUIRED_QUESTION_IDS) {
    const v = answers[id];
    if (v === undefined || v === null) {
      missing.push(id);
      continue;
    }
    if (typeof v === 'string' && v.trim().length === 0) {
      missing.push(id);
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      missing.push(id);
    }
  }
  return missing;
}

/**
 * Validate a single answer against its question definition. Returns
 * an error message when invalid; null when valid (or unknown id —
 * unknown ids are dropped silently at the route layer so a stale
 * answers blob doesn't fail the upsert).
 */
export function validateAnswer(qid: string, value: unknown): string | null {
  const q = DISCOVERY_LITE_QUESTIONS.find((x) => x.id === qid);
  if (!q) return null;
  if (value === null || value === undefined) return null;
  switch (q.type) {
    case 'text':
    case 'long_text':
      return typeof value === 'string' ? null : 'expected string';
    case 'single_select':
      if (typeof value !== 'string') return 'expected string';
      if (q.adaptorAware) return null;
      if (q.options && !q.options.some((o) => o.value === value)) {
        return `value must be one of ${q.options.map((o) => o.value).join(', ')}`;
      }
      return null;
    case 'multi_select': {
      if (!Array.isArray(value)) return 'expected array';
      if (q.adaptorAware) return value.every((v) => typeof v === 'string') ? null : 'expected array of strings';
      if (q.options) {
        const allowed = new Set(q.options.map((o) => o.value));
        for (const v of value) {
          if (typeof v !== 'string' || !allowed.has(v)) {
            return `each value must be one of ${q.options.map((o) => o.value).join(', ')}`;
          }
        }
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected number';
      if (q.min !== undefined && value < q.min) return `must be >= ${q.min}`;
      if (q.max !== undefined && value > q.max) return `must be <= ${q.max}`;
      return null;
    }
    default:
      return null;
  }
}
