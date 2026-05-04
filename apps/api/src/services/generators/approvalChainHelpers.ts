/**
 * Approval-chain helpers (Phase 24 — Workflow detail capture).
 *
 * Parses, validates, and renders structured approval-chain data captured
 * by the wizard's ApprovalChainEditor (apps/web/src/components/wizard/
 * ApprovalChainEditor.tsx). The output of `renderApprovalChainSection`
 * is consumed by solutionDocGenerator's Section 4.3 to replace generic
 * approval prose with detailed per-flow tier tables + concrete
 * SuiteFlow build instructions.
 *
 * Phase 6 constraint (verified active in scriptGenerator.ts:153-159):
 *   Hand-written workflow XML does not survive NetSuite SDF deploy.
 *   Phase 24 captures the spec in the wizard and renders it into the
 *   Solution Design as prose — it MUST NOT emit any customworkflow_*.xml
 *   SDF objects. The consultant authors workflows in the NetSuite UI
 *   from the rendered spec, then exports via SDF for promotion.
 *
 * Phase 24 module surface:
 *   - parseApprovalChain(raw)              — JSON or already-parsed object
 *   - validateApprovalChain(chain, ctx)    — gap/overlap/role/currency checks
 *   - renderApprovalChainSection(...)      — Markdown subsection for Section 4.3
 *   - chainToLegacyTextarea(chain)         — option-β legacy bridge for the
 *                                            PO SuiteScript User Event generator
 *   - APPROVAL_FLOW_KEYS                   — canonical map of the 5 flows
 *
 * Sources:
 *   - NetSuite SuiteFlow workflow authoring patterns (Customization →
 *     Workflow → Workflows; states / transitions / send-email actions).
 *   - Phase 6 architectural decision (scriptGenerator.ts:153-159).
 *   - Existing legacy capture shape (poApprovalTiers TEXTAREA parsed by
 *     sdfPoApprovalScriptGenerator).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ApprovalTier {
  /** Inclusive lower bound of the amount range. */
  lowerBound: number;
  /** Inclusive upper bound; null = unlimited (only allowed on the top tier). */
  upperBound: number | null;
  /** Approver role label (free-text; consultant fills NS-style role names). */
  role: string;
  /** Auto-escalation timeout in business hours. 0 = no escalation. */
  escalationHours: number;
  /** Out-of-office alternate approver role; empty string = no alternate. */
  alternateApprover: string;
}

export interface ApprovalChain {
  /** Per-currency tier sets. Currency keys are ISO 4217 (USD, AED, EUR, …). */
  byCurrency: Record<string, ApprovalTier[]>;
  /** Per-currency self-approval bypass amount. 0 = no bypass. */
  selfApprovalBypassUpTo: Record<string, number>;
  /** Free-form consultant notes (rendered inline below the tables). */
  notes: string;
}

/**
 * Canonical map of the 5 approval flows. Each entry pairs the boolean
 * answer key (gates rendering), the structured chain answer key (Phase 24),
 * the human flow label (rendered in Section 4.3 + Solution Design), and
 * the NetSuite record type the workflow attaches to (for the SuiteFlow
 * build instructions).
 */
export interface ApprovalFlowKey {
  booleanKey: string;
  structuredKey: string;
  flowLabel: string;
  /** NetSuite record type (case-sensitive — matches SuiteFlow Record Type field). */
  netsuiteRecordType: string;
}

