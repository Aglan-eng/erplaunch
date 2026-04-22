/**
 * AI Implementation Expert Service
 * 
 * Uses Anthropic Claude to analyze section answers, consultant comments,
 * license profile, and conflicts to produce structured implementation advice.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { allQuestions } from '@ofoq/shared';
import type { Question } from '@ofoq/shared';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AIAdviceResult {
  suggestions: Array<{
    title: string;
    description: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    category: 'CONFIGURATION' | 'BEST_PRACTICE' | 'RISK' | 'DATA_MIGRATION';
  }>;
  consultantInstructions: Array<{
    step: number;
    instruction: string;
    context: string;
  }>;
  warnings: string[];
  relatedKBArticles: Array<{
    title: string;
    description: string;
  }>;
}

interface AdvisorInput {
  sectionKey: string;
  answers: Record<string, unknown>;
  comment: string;
  license: { edition: string; modules: string[] };
  conflicts: Array<{ message: string; severity: string; resolution: string }>;
}

// ── Question lookup ──────────────────────────────────────────────────────────

const questionMap = new Map<string, Question>();
for (const q of allQuestions) {
  questionMap.set(q.id, q);
}

// ── Section metadata for prompt context ──────────────────────────────────────

const SECTION_CONTEXT: Record<string, string> = {
  'license': 'NetSuite License Profile — edition selection and module provisioning',
  'r2r.entities': 'Legal entity structure — determines OneWorld requirement',
  'r2r.segmentation': 'Reporting dimensions: departments, classes, locations',
  'r2r.accountingPeriods': 'Fiscal calendar and period locking configuration',
  'r2r.currencies': 'Base currency and multi-currency requirements',
  'r2r.bankTransactions': 'Bank accounts, reconciliation, opening balances',
  'r2r.tax': 'Tax regimes, VAT rates, registration details',
  'r2r.journalEntries': 'Manual journal entries and approval workflows',
  'r2r.fiscalClose': 'Period close procedures and automated locking',
  'r2r.reporting': 'Standard/custom reporting and consolidation',
  'p2p.vendors': 'Vendor master, payment terms, withholding tax',
  'p2p.purchasing': 'Purchase order workflow and approval thresholds',
  'p2p.receiving': 'Goods receipt, 3-way matching, vendor returns',
  'p2p.bills': 'Vendor bill entry and approval workflows',
  'p2p.payments': 'Payment methods, payment run frequency, bank file export',
  'p2p.expenses': 'Employee expense reports and reimbursement',
  'o2c.customers': 'Customer master, credit limits, payment terms',
  'o2c.pricing': 'Price levels, discounts, multi-currency pricing',
  'o2c.salesOrders': 'Sales order workflow and approval thresholds',
  'o2c.fulfillment': 'Warehouse operations, pick-pack-ship, multi-location',
  'o2c.invoicing': 'Invoice triggers, e-invoicing, revenue recognition',
  'o2c.collections': 'AR aging, dunning, cash application',
  'mfg.productionFlow': 'Production methods, labor/machine tracking',
  'mfg.bom': 'Bill of materials structure and revisions',
  'mfg.outsourced': 'External manufacturing and material transfers',
  'mfg.demand': 'Forecasting and automated work order suggestions',
  'rtn.customerReturns': 'RMA workflows and refund policies',
  'rtn.vendorReturns': 'Vendor return authorization process',
  'rtn.processing': 'Quality inspection, restocking fees, warehouse flows',
};

// ── Hash computation for cache invalidation ──────────────────────────────────

export function computeInputHash(input: AdvisorInput): string {
  const data = JSON.stringify({
    answers: input.answers,
    comment: input.comment,
    license: input.license,
    conflicts: input.conflicts,
  });
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ── Format answers for prompt ────────────────────────────────────────────────

function formatAnswersForPrompt(sectionKey: string, answers: Record<string, unknown>): string {
  const sectionAnswers = Object.entries(answers)
    .filter(([key]) => key.startsWith(`${sectionKey}.`))
    .map(([key, value]) => {
      const question = questionMap.get(key);
      const label = question?.label ?? key;
      let formatted: string;

      if (typeof value === 'boolean') {
        formatted = value ? 'Yes' : 'No';
      } else if (Array.isArray(value)) {
        formatted = value.join(', ');
      } else if (value === null || value === undefined) {
        formatted = '(not answered)';
      } else {
        formatted = String(value);
      }

      return `- ${label}: ${formatted}`;
    });

  return sectionAnswers.length > 0 ? sectionAnswers.join('\n') : '(no answers recorded yet)';
}

// ── Core AI generation ───────────────────────────────────────────────────────

export async function generateAIAdvice(input: AdvisorInput): Promise<AIAdviceResult> {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || 'claude-sonnet-4-20250514';

  if (!apiKey) {
    // Fallback to heuristic engine
    return generateHeuristicAdvice(input);
  }

  const client = new Anthropic({ apiKey });
  const sectionContext = SECTION_CONTEXT[input.sectionKey] || input.sectionKey;
  const formattedAnswers = formatAnswersForPrompt(input.sectionKey, input.answers);

  const conflictsText = input.conflicts.length > 0
    ? input.conflicts.map(c => `- [${c.severity}] ${c.message} (Resolution: ${c.resolution})`).join('\n')
    : 'None';

  const systemPrompt = `You are a Senior NetSuite Implementation Expert with 15+ years of experience across hundreds of ERP implementations in the Middle East and globally. You specialize in translating discovery workshop findings into actionable configuration guidance.

Your role is to analyze the client's responses and consultant notes for a specific section of the NetSuite implementation wizard, then provide structured implementation advice.

CRITICAL RULES:
1. Be specific to NetSuite — reference actual menu paths (e.g., "Setup > Company > Enable Features > Accounting")
2. Tailor advice to the selected edition (${input.license.edition}) and modules (${input.license.modules.join(', ') || 'none'})
3. Flag any risks or common pitfalls specific to the answers provided
4. Reference NetSuite best practices and SuiteAnswers article IDs where applicable
5. Keep instructions actionable and numbered — a junior consultant should be able to follow them

You MUST respond with ONLY valid JSON matching this exact schema:
{
  "suggestions": [
    {
      "title": "string — brief actionable title",
      "description": "string — detailed explanation with specific NetSuite context",
      "priority": "HIGH | MEDIUM | LOW",
      "category": "CONFIGURATION | BEST_PRACTICE | RISK | DATA_MIGRATION"
    }
  ],
  "consultantInstructions": [
    {
      "step": 1,
      "instruction": "string — specific action to take in NetSuite",
      "context": "string — why this step matters"
    }
  ],
  "warnings": ["string — risk items or things to watch out for"],
  "relatedKBArticles": [
    {
      "title": "string — article title or SuiteAnswers reference",
      "description": "string — what it covers and why it's relevant"
    }
  ]
}`;

  const userPrompt = `Analyze this section of a NetSuite implementation and provide implementation advice.

## Section
**${input.sectionKey}** — ${sectionContext}

## Client's NetSuite License
- Edition: ${input.license.edition}
- Modules: ${input.license.modules.join(', ') || 'None provisioned'}

## Discovery Answers
${formattedAnswers}

## Consultant Notes
${input.comment || '(no consultant notes for this section)'}

## Active Conflicts / Warnings
${conflictsText}

Provide your implementation advice as JSON.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    });

    // Extract text content
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.error('AI Advisor: No text in response');
      return generateHeuristicAdvice(input);
    }

    // Parse JSON (handle possible markdown fencing)
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as AIAdviceResult;

    // Validate structure
    if (!parsed.suggestions) parsed.suggestions = [];
    if (!parsed.consultantInstructions) parsed.consultantInstructions = [];
    if (!parsed.warnings) parsed.warnings = [];
    if (!parsed.relatedKBArticles) parsed.relatedKBArticles = [];

    return parsed;
  } catch (error) {
    console.error('AI Advisor error, falling back to heuristics:', error);
    return generateHeuristicAdvice(input);
  }
}

// ── Heuristic fallback engine ────────────────────────────────────────────────

function generateHeuristicAdvice(input: AdvisorInput): AIAdviceResult {
  const { sectionKey, answers, license } = input;
  const suggestions: AIAdviceResult['suggestions'] = [];
  const instructions: AIAdviceResult['consultantInstructions'] = [];
  const warnings: string[] = [];
  const articles: AIAdviceResult['relatedKBArticles'] = [];

  // Universal advice
  suggestions.push({
    title: 'Document All Configuration Decisions',
    description: 'Ensure all configuration choices are documented in the BRD before proceeding to build. Use the comments section to capture any verbal agreements from workshops.',
    priority: 'MEDIUM',
    category: 'BEST_PRACTICE',
  });

  // Section-specific heuristics
  if (sectionKey.startsWith('r2r.entities')) {
    if (answers['r2r.entities.multiEntity'] === true) {
      suggestions.push({
        title: 'Enable OneWorld',
        description: 'Multi-entity setup requires NetSuite OneWorld. Verify the license includes OneWorld before configuration.',
        priority: 'HIGH',
        category: 'CONFIGURATION',
      });
      if (!license.modules.includes('ONEWORLD')) {
        warnings.push('Multi-entity is enabled but OneWorld module is not provisioned. This is a blocking issue.');
      }
    }
  }

  if (sectionKey.startsWith('r2r.currencies')) {
    if (answers['r2r.currencies.isMultiCurrency'] === true) {
      instructions.push({
        step: 1,
        instruction: 'Navigate to Setup > Company > Enable Features > Accounting and enable Multi-Currency',
        context: 'Multi-currency must be enabled before creating any transactions in foreign currencies',
      });
      articles.push({
        title: 'SuiteAnswers: Multi-Currency Setup',
        description: 'Covers base currency selection, exchange rate providers, and currency list configuration.',
      });
    }
  }

  if (sectionKey.startsWith('p2p.purchasing')) {
    if (answers['p2p.purchasing.poApprovalRequired'] === true) {
      instructions.push({
        step: 1,
        instruction: 'Create a Purchase Order approval workflow via Customization > Workflow > Workflows > New',
        context: 'PO approval routing should be configured based on the client\'s authority matrix',
      });
      suggestions.push({
        title: 'Define Approval Thresholds',
        description: 'Work with the client to define PO value thresholds and corresponding approval levels before building the workflow.',
        priority: 'HIGH',
        category: 'CONFIGURATION',
      });
    }
  }

  if (sectionKey.startsWith('o2c.')) {
    if (answers['o2c.customers.creditLimits'] === true) {
      suggestions.push({
        title: 'Configure Credit Hold Rules',
        description: 'Set up credit limit enforcement on Sales Orders. Configure whether to block or warn when limits are exceeded.',
        priority: 'HIGH',
        category: 'CONFIGURATION',
      });
    }
  }

  // Conflict-based warnings
  for (const c of input.conflicts) {
    if (c.severity === 'BLOCK') {
      warnings.push(`Blocking issue: ${c.message}. Recommended: ${c.resolution}`);
    }
  }

  return { suggestions, consultantInstructions: instructions, warnings, relatedKBArticles: articles };
}
