import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { setupTestDb } from '../_helpers/testDb.js';
import { getDb } from '../../src/db/index.js';
import { upsertFirmEmailSettings } from '../../src/db/firmEmailSettings.js';
import { sendEmailForFirm, __setTestTransportFactory } from '../../src/services/emailTransport.js';
import nodemailer, { type TransportOptions, type Transporter } from 'nodemailer';

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
  __setTestTransportFactory(null);
});

async function seedFirmWithEmail() {
  const db = getDb();
  const firmId = createId();
  await db.execute({
    sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
    args: [firmId, 'Mail Firm', `mail-${createId()}`, 'STARTER', new Date().toISOString()],
  });
  await upsertFirmEmailSettings(firmId, {
    fromEmail: 'portal@mail-firm.example',
    fromName: 'Mail Firm Portal',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: true,
    smtpUsername: 'portal@mail-firm.example',
    smtpPassword: 'smtp-pw',
    inboundProtocol: 'NONE',
  });
  return firmId;
}

describe('emailTransport: sendEmailForFirm', () => {
  it('resolves firm SMTP settings, creates a transport, and sends', async () => {
    const firmId = await seedFirmWithEmail();

    // Capture what nodemailer would have been given
    type SmtpAuthOpts = TransportOptions & { host?: string; port?: number; secure?: boolean; auth?: { user?: string; pass?: string } };
    let capturedOptions: SmtpAuthOpts | null = null;
    let capturedMessage: unknown = null;
    __setTestTransportFactory((opts) => {
      capturedOptions = opts as SmtpAuthOpts;
      return nodemailer.createTransport({ jsonTransport: true }) as Transporter;
    });

    const info = await sendEmailForFirm(firmId, {
      to: 'client@example.com',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    });

    expect(capturedOptions!.host).toBe('smtp.example.com');
    expect(capturedOptions!.port).toBe(587);
    expect(capturedOptions!.secure).toBe(true);
    expect(capturedOptions!.auth!.user).toBe('portal@mail-firm.example');
    expect(capturedOptions!.auth!.pass).toBe('smtp-pw');
    expect(info).toBeTruthy();
    capturedMessage = info;
    expect(JSON.stringify(capturedMessage)).toContain('client@example.com');
  });

  it('throws when firm has no email settings configured', async () => {
    const db = getDb();
    const firmId = createId();
    await db.execute({
      sql: `INSERT INTO Firm (id, name, slug, plan, createdAt) VALUES (?,?,?,?,?)`,
      args: [firmId, 'No Email Firm', `nomail-${createId()}`, 'STARTER', new Date().toISOString()],
    });

    await expect(
      sendEmailForFirm(firmId, { to: 'x@y.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/email settings/i);
  });

  it('sets From header to "<fromName> <fromEmail>" when fromName present', async () => {
    const firmId = await seedFirmWithEmail();
    // Captured but unused — set so the factory matches the expected signature.
    __setTestTransportFactory((_opts) => {
      return nodemailer.createTransport({ jsonTransport: true }) as Transporter;
    });
    const info = await sendEmailForFirm(firmId, {
      to: 'c@ex.com',
      subject: 'Subject',
      text: 'Body',
    }) as { message: string };
    // jsonTransport stores the message on info.message
    const msg = JSON.parse(info.message) as { from?: string | { address?: string } };
    expect(msg.from).toBeTruthy();
    const fromAddr = typeof msg.from === 'string' ? msg.from : msg.from?.address;
    expect(fromAddr ?? msg.from).toMatch(/portal@mail-firm.example/);
  });
});
