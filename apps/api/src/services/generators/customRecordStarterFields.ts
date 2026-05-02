/**
 * Custom Record Starter Fields (Pack K — Custom Record Business Fields).
 *
 * Pre-Pack-K, customrecord_*.xml files shipped with 4 baseline audit
 * fields (status / owner / notes / external_ref) and nothing else. The
 * actual BUSINESS fields each record needs (Approval Tracker needs
 * subject + transaction_link + requested_amount; Tax Filing Calendar
 * needs jurisdiction + filing periods + due dates; etc.) had to be
 * added manually post-deploy — typically 5–8 fields per record × 5
 * records × ~5 min = ~125–200 min/engagement of UI clicking.
 *
 * Pack K closes the gap with a name-keyword classifier. The custom
 * record's name maps to a curated starter set:
 *   - "Approval Tracker"          → 6 starter fields
 *   - "Vendor Onboarding Request" → 5 starter fields
 *   - "Project Milestone"         → 5 starter fields
 *   - "Intercompany Transfer"     → 5 starter fields
 *   - "Tax Filing Calendar"       → 6 starter fields
 *   - "Batch Recall Tracker"      → 5 starter fields
 *   - "Clinical Trial …"          → 6 starter fields
 *   - "Medical Affairs Activity"  → 5 starter fields
 *   - "Product License Renewal"   → 6 starter fields
 *   - "GCP Compliance Register"   → 5 starter fields
 *   - default                      → []
 *
 * Pack K's wizard overlay (ns.design.customRecordExtraFields, parsed
 * by customRecordExtraFieldsParser.ts) layers consultant-supplied
 * extras on top of the smart starters. The customrecord generator
 * merges baseline + starters + overlay in that priority order.
 *
 * Fieldtype mapping uses NetSuite SDF enum values directly:
 *   - TEXT → FREEFORMTEXT (NetSuite uses FREEFORMTEXT for single-line)
 *   - SELECT with hardcoded selectrecordtype = '-4' (Employee), '-30'
 *     (Transaction), '-117' (Subsidiary)
 *   - SELECT WITHOUT hardcoded selectrecordtype → caller emits a
 *     companion customlist with placeholder values
 *
 * Sources:
 *   - NetSuite SDF customrecordcustomfield XML reference (Oracle docs).
 *   - NetSuite standard record type IDs:
 *       -4   Employee
 *       -30  Transaction
 *       -117 Subsidiary
 *     (NetSuite Help — Standard Record Type IDs reference).
 *   - NetSuite Custom Record best practice (Oracle Help).
 */

export type StarterFieldType =
  | 'FREEFORMTEXT'
  | 'TEXTAREA'
  | 'CHECKBOX'
  | 'DATE'
  | 'CURRENCY'
  | 'FLOAT'
  | 'SELECT';

export interface StarterField {
  /** scriptid suffix — combined with custrecord_<recordSlug>_ to form
   *  the final scriptid. Lowercase + underscores. */
  id: string;
  /** Human label rendered in the customrecordcustomfield XML. */
  label: string;
  /** SDF fieldtype enum value. */
  fieldtype: StarterFieldType;
  /** When fieldtype === 'SELECT':
   *    - '-4' / '-30' / '-117' for hardcoded NetSuite record-type
   *      links (Employee / Transaction / Subsidiary)
   *    - undefined when the caller should emit a companion customlist
   *      with placeholder values (the customrecord generator
   *      auto-derives the customlist scriptid as
   *      customlist_<recordSlug>_<fieldId>) */
  selectrecordtype?: string;
}

// ─── Curated starter sets per keyword family ────────────────────────────────

const APPROVAL_TRACKER_STARTERS: StarterField[] = [
  { id: 'subject', label: 'Subject', fieldtype: 'FREEFORMTEXT' },
  { id: 'transaction_link', label: 'Transaction', fieldtype: 'SELECT', selectrecordtype: '-30' },
  { id: 'requested_amount', label: 'Requested Amount', fieldtype: 'CURRENCY' },
  { id: 'requested_by', label: 'Requested By', fieldtype: 'SELECT', selectrecordtype: '-4' },
  { id: 'approval_date', label: 'Approval Date', fieldtype: 'DATE' },
  { id: 'approval_chain_history', label: 'Approval Chain History', fieldtype: 'TEXTAREA' },
];

