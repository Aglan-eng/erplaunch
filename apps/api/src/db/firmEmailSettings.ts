import { getDb } from './index.js';
import { encrypt, decrypt } from '../services/credentialCipher.js';

export type InboundProtocol = 'IMAP' | 'POP3' | 'NONE';

export interface FirmEmailSettingsInput {
  fromEmail: string;
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  inboundProtocol: InboundProtocol;
  inboundHost?: string | null;
  inboundPort?: number | null;
  inboundSecure?: boolean | null;
  inboundUsername?: string | null;
  inboundPassword?: string | null;
  inboundFolder?: string | null;
}

export interface FirmEmailSettings {
  firmId: string;
  fromEmail: string;
  fromName: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string; // decrypted on read
  inboundProtocol: InboundProtocol;
  inboundHost: string | null;
  inboundPort: number | null;
  inboundSecure: boolean | null;
  inboundUsername: string | null;
  inboundPassword: string | null; // decrypted on read
  inboundFolder: string | null;
  testedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

export async function upsertFirmEmailSettings(firmId: string, input: FirmEmailSettingsInput): Promise<void> {
  const db = getDb();
  const smtpCipher = encrypt(input.smtpPassword);
  const inboundCipher = input.inboundPassword ? encrypt(input.inboundPassword) : null;
  const now = new Date().toISOString();

  await db.execute({
    sql: `INSERT INTO FirmEmailSettings (
            firmId, fromEmail, fromName,
            smtpHost, smtpPort, smtpSecure, smtpUsername, smtpPasswordCipher,
            inboundProtocol, inboundHost, inboundPort, inboundSecure,
            inboundUsername, inboundPasswordCipher, inboundFolder,
            createdAt, updatedAt
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(firmId) DO UPDATE SET
            fromEmail             = excluded.fromEmail,
            fromName              = excluded.fromName,
            smtpHost              = excluded.smtpHost,
            smtpPort              = excluded.smtpPort,
            smtpSecure            = excluded.smtpSecure,
            smtpUsername          = excluded.smtpUsername,
            smtpPasswordCipher    = excluded.smtpPasswordCipher,
            inboundProtocol       = excluded.inboundProtocol,
            inboundHost           = excluded.inboundHost,
            inboundPort           = excluded.inboundPort,
            inboundSecure         = excluded.inboundSecure,
            inboundUsername       = excluded.inboundUsername,
            inboundPasswordCipher = excluded.inboundPasswordCipher,
            inboundFolder         = excluded.inboundFolder,
            updatedAt             = excluded.updatedAt`,
    args: [
      firmId,
      input.fromEmail,
      input.fromName,
      input.smtpHost,
      input.smtpPort,
      input.smtpSecure ? 1 : 0,
      input.smtpUsername,
      smtpCipher,
      input.inboundProtocol,
      input.inboundHost ?? null,
      input.inboundPort ?? null,
      input.inboundSecure == null ? null : input.inboundSecure ? 1 : 0,
      input.inboundUsername ?? null,
      inboundCipher,
      input.inboundFolder ?? null,
      now,
      now,
    ],
  });
}

export async function getFirmEmailSettings(firmId: string): Promise<FirmEmailSettings | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM FirmEmailSettings WHERE firmId = ?`, args: [firmId] });
  const row = r.rows[0] as Row | undefined;
  if (!row) return null;

  const smtpPassword = decrypt(row.smtpPasswordCipher as string);
  const inboundCipher = row.inboundPasswordCipher as string | null;
  const inboundPassword = inboundCipher ? decrypt(inboundCipher) : null;

  return {
    firmId: row.firmId as string,
    fromEmail: row.fromEmail as string,
    fromName: (row.fromName as string | null) ?? null,
    smtpHost: row.smtpHost as string,
    smtpPort: Number(row.smtpPort),
    smtpSecure: Number(row.smtpSecure) === 1,
    smtpUsername: row.smtpUsername as string,
    smtpPassword,
    inboundProtocol: row.inboundProtocol as InboundProtocol,
    inboundHost: (row.inboundHost as string | null) ?? null,
    inboundPort: row.inboundPort != null ? Number(row.inboundPort) : null,
    inboundSecure: row.inboundSecure != null ? Number(row.inboundSecure) === 1 : null,
    inboundUsername: (row.inboundUsername as string | null) ?? null,
    inboundPassword,
    inboundFolder: (row.inboundFolder as string | null) ?? null,
    testedAt: (row.testedAt as string | null) ?? null,
    lastTestResult: (row.lastTestResult as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function deleteFirmEmailSettings(firmId: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM FirmEmailSettings WHERE firmId = ?`, args: [firmId] });
}

export async function recordFirmEmailTestResult(firmId: string, result: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `UPDATE FirmEmailSettings SET testedAt = ?, lastTestResult = ? WHERE firmId = ?`,
    args: [new Date().toISOString(), result, firmId],
  });
}
