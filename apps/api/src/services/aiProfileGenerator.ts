/**
 * AI Business Profile Generator
 *
 * Takes minimal client info (name, industry, size, country) and generates
 * a complete set of business profile answers using Claude.
 * Also provides suggested answers per-section for one-click accept.
 */
import { allQuestions } from '@ofoq/shared';
import type { Question } from '@ofoq/shared';
import { getAnthropicClient, getAiModel } from './aiClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfileGeneratorInput {
  clientName: string;
  industry: string;
  companySize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE';
  country: string;
  additionalContext?: string;
  license?: { edition: string; modules: string[] };
  /** Platform context (Phase 8). When omitted, falls back to NetSuite framing
   *  + the @ofoq/shared NetSuite question bank. */
  platform?: {
    id: string;
    name: string;
    vendor?: string;
  };
  /** Optional adaptor-sourced question list. Every element mirrors the
   *  @ofoq/shared Question shape so downstream code doesn't branch. */
  adaptorQuestions?: Question[];
}

export interface GeneratedProfile {
  answers: Record<string, unknown>;
  confidence: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'>;
  notes: Record<string, string>;
  summary: string;
}

export interface SectionSuggestions {
  suggestedAnswers: Record<string, unknown>;
  reasoning: Record<string, string>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SIZE_DESCRIPTIONS: Record<string, string> = {
  SMALL: '1-50 employees, <$10M revenue, simple operations',
  MEDIUM: '50-200 employees, $10M-$50M revenue, moderate complexity',
  LARGE: '200-1000 employees, $50M-$200M revenue, complex multi-department',
  ENTERPRISE: '1000+ employees, $200M+ revenue, multi-entity/multi-country',
};

function buildQuestionList(questions: Question[]): string {
  const sections = new Map<string, Question[]>();
  for (const q of questions) {
    const key = `${q.flow}.${q.section}`;
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key)!.push(q);
  }

  const lines: string[] = [];
  for (const [section, sectionQuestions] of sections) {
    lines.push(`\n### ${section}`);
    for (const q of sectionQuestions) {
      const type = q.inputType;
      const options = q.options ? ` Options: [${q.options.map(o => o.value).join(', ')}]` : '';
      const dep = q.dependsOn ? ` (only if ${q.dependsOn.questionId} = ${q.dependsOn.value})` : '';
      lines.push(`- **${q.id}** (${type}${options}${dep}): ${q.label}`);
    }
  }
  return lines.join('\n');
}

// ── Full Profile Generation ─────────────────────────────────────────────────

