/**
 * Phase 54.2 — engagement context loader for individual document
 * generators.
 *
 * Shared by the new per-doc export routes (/exports/kickoff-deck,
 * /exports/business-process-document) — each generator needs the
 * adaptor context + license + wizard answers that
 * `services/generation.ts` already plumbs through `processJob`.
 * Rather than duplicate that wiring, this helper re-creates the
 * minimal slice each generator needs from a single Customer/
 * Engagement id (Phase 52.1 made these equal).
 */
import { getDb } from '../../db/index.js';
import { buildAdaptorContext } from '../generation.js';
import type { AdaptorContext } from './../generators/brdGenerator.js';

export interface EngagementContext {
  engagementId: string;
  clientName: string;
  adaptor: AdaptorContext;
  license: { edition: string; modules: string[] };
  answers: Record<string, unknown>;
  members: Array<{ id: string; name: string; role?: string; team?: string }>;
}

interface EngagementRow {
  id: unknown;
  clientName: unknown;
  adaptorId: unknown;
  license: unknown;
  profile: unknown;
}

interface BusinessProfileRow {
  answers: unknown;
}

interface ProjectMemberRow {
  id: unknown;
  name: unknown;
  role: unknown;
  team: unknown;
}

function safeJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Loads everything a single-doc generator needs to produce a useful
 * artifact. Returns null when no engagement exists for the given id.
 */
export async function loadEngagementContext(
  engagementId: string,
): Promise<EngagementContext | null> {
  const db = getDb();
  const engRow = await db.execute({
    sql: `SELECT id, clientName, adaptorId, license, profile
          FROM Engagement WHERE id = ? LIMIT 1`,
    args: [engagementId],
  });
  const eng = engRow.rows[0] as unknown as EngagementRow | undefined;
  if (!eng) return null;

  const adaptorId = String(eng.adaptorId ?? 'netsuite');
  const licenseJson = safeJson<{ edition?: string; modules?: string[] }>(eng.license, {});
  const edition = licenseJson.edition ?? 'MID_MARKET';
  const modules = Array.isArray(licenseJson.modules) ? licenseJson.modules : [];

  const profileJson = safeJson<{ answers?: Record<string, unknown> }>(eng.profile, {});
  let answers: Record<string, unknown> = profileJson.answers ?? {};

  // BusinessProfile.answers is the canonical source — Engagement.profile
  // is the legacy fallback.
  const bp = await db.execute({
    sql: `SELECT answers FROM BusinessProfile WHERE engagementId = ? LIMIT 1`,
    args: [engagementId],
  });
  const bpRow = bp.rows[0] as unknown as BusinessProfileRow | undefined;
  if (bpRow) {
    const bpAnswers = safeJson<Record<string, unknown>>(bpRow.answers, {});
    answers = { ...answers, ...bpAnswers };
  }

  const membersResult = await db.execute({
    sql: `SELECT id, name, role, team FROM ProjectMember WHERE engagementId = ?`,
    args: [engagementId],
  });
  const members = membersResult.rows.map((raw) => {
    const r = raw as unknown as ProjectMemberRow;
    return {
      id: String(r.id),
      name: String(r.name ?? ''),
      role: r.role == null ? undefined : String(r.role),
      team: r.team == null ? undefined : String(r.team),
    };
  });

  return {
    engagementId: String(eng.id),
    clientName: String(eng.clientName ?? ''),
    adaptor: buildAdaptorContext(adaptorId, edition),
    license: { edition, modules },
    answers,
    members,
  };
}
