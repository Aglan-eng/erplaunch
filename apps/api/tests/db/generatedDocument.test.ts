/**
 * Phase 50.1 — GeneratedDocument DB layer tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createGeneratedDocument,
  listGeneratedDocumentsByEngagement,
  getGeneratedDocument,
  updateGeneratedDocument,
  deleteGeneratedDocument,
  createCustomTemplate,
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
  // Dependency order: clear children before parents. GeneratedDocument
  // FKs to Firm + Engagement + CustomTemplate.
  const db = getDb();
  await db.execute('DELETE FROM GeneratedDocument');
  await db.execute('DELETE FROM CustomTemplate');
  await db.execute('DELETE FROM Engagement');
  await db.execute('DELETE FROM FirmRole');
  await db.execute('DELETE FROM EngagementRole');
  await db.execute('DELETE FROM User');
  await db.execute('DELETE FROM Firm');
});

async function seedFirmAndEngagement(): Promise<{ firmId: string; engagementId: string; userId: string }> {
  const db = getDb();
  const firmId = createId();
  const engagementId = createId();
  const userId = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Doc Firm', `doc-${createId()}`, 'STARTER', now],
  });
  await db.execute({
    sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?)`,
    args: [engagementId, firmId, 'Doc Client', 'DISCOVERY', now, now],
  });
  return { firmId, engagementId, userId };
}

describe('GeneratedDocument DB layer', () => {
  it('creates a row from a CustomTemplate source', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    const tpl = await createCustomTemplate({
      firmId,
      name: 'Cutover Runbook',
      type: 'CUSTOM',
      body: 'Body',
    });
    const doc = await createGeneratedDocument({
      firmId,
      engagementId,
      sourceTemplateId: tpl.id,
      name: 'Cutover Runbook — v1',
      body: '# Rendered\n\nHello.',
      generatedBy: userId,
    });
    expect(doc.id).toBeTruthy();
    expect(doc.sourceTemplateId).toBe(tpl.id);
    expect(doc.sourceGeneratorId).toBeNull();
    expect(doc.format).toBe('markdown');
    expect(doc.generatedBy).toBe(userId);
  });

  it('creates a row from a built-in generator source (template null)', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    const doc = await createGeneratedDocument({
      firmId,
      engagementId,
      sourceGeneratorId: 'BRD',
      name: 'BRD Export',
      body: 'body',
      generatedBy: userId,
    });
    expect(doc.sourceGeneratorId).toBe('BRD');
    expect(doc.sourceTemplateId).toBeNull();
  });

  it('lists docs newest-first within an engagement', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    await createGeneratedDocument({ firmId, engagementId, name: 'A', body: 'a', generatedBy: userId });
    await new Promise((r) => setTimeout(r, 10));
    await createGeneratedDocument({ firmId, engagementId, name: 'B', body: 'b', generatedBy: userId });
    await new Promise((r) => setTimeout(r, 10));
    await createGeneratedDocument({ firmId, engagementId, name: 'C', body: 'c', generatedBy: userId });
    const docs = await listGeneratedDocumentsByEngagement(engagementId, firmId);
    expect(docs.map((d) => d.name)).toEqual(['C', 'B', 'A']);
  });

  it('cross-firm read returns null (firm-scope isolation)', async () => {
    const a = await seedFirmAndEngagement();
    const b = await seedFirmAndEngagement();
    const doc = await createGeneratedDocument({
      firmId: a.firmId,
      engagementId: a.engagementId,
      name: 'A only',
      body: 'x',
      generatedBy: a.userId,
    });
    expect(await getGeneratedDocument(doc.id, b.firmId)).toBeNull();
    expect(await getGeneratedDocument(doc.id, a.firmId)).not.toBeNull();
  });

  it('updates name + body and bumps updatedAt', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    const doc = await createGeneratedDocument({
      firmId,
      engagementId,
      name: 'Old',
      body: 'v1',
      generatedBy: userId,
    });
    await new Promise((r) => setTimeout(r, 10));
    const updated = await updateGeneratedDocument(doc.id, firmId, {
      name: 'New',
      body: 'v2',
    });
    expect(updated?.name).toBe('New');
    expect(updated?.body).toBe('v2');
    expect(updated!.updatedAt > doc.updatedAt).toBe(true);
  });

  it('update is firm-scoped — cross-firm patch returns null and leaves row unchanged', async () => {
    const a = await seedFirmAndEngagement();
    const b = await seedFirmAndEngagement();
    const doc = await createGeneratedDocument({
      firmId: a.firmId,
      engagementId: a.engagementId,
      name: 'Untouched',
      body: 'x',
      generatedBy: a.userId,
    });
    const updated = await updateGeneratedDocument(doc.id, b.firmId, { name: 'Hacked' });
    expect(updated).toBeNull();
    const reread = await getGeneratedDocument(doc.id, a.firmId);
    expect(reread?.name).toBe('Untouched');
  });

  it('delete returns true on success and false on cross-firm attempt', async () => {
    const a = await seedFirmAndEngagement();
    const b = await seedFirmAndEngagement();
    const doc = await createGeneratedDocument({
      firmId: a.firmId,
      engagementId: a.engagementId,
      name: 'X',
      body: 'x',
      generatedBy: a.userId,
    });
    expect(await deleteGeneratedDocument(doc.id, b.firmId)).toBe(false);
    expect(await getGeneratedDocument(doc.id, a.firmId)).not.toBeNull();
    expect(await deleteGeneratedDocument(doc.id, a.firmId)).toBe(true);
    expect(await getGeneratedDocument(doc.id, a.firmId)).toBeNull();
  });

  it('engagement delete cascades to documents (ON DELETE CASCADE)', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    await createGeneratedDocument({ firmId, engagementId, name: 'A', body: 'a', generatedBy: userId });
    await createGeneratedDocument({ firmId, engagementId, name: 'B', body: 'b', generatedBy: userId });
    const db = getDb();
    await db.execute({ sql: `DELETE FROM Engagement WHERE id = ?`, args: [engagementId] });
    const remaining = await listGeneratedDocumentsByEngagement(engagementId, firmId);
    expect(remaining).toHaveLength(0);
  });

  it('template delete does NOT cascade — sourceTemplateId becomes NULL', async () => {
    const { firmId, engagementId, userId } = await seedFirmAndEngagement();
    const tpl = await createCustomTemplate({
      firmId,
      name: 'Throwaway',
      type: 'CUSTOM',
      body: 'x',
    });
    const doc = await createGeneratedDocument({
      firmId,
      engagementId,
      sourceTemplateId: tpl.id,
      name: 'From throwaway',
      body: 'rendered',
      generatedBy: userId,
    });
    const db = getDb();
    await db.execute({ sql: `DELETE FROM CustomTemplate WHERE id = ?`, args: [tpl.id] });
    const reread = await getGeneratedDocument(doc.id, firmId);
    expect(reread).not.toBeNull();
    expect(reread?.sourceTemplateId).toBeNull();
    expect(reread?.body).toBe('rendered');
  });
});
