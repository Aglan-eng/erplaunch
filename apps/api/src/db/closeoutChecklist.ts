/**
 * Phase 45.1 — DB layer for the CLOSEOUT-stage checklist.
 *
 * Re-exported through `db/index.ts` so callers stick with the existing
 * `from '../db/index.js'` convention. The 9 canonical keys live in
 * `services/closeoutChecklist.ts` so the policy is testable without
 * a DB.
 */

import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';
import {
  CHECKLIST_KEYS,
  type ChecklistKey,
  type ChecklistStatus,
} from '../services/closeoutChecklist.js';

export interface CloseoutChecklistRow {
  id: string;
  engagementId: string;
  key: ChecklistKey;
  status: ChecklistStatus;
  completedBy: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create one row per canonical key for the engagement, with
 * status=NOT_STARTED. Idempotent: existing rows are not touched
 * (UNIQUE on (engagementId, key) guarantees no duplicates).
 *
 * Returns the count of rows actually inserted so the caller can
 * log a meaningful summary on the stage transition.
 */
export async function createCloseoutChecklist(engagementId: string): Promise<{ inserted: number }> {
  const db = getDb();
  let inserted = 0;
  for (const key of CHECKLIST_KEYS) {
    // INSERT OR IGNORE keeps re-runs safe — second-time-around the
    // existing row stays untouched.
    const r = await db.execute({
      sql: `INSERT OR IGNORE INTO CloseoutChecklistItem (id, engagementId, key, status) VALUES (?,?,?,?)`,
      args: [createId(), engagementId, key, 'NOT_STARTED'],
    });
    inserted += r.rowsAffected ?? 0;
  }
  return { inserted };
}

/**
 * Return the engagement's checklist rows in canonical order.
 * Missing rows (e.g. if a row was deleted manually) are returned
 * as synthetic NOT_STARTED rows so the UI can render a complete
 * 9-row list — keeps the page from looking broken.
 */
export async function listCloseoutChecklist(engagementId: string): Promise<CloseoutChecklistRow[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, engagementId, key, status, completedBy, completedAt, notes, createdAt, updatedAt
          FROM CloseoutChecklistItem
          WHERE engagementId = ?`,
    args: [engagementId],
  });
  const byKey = new Map<string, CloseoutChecklistRow>();
  for (const row of r.rows) {
    const cast = row as unknown as CloseoutChecklistRow;
    byKey.set(cast.key, cast);
  }
  // Walk CHECKLIST_KEYS to keep the output ordered the same way the
  // UI renders so the consumer doesn't need to sort.
  return CHECKLIST_KEYS.map(
    (k): CloseoutChecklistRow => byKey.get(k) ?? {
      id: '',
      engagementId,
      key: k,
      status: 'NOT_STARTED',
      completedBy: null,
      completedAt: null,
      notes: null,
      createdAt: '',
      updatedAt: '',
    },
  );
}

export interface UpdateCloseoutChecklistItemArgs {
  engagementId: string;
  key: ChecklistKey;
  /** Optional — when omitted the existing status is preserved. */
  status?: ChecklistStatus;
  /** Optional — when omitted the existing notes are preserved. */
  notes?: string | null;
  /** User performing the change. Stamps completedBy when status →
   *  DONE; stays null otherwise. */
  byUserId: string;
}

/**
 * Patch one item. When status flips to DONE, stamps completedBy +
 * completedAt; when it flips away from DONE, clears them. Other
 * status transitions don't touch the completed-* columns.
 *
 * Returns the post-update row so the route can return it without a
 * second SELECT.
 */
export async function updateCloseoutChecklistItem(
  args: UpdateCloseoutChecklistItemArgs,
): Promise<CloseoutChecklistRow | null> {
  const db = getDb();
  // Pull the current row so we know which columns to touch. If it
  // doesn't exist (engagement never went through CLOSEOUT, or the
  // checklist was somehow not auto-created), return null and let the
  // caller decide what to do.
  const existing = await db.execute({
    sql: `SELECT * FROM CloseoutChecklistItem WHERE engagementId = ? AND key = ? LIMIT 1`,
    args: [args.engagementId, args.key],
  });
  if (existing.rows.length === 0) return null;
  const current = existing.rows[0] as unknown as CloseoutChecklistRow;

  const newStatus = args.status ?? current.status;
  const newNotes = args.notes === undefined ? current.notes : args.notes;
  const now = new Date().toISOString();

  // completedBy / completedAt stamping rules:
  //   - flipping TO 'DONE' → stamp byUserId + now
  //   - flipping AWAY FROM 'DONE' → clear both
  //   - otherwise preserve
  let completedBy = current.completedBy;
  let completedAt = current.completedAt;
  if (newStatus === 'DONE' && current.status !== 'DONE') {
    completedBy = args.byUserId;
    completedAt = now;
  } else if (newStatus !== 'DONE' && current.status === 'DONE') {
    completedBy = null;
    completedAt = null;
  }

  await db.execute({
    sql: `UPDATE CloseoutChecklistItem
          SET status = ?, notes = ?, completedBy = ?, completedAt = ?, updatedAt = ?
          WHERE engagementId = ? AND key = ?`,
    args: [newStatus, newNotes, completedBy, completedAt, now, args.engagementId, args.key],
  });
  return {
    ...current,
    status: newStatus,
    notes: newNotes,
    completedBy,
    completedAt,
    updatedAt: now,
  };
}
