import crypto from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { findPortalSessionByJtiHash, touchPortalSession } from '../db/portalSession.js';

export interface PortalTokenPayload {
  /** Always "portal" — guards against accidentally accepting consultant tokens. */
  type: 'portal';
  memberId: string;
  engagementId: string;
  /** jti the session was signed with; we hash this and look it up. */
  jti: string;
  /** Session row PK so we can touch/revoke without an extra lookup. */
  sid: string;
}

export interface PortalMemberContext {
  sessionId: string;
  memberId: string;
  engagementId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    portalMember: PortalMemberContext;
  }
}

export function hashJti(jti: string): string {
  return crypto.createHash('sha256').update(jti).digest('hex');
}

/**
 * Strict portal authenticator. Requires a valid `portal_token` cookie whose
 * signed JWT resolves to a non-revoked, non-expired PortalSession.
 *
 * Decorates `request.portalMember = { sessionId, memberId, engagementId }`.
 */
export async function authenticatePortalSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  let payload: PortalTokenPayload;
  try {
    // @fastify/jwt attaches a `${namespace}JwtVerify` method to request.
    // Typed via declaration merging is verbose; cast once here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload = (await (request as any).portalJwtVerify()) as PortalTokenPayload;
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Portal authentication required' } });
  }

  if (payload.type !== 'portal' || !payload.jti || !payload.sid || !payload.memberId || !payload.engagementId) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid portal token shape' } });
  }

  const session = await findPortalSessionByJtiHash(hashJti(payload.jti));
  if (!session) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session not found' } });
  }
  if (session.revokedAt) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session revoked' } });
  }
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
  }
  if (session.memberId !== payload.memberId || session.engagementId !== payload.engagementId) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session/payload mismatch' } });
  }

  // Sliding refresh: if more than half of TTL has passed, extend to full TTL.
  const ttlDays = Number(process.env.PORTAL_SESSION_TTL_DAYS ?? 7);
  const ttlMs = ttlDays * 86400_000;
  const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
  if (remainingMs < ttlMs / 2) {
    const newExpires = new Date(Date.now() + ttlMs).toISOString();
    await touchPortalSession(session.id, newExpires);
  }

  request.portalMember = {
    sessionId: session.id,
    memberId: session.memberId,
    engagementId: session.engagementId,
  };
}
