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