const ONBOARDING_REQUEST_STARTERS: StarterField[] = [
  { id: 'submission_date', label: 'Submission Date', fieldtype: 'DATE' },
  { id: 'submitted_by', label: 'Submitted By', fieldtype: 'SELECT', selectrecordtype: '-4' },
  { id: 'kyc_status', label: 'KYC Status', fieldtype: 'SELECT' }, // companion customlist
  { id: 'supporting_documents', label: 'Supporting Documents', fieldtype: 'TEXTAREA' },
  { id: 'risk_rating', label: 'Risk Rating', fieldtype: 'SELECT' }, // companion customlist
];

const MILESTONE_STARTERS: StarterField[] = [
  { id: 'planned_date', label: 'Planned Date', fieldtype: 'DATE' },
  { id: 'actual_date', label: 'Actual Date', fieldtype: 'DATE' },
  { id: 'completion_percent', label: 'Completion %', fieldtype: 'FLOAT' },
  { id: 'deliverables', label: 'Deliverables', fieldtype: 'TEXTAREA' },
  { id: 'responsible_party', label: 'Responsible Party', fieldtype: 'SELECT', selectrecordtype: '-4' },
];

const TRANSFER_STARTERS: StarterField[] = [
  { id: 'source_entity', label: 'Source Entity', fieldtype: 'SELECT', selectrecordtype: '-117' },
  { id: 'destination_entity', label: 'Destination Entity', fieldtype: 'SELECT', selectrecordtype: '-117' },
  { id: 'amount', label: 'Amount', fieldtype: 'CURRENCY' },
  { id: 'transfer_date', label: 'Transfer Date', fieldtype: 'DATE' },
  { id: 'reference_number', label: 'Reference Number', fieldtype: 'FREEFORMTEXT' },
];

const TAX_FILING_STARTERS: StarterField[] = [
  { id: 'jurisdiction', label: 'Jurisdiction', fieldtype: 'FREEFORMTEXT' },
  { id: 'filing_period_start', label: 'Filing Period Start', fieldtype: 'DATE' },
  { id: 'filing_period_end', label: 'Filing Period End', fieldtype: 'DATE' },
  { id: 'due_date', label: 'Due Date', fieldtype: 'DATE' },
  { id: 'filed_date', label: 'Filed Date', fieldtype: 'DATE' },
  { id: 'return_amount', label: 'Return Amount', fieldtype: 'CURRENCY' },
];

const RECALL_COMPLIANCE_STARTERS: StarterField[] = [
  { id: 'event_date', label: 'Event Date', fieldtype: 'DATE' },
  { id: 'severity', label: 'Severity', fieldtype: 'SELECT' }, // companion customlist
  { id: 'affected_lots', label: 'Affected Lots', fieldtype: 'TEXTAREA' },
  { id: 'disposition', label: 'Disposition', fieldtype: 'SELECT' }, // companion customlist
  { id: 'regulatory_authority', label: 'Regulatory Authority', fieldtype: 'FREEFORMTEXT' },
];

const CLINICAL_TRIAL_STARTERS: StarterField[] = [
  { id: 'trial_id', label: 'Trial ID', fieldtype: 'FREEFORMTEXT' },
  { id: 'phase', label: 'Phase', fieldtype: 'SELECT' }, // companion customlist
  { id: 'start_date', label: 'Start Date', fieldtype: 'DATE' },
  { id: 'end_date', label: 'End Date', fieldtype: 'DATE' },
  { id: 'participant_count', label: 'Participant Count', fieldtype: 'FLOAT' },
  { id: 'study_lead', label: 'Study Lead', fieldtype: 'SELECT', selectrecordtype: '-4' },
];

