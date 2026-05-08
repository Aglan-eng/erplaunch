/**
 * Phase 46.3 — Proposal generator.
 *
 * Pure function — `generateProposal(input)` returns a Record<filepath,
 * content> the route layer writes to disk. Mirrors the Phase 45.2
 * HANDOFF_PACKAGE generator's shape so processJob can dispatch them
 * through identical machinery.
 *
 * The bundle is intended to be regenerated each time the sales rep
 * tweaks the deal and emails to the prospect's decision-maker. The
 * docx files are markdown today (real .docx bytes would require a
 * heavyweight dep we'd rather defer); the route layer stamps the
 * .docx extension so downstream tooling still treats them as Word
 * documents and the firm's brand templates can be substituted later.
 *
 * Documentation/
 *   Cover_Letter.docx               — branded letter to the decision maker
 *   Executive_Summary.html          — 1-page summary of pain points + solution
 *   Solution_Overview.html          — module-by-module breakdown
 *   Implementation_Approach.html    — methodology + timeline + team
 *   Pricing_Schedule.docx           — phased pricing breakdown
 *   Why_Us.docx                     — firm-customizable sales pitch
 *   Terms_and_Conditions.docx       — boilerplate contract terms
 */

export interface ProposalPricingPhase {
  /** Display label — "Discovery", "Configure", etc. */
  label: string;
  /** Whole-dollar phase price after multipliers. */
  amount: number;
}

export interface ProposalLineItem {
  /** Module id — matches Discovery Lite's modules.interest values
   *  (gl-ar-ap, inventory, etc.) when the prospect is on a built-in
   *  catalog. Adaptor-specific modules are also valid. */
  moduleId: string;
  /** Per-user price the firm charges for this module. */
  perUserPrice: number;
}

export interface ProposalInput {
  // Engagement context
  clientName: string;
  decisionMakerName?: string | null;
  adaptorId: string;
  adaptorName: string;

  // Pulled from Discovery Lite (Phase 46.2). When the prospect skipped
  // Discovery Lite the generator falls back to safe-but-vague defaults.
  pains: ReadonlyArray<string>;
  modulesOfInterest: ReadonlyArray<{ id: string; label: string }>;
  estimatedUsers: number;
  estimatedLocations: number;
  geographyMultiEntity: 'single' | 'single-country-multi-entity' | 'multi-country';
  targetGoLive: string; // catalog code: 'asap' | '3-6m' | '6-12m' | '12m+' | 'tbd'

  // Pricing inputs — pulled from FirmSettings + per-prospect overrides.
  // perUserPricing maps moduleId → annual per-user price. Modules in
  // modulesOfInterest that aren't in this map fall back to defaultPerUserPrice.
  perUserPricing: Record<string, number>;
  defaultPerUserPrice: number;
  /** Geography multiplier — 1.0 single, 1.15 multi-entity, 1.30 multi-country. */
  geographyMultiplier?: number;
  /** Phase split (must sum to 1.0; generator normalises if not). */
  phaseSplit?: Record<string, number>;
  /** Validity period of the proposal in days. */
  validityDays?: number;

  // Firm customisation. Each is optional; defaults provide a generic
  // template the firm can swap out via FirmSettings.
  firmName: string;
  firmWhyUs?: string | null;
  firmCoverLetterTemplate?: string | null;
  firmTermsAndConditions?: string | null;
  preparedByName?: string | null;
  preparedByEmail?: string | null;

  // ISO date — anchors "valid until" math.
  preparedAt: string;
}

const DEFAULT_PHASE_SPLIT: Record<string, number> = {
  Discovery: 0.15,
  Configure: 0.45,
  UAT: 0.20,
  'Go-Live': 0.10,
  Hypercare: 0.10,
};
const DEFAULT_VALIDITY_DAYS = 30;
const DEFAULT_GEO_MULTIPLIER = (geo: ProposalInput['geographyMultiEntity']): number => {
  if (geo === 'multi-country') return 1.3;
  if (geo === 'single-country-multi-entity') return 1.15;
  return 1.0;
};

const PAIN_LABELS: Record<string, string> = {
  'manual-reconciliation': 'Manual reconciliation & spreadsheets',
  'reporting-lag': 'Slow / inaccurate reporting',
  'multi-entity-consolidation': 'Multi-entity consolidation pain',
  'inventory-visibility': 'No real-time inventory visibility',
  'compliance-audit': 'Compliance / audit burden',
  'integration-gaps': 'Disconnected systems / integration gaps',
  'scaling-bottleneck': "Current system can't scale",
  forecasting: 'Forecasting & cash visibility',
  other: 'Other',
};

