/**
 * Phase 49.4 — CustomTemplate DB layer.
 *
 * Firm-authored templates created via the Settings → Templates editor's
 * "Create new template" wizard. type matches a built-in generator id
 * (BRD, SOLUTION_DOC, PROPOSAL, etc.) for templates that override a
 * generator's output, OR is the literal 'CUSTOM' for free-form
 * templates not tied to a specific generator.
 *
 * themeLocked is always 1 in v1 — kept as a column for forward-compat
 * when Phase 50 adds a firm-admin override toggle. The editor enforces
 * the lock client-side and the generator falls back to firm theme
 * tokens regardless of body content.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export interface CustomTemplate {
  id: string;
  firmId: string;
  name: string;
  type: string;
  body: string;
  themeLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function toCustomTemplate(row: Row): CustomTemplate {
  return {
    id: row.id as string,
    firmId: row.firmId as string,
    name: row.name as string,
    type: row.type as string,
    body: row.body as string,
    themeLocked: Number(row.themeLocked ?? 1) === 1,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function createCustomTemplate(input: {
  firmId: string;
  name: string;
  type: string;
  body: string;
  themeLocked?: boolean;
}): Promise<CustomTemplate> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO CustomTemplate (id, firmId, name, type, body, themeLocked, createdAt, updatedAt)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.firmId,
      input.name,
      input.type,
      input.body,
      input.themeLocked === false ? 0 : 1,
      now,
      now,
    ],
  });
  const r = await db.execute({
    sql: `SELECT * FROM CustomTemplate WHERE id = ?`,
    args: [id],
  });
  return toCustomTemplate(r.rows[0] as Row);
}

export async function listCustomTemplatesByFirm(
  firmId: string,
): Promise<CustomTemplate[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM CustomTemplate WHERE firmId = ? ORDER BY updatedAt DESC`,
    args: [firmId],
  });
  return (r.rows as Row[]).map(toCustomTemplate);
}

export async function findCustomTemplateById(
  id: string,
): Promise<CustomTemplate | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM CustomTemplate WHERE id = ?`,
    args: [id],
  });
  return r.rows[0] ? toCustomTemplate(r.rows[0] as Row) : null;
}

export async function updateCustomTemplate(
  id: string,
  patch: Partial<{ name: string; body: string; themeLocked: boolean }>,
): Promise<CustomTemplate | null> {
  const db = getDb();
  const sets: string[] = ['updatedAt = ?'];
  const args: (string | number | null)[] = [new Date().toISOString()];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.body !== undefined) {
    sets.push('body = ?');
    args.push(patch.body);
  }
  if (patch.themeLocked !== undefined) {
    sets.push('themeLocked = ?');
    args.push(patch.themeLocked ? 1 : 0);
  }
  args.push(id);
  await db.execute({
    sql: `UPDATE CustomTemplate SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
  return findCustomTemplateById(id);
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM CustomTemplate WHERE id = ?`,
    args: [id],
  });
}
