/**
 * Phase 45.1 — Closeout checklist helpers.
 *
 * The CLOSEOUT lifecycle stage exists on the engagement enum since
 * Phase 43.3 but had no associated workflow. This module ships the
 * server-side primitives:
 *
 *   - CHECKLIST_KEYS — the 9 canonical items every engagement gets
 *     when it enters CLOSEOUT.
 *   - createCloseoutChecklist(engagementId) — bulk-insert row per key
 *     with status=NOT_STARTED. Idempotent: re-runs are no-ops.
 *   - updateCloseoutChecklistItem({ key, status, notes, byUserId }) —
 *     stamps completedBy / completedAt when status flips to DONE.
 *   - listCloseoutChecklist(engagementId) — return rows in the canonical
 *     order so the UI doesn't have to sort.
 *   - autoDetectStatus(args) — used by upstream events (a HANDOFF_PACKAGE
 *     job finishes → SYSTEM_CATALOG_REVIEWED auto-flips to IN_PROGRESS;
 *     INTERNAL_ACCOUNTANT marks final invoice paid → FINAL_INVOICE_PAID
 *     to DONE).
 *
 * Pure helpers live here and the SQL-backed CRUD lives in
 * `db/closeoutChecklist.ts`. The two split keeps the matrix-style
 * decisions (KEY_LABELS, ordering, NORMAL_STATUSES) testable without
 * standing up a DB.
 */

export const CHECKLIST_KEYS = [
  'KNOWLEDGE_TRANSFER',
  'SYSTEM_CATALOG_REVIEWED',
  'INTEGRATION_LIST_CONFIRMED',
  'SUPPORT_CONTACTS_ASSIGNED',
  'SLA_TERMS_AGREED',
  'FINAL_INVOICE_PAID',
  'PRODUCTION_STABLE',
  'CLIENT_SIGNOFF',
  'SLA_TEAM_ACCEPT',
] as const;

export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const CHECKLIST_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'NA'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** Display labels for the UI — keep them in one place so the
 *  step page + the activity log entries phrase the same item the
 *  same way. */
export const KEY_LABELS: Record<ChecklistKey, string> = {
  KNOWLEDGE_TRANSFER: 'Knowledge transfer to support team',
  SYSTEM_CATALOG_REVIEWED: 'System catalog reviewed',
  INTEGRATION_LIST_CONFIRMED: 'Integration list confirmed',
  SUPPORT_CONTACTS_ASSIGNED: 'Support contacts assigned',
  SLA_TERMS_AGREED: 'SLA terms agreed',
  FINAL_INVOICE_PAID: 'Final invoice paid',
  PRODUCTION_STABLE: 'Production stable for 7 days',
  CLIENT_SIGNOFF: 'Client closeout sign-off',
  SLA_TEAM_ACCEPT: 'SLA team accepts handover',
};

export function isChecklistKey(s: string): s is ChecklistKey {
  return (CHECKLIST_KEYS as readonly string[]).includes(s);
}

export function isChecklistStatus(s: string): s is ChecklistStatus {
  return (CHECKLIST_STATUSES as readonly string[]).includes(s);
}

// ─── Auto-detect rules ───────────────────────────────────────────────────────

/**
 * Trigger sources that may automatically flip a checklist item's
 * status. The route layer calls applyAutoDetect(engagementId, source)
 * after firing the relevant event so the checklist stays in sync
 * without manual updates.
 */
export type AutoDetectSource =
  | 'HANDOFF_PACKAGE_GENERATED' // Phase 45.2 — moves SYSTEM_CATALOG_REVIEWED to IN_PROGRESS
  | 'FINAL_INVOICE_PAID';        // future billing flow — moves FINAL_INVOICE_PAID to DONE

export interface AutoDetectAction {
  key: ChecklistKey;
  newStatus: ChecklistStatus;
}

/**
 * Pure mapping from event source → checklist mutation. The route
 * layer hits this after firing the event, then applies the returned
 * mutation through the regular updateCloseoutChecklistItem path so
 * the audit + activity-log hooks fire consistently.
 *
 * Returns null when the source doesn't drive an automatic item.
 */
export function autoDetectFor(source: AutoDetectSource): AutoDetectAction | null {
  switch (source) {
    case 'HANDOFF_PACKAGE_GENERATED':
      return { key: 'SYSTEM_CATALOG_REVIEWED', newStatus: 'IN_PROGRESS' };
    case 'FINAL_INVOICE_PAID':
      return { key: 'FINAL_INVOICE_PAID', newStatus: 'DONE' };
    default:
      return null;
  }
}

// ─── Progress helpers ────────────────────────────────────────────────────────

export interface ChecklistItemSummary {
  key: ChecklistKey;
  status: ChecklistStatus;
}

/** Count rows with status=DONE; rows with NA are also counted as
 *  satisfied (they're "complete" in the sense that they can't block
 *  closeout). NOT_STARTED + IN_PROGRESS are pending. */
export function checklistProgress(items: ReadonlyArray<ChecklistItemSummary>): {
  total: number;
  done: number;
  pending: number;
  percentComplete: number;
} {
  const total = items.length;
  let done = 0;
  for (const i of items) {
    if (i.status === 'DONE' || i.status === 'NA') done++;
  }
  const pending = total - done;
  const percentComplete = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, pending, percentComplete };
}

/**
 * Two checklist items are required to be DONE before the engagement
 * can transition CLOSEOUT → SLA_ACTIVE — Phase 45.4 will wire this
 * into the /advance gate. We keep the predicate here so the test
 * suite can pin which items count as blockers without booting a DB.
 */
export const TRANSITION_BLOCKERS: ReadonlyArray<ChecklistKey> = [
  'CLIENT_SIGNOFF',
  'SLA_TEAM_ACCEPT',
];

export function canTransitionToSlaActive(items: ReadonlyArray<ChecklistItemSummary>): boolean {
  for (const blocker of TRANSITION_BLOCKERS) {
    const item = items.find((i) => i.key === blocker);
    if (!item || (item.status !== 'DONE' && item.status !== 'NA')) return false;
  }
  return true;
}