const TARGET_GOLIVE_LABELS: Record<string, string> = {
  asap: 'within 90 days',
  '3-6m': 'in 3 to 6 months',
  '6-12m': 'in 6 to 12 months',
  '12m+': 'beyond 12 months',
  tbd: 'on a flexible timeline',
};

function fmt(s: string): string {
  return s.trim() + '\n';
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

export interface ProposalPricingBreakdown {
  baseAnnualLicense: number;
  geographyMultiplier: number;
  totalAnnualLicense: number;
  implementationServices: number;
  totalFirstYear: number;
  phases: ReadonlyArray<ProposalPricingPhase>;
  lineItems: ReadonlyArray<ProposalLineItem & { extendedAnnual: number; label: string }>;
  validityDays: number;
  validUntil: string;
}

/**
 * Compute the pricing breakdown without rendering markdown — so the
 * route layer can echo it back to the UI for the "review pricing
 * before generating" step in a future phase.
 */
export function computeProposalPricing(input: ProposalInput): ProposalPricingBreakdown {
  const geographyMultiplier =
    input.geographyMultiplier ?? DEFAULT_GEO_MULTIPLIER(input.geographyMultiEntity);
  const lineItems = input.modulesOfInterest.map((m) => {
    const perUser = input.perUserPricing[m.id] ?? input.defaultPerUserPrice;
    return {
      moduleId: m.id,
      label: m.label,
      perUserPrice: perUser,
      extendedAnnual: perUser * input.estimatedUsers,
    };
  });
  const baseAnnualLicense = lineItems.reduce((sum, li) => sum + li.extendedAnnual, 0);
  const totalAnnualLicense = baseAnnualLicense * geographyMultiplier;
  // Implementation services priced at 80% of annual licence as a
  // first-pass heuristic — overridable per firm in a later phase.
  const implementationServices = totalAnnualLicense * 0.8;
  const totalFirstYear = totalAnnualLicense + implementationServices;

  // Normalise phase split (so a firm passing 5/40/40/10 still works).
  const rawSplit = input.phaseSplit ?? DEFAULT_PHASE_SPLIT;
  const splitSum = Object.values(rawSplit).reduce((a, b) => a + b, 0);
  const normSplit: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawSplit)) {
    normSplit[k] = splitSum > 0 ? v / splitSum : 0;
  }
  const phases: ProposalPricingPhase[] = Object.entries(normSplit).map(([label, pct]) => ({
    label,
    amount: implementationServices * pct,
  }));

  const validityDays = input.validityDays ?? DEFAULT_VALIDITY_DAYS;
  const preparedDate = new Date(input.preparedAt);
  const validUntil = new Date(preparedDate.getTime() + validityDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return {
    baseAnnualLicense,
    geographyMultiplier,
    totalAnnualLicense,
    implementationServices,
    totalFirstYear,
    phases,
    lineItems,
    validityDays,
    validUntil,
  };
}

