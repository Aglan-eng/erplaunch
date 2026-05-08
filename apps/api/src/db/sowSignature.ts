/**
 * Phase 46.5 — SOW signature DB layer.
 *
 * One row per signature attempt against a SOW version. The same
 * version can have multiple signature rows over time (e.g., a
 * DocuSign envelope was sent, the recipient declined, then the
 * sales rep tried again with a manual upload). The route layer is
 * the source of truth for transition rules; the DB layer is dumb
 * persistence + lookups.
 */
import { createId } from '@paralleldrive/cuid2';
import { getDb } from './index.js';

export type SowSignaturePath = 'DOCUSIGN' | 'MANUAL';
export type SowSignatureStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'DECLINED'
  | 'EXPIRED';

export const SOW_SIGNATURE_STATUSES: ReadonlyArray<SowSignatureStatus> = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'SIGNED',
  'DECLINED',
  'EXPIRED',
];

export function isSowSignatureStatus(s: string): s is SowSignatureStatus {
  return (SOW_SIGNATURE_STATUSES as readonly string[]).includes(s);
}

export interface EngagementSowSignature {
  id: string;
  engagementId: string;
  sowVersionId: string;
  signaturePath: SowSignaturePath;
  docusignEnvelopeId: string | null;
  signedFileUrl: string | null;
  status: SowSignatureStatus;
  sentAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  signedByName: string | null;
  signedByEmail: string | null;
  signedByTitle: string | null;
  signerIpHash: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function toSig(row: Row): EngagementSowSignature {
  return {
    id: row.id as string,
    engagementId: row.engagementId as string,
    sowVersionId: row.sowVersionId as string,
    signaturePath: row.signaturePath as SowSignaturePath,
    docusignEnvelopeId: (row.docusignEnvelopeId as string | null) ?? null,
    signedFileUrl: (row.signedFileUrl as string | null) ?? null,
    status: row.status as SowSignatureStatus,
    sentAt: (row.sentAt as string | null) ?? null,
    signedAt: (row.signedAt as string | null) ?? null,
    declinedAt: (row.declinedAt as string | null) ?? null,
    signedByName: (row.signedByName as string | null) ?? null,
    signedByEmail: (row.signedByEmail as string | null) ?? null,
    signedByTitle: (row.signedByTitle as string | null) ?? null,
    signerIpHash: (row.signerIpHash as string | null) ?? null,
    createdByUserId: (row.createdByUserId as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export async function createSowSignature(input: {
  engagementId: string;
  sowVersionId: string;
  signaturePath: SowSignaturePath;
  docusignEnvelopeId?: string | null;
  status?: SowSignatureStatus;
  createdByUserId?: string | null;
}): Promise<EngagementSowSignature> {
  const db = getDb();
  const id = createId();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO EngagementSowSignature
            (id, engagementId, sowVersionId, signaturePath, docusignEnvelopeId, status,
             createdByUserId, createdAt, updatedAt, sentAt)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      input.engagementId,
      input.sowVersionId,
      input.signaturePath,
      input.docusignEnvelopeId ?? null,
      input.status ?? 'DRAFT',
      input.createdByUserId ?? null,
      now,
      now,
      input.status === 'SENT' ? now : null,
    ],
  });
  const r = await db.execute({ sql: `SELECT * FROM EngagementSowSignature WHERE id = ?`, args: [id] });
  return toSig(r.rows[0] as Row);
}

export async function findSowSignatureById(id: string): Promise<EngagementSowSignature | null> {
  const db = getDb();
  const r = await db.execute({ sql: `SELECT * FROM EngagementSowSignature WHERE id = ?`, args: [id] });
  return r.rows[0] ? toSig(r.rows[0] as Row) : null;
}

export async function findSowSignatureByEnvelopeId(envelopeId: string): Promise<EngagementSowSignature | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowSignature WHERE docusignEnvelopeId = ? LIMIT 1`,
    args: [envelopeId],
  });
  return r.rows[0] ? toSig(r.rows[0] as Row) : null;
}

export async function listSowSignaturesByEngagement(engagementId: string): Promise<EngagementSowSignature[]> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT * FROM EngagementSowSignature WHERE engagementId = ? ORDER BY createdAt DESC`,
    args: [engagementId],
  });
  return (r.rows as Row[]).map(toSig);
}

export async function updateSowSignature(
  id: string,
  patch: Partial<{
    status: SowSignatureStatus;
    docusignEnvelopeId: string | null;
    signedFileUrl: string | null;
    sentAt: string | null;
    signedAt: string | null;
    declinedAt: string | null;
    signedByName: string | null;
    signedByEmail: string | null;
    signedByTitle: string | null;
    signerIpHash: string | null;
  }>,
): Promise<EngagementSowSignature | null> {
  const db = getDb();
  const sets: string[] = ['updatedAt = ?'];
  const args: (string | null)[] = [new Date().toISOString()];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    args.push(v as string | null);
  }
  args.push(id);
  await db.execute({
    sql: `UPDATE EngagementSowSignature SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
  return findSowSignatureById(id);
}