export async function generateFullProfile(input: ProfileGeneratorInput): Promise<GeneratedProfile> {
  const client = getAnthropicClient();
  const model = getAiModel();

  if (!client) {
    return generateHeuristicProfile(input);
  }
  const platformName = input.platform?.name ?? 'NetSuite';
  const platformVendor = input.platform?.vendor;
  const isNetSuite = (input.platform?.id ?? 'netsuite') === 'netsuite';
  const questions = input.adaptorQuestions ?? allQuestions;
  const questionList = buildQuestionList(questions);

  const platformBullet = isNetSuite
    ? '4. NetSuite capabilities and common patterns'
    : `4. ${platformName}${platformVendor ? ` (${platformVendor})` : ''} capabilities and common patterns — if you are unsure about a platform-specific detail, mark confidence LOW rather than guess`;

  const systemPrompt = `You are a Senior ${platformName} Implementation Expert. Given basic information about a company, you generate a complete business profile with answers to all relevant ${platformName} implementation discovery questions.

Your answers should be based on:
1. Industry best practices and typical configurations for the given industry
2. Company size to determine complexity (multi-entity, approval workflows, etc.)
3. Country/region for tax, currency, and compliance requirements
${platformBullet}

CRITICAL RULES:
- Only answer questions that are relevant to the company (respect dependsOn conditions)
- For BOOLEAN questions: return true or false
- For SINGLE_SELECT questions: return one of the listed option values
- For MULTI_SELECT questions: return an array of option values
- For NUMBER questions: return a number
- For TEXT questions: return a descriptive string
- For TABLE questions: return an array of row objects
- For DATE questions: return an ISO date string
- Provide a confidence level (HIGH/MEDIUM/LOW) for each answer
- Provide a brief reasoning note for non-obvious answers
- Be conservative: when unsure, mark confidence as LOW

You MUST respond with ONLY valid JSON matching this schema:
{
  "answers": { "question.id": value },
  "confidence": { "question.id": "HIGH" | "MEDIUM" | "LOW" },
  "notes": { "question.id": "reasoning for this answer" },
  "summary": "2-3 sentence overview of the recommended configuration approach"
}`;

  const userPrompt = `Generate a complete ${platformName} implementation business profile for:

## Client Information
- **Company Name**: ${input.clientName}
- **Industry**: ${input.industry}
- **Company Size**: ${input.companySize} (${SIZE_DESCRIPTIONS[input.companySize] || input.companySize})
- **Country**: ${input.country}
${input.additionalContext ? `- **Additional Context**: ${input.additionalContext}` : ''}
${input.license ? `- **License Edition**: ${input.license.edition}\n- **Modules**: ${input.license.modules.join(', ') || 'None'}` : ''}

## Questions to Answer
${questionList}

Generate answers for ALL applicable questions. Skip questions whose dependsOn conditions are not met based on your answers.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return generateHeuristicProfile(input);
    }

    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const parsed = JSON.parse(jsonStr) as GeneratedProfile;
    if (!parsed.answers) parsed.answers = {};
    if (!parsed.confidence) parsed.confidence = {};
    if (!parsed.notes) parsed.notes = {};
    if (!parsed.summary) parsed.summary = '';

    return parsed;
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('Profile generator error:', error);
    return generateHeuristicProfile(input);
  }
}

// ── Section-level Suggestion Generation ─────────────────────────────────────

export async function generateSectionSuggestions(
  sectionKey: string,
  existingAnswers: Record<string, unknown>,
  clientInfo: { industry: string; companySize: string; country: string },
  license: { edition: string; modules: string[] },
  options: { platform?: { id: string; name: string; vendor?: string }; adaptorQuestions?: Question[] } = {},
): Promise<SectionSuggestions> {
  const client = getAnthropicClient();
  const model = getAiModel();

  if (!client) {
    return { suggestedAnswers: {}, reasoning: {} };
  }

  const platformName = options.platform?.name ?? 'NetSuite';
  const questionPool = options.adaptorQuestions ?? allQuestions;
  const sectionQuestions = questionPool.filter(q => `${q.flow.toLowerCase()}.${q.section}` === sectionKey || q.id.startsWith(`${sectionKey}.`));

  if (sectionQuestions.length === 0) {
    return { suggestedAnswers: {}, reasoning: {} };
  }

  // Find unanswered questions
  const unanswered = sectionQuestions.filter(q => !(q.id in existingAnswers));
  if (unanswered.length === 0) {
    return { suggestedAnswers: {}, reasoning: {} };
  }

  const questionListStr = unanswered.map(q => {
    const type = q.inputType;
    const options = q.options ? ` Options: [${q.options.map(o => o.value).join(', ')}]` : '';
    return `- **${q.id}** (${type}${options}): ${q.label}`;
  }).join('\n');

  const existingStr = Object.entries(existingAnswers)
    .filter(([k]) => k.startsWith(sectionKey) || sectionQuestions.some(q => q.id === k))
    .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
    .join('\n') || '(no existing answers)';

  const systemPrompt = `You are a ${platformName} expert. Suggest answers for unanswered questions based on the client's industry, size, and existing answers. Return ONLY valid JSON: { "suggestedAnswers": { "id": value }, "reasoning": { "id": "why" } }`;

  const userPrompt = `Client: ${clientInfo.industry}, ${clientInfo.companySize}, ${clientInfo.country}
License: ${license.edition}, Modules: ${license.modules.join(', ') || 'none'}

Already answered:
${existingStr}

Suggest answers for:
${questionListStr}`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return { suggestedAnswers: {}, reasoning: {} };

    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    return JSON.parse(jsonStr) as SectionSuggestions;
  } catch {
    return { suggestedAnswers: {}, reasoning: {} };
  }
}

// ── Heuristic Fallback ──────────────────────────────────────────────────────