export function generateProposal(input: ProposalInput): Record<string, string> {
  const out: Record<string, string> = {};
  const pricing = computeProposalPricing(input);
  const painList = input.pains.length === 0
    ? ['Operational scale']
    : input.pains.map((p) => PAIN_LABELS[p] ?? p);
  const goLiveLabel = TARGET_GOLIVE_LABELS[input.targetGoLive] ?? input.targetGoLive;
  const decisionMaker = input.decisionMakerName?.trim() || 'Decision-maker';
  const preparedBy = input.preparedByName?.trim() || `${input.firmName} sales team`;
  const contactEmail = input.preparedByEmail?.trim() || '';

  // ── Cover_Letter (firm-customisable template) ──────────────────────────
  const coverTemplate = input.firmCoverLetterTemplate
    ? input.firmCoverLetterTemplate
    : `Dear {{decisionMaker}},

Thank you for considering {{firmName}} as your implementation partner for
{{adaptorName}}. We've built this proposal around the priorities you
shared with us — particularly {{topPain}} — and tailored the scope and
investment to your team size and timeline.

You'll find everything you need to make a decision in the documents
attached, including a detailed pricing schedule and a 5-phase
implementation approach designed to get you live {{goLiveLabel}}.

This proposal is valid through {{validUntil}}.

We're ready to start as soon as you give the go-ahead.

Sincerely,
{{preparedBy}}
{{firmName}}{{contactLine}}`;
  const cover = coverTemplate
    .replace(/\{\{decisionMaker\}\}/g, decisionMaker)
    .replace(/\{\{firmName\}\}/g, input.firmName)
    .replace(/\{\{adaptorName\}\}/g, input.adaptorName)
    .replace(/\{\{topPain\}\}/g, painList[0].toLowerCase())
    .replace(/\{\{goLiveLabel\}\}/g, goLiveLabel)
    .replace(/\{\{validUntil\}\}/g, pricing.validUntil)
    .replace(/\{\{preparedBy\}\}/g, preparedBy)
    .replace(/\{\{contactLine\}\}/g, contactEmail ? `\n${contactEmail}` : '');
  out['Proposal/Cover_Letter.docx'] = fmt(cover);

  // ── Executive_Summary ──────────────────────────────────────────────────
  out['Proposal/Executive_Summary.html'] = fmt(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Executive Summary — ${input.clientName}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:auto;padding:32px;color:#111;">
<h1 style="margin:0 0 4px;">Executive Summary</h1>
<p style="margin:0 0 24px;color:#666;font-size:13px;">${input.clientName} — prepared ${input.preparedAt} by ${input.firmName}</p>

<h2>Why now</h2>
<p>You're evaluating ${input.adaptorName} because the systems and processes you have today aren't keeping up. Specifically:</p>
<ul>${painList.map((p) => `<li>${p}</li>`).join('')}</ul>

<h2>What we're proposing</h2>
<p>A ${input.adaptorName} implementation covering ${input.modulesOfInterest.length} module${input.modulesOfInterest.length === 1 ? '' : 's'} for an estimated ${input.estimatedUsers} user${input.estimatedUsers === 1 ? '' : 's'} across ${input.estimatedLocations} location${input.estimatedLocations === 1 ? '' : 's'}. We aim to be live ${goLiveLabel}.</p>

<h2>Investment</h2>
<p>Total first-year investment: <strong>${dollars(pricing.totalFirstYear)}</strong></p>
<p style="font-size:13px;color:#666;">${dollars(pricing.totalAnnualLicense)} annual licences · ${dollars(pricing.implementationServices)} implementation services · valid through ${pricing.validUntil}</p>
</body></html>`);

  // ── Solution_Overview ──────────────────────────────────────────────────
  out['Proposal/Solution_Overview.html'] = fmt(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Solution Overview — ${input.clientName}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:auto;padding:32px;color:#111;">
<h1>Solution Overview</h1>
<p>The proposed ${input.adaptorName} configuration covers the following modules:</p>
<table style="width:100%;border-collapse:collapse;margin-top:16px;">
<thead><tr style="background:#f4f4f5;"><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Module</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Per-user (annual)</th><th style="text-align:left;padding:8px;border-bottom:1px solid #ddd;">Extended (${input.estimatedUsers}× users)</th></tr></thead>
<tbody>
${pricing.lineItems
  .map(
    (li) =>
      `<tr><td style="padding:8px;border-bottom:1px solid #f1f1f1;">${li.label}</td><td style="padding:8px;border-bottom:1px solid #f1f1f1;">${dollars(li.perUserPrice)}</td><td style="padding:8px;border-bottom:1px solid #f1f1f1;">${dollars(li.extendedAnnual)}</td></tr>`,
  )
  .join('\n')}
</tbody>
</table>
<p style="margin-top:16px;color:#666;font-size:13px;">Geography multiplier (${input.geographyMultiEntity}): <strong>${pricing.geographyMultiplier.toFixed(2)}×</strong></p>
<p><strong>Total annual licences: ${dollars(pricing.totalAnnualLicense)}</strong></p>
</body></html>`);

  // ── Implementation_Approach ───────────────────────────────────────────
  out['Proposal/Implementation_Approach.html'] = fmt(`
<!DOCTYPE html><html><head><meta charset="utf-8"><title>Implementation Approach — ${input.clientName}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:auto;padding:32px;color:#111;">
<h1>Implementation Approach</h1>
<p>${input.firmName} delivers ${input.adaptorName} engagements through a five-phase methodology that's been refined over hundreds of implementations:</p>

<ol>
<li><strong>Discovery</strong> — finalise scope, configure user roles, build the project plan.</li>
<li><strong>Configure</strong> — system build-out, data migration design, integration scaffolding.</li>
<li><strong>UAT</strong> — user acceptance testing, training, defect triage.</li>
<li><strong>Go-Live</strong> — cutover orchestration, hypercare standby, day-one support.</li>
<li><strong>Hypercare</strong> — 30-day stabilisation window before SLA handover.</li>
</ol>

<h2>Team structure</h2>
<ul>
<li>Project Manager (single point of accountability)</li>
<li>Project Lead (technical solution owner)</li>
<li>Functional consultant${input.modulesOfInterest.length > 2 ? 's' : ''} per workstream</li>
<li>Technical consultant for integrations and customisations</li>
<li>Hypercare engineer for the post-go-live window</li>
</ul>

<h2>Target timeline</h2>
<p>We are targeting go-live <strong>${goLiveLabel}</strong>.</p>
</body></html>`);

  // ── Pricing_Schedule ───────────────────────────────────────────────────
  const pricingMd = `# Pricing Schedule

**Prepared for:** ${input.clientName}
**Prepared on:** ${input.preparedAt}
**Valid through:** ${pricing.validUntil} (${pricing.validityDays} days)

## Annual licences
| Module | Per-user (annual) | Users | Extended |
| --- | --- | --- | --- |
${pricing.lineItems
  .map((li) => `| ${li.label} | ${dollars(li.perUserPrice)} | ${input.estimatedUsers} | ${dollars(li.extendedAnnual)} |`)
  .join('\n')}

Geography multiplier (${input.geographyMultiEntity}): **${pricing.geographyMultiplier.toFixed(2)}×**
Total annual licences: **${dollars(pricing.totalAnnualLicense)}**

## Implementation services
Priced at 80% of annual licences as a baseline. Phased payment terms below.

| Phase | Amount |
| --- | --- |
${pricing.phases.map((p) => `| ${p.label} | ${dollars(p.amount)} |`).join('\n')}

**Total implementation services: ${dollars(pricing.implementationServices)}**

## Total first-year investment
**${dollars(pricing.totalFirstYear)}**

## Payment terms
- 50% on phase kickoff (Discovery)
- 25% on UAT entry
- 25% on go-live
- Annual licence invoice issued on go-live date

This pricing is valid through ${pricing.validUntil}. Discounts may
require board-level sign-off and a Statement of Work amendment.
`;
  out['Proposal/Pricing_Schedule.docx'] = fmt(pricingMd);

  // ── Why_Us ─────────────────────────────────────────────────────────────
  const whyUs = input.firmWhyUs ?? `# Why ${input.firmName}

We focus exclusively on ${input.adaptorName} implementations. Our team
has delivered hundreds of engagements at firms ranging from
fast-growing startups to publicly-traded enterprises. Every project
ships with a complete SDF/Bundle artifact set, role + permission
matrix, training documentation, and a 30-day hypercare window
before SLA handover.

When you choose ${input.firmName}, you get:

- A named Project Manager with a track record on engagements like yours
- Daily transparency into progress through our client portal
- A complete, auditable trail of decisions and configuration changes
- A clean SLA-ready handover with documentation that doesn't require
  us to be in the room to be useful

You can edit this section in **Settings → Proposal Templates → Why Us**.`;
  out['Proposal/Why_Us.docx'] = fmt(whyUs);

  // ── Terms_and_Conditions ──────────────────────────────────────────────
  const tc = input.firmTermsAndConditions ?? `# Terms and Conditions (Summary)

This is a high-level summary. The signed Statement of Work supersedes
this document for legal purposes.

## Scope
The scope of this engagement is described in the accompanying Solution
Overview document. Out-of-scope work requires a written change order
and may incur additional fees.

## Pricing & Validity
Pricing is valid for ${pricing.validityDays} days from the date of this
proposal. Annual licence fees are invoiced upfront and are
non-refundable once the engagement enters Configure.

## Term & Termination
Either party may terminate the engagement with 30 days written notice.
Work completed prior to termination is invoiced pro-rata.

## Confidentiality
${input.firmName} treats all client data as confidential. Standard
mutual NDA terms apply unless a separate NDA is in force.

## Liability
Aggregate liability is capped at fees paid in the preceding 12
months. Indirect, consequential, and punitive damages are excluded.

You can edit this section in **Settings → Proposal Templates → Terms**.`;
  out['Proposal/Terms_and_Conditions.docx'] = fmt(tc);

  return out;
}