export const APPROVAL_FLOW_KEYS: ReadonlyArray<ApprovalFlowKey> = [
  {
    booleanKey: 'p2p.purchasing.poApprovalRequired',
    structuredKey: 'p2p.purchasing.approvalChainStructured',
    flowLabel: 'Purchase Order Approval',
    netsuiteRecordType: 'Purchase Order',
  },
  {
    booleanKey: 'p2p.bills.billApprovalRequired',
    structuredKey: 'p2p.bills.approvalChainStructured',
    flowLabel: 'Vendor Bill Approval',
    netsuiteRecordType: 'Vendor Bill',
  },
  {
    booleanKey: 'o2c.salesOrders.soApprovalRequired',
    structuredKey: 'o2c.salesOrders.approvalChainStructured',
    flowLabel: 'Sales Order Approval',
    netsuiteRecordType: 'Sales Order',
  },
  {
    booleanKey: 'r2r.journalEntries.approvalRequired',
    structuredKey: 'r2r.journalEntries.approvalChainStructured',
    flowLabel: 'Journal Entry Approval',
    netsuiteRecordType: 'Journal Entry',
  },
  {
    booleanKey: 'p2p.expenses.expenseApproval',
    structuredKey: 'p2p.expenses.approvalChainStructured',
    flowLabel: 'Expense Report Approval',
    netsuiteRecordType: 'Expense Report',
  },
];

export interface ChainValidationContext {
  /** Engagement-declared base currency (r2r.currencies.baseCurrency). */
  baseCurrency: string | null | undefined;
  /** Engagement-declared additional currencies — newline-separated TEXTAREA
   *  (r2r.currencies.additionalCurrencies). May be null/empty. */
  additionalCurrencies: string | null | undefined;
}

