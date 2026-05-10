/**
 * Phase 49.4 — CustomTemplate DB layer tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createCustomTemplate,
  listCustomTemplatesByFirm,
  findCustomTemplateById,
  updateCustomTemplate,
  deleteCustomTemplate,
  getDb,
} from '../../src/db/index.js';

let cleanup: () => void;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
});

beforeEach(async () => {
  const db = getDb();
  await db.execute('DELETE FROM CustomTemplate');
  await db.execute('DELETE FROM Firm');
});

async function seedFirm(): Promise<string> {
  const db = getDb();
  const firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Custom Tmpl', `custom-${createId()}`, 'STARTER', new Date().toISOString()],
  });
  return firmId;
}

describe('CustomTemplate DB layer', () => {
  it('creates a row with themeLocked defaulting to true', async () => {
    const firmId = await seedFirm();
    const t = await createCustomTemplate({
      firmId,
      name: 'Migration Cutover Memo',
      type: 'CUSTOM',
      body: '# Memo\n\nBody',
    });
    expect(t.themeLocked).toBe(true);
    expect(t.firmId).toBe(firmId);
    expect(t.name).toBe('Migration Cutover Memo');
  });

  it('lists by firm in updatedAt-DESC order', async () => {
    const firmId = await seedFirm();
    await createCustomTemplate({ firmId, name: 'A', type: 'CUSTOM', body: 'a' });
    await new Promise((r) => setTimeout(r, 10));
    await createCustomTemplate({ firmId, name: 'B', type: 'CUSTOM', body: 'b' });
    await new Promise((r) => setTimeout(r, 10));
    const c = await createCustomTemplate({ firmId, name: 'C', type: 'CUSTOM', body: 'c' });
    const all = await listCustomTemplatesByFirm(firmId);
    expect(all.map((t) => t.name)[0]).toBe('C');
    expect(all.find((t) => t.id === c.id)?.body).toBe('c');
  });

  it('isolates rows across firms', async () => {
    const a = await seedFirm();
    const b = await seedFirm();
    await createCustomTemplate({ firmId: a, name: 'a', type: 'CUSTOM', body: 'x' });
    await createCustomTemplate({ firmId: b, name: 'b', type: 'CUSTOM', body: 'y' });
    expect(await listCustomTemplatesByFirm(a)).toHaveLength(1);
    expect(await listCustomTemplatesByFirm(b)).toHaveLength(1);
  });

  it('updates name + body + bumps updatedAt', async () => {
    const firmId = await seedFirm();
    const t = await createCustomTemplate({ firmId, name: 'Old', type: 'CUSTOM', body: 'v1' });
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updateCustomTemplate(t.id, { name: 'New', body: 'v2' });
    expect(updated?.name).toBe('New');
    expect(updated?.body).toBe('v2');
    expect(updated!.updatedAt > t.updatedAt).toBe(true);
  });

  it('deletes a template', async () => {
    const firmId = await seedFirm();
    const t = await createCustomTemplate({ firmId, name: 'X', type: 'CUSTOM', body: 'x' });
    await deleteCustomTemplate(t.id);
    expect(await findCustomTemplateById(t.id)).toBeNull();
  });
});
