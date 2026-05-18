/**
 * Phase 51.3 — SOW (Statement of Work) template input contract.
 *
 * Distinct from `ProposalInput` (51.2) because SOWs and proposals
 * have meaningfully different shapes:
 *
 *   - Proposals sell — they need a pricing line-item table.
 *   - SOWs commit — they need scope splits (in/out), milestone-based
 *     payment schedule, change-order process, and a dual signature
 *     block with named signatories.
 *
 * The renderer fetches firm-level brand-pack tokens by `firmId` at
 * render time; this payload only carries content the route caller
 * controls.
 */

export interface SowCustomer {
  name: string;
  address?: string;
  contactName?: string;
}

export interface SowDeliverable {
  /** Stable identifier (DLV-1 / DLV-2 / …). Surfaces in the rendered
   *  deliverable header AND in the milestone "deliverable refs" if
   *  callers want to wire those manually. */
  id: string;
  name: string;
  description: string;
  /** Plain text — what the customer must accept for sign-off. */
  acceptanceCriteria: string;
}

export interface SowMilestone {
  name: string;
  /** ISO 8601 date string. */
  targetDate: string;
  /** Integer 0–100. The renderer doesn't enforce that milestones sum
   *  to 100% — that's the caller's contract decision (e.g. a 30/40/30
   *  cadence is < 100% by design until go-live retainer kicks in). */
  paymentPercent: number;
}

export interface SowFeesFixed {
  fixedFee?: number;
  /** When fixedFee is present, tAndM is omitted from the rendered
   *  fees panel. When BOTH are present, the renderer shows fixedFee
   *  as the headline and tAndM as a footnote for overruns. */
  tAndM?: SowTAndM;
  /** ISO 4217 alpha-3. */
  currency: string;
  /** Plain text. e.g. "Net 30 from milestone sign-off." */
  paymentTerms: string;
}

export interface SowTAndM {
  /** Hourly rate in the fees currency. */
  rate: number;
  estimatedHours: number;
  /** Hard ceiling on T&M billing. Omitted → uncapped. */
  cap?: number;
}

export type SowFees = SowFeesFixed;

export interface SowSignatures {
  firmSignatoryName: string;
  firmSignatoryTitle: string;
  customerSignatoryName: string;
  customerSignatoryTitle: string;
}

export interface SowContent {
  title: string;
  /** ISO 8601 date the SOW takes effect on signing. */
  effectiveDate: string;
  /** Optional cross-reference back to the originating proposal. */
  referenceProposalNumber?: string;
  /** Markdown allowed — rendered + sanitized. */
  projectOverview: string;
  inScope: string[];
  outOfScope: string[];
  deliverables: SowDeliverable[];
  milestones: SowMilestone[];
  assumptions: string[];
  /** Markdown allowed. */
  changeOrderProcess: string;
  fees: SowFees;
  /** Markdown allowed. */
  termAndTermination: string;
  signatures: SowSignatures;
}

export interface SowInput {
  /** Firm scope — drives brand-pack lookup at render time. */
  firmId: string;
  customer: SowCustomer;
  sow: SowContent;
}