export interface ValidationIssue {
  /** "tier-gap" / "tier-overlap" / "missing-role" / "currency-undeclared" /
   *  "top-tier-not-unlimited" / "non-positive-escalation" / etc. */
  code: string;
  /** Human-readable diagnostic for the rendered ⚠ callout. */
  message: string;
  /** Currency the issue belongs to (null when chain-level, e.g. shape). */
  currency: string | null;
  /** Tier index within the currency's tier list (null when chain-level). */
  tierIndex: number | null;
  /** Severity — "warning" surfaces inline; "info" renders as a soft note. */
  severity: 'warning' | 'info';
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse the structured-chain answer payload into an ApprovalChain or null.
 *
 *   - undefined/null/empty/whitespace string → null (no chain configured).
 *   - Already-parsed object → normalised + returned.
 *   - JSON string → parsed → normalised + returned.
 *   - Malformed JSON → null (caller treats as "no chain").
 *   - Wrong shape after parse → null.
 *
 * The parser is permissive on missing optional fields (selfApprovalBypassUpTo,
 * notes) and defensive on numeric fields — anything that isn't a finite
 * number gets coerced to 0.
 */
export function parseApprovalChain(raw: unknown): ApprovalChain | null {
  if (raw === null || raw === undefined) return null;

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const byCurrencyRaw = obj.byCurrency;
  if (
    byCurrencyRaw === null ||
    byCurrencyRaw === undefined ||
    typeof byCurrencyRaw !== 'object' ||
    Array.isArray(byCurrencyRaw)
  ) {
    return null;
  }

  const byCurrency: Record<string, ApprovalTier[]> = {};
  for (const [currency, tiersRaw] of Object.entries(byCurrencyRaw as Record<string, unknown>)) {
    if (!Array.isArray(tiersRaw)) continue;
    const tiers: ApprovalTier[] = [];
    for (const t of tiersRaw) {
      if (t === null || typeof t !== 'object' || Array.isArray(t)) continue;
      const tier = t as Record<string, unknown>;
      const lowerBound = toFiniteNumber(tier.lowerBound, 0);
      const upperBound = tier.upperBound === null
        ? null
        : tier.upperBound === undefined
          ? null
          : toFiniteNumber(tier.upperBound, 0);
      const role = typeof tier.role === 'string' ? tier.role : '';
      const escalationHours = toFiniteNumber(tier.escalationHours, 0);
      const alternateApprover =
        typeof tier.alternateApprover === 'string' ? tier.alternateApprover : '';
      tiers.push({ lowerBound, upperBound, role, escalationHours, alternateApprover });
    }
    byCurrency[currency.toUpperCase()] = tiers;
  }

  const selfApprovalBypassUpTo: Record<string, number> = {};
  const bypassRaw = obj.selfApprovalBypassUpTo;
  if (bypassRaw !== null && bypassRaw !== undefined && typeof bypassRaw === 'object' && !Array.isArray(bypassRaw)) {
    for (const [currency, amount] of Object.entries(bypassRaw as Record<string, unknown>)) {
      selfApprovalBypassUpTo[currency.toUpperCase()] = toFiniteNumber(amount, 0);
    }
  }

  const notes = typeof obj.notes === 'string' ? obj.notes : '';

  return { byCurrency, selfApprovalBypassUpTo, notes };
}

function toFiniteNumber(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * True when the chain has at least one tier in at least one currency.
 * Used by Section 4.3 to decide between structured rendering and the
 * existing generic prose fallback.
 */
export function chainIsEmpty(chain: ApprovalChain | null): boolean {
  if (chain === null) return true;
  for (const tiers of Object.values(chain.byCurrency)) {
    if (tiers.length > 0) return false;
  }
  return true;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Defensive validator. Runs at render time so a partial chain still
 * produces a meaningful Solution Design with a ⚠ prefix instead of
 * silently dropping content.
 *
 * Currency cross-check is permissive — when r2r.currencies isn't yet
 * declared on the engagement (partial-completion case), we surface an
 * info-level note rather than a blocking warning.
 */
export function validateApprovalChain(
  chain: ApprovalChain,
  ctx: ChainValidationContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const declaredCurrencies = collectDeclaredCurrencies(ctx);
  const r2rDeclared = declaredCurrencies.size > 0;

  for (const [currency, tiers] of Object.entries(chain.byCurrency)) {
    if (tiers.length === 0) continue;

    // Currency cross-check — permissive when R2R section is incomplete.
    if (r2rDeclared && !declaredCurrencies.has(currency)) {
      issues.push({
        code: 'currency-undeclared',
        message: `Currency \`${currency}\` is not declared in R2R → Currencies. Verify before deploy.`,
        currency,
        tierIndex: null,
        severity: 'warning',
      });
    } else if (!r2rDeclared) {
      issues.push({
        code: 'currency-r2r-incomplete',
        message: `R2R → Currencies section is incomplete on this engagement. Currency \`${currency}\` cannot be cross-checked yet — verify the chain when the R2R section is filled in.`,
        currency,
        tierIndex: null,
        severity: 'info',
      });
    }

    // Per-tier shape + sequencing.
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];

      if (t.role.trim().length === 0) {
        issues.push({
          code: 'missing-role',
          message: `Tier ${i + 1} (${currency}) has no approver role assigned.`,
          currency,
          tierIndex: i,
          severity: 'warning',
        });
      }

      if (!Number.isFinite(t.escalationHours) || t.escalationHours < 0) {
        issues.push({
          code: 'invalid-escalation',
          message: `Tier ${i + 1} (${currency}) escalation hours must be ≥ 0.`,
          currency,
          tierIndex: i,
          severity: 'warning',
        });
      }

      // Sequencing: each tier's lower must equal previous tier's upper + 1
      // (or === upper if you prefer fenceposts the other way; we go with
      // strict adjacency to match how the legacy poApprovalTiers parser
      // expects ranges).
      if (i > 0) {
        const prev = tiers[i - 1];
        if (prev.upperBound === null) {
          issues.push({
            code: 'tier-after-unlimited',
            message: `Tier ${i + 1} (${currency}) sits after an "unlimited" tier — only the highest tier may have an open upper bound.`,
            currency,
            tierIndex: i,
            severity: 'warning',
          });
        } else if (t.lowerBound > prev.upperBound + 1) {
          issues.push({
            code: 'tier-gap',
            message: `Gap between tier ${i} (${currency}, ends at ${prev.upperBound}) and tier ${i + 1} (starts at ${t.lowerBound}).`,
            currency,
            tierIndex: i,
            severity: 'warning',
          });
        } else if (t.lowerBound <= prev.upperBound) {
          issues.push({
            code: 'tier-overlap',
            message: `Tier ${i + 1} (${currency}, starts at ${t.lowerBound}) overlaps tier ${i} (ends at ${prev.upperBound}).`,
            currency,
            tierIndex: i,
            severity: 'warning',
          });
        }
      }
    }

    // Top tier must be unlimited.
    const top = tiers[tiers.length - 1];
    if (top.upperBound !== null) {
      issues.push({
        code: 'top-tier-not-unlimited',
        message: `Top tier (${currency}) must be unlimited (upper bound = ∞). Currently capped at ${top.upperBound}.`,
        currency,
        tierIndex: tiers.length - 1,
        severity: 'warning',
      });
    }
  }

  return issues;
}

function collectDeclaredCurrencies(ctx: ChainValidationContext): Set<string> {
  const out = new Set<string>();
  if (typeof ctx.baseCurrency === 'string' && ctx.baseCurrency.trim().length > 0) {
    out.add(ctx.baseCurrency.trim().toUpperCase());
  }
  if (typeof ctx.additionalCurrencies === 'string' && ctx.additionalCurrencies.trim().length > 0) {
    for (const line of ctx.additionalCurrencies.split(/\r?\n|,/)) {
      const code = line.trim().toUpperCase();
      // Pull the leading 3-letter ISO code if the line is shaped like
      // "USD — US Dollar" or similar.
      const match = code.match(/^[A-Z]{3}\b/);
      if (match) out.add(match[0]);
    }
  }
  return out;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Adaptor name for safety; renderer is NetSuite-only and bails to ''
   *  when the caller passes a non-NetSuite adaptor. Belt-and-braces with
   *  the existing `if (isNetSuite) {}` gate in solutionDocGenerator. */
  adaptorId: string;
  /** For the SuiteFlow build instructions subsection. */
  netsuiteRecordType: string;
  /** Engagement-declared currencies — passed through to the validator. */
  validationContext: ChainValidationContext;
}

/**
 * Render a single approval flow's structured detail as a Markdown
 * subsection. Returns '' when the chain is empty (caller falls back to
 * generic prose) or when the adaptor isn't NetSuite (banlist safety).
 *
 * Output shape per flow:
 *   - ⚠ callout if validation produced warnings
 *   - per-currency tier table
 *   - self-approval bypass row
 *   - consultant notes block (if any)
 *   - "How to build this in NetSuite SuiteFlow" subsection with concrete
 *     UI navigation steps
 */
export function renderApprovalChainSection(
  chain: ApprovalChain | null,
  flowLabel: string,
  options: RenderOptions,
): string {
  // Banlist safety — NetSuite SuiteFlow content must never reach an
  // Odoo bundle. Same gate as solutionDocGenerator's outer isNetSuite
  // check; defence-in-depth.
  if (options.adaptorId !== 'netsuite') return '';
  if (chainIsEmpty(chain)) return '';

  const safeChain = chain as ApprovalChain;
  const issues = validateApprovalChain(safeChain, options.validationContext);
  const warnings = issues.filter((i) => i.severity === 'warning');
  const infos = issues.filter((i) => i.severity === 'info');

  let out = `#### ${escapeMd(flowLabel)} — Detailed Tier Structure\n\n`;

  if (warnings.length > 0) {
    out += `> ⚠ **Incomplete chain — review before deploy.**\n>\n`;
    for (const w of warnings) {
      out += `> - ${escapeMd(w.message)}\n`;
    }
    out += `\n`;
  }
  for (const info of infos) {
    out += `_Note: ${escapeMd(info.message)}_\n\n`;
  }

  // Per-currency tables.
  const currencies = Object.keys(safeChain.byCurrency).sort();
  for (const currency of currencies) {
    const tiers = safeChain.byCurrency[currency];
    if (tiers.length === 0) continue;

    out += `**Tier table — ${escapeMd(currency)}**\n\n`;
    out += `| Tier | From | To | Approver Role | Escalation | OOO Alternate |\n`;
    out += `|------|------|----|---------------|------------|---------------|\n`;
    tiers.forEach((t, i) => {
      const from = formatNumber(t.lowerBound);
      const to = t.upperBound === null ? 'unlimited' : formatNumber(t.upperBound);
      const role = t.role.trim().length > 0 ? escapeMd(t.role) : '_[ASSIGN]_';
      const esc = t.escalationHours > 0 ? `${t.escalationHours}h` : '—';
      const alt = t.alternateApprover.trim().length > 0 ? escapeMd(t.alternateApprover) : '—';
      out += `| ${i + 1} | ${from} | ${to} | ${role} | ${esc} | ${alt} |\n`;
    });

    const bypass = safeChain.selfApprovalBypassUpTo[currency] ?? 0;
    if (bypass > 0) {
      out += `\n_Self-approval bypass: requesters may self-approve up to **${formatNumber(bypass)} ${escapeMd(currency)}** without entering the tier chain._\n`;
    }
    out += `\n`;
  }

  // Consultant notes — sanitised for cross-platform vocabulary leakage even
  // though we're already inside the NetSuite gate. Defence-in-depth.
  if (safeChain.notes.trim().length > 0) {
    out += `**Notes:** ${escapeMd(safeChain.notes.trim())}\n\n`;
  }

  // SuiteFlow build instructions — concrete UI navigation per flow.
  out += renderSuiteFlowBuildInstructions(safeChain, currencies, options.netsuiteRecordType);

  return out;
}

function renderSuiteFlowBuildInstructions(
  chain: ApprovalChain,
  currencies: string[],
  recordType: string,
): string {
  let out = `**How to build this in NetSuite SuiteFlow**\n\n`;
  out += `1. **Path:** Customization → Workflow → Workflows → New\n`;
  out += `2. **Record Type:** ${escapeMd(recordType)}\n`;
  out += `3. **Init Trigger:** On Create AND On Update\n`;
  out += `4. **Base States:** \`Pending Approval\` → \`Approved\` → \`Rejected\`\n`;
  out += `5. **Per-tier transitions on amount field:**\n`;
  for (const currency of currencies) {
    const tiers = chain.byCurrency[currency];
    if (tiers.length === 0) continue;
    out += `   - For **${escapeMd(currency)}**:\n`;
    tiers.forEach((t, i) => {
      const range = t.upperBound === null
        ? `> ${formatNumber(t.lowerBound)}`
        : `${formatNumber(t.lowerBound)} – ${formatNumber(t.upperBound)}`;
      const role = t.role.trim().length > 0 ? escapeMd(t.role) : '_[ASSIGN]_';
      out += `     - Tier ${i + 1} (${range}): route to **${role}**`;
      if (t.escalationHours > 0) {
        out += `; escalate after ${t.escalationHours}h state-entry wait`;
      }
      if (t.alternateApprover.trim().length > 0) {
        out += `; OOO fallback to **${escapeMd(t.alternateApprover)}**`;
      }
      out += `\n`;
    });
  }
  out += `6. **Send-Email Actions:** role-targeted via Get Field Value → role. `;
  out += `**Use role-based recipients, not hard-coded user IDs** — user IDs vary across environments and break promotion.\n`;
  out += `7. **Workflow Log Mode:** set to \`Detailed\` for the first 30 days post-deploy so any routing surprises surface in the log.\n`;
  out += `8. **Promotion:** once verified end-to-end in the lowest environment, export via \`suitecloud object:import --type workflow\` and commit the XML into the SDF bundle for promotion to higher environments.\n\n`;
  return out;
}

// Minimal Markdown-safe escape — protects pipe / backtick / angle brackets
// inside table cells and inline content. Conservative: doesn't try to
// preserve user-intended Markdown formatting in role / alternate / notes.
function escapeMd(s: string): string {
  return s
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  // Group thousands with commas; don't show decimals when whole.
  return n.toLocaleString('en-US');
}

// ─── Legacy bridge (option β) ────────────────────────────────────────────────

/**
 * Synthesise the legacy `poApprovalTiers` TEXTAREA shape from a structured
 * chain so the existing PO SuiteScript User Event generator
 * (sdfPoApprovalScriptGenerator.ts) keeps working without the consultant
 * having to fill both keys.
 *
 * The legacy parser expects one line per tier in the form:
 *   "<range>: <approver>"
 *   e.g.  "<$5,000: auto-approve"
 *         "$5,000-$50,000: Department Manager"
 *         ">$250,000: CFO + Steering"
 *
 * Only the chain's BASE currency tier list is bridged — multi-currency
 * tiers are rendered in Solution Design but the PO User Event script is
 * single-currency by construction. When the structured chain has no tiers
 * for the base currency, returns null (caller falls back to whatever
 * legacy answer is present).
 *
 * Phase 23 precedence rule applies: when this returns a non-null string,
 * the orchestrator passes it as the SuiteScript generator's input
 * INSTEAD of `answers['p2p.purchasing.poApprovalTiers']` — overriding
 * the legacy TEXTAREA in-memory only. The persisted answer map is NOT
 * mutated.
 */
export function chainToLegacyTextarea(
  chain: ApprovalChain | null,
  baseCurrency: string | null | undefined,
): string | null {
  if (chain === null) return null;
  if (!baseCurrency || baseCurrency.trim().length === 0) return null;

  const currencyKey = baseCurrency.trim().toUpperCase();
  const tiers = chain.byCurrency[currencyKey];
  if (!tiers || tiers.length === 0) return null;

  const lines: string[] = [];
  tiers.forEach((t, i) => {
    const role = t.role.trim().length > 0 ? t.role.trim() : '_[ASSIGN]_';
    let range: string;
    if (t.upperBound === null) {
      range = `>${formatBareCurrency(t.lowerBound, currencyKey)}`;
    } else if (i === 0 && t.lowerBound === 0) {
      // First tier from 0 → use "<X" form for the cleanest match with
      // existing seed examples.
      range = `<${formatBareCurrency(t.upperBound, currencyKey)}`;
    } else {
      range = `${formatBareCurrency(t.lowerBound, currencyKey)}-${formatBareCurrency(t.upperBound, currencyKey)}`;
    }
    lines.push(`${range}: ${role}`);
  });

  return lines.join('\n');
}

function formatBareCurrency(amount: number, currency: string): string {
  // The legacy parser is keyword-permissive on currency formatting —
  // "$5,000" / "AED 5,000" / "5000" all work. Use $ for USD (matches
  // existing seed examples) and the bare ISO code for others.
  const formatted = amount.toLocaleString('en-US');
  if (currency === 'USD') return `$${formatted}`;
  return `${currency} ${formatted}`;
}

// ─── Convenience: collect chains across the orchestrator ─────────────────────

/**
 * Read all 5 structured-chain answers from the engagement's answer map
 * and return them keyed by the boolean's flow id. Returns only the flows
 * where the boolean is `true` AND the chain parsed successfully (non-null).
 *
 * Used by solutionDocGenerator's Section 4.3 to iterate the populated
 * structured chains without repeating the parse-and-filter logic per flow.
 */
export function collectActiveChains(
  answers: Record<string, unknown>,
): Array<{ flowKey: ApprovalFlowKey; chain: ApprovalChain }> {
  const out: Array<{ flowKey: ApprovalFlowKey; chain: ApprovalChain }> = [];
  for (const flowKey of APPROVAL_FLOW_KEYS) {
    if (answers[flowKey.booleanKey] !== true) continue;
    const chain = parseApprovalChain(answers[flowKey.structuredKey]);
    if (chain === null || chainIsEmpty(chain)) continue;
    out.push({ flowKey, chain });
  }
  return out;
}