function generateHeuristicProfile(input: ProfileGeneratorInput): GeneratedProfile {
  const answers: Record<string, unknown> = {};
  const confidence: Record<string, 'HIGH' | 'MEDIUM' | 'LOW'> = {};
  const notes: Record<string, string> = {};

  // Basic entity structure based on size
  const isMultiEntity = input.companySize === 'LARGE' || input.companySize === 'ENTERPRISE';
  answers['r2r.entities.multiEntity'] = isMultiEntity;
  confidence['r2r.entities.multiEntity'] = 'MEDIUM';
  notes['r2r.entities.multiEntity'] = `${input.companySize} companies typically ${isMultiEntity ? 'have' : 'do not have'} multiple entities`;

  if (isMultiEntity) {
    answers['r2r.entities.entityCount'] = input.companySize === 'ENTERPRISE' ? 5 : 2;
    confidence['r2r.entities.entityCount'] = 'LOW';
    notes['r2r.entities.entityCount'] = 'Estimated based on company size — verify with client';
    answers['r2r.entities.intercompanyJE'] = true;
    confidence['r2r.entities.intercompanyJE'] = 'MEDIUM';
  }

  // Currency based on country
  const multiCurrencyCountries = ['UAE', 'United Arab Emirates', 'Saudi Arabia', 'KSA', 'Qatar', 'Bahrain', 'Kuwait', 'Oman'];
  const isMiddleEast = multiCurrencyCountries.some(c => input.country.toLowerCase().includes(c.toLowerCase()));
  answers['r2r.currencies.isMultiCurrency'] = isMultiEntity || isMiddleEast;
  confidence['r2r.currencies.isMultiCurrency'] = 'MEDIUM';

  // Accounting periods
  answers['r2r.accountingPeriods.fiscalYearStart'] = 'January';
  confidence['r2r.accountingPeriods.fiscalYearStart'] = 'LOW';
  notes['r2r.accountingPeriods.fiscalYearStart'] = 'Default to calendar year — verify with client';

  // Tax
  if (isMiddleEast) {
    answers['r2r.tax.hasVAT'] = true;
    confidence['r2r.tax.hasVAT'] = 'HIGH';
    notes['r2r.tax.hasVAT'] = 'VAT is mandatory in GCC countries';
  }

  // Industry-specific defaults
  const industry = input.industry.toLowerCase();

  if (industry.includes('manufactur')) {
    answers['mfg.productionFlow.hasManufacturing'] = true;
    confidence['mfg.productionFlow.hasManufacturing'] = 'HIGH';
    answers['mfg.bom.hasBOM'] = true;
    confidence['mfg.bom.hasBOM'] = 'HIGH';
  }

  if (industry.includes('retail') || industry.includes('ecommerce') || industry.includes('e-commerce')) {
    answers['o2c.pricing.hasMultiplePriceLevels'] = true;
    confidence['o2c.pricing.hasMultiplePriceLevels'] = 'HIGH';
    answers['o2c.fulfillment.hasMultipleWarehouses'] = input.companySize !== 'SMALL';
    confidence['o2c.fulfillment.hasMultipleWarehouses'] = 'MEDIUM';
  }

  if (industry.includes('wholesale') || industry.includes('distribution')) {
    answers['o2c.salesOrders.hasSalesOrders'] = true;
    confidence['o2c.salesOrders.hasSalesOrders'] = 'HIGH';
    answers['p2p.purchasing.hasPurchaseOrders'] = true;
    confidence['p2p.purchasing.hasPurchaseOrders'] = 'HIGH';
  }

  if (industry.includes('service') || industry.includes('consulting')) {
    answers['o2c.invoicing.hasServiceInvoicing'] = true;
    confidence['o2c.invoicing.hasServiceInvoicing'] = 'MEDIUM';
  }

  // Approval workflows based on size
  if (input.companySize !== 'SMALL') {
    answers['p2p.purchasing.hasApprovalWorkflow'] = true;
    confidence['p2p.purchasing.hasApprovalWorkflow'] = 'HIGH';
    notes['p2p.purchasing.hasApprovalWorkflow'] = 'Most medium+ companies require PO approvals';

    answers['r2r.journalEntries.hasJEApproval'] = true;
    confidence['r2r.journalEntries.hasJEApproval'] = 'MEDIUM';
  }

  return {
    answers,
    confidence,
    notes,
    summary: `Generated profile for ${input.clientName} (${input.industry}, ${input.companySize}). ${Object.keys(answers).length} answers pre-filled based on industry patterns and company size. Review all answers marked LOW confidence.`,
  };
}
