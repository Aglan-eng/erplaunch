/**
 * Phase 50.1 — GeneratedDocument DB layer.
 *
 * Persists rendered template output per engagement. The canonical
 * storage form is the rendered markdown body (after templateRenderer
 * substitutes tokens); exporters in apps/api/src/services/exporters/
 * render that markdown to PDF / DOCX / PPTX on demand without
 * touching the row.
 *
 * Firm scoping: every read/update/delete carries an explicit firmId
 * because the row's firmId is the audit anchor — the engagement's
 * firmId could change in theory (it doesn't today, but the SQL is
 * future-proof against a future "transfer engagement to another firm"
 * flow that would otherwise orphan documents). Cross-firm reads
 * return null so route handlers can 404 cleanly.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type DocumentFormat = 'markdown' | 'pdf' | 'docx' | 'pptx';

export interface GeneratedDocument {
  id: string;
  firmId: string;
  engagementId: string;
  /** NULL when the doc came from a built-in generator (Phase 51 forward-compat). */
  sourceTemplateId: string | null;
  /** NULL when the doc came from a CustomTemplate. */
  sourceGeneratorId: string | null;
  name: string;
  /** Canonical body — always markdown. Exporters render to other formats on the fly. */
  body: string;
  format: DocumentFormat;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function toGeneratedDocument(row: Row): GeneratedDocument {
  return {
    id: row.id as string,
    firmId: row.firmId as string,
    engagementId: row.engagementId as string,
    sourceTemplateId: (row.sourceTemplateId as string | null) ?? null,
    sourceGeneratorId: (row.sourceGeneratorId as string | null) ?? null,
    name: row.name as string,
    body: row.body as string,
    format: ((row.format as string | null) ?? 'markdown') as DocumentFormat,
    generatedBy: row.generatedBy as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export interface CreateGeneratedDocumentInput {
  firmId: string;
  engagementId: string;
  sourceTemplateId?: string | null;
  sourceGeneratorId?: string | null;
  name: string;
  body: string;
  format?: DocumentFormat;
  generatedBy: string;
}

export async function createGeneratedDocument(
  input: CreateGeneratedDocumentInput,
): Promise<GeneratedDocument> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO GeneratedDocument
            (id, firmId, engagementId, sourceTemplateId, sourceGeneratorId,
             name, body, format, generatedBy, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.firmId,
      input.engagementId,
      input.sourceTemplateId ?? null,
      input.sourceGeneratorId ?? null,
      input.name,
      input.body,
      input.format ?? 'markdown',
      input.generatedBy,
      now,
      now,
    ],
  });
  const r = await db.execute({
    sql: `SELECT * FROM GeneratedDocument WHERE id = ?`,
    args: [id],
  });
  return toGeneratedDocument(r.rows[0] as Row);
}

export async function listGeneratedDocumentsByEngagement(
  engagementId: string,
  firmId: string,
): Promise<GeneratedDocument[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM GeneratedDocument
          WHERE engagementId = ? AND firmId = ?
          ORDER BY createdAt DESC`,
    args: [engagementId, firmId],
  });
  return (r.rows as Row[]).map(toGeneratedDocument);
}

/** Firm-scoped read. Returns null on cross-firm access so route handlers can 404. */
export async function getGeneratedDocument(
  id: string,
  firmId: string,
): Promise<GeneratedDocument | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM GeneratedDocument WHERE id = ? AND firmId = ?`,
    args: [id, firmId],
  });
  return r.rows[0] ? toGeneratedDocument(r.rows[0] as Row) : null;
}

/** Only name + body are mutable. format is set at create time and stays. */
export async function updateGeneratedDocument(
  id: string,
  firmId: string,
  patch: Partial<{ name: string; body: string }>,
): Promise<GeneratedDocument | null> {
  const db = getDb();
  const sets: string[] = ['updatedAt = ?'];
  const args: (string | null)[] = [new Date().toISOString()];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.body !== undefined) {
    sets.push('body = ?');
    args.push(patch.body);
  }
  args.push(id, firmId);
  await db.execute({
    sql: `UPDATE GeneratedDocument SET ${sets.join(', ')} WHERE id = ? AND firmId = ?`,
    args,
  });
  return getGeneratedDocument(id, firmId);
}

/** Returns true when the row was deleted; false when not found / cross-firm. */
export async function deleteGeneratedDocument(
  id: string,
  firmId: string,
): Promise<boolean> {
  const existing = await getGeneratedDocument(id, firmId);
  if (!existing) return false;
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM GeneratedDocument WHERE id = ? AND firmId = ?`,
    args: [id, firmId],
  });
  return true;
}
