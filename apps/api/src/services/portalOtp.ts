import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  createPortalMagicLink,
  findActivePortalMagicLink,
  recordPortalMagicLinkAttempt,
  consumePortalMagicLink,
  invalidateActiveLinksForMember,
} from '../db/portalMagicLink.js';

function codeLength(): number {
  const n = Number(process.env.PORTAL_OTP_CODE_LENGTH ?? 6);
  return n >= 4 && n <= 10 ? n : 6;
}

function ttlMinutes(): number {
  const n = Number(process.env.PORTAL_OTP_TTL_MINUTES ?? 10);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

function maxAttempts(): number {
  const n = Number(process.env.PORTAL_OTP_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(n) && n >= 1 ? n : 5;
}

function generateNumericCode(length: number): string {
  // Cryptographically strong, numeric only, no bias.
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length);
    for (const b of bytes) {
      if (b < 250) {
        // reject values >=250 to avoid modulo bias on [0..9]
        out += String(b % 10);
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export interface IssueOtpResult {
  code: string;
  linkId: string;
  expiresAt: string;
}

export async function issuePortalOtp(input: {
  engagementId: string;
  memberId: string;
  ipHash?: string | null;
}): Promise<IssueOtpResult> {
  // Invalidate any prior active code first
  await invalidateActiveLinksForMember(input.memberId);

  const code = generateNumericCode(codeLength());
  const hash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + ttlMinutes() * 60_000).toISOString();
  const link = await createPortalMagicLink({
    engagementId: input.engagementId,
    memberId: input.memberId,
    codeHash: hash,
    expiresAt,
    maxAttempts: maxAttempts(),
    ipHash: input.ipHash ?? null,
  });

  return { code, linkId: link.id, expiresAt };
}

export type VerifyOtpResult =
  | { ok: true; linkId: string; engagementId: string }
  | { ok: false; reason: 'INVALID_CODE' | 'NO_ACTIVE_LINK' | 'RATE_LIMITED' };

export async function verifyPortalOtp(input: { memberId: string; code: string }): Promise<VerifyOtpResult> {
  const link = await findActivePortalMagicLink(input.memberId);
  if (!link) return { ok: false, reason: 'NO_ACTIVE_LINK' };

  if (link.attemptCount >= link.maxAttempts) {
    return { ok: false, reason: 'RATE_LIMITED' };
  }

  const match = await bcrypt.compare(input.code, link.codeHash);
  if (!match) {
    const count = await recordPortalMagicLinkAttempt(link.id);
    if (count >= link.maxAttempts) {
      return { ok: false, reason: 'RATE_LIMITED' };
    }
    return { ok: false, reason: 'INVALID_CODE' };
  }

  await consumePortalMagicLink(link.id);
  return { ok: true, linkId: link.id, engagementId: link.engagementId };
}
