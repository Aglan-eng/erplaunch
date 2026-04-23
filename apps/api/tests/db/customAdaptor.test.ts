import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import {
  createCustomAdaptor,
  findCustomAdaptorById,
  findCustomAdaptorByFirmAndSlug,
  listCustomAdaptorsForFirm,
  listPublishedCustomAdaptorsForFirm,
  appendCustomAdaptorDocument,
  updateCustomAdaptorStatus,
  savePlatformAdaptorDraft,
  publishCustomAdaptor,
  archiveCustomAdaptor,
  getDb,
} from '../../src/db/index.js';

let cleanup: () => void;
let firmId: string;

beforeAll(async () => {
  const setup = await setupTestDb();
  cleanup = setup.cleanup;

  // Seed a firm for the multi-tenant tests
  firmId = createId();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Acme Advisory', `acme-${createId()}`, 'STARTER', new Date().toISOString()],
  });
});

afterAll(() => {
  cleanup();
});

describe('customAdaptor: create + lookup', () => {
  it('creates a draft adaptor and retrieves by id', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'MyFactoryERP', slug: 'myfactory' });
    expect(row.id).toBeDefined();
    expect(row.firmId).toBe(firmId);
    expect(row.name).toBe('MyFactoryERP');
    expect(row.slug).toBe('myfactory');
    expect(row.status).toBe('DRAFT');
    expect(row.sourceDocuments).toEqual([]);
    expect(row.publishedAt).toBeNull();

    const fetched = await findCustomAdaptorById(row.id);
    expect(fetched?.id).toBe(row.id);
  });

  it('looks up by firmId + slug', async () => {
    await createCustomAdaptor({ firmId, name: 'WarehousePro', slug: 'warehouse-pro' });
    const row = await findCustomAdaptorByFirmAndSlug(firmId, 'warehouse-pro');
    expect(row?.name).toBe('WarehousePro');
  });

  it('returns null when firm+slug does not exist', async () => {
    const row = await findCustomAdaptorByFirmAndSlug(firmId, 'does-not-exist');
    expect(row).toBeNull();
  });

  it('refuses duplicate (firmId, slug)', async () => {
    await createCustomAdaptor({ firmId, name: 'Unique1', slug: 'unique-slug' });
    await expect(createCustomAdaptor({ firmId, name: 'Unique2', slug: 'unique-slug' })).rejects.toThrow();
  });

  it('allows same slug across different firms', async () => {
    const otherFirmId = createId();
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [otherFirmId, 'Other Firm', `other-${createId()}`, 'STARTER', new Date().toISOString()],
    });

    await createCustomAdaptor({ firmId, name: 'Shared', slug: 'shared-slug' });
    // Same slug, different firm — must succeed (multi-tenant isolation)
    const row = await createCustomAdaptor({ firmId: otherFirmId, name: 'Shared', slug: 'shared-slug' });
    expect(row.firmId).toBe(otherFirmId);
  });
});

describe('customAdaptor: document append', () => {
  it('appends documents to the sourceDocuments array', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'WithDocs', slug: 'with-docs' });
    const doc = {
      filename: `${createId()}.pdf`,
      originalName: 'system-manual.pdf',
      mimeType: 'application/pdf',
      size: 12345,
    };
    const updated = await appendCustomAdaptorDocument(row.id, doc);
    expect(updated.sourceDocuments).toHaveLength(1);
    expect(updated.sourceDocuments[0].originalName).toBe('system-manual.pdf');
    expect(updated.sourceDocuments[0].uploadedAt).toBeDefined();

    const second = await appendCustomAdaptorDocument(row.id, {
      filename: `${createId()}.docx`,
      originalName: 'workflow.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 6789,
    });
    expect(second.sourceDocuments).toHaveLength(2);
  });
});

describe('customAdaptor: status lifecycle', () => {
  it('transitions DRAFT → PARSING → READY via saves', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'LifecycleTest', slug: 'lifecycle-test' });
    expect(row.status).toBe('DRAFT');

    const parsing = await updateCustomAdaptorStatus(row.id, 'PARSING');
    expect(parsing.status).toBe('PARSING');

    const ready = await savePlatformAdaptorDraft(row.id, {
      manifest: { id: 'custom:lifecycle-test', name: 'LifecycleTest', version: '1.0.0', vendor: 'Acme', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });
    expect(ready.status).toBe('READY');
    expect(ready.parsedManifest).toBeTruthy();
    expect(ready.parseError).toBeNull();
  });

  it('records parse errors on FAILED status', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'FailTest', slug: 'fail-test' });
    const failed = await updateCustomAdaptorStatus(row.id, 'FAILED', 'PDF extractor crashed on page 42');
    expect(failed.status).toBe('FAILED');
    expect(failed.parseError).toBe('PDF extractor crashed on page 42');
  });

  it('publishes a READY adaptor and sets publishedAt', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'PubTest', slug: 'pub-test' });
    await savePlatformAdaptorDraft(row.id, {
      manifest: { id: 'custom:pub-test', name: 'PubTest', version: '1.0.0', vendor: 'Acme', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });
    const published = await publishCustomAdaptor(row.id);
    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedAt).toBeTruthy();
  });
});

describe('customAdaptor: list + archive', () => {
  it('listCustomAdaptorsForFirm excludes archived rows', async () => {
    const row = await createCustomAdaptor({ firmId, name: 'Archivable', slug: 'archivable' });
    const before = await listCustomAdaptorsForFirm(firmId);
    const beforeIds = before.map((r) => r.id);
    expect(beforeIds).toContain(row.id);

    await archiveCustomAdaptor(row.id);
    const after = await listCustomAdaptorsForFirm(firmId);
    const afterIds = after.map((r) => r.id);
    expect(afterIds).not.toContain(row.id);
  });

  it('listPublishedCustomAdaptorsForFirm returns only PUBLISHED rows', async () => {
    const published = await createCustomAdaptor({ firmId, name: 'P1', slug: 'p1' });
    await savePlatformAdaptorDraft(published.id, {
      manifest: { id: 'custom:p1', name: 'P1', version: '1.0.0', vendor: 'Acme', capabilities: [], minSdk: '0.1.0', sourceKind: 'custom' },
      schema: { version: '1.0.0', flows: [] },
      license: { editions: [], modules: [], defaultEditionId: 'BASIC' },
      phases: { defaultPhases: [] },
      generators: [],
    });
    await publishCustomAdaptor(published.id);

    await createCustomAdaptor({ firmId, name: 'D1', slug: 'd1' }); // stays DRAFT

    const rows = await listPublishedCustomAdaptorsForFirm(firmId);
    const statuses = rows.map((r) => r.status);
    expect(statuses.every((s) => s === 'PUBLISHED')).toBe(true);
  });

  it('list is firm-scoped — does not leak across tenants', async () => {
    const otherFirmId = createId();
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [otherFirmId, 'Leaky Firm', `leaky-${createId()}`, 'STARTER', new Date().toISOString()],
    });
    await createCustomAdaptor({ firmId: otherFirmId, name: 'TheirAdaptor', slug: 'their-adaptor' });

    const ourRows = await listCustomAdaptorsForFirm(firmId);
    expect(ourRows.every((r) => r.firmId === firmId)).toBe(true);
    expect(ourRows.some((r) => r.slug === 'their-adaptor')).toBe(false);
  });
});
