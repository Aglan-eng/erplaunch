import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import {
  upsertFirmEmailSettings,
  getFirmEmailSettings,
  deleteFirmEmailSettings,
} from '../../src/db/firmEmailSettings.js';

const KEY_BACKUP = process.env.ERPLAUNCH_MASTER_KEY;
let cleanup: () => void;

beforeAll(async () => {
  process.env.ERPLAUNCH_MASTER_KEY = 'a'.repeat(64);
  const setup = await setupTestDb();
  cleanup = setup.cleanup;
});

afterAll(() => {
  cleanup();
  if (KEY_BACKUP !== undefined) process.env.ERPLAUNCH_MASTER_KEY = KEY_BACKUP;
  else delete process.env.ERPLAUNCH_MASTER_KEY;
});

async function seedFirm() {
  const db = getDb();
  const firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Email Firm', `email-firm-${createId()}`, 'STARTER', new Date().toISOString()],
  });
  return firmId;
}

describe('firmEmailSettings: upsert + get', () => {
  it('stores SMTP settings with encrypted password and reads them back', async () => {
    const firmId = await seedFirm();
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'portal@example.com',
      fromName: 'Acme Portal',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'portal@example.com',
      smtpPassword: 'plaintext-smtp-pass',
      inboundProtocol: 'IMAP',
      inboundHost: 'imap.example.com',
      inboundPort: 993,
      inboundSecure: true,
      inboundUsername: 'portal@example.com',
      inboundPassword: 'plaintext-imap-pass',
      inboundFolder: 'INBOX',
    });

    const settings = await getFirmEmailSettings(firmId);
    expect(settings).not.toBeNull();
    expect(settings!.fromEmail).toBe('portal@example.com');
    expect(settings!.smtpHost).toBe('smtp.example.com');
    expect(settings!.smtpPort).toBe(587);
    expect(settings!.smtpPassword).toBe('plaintext-smtp-pass'); // decrypted on read
    expect(settings!.inboundProtocol).toBe('IMAP');
    expect(settings!.inboundPassword).toBe('plaintext-imap-pass');
  });

  it('does not store plaintext passwords in the DB', async () => {
    const firmId = await seedFirm();
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'a@b.com',
      fromName: null,
      smtpHost: 'smtp.b.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: 'a@b.com',
      smtpPassword: 'DO-NOT-LEAK-THIS',
      inboundProtocol: 'NONE',
    });

    const db = getDb();
    const r = await db.execute({
      sql: `SELECT smtpPasswordCipher FROM FirmEmailSettings WHERE firmId = ?`,
      args: [firmId],
    });
    const cipher = (r.rows[0] as Record<string, unknown>).smtpPasswordCipher as string;
    expect(cipher).not.toContain('DO-NOT-LEAK-THIS');
    expect(cipher.length).toBeGreaterThan(0);
  });

  it('upsert replaces existing settings for the same firmId', async () => {
    const firmId = await seedFirm();
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'v1@example.com',
      fromName: null,
      smtpHost: 'smtp.v1.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'v1',
      smtpPassword: 'pw-v1',
      inboundProtocol: 'NONE',
    });
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'v2@example.com',
      fromName: null,
      smtpHost: 'smtp.v2.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: 'v2',
      smtpPassword: 'pw-v2',
      inboundProtocol: 'NONE',
    });
    const settings = await getFirmEmailSettings(firmId);
    expect(settings!.fromEmail).toBe('v2@example.com');
    expect(settings!.smtpHost).toBe('smtp.v2.com');
    expect(settings!.smtpPassword).toBe('pw-v2');
  });

  it('returns null for a firm with no settings', async () => {
    const firmId = await seedFirm();
    expect(await getFirmEmailSettings(firmId)).toBeNull();
  });

  it('supports POP3 inbound protocol', async () => {
    const firmId = await seedFirm();
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'pop@example.com',
      fromName: null,
      smtpHost: 'smtp.pop.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'pop',
      smtpPassword: 'pw',
      inboundProtocol: 'POP3',
      inboundHost: 'pop.example.com',
      inboundPort: 995,
      inboundSecure: true,
      inboundUsername: 'pop',
      inboundPassword: 'pop-pw',
    });
    const settings = await getFirmEmailSettings(firmId);
    expect(settings!.inboundProtocol).toBe('POP3');
    expect(settings!.inboundPort).toBe(995);
    expect(settings!.inboundPassword).toBe('pop-pw');
  });

  it('deleteFirmEmailSettings removes the row', async () => {
    const firmId = await seedFirm();
    await upsertFirmEmailSettings(firmId, {
      fromEmail: 'del@example.com',
      fromName: null,
      smtpHost: 'smtp.del.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUsername: 'del',
      smtpPassword: 'pw',
      inboundProtocol: 'NONE',
    });
    await deleteFirmEmailSettings(firmId);
    expect(await getFirmEmailSettings(firmId)).toBeNull();
  });
});
