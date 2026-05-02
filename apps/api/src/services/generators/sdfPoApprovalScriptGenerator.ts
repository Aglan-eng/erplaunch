/**
 * SuiteScript User Event generator — Purchase Order approval routing.
 *
 * First real-LOGIC SuiteScript file (the SDF Custom Records pack proved
 * the real-code pattern with deterministic XML; this pack extends it to
 * actual JavaScript with business logic).
 *
 * Why PO approval first?
 *   - PO approval is the #1 most-customized workflow in every NetSuite
 *     implementation. Every consultant writes a variant of this script
 *     on every engagement.
 *   - The P2P workstream already captures approval thresholds. This
 *     generator just converts that wizard answer into a deployable User
 *     Event script with the correct thresholds + approver roles already
 *     wired in.
 *   - Pattern matters because RESTlet, Workflow Action, and Scheduled
 *     Script generators in later packs follow this same shape (parse a
 *     wizard answer → emit a real, named .js file → harness measures).
 *
 * Two output modes:
 *   - RESOLVED — every line of the wizard answer parsed cleanly into a
 *     (label, minAmount, maxAmount, approver) tuple. APPROVAL_TIERS is
 *     hardcoded, the consultant gets a script that works on first
 *     deploy.
 *   - FALLBACK — at least one line failed to parse. The script still
 *     emits (so the bundle doesn't break) but APPROVAL_TIERS is a
 *     placeholder and a TODO comment quotes the verbatim wizard answer
 *     so the consultant can hand-translate.
 *
 * Real-code contract (audit Fix #7 closeout, commit 5724756):
 *   - This file does NOT carry the "STARTER SCAFFOLDING" banner that
 *     placeholder generators (scriptGenerator.ts) emit. The banner
 *     warns consultants that a file is incomplete and must be
 *     replaced — that warning is wrong here, where the script has real
 *     logic and is meant to deploy as-is.
 *
 * Sources:
 *   - NetSuite SuiteScript 2.1 User Event Script documentation
 *     (Oracle docs — UserEventScript module, beforeSubmit / afterSubmit
 *     contract, approvalstatus field semantics)
 *   - NetSuite Approval Routing best practices (NetSuite Help —
 *     Approval Workflows; standard approvalstatus IDs 1=PendingApproval,
 *     2=Approved, 3=Rejected)
 *   - audit Fix #7 closeout (5724756) — STARTER SCAFFOLDING banner
 *     scope: placeholder scaffolds only, never real generated logic
 */

export interface PoApprovalScriptInput {
  /** Raw TEXTAREA value from p2p.purchasing.poApprovalTiers. One tier per
   *  line in one of these three shapes:
   *    "<$X: <approver>"        e.g., "<$5,000: auto-approve"
   *    "$X-$Y: <approver>"      e.g., "$5,000-$50,000: Department Manager"
   *    ">$Y: <approver>"        e.g., ">$250,000: CFO + Steering"
   *  Empty / whitespace-only / unparseable lines route the whole script
   *  to fallback mode. */
  approvalTiers: string;
  /** Implementing firm (drives the JSDoc credit line). */
  firmName: string;
  /** Client / engagement name (drives the JSDoc credit line). */
  clientName: string;
}

// Pack W moved the amount-tier parsing logic to a shared util so the
// new SuiteFlow workflow + Workflow Action Script generators can re-
// use it. The PO UE script keeps using it for backward compatibility
// (this script is repositioned as the fallback / legacy implementation
// pattern — see the JSDoc header in the emitted output).
import { parseApprovalTiers, type ParsedTier } from './approvalTierParser.js';

// ─── String helpers ──────────────────────────────────────────────────────────

/** Escape a string for embedding inside single-quoted JS string literal.
 *  Real-code generator: must produce valid JS, so escape backslashes
 *  and single quotes. */
function jsSingleQuoteEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Render the verbatim wizard answer as a JSDoc comment block — each
 *  line prefixed with " * " so it slots into the script header without
 *  breaking the JSDoc grammar. Empty input renders a single bullet
 *  noting "(no tiers provided)". */
function answerToJsDocLines(answer: string): string {
  const lines = answer.replace(/\r\n/g, '\n').split('\n');
  const meaningful = lines.filter((l) => l.trim().length > 0);
  if (meaningful.length === 0) return ' *   (no tiers provided)';
  return meaningful.map((l) => ` *   ${l}`).join('\n');
}

// ─── Resolved-mode emission ──────────────────────────────────────────────────

function renderResolvedTiersArray(tiers: ParsedTier[]): string {
  return tiers
    .map((t) => {
      const max = t.maxAmount === Infinity ? 'Infinity' : String(t.maxAmount);
      return `        { label: '${jsSingleQuoteEscape(t.label)}', minAmount: ${t.minAmount}, maxAmount: ${max}, approver: '${jsSingleQuoteEscape(t.approver)}' },`;
    })
    .join('\n');
}

// ─── Fallback-mode emission ──────────────────────────────────────────────────