const MEDICAL_AFFAIRS_STARTERS: StarterField[] = [
  { id: 'activity_date', label: 'Activity Date', fieldtype: 'DATE' },
  { id: 'activity_type', label: 'Activity Type', fieldtype: 'SELECT' }, // companion customlist
  { id: 'drug_or_program', label: 'Drug or Program', fieldtype: 'FREEFORMTEXT' },
  { id: 'region', label: 'Region', fieldtype: 'SELECT' }, // companion customlist
  { id: 'kol_engaged', label: 'KOL Engaged', fieldtype: 'TEXTAREA' },
];

const LICENSE_RENEWAL_STARTERS: StarterField[] = [
  { id: 'license_type', label: 'License Type', fieldtype: 'FREEFORMTEXT' },
  { id: 'authority', label: 'Authority', fieldtype: 'FREEFORMTEXT' },
  { id: 'issue_date', label: 'Issue Date', fieldtype: 'DATE' },
  { id: 'expiry_date', label: 'Expiry Date', fieldtype: 'DATE' },
  { id: 'renewal_amount', label: 'Renewal Amount', fieldtype: 'CURRENCY' },
  { id: 'renewal_status', label: 'Renewal Status', fieldtype: 'SELECT' }, // companion customlist
];

const GCP_REGISTER_STARTERS: StarterField[] = [
  { id: 'registered_date', label: 'Registered Date', fieldtype: 'DATE' },
  { id: 'expiry_date', label: 'Expiry Date', fieldtype: 'DATE' },
  // Note: 'status' label collides with the baseline 'Status' field —
  // the customrecord generator's dedup logic skips this in favour of
  // the baseline (audit fields always win).
  { id: 'status', label: 'Status', fieldtype: 'SELECT' },
  { id: 'responsible_officer', label: 'Responsible Officer', fieldtype: 'SELECT', selectrecordtype: '-4' },
  { id: 'evidence_link', label: 'Evidence Link', fieldtype: 'FREEFORMTEXT' },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Match the record name against the keyword classifier (case-insensitive,
 * priority order top-to-bottom — first match wins). Returns the curated
 * starter-field set for that family, or an empty array when no rule
 * fires. The empty case is correct: the consultant uses the wizard
 * overlay (ns.design.customRecordExtraFields) to add fields beyond the
 * baseline 4.
 *
 * Detection is lenient — the record name need only contain the keyword
 * as a word boundary; "Approval Tracker (custom record — captures full
 * chain)" still matches the approval/tracker family because the parser
 * upstream already strips the parenthetical hint.
 */
export function inferStarterFields(recordName: string): StarterField[] {
  const lc = recordName.toLowerCase();

  if (/\bapproval\b|\btracker\b/.test(lc)) return APPROVAL_TRACKER_STARTERS;
  // intercompany/transfer must match BEFORE onboarding/request — otherwise
  // "Intercompany Transfer Request" hits the onboarding branch via the
  // generic "request" keyword. Specificity > generality in priority order.
  if (/\btransfer\b|\bintercompany\b/.test(lc)) return TRANSFER_STARTERS;
  if (/\bonboarding\b|\brequest\b/.test(lc)) return ONBOARDING_REQUEST_STARTERS;
  if (/\bmilestone\b/.test(lc)) return MILESTONE_STARTERS;
  if (/\btax\b|\bfiling\b|\bcalendar\b/.test(lc)) return TAX_FILING_STARTERS;
  if (/\brecall\b|\bcompliance\b|\bquality\b/.test(lc)) return RECALL_COMPLIANCE_STARTERS;
  if (/\bclinical\b|\btrial\b/.test(lc)) return CLINICAL_TRIAL_STARTERS;
  if (/\bmedical\b|\baffairs\b|\bactivity\b/.test(lc)) return MEDICAL_AFFAIRS_STARTERS;
  if (/\blicense\b|\brenewal\b/.test(lc)) return LICENSE_RENEWAL_STARTERS;
  if (/\bgcp\b|\bregister\b/.test(lc)) return GCP_REGISTER_STARTERS;

  return [];
}
