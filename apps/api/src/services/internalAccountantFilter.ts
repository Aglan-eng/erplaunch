/**
 * Phase 43.2 — INTERNAL_ACCOUNTANT field-level filter.
 *
 * The accountant role has READ on ENGAGEMENT_META + WRITE on BILLING
 * but NONE on the rest. The dashboard list endpoint must still return
 * something for them so they can navigate; this helper strips the
 * non-billing-shaped fields from the engagement payload before send.
 *
 * Pure function — takes the raw engagement object and returns a
 * filtered copy. The caller decides whether to apply it (after
 * checking the user's roles).
 *
 * What stays:
 *   id, firmId, clientName, status, startDate, contractEndDate,
 *   adaptorId, createdAt, updatedAt — the structural/metadata
 *   columns the dashboard needs to render the row.
 *
 *   billing.* (any future billing-shaped field) — this is what the
 *   accountant actually cares about. Not in the schema today; the
 *   filter forwards it as-is when present.
 *
 * What goes:
 *   members, conflicts, profile (answers), jobs, anything else
 *   that came in via enrichEngagement(). The accountant has no
 *   business reading the wizard answers or risk register.
 */

const KEEP_FIELDS = new Set<string>([
  'id',
  'firmId',
  'clientName',
  'status',
  'startDate',
  'contractEndDate',
  'adaptorId',
  'createdAt',
  'updatedAt',
  'previousStatus',
  // Phase 44.2 — accountants need a billing-shaped view. License
  // summary tells them what the firm is paying for; member list
  // (kept read-only via the matrix's NONE on MEMBERS write) tells
  // them who to invoice. Both are nested objects added by
  // enrichEngagement; KEEP_FIELDS forwards them verbatim.
  'license',
  'members',
  // Billing keys (future-proofed — none exist on the schema today,
  // but we keep them when they land so the field-level filter
  // doesn't need updating then).
  'billingPlan',
  'billingMonthlyRate',
  'billingCurrency',
  'billingContactEmail',
  'billingNextInvoiceAt',
  'billingPaidThrough',
]);

/** Apply the accountant filter to a single engagement object. */
export function filterEngagementForAccountant<T extends Record<string, unknown>>(
  engagement: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(engagement)) {
    if (KEEP_FIELDS.has(k)) {
      (out as Record<string, unknown>)[k] = v;
    }
    // Forward any nested `billing` object verbatim — the schema may
    // grow a billing sub-object later (e.g. invoice line items).
    if (k === 'billing') {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/** Apply the accountant filter to a list of engagements. */
export function filterEngagementListForAccountant<T extends Record<string, unknown>>(
  engagements: ReadonlyArray<T>,
): Array<Partial<T>> {
  return engagements.map((e) => filterEngagementForAccountant(e));
}

/**
 * Phase 44.2 — decide whether the field-strip should apply.
 *
 * Returns true when the user holds INTERNAL_ACCOUNTANT (firm-level)
 * AND has no other engagement-level role on the engagement that
 * would entitle them to the full payload. Mixed-role users (e.g.
 * an accountant who's ALSO a PROJECT_LEAD on engagement X) get
 * the full payload — the PM role wins.
 *
 * On the dashboard list (no engagement context), the heuristic is
 * simpler: accountants who don't have ANY engagement-level role at
 * all see stripped payloads everywhere. Accountants who happen to
 * also be a PROJECT_LEAD on a couple of deals will see THOSE deals
 * stripped on the list (we don't have engagement-context here) but
 * full when they click through. That's acceptable for the demo —
 * the dashboard row is mostly clientName/status anyway.
 *
 * Inputs are kept primitive so the route layer's per-request
 * permissionContext (Phase 43.2 middleware) feeds straight in.
 */
export function isAccountantOnly(args: {
  firmRoles: ReadonlyArray<string>;
  engagementRoles: ReadonlyArray<string>;
}): boolean {
  if (!args.firmRoles.includes('INTERNAL_ACCOUNTANT')) return false;
  // If the user holds ANY firm-level role above accountant
  // (APP_ADMIN / SALES_MANAGER / SUPPORT_LEAD), let them see
  // the full payload.
  const otherFirmRoles = args.firmRoles.filter((r) => r !== 'INTERNAL_ACCOUNTANT');
  if (otherFirmRoles.length > 0) return false;
  // Engagement-level role on THIS engagement → full payload (PM /
  // PROJECT_LEAD / consultant / client wins).
  if (args.engagementRoles.length > 0) return false;
  return true;
}