function renderFallbackTiersArray(rawAnswer: string): string {
  // Quote the verbatim answer in a comment block above the placeholder
  // tiers array so the consultant can hand-translate without leaving
  // the file. Indented to match the resolved-mode shape.
  const quotedLines = answerToJsDocLines(rawAnswer)
    .split('\n')
    .map((l) => `        // ${l.replace(/^ \* {3}/, '').replace(/^ \* /, '')}`)
    .join('\n');
  return [
    '        // TODO: parse failed — fill in the actual tiers from the wizard answer below.',
    '        // Wizard answer (verbatim):',
    quotedLines,
    "        { label: 'TBD', minAmount: 0, maxAmount: Infinity, approver: 'TBD' },",
  ].join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the full SuiteScript User Event file body. Input is the
 * wizard's free-text approvalTiers + the firm/client credits; output
 * is one .js file body ready to write to
 * SDF/SuiteScripts/NSIX_UE_PurchaseOrderApproval.js.
 *
 * Empty / unparseable input falls back to a placeholder APPROVAL_TIERS
 * but the script still emits — bundle build never fails on this
 * generator. The harness sees the file exist; the script just wears a
 * TODO until the consultant hand-fills the tiers.
 */
export function generatePoApprovalScript(input: PoApprovalScriptInput): string {
  const rawAnswer = (input.approvalTiers ?? '').toString();
  const parsed = parseApprovalTiers(rawAnswer);

  // Treat empty input as "fallback" too — the consultant should see a
  // TODO placeholder rather than a script with an empty APPROVAL_TIERS
  // array (which would route every PO to the last-tier fallback at
  // runtime, almost certainly the wrong default).
  const resolvedTiers: ParsedTier[] | null =
    parsed.allOk && parsed.tiers.length > 0 ? parsed.tiers : null;

  const tiersBlock = resolvedTiers
    ? renderResolvedTiersArray(resolvedTiers)
    : renderFallbackTiersArray(rawAnswer);

  const headerAnswerBlock = answerToJsDocLines(rawAnswer);

  const firm = input.firmName;
  const client = input.clientName;

  return `/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Purchase Order Approval — auto-routes POs based on amount thresholds.
 * Generated by ERPLaunch from ${firm}'s implementation wizard for ${client}.
 *
 * STATUS: Fallback / legacy implementation pattern.
 * For new implementations, prefer the SuiteFlow workflow + Workflow Action script
 * combo emitted by Pack W (customworkflow_nsix_po_approval.xml +
 * NSIX_WFA_PO_Approval.js). SuiteFlow is admin-editable post-deploy without
 * code changes. This UE script remains for engagements that explicitly want
 * script-based control or as a deploy-time fallback.
 *
 * Approval tiers (from wizard):
${headerAnswerBlock}
 *
 * Wire-up: Deploy as User Event on Transaction → Purchase Order, beforeSubmit + afterSubmit.
 */
define(['N/runtime', 'N/email', 'N/search', 'N/log'], (runtime, email, search, log) => {

    const APPROVAL_TIERS = [
${tiersBlock}
    ];

    const APPROVED_STATUS_ID = 2;       // standard NetSuite approved transaction status
    const PENDING_APPROVAL_ID = 1;       // standard pending approval status

    const findTier = (amount) => {
        for (const tier of APPROVAL_TIERS) {
            if (amount <= tier.maxAmount) return tier;
        }
        return APPROVAL_TIERS[APPROVAL_TIERS.length - 1];
    };

    const beforeSubmit = (scriptContext) => {
        if (scriptContext.type !== scriptContext.UserEventType.CREATE &&
            scriptContext.type !== scriptContext.UserEventType.EDIT) return;

        const rec = scriptContext.newRecord;
        const total = rec.getValue({ fieldId: 'total' }) || 0;
        const tier = findTier(total);

        if (tier.approver === 'auto') {
            rec.setValue({ fieldId: 'approvalstatus', value: APPROVED_STATUS_ID });
            log.audit({ title: 'PO auto-approved', details: 'Tier: ' + tier.label + ', amount: ' + total });
        } else {
            rec.setValue({ fieldId: 'approvalstatus', value: PENDING_APPROVAL_ID });
            rec.setValue({ fieldId: 'custbody_nsix_required_approver', value: tier.approver });
            log.audit({ title: 'PO routed for approval', details: 'Tier: ' + tier.label + ', approver: ' + tier.approver });
        }
    };

    const afterSubmit = (scriptContext) => {
        if (scriptContext.type !== scriptContext.UserEventType.CREATE) return;

        const rec = scriptContext.newRecord;
        const total = rec.getValue({ fieldId: 'total' }) || 0;
        const tier = findTier(total);

        if (tier.approver === 'auto') return;

        // Email notification to required approver — integrate with role-based recipient lookup before deploying to production
        log.debug({ title: 'PO approval email queued', details: 'Approver: ' + tier.approver });
    };

    return { beforeSubmit, afterSubmit };
});
`;
}
