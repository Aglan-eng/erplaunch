/**
 * Phase 56.2 — Account + Project routes.
 *
 *   GET    /api/v1/accounts                 — list accounts for firm
 *   GET    /api/v1/accounts/:id             — account detail + projects
 *   POST   /api/v1/accounts                 — create a new account
 *   POST   /api/v1/accounts/:id/projects    — create a project under it
 *   POST   /api/v1/leads                    — convenience "new lead":
 *           - { accountId, projectName }           → new project at LEAD under existing account
 *           - { newAccount: {…}, projectName }     → new Account + project at LEAD in one call
 *
 * Every endpoint is firm-scoped. The Customer row IS the Project — the
 * Phase 56.1 backfill linked every existing customer to one Account.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../db/index.js';
import {
  PROJECT_KINDS,
  createAccount,
  createProject,
  getAccount,
  listAccounts,
  listProjectsForAccount,
  type ProjectKind,
} from '../db/account.js';
import { CUSTOMER_STAGES, isCustomerStage, type CustomerStage } from '../db/customer.js';

// ─── Schemas ───────────────────────────────────────────────────────────────

const CreateAccountBody = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(1000).nullable().optional(),
  primaryContactName: z.string().max(200).nullable().optional(),
  primaryContactEmail: z.string().email().nullable().optional(),
  primaryContactPhone: z.string().max(50).nullable().optional(),
});

const ProjectKindEnum = z.enum([...PROJECT_KINDS] as [ProjectKind, ...ProjectKind[]]);

const CreateProjectBody = z.object({
  projectName: z.string().min(1).max(200),
  projectKind: ProjectKindEnum.optional(),
  startStage: z
    .string()
    .refine(isCustomerStage, { message: 'startStage must be a valid customer stage' })
    .optional(),
  salesOwnerUserId: z.string().nullable().optional(),
  projectLeadUserId: z.string().nullable().optional(),
  csmUserId: z.string().nullable().optional(),
  arOwnerUserId: z.string().nullable().optional(),
});

const NewLeadBody = z
  .object({
    projectName: z.string().min(1).max(200),
    accountId: z.string().min(1).max(200).optional(),
    newAccount: CreateAccountBody.optional(),
  })
  .refine((b) => Boolean(b.accountId) !== Boolean(b.newAccount), {
    message: 'Exactly one of accountId or newAccount must be provided.',
  });

// ─── Helpers ───────────────────────────────────────────────────────────────

interface ProjectsAggregateRow {
  accountId: unknown;
  projectCount: unknown;
  worstHealth: unknown;
}

async function loadAccountAggregates(firmId: string): Promise<
  Map<string, { projectCount: number; worstHealth: number | null }>
> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT accountId,
                 COUNT(*) AS projectCount,
                 MIN(health) AS worstHealth
          FROM Customer
          WHERE firmId = ? AND accountId IS NOT NULL AND isArchived = 0
          GROUP BY accountId`,
    args: [firmId],
  });
  const out = new Map<string, { projectCount: number; worstHealth: number | null }>();
  for (const raw of r.rows) {
    const row = raw as unknown as ProjectsAggregateRow;
    out.set(String(row.accountId), {
      projectCount: Number(row.projectCount ?? 0),
      worstHealth: row.worstHealth == null ? null : Number(row.worstHealth),
    });
  }
  return out;
}

function healthBand(score: number | null): 'red' | 'yellow' | 'green' | null {
  if (score == null) return null;
  if (score < 30) return 'red';
  if (score < 70) return 'yellow';
  return 'green';
}

async function writeActivity(opts: {
  customerId: string;
  firmId: string;
  actorUserId: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  try {
    await db.execute({
      sql: `INSERT INTO ActivityLog
              (id, engagementId, customerId, firmId, action, details, actorUserId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `act_${createId()}`,
        opts.customerId, // Phase 52.1 invariant: Customer.id === Engagement.id
        opts.customerId,
        opts.firmId,
        opts.action,
        opts.details ? JSON.stringify(opts.details) : null,
        opts.actorUserId,
        new Date().toISOString(),
      ],
    });
  } catch {
    // Some legacy customers were created without a parallel Engagement
    // row — the ActivityLog FK on engagementId fails. The 56.2 surfaces
    // tolerate this so a new lead/project still succeeds. The audit
    // gap is documented for Phase 56.5 to repair.
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────

export async function accountsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /accounts — list with project count + worst health.
  fastify.get('/accounts', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const accounts = await listAccounts(firmId);
    const aggregates = await loadAccountAggregates(firmId);
    return reply.send({
      accounts: accounts.map((a) => {
        const agg = aggregates.get(a.id) ?? { projectCount: 0, worstHealth: null };
        return {
          id: a.id,
          name: a.name,
          address: a.address,
          primaryContactName: a.primaryContactName,
          primaryContactEmail: a.primaryContactEmail,
          primaryContactPhone: a.primaryContactPhone,
          archived: a.archived,
          projectCount: agg.projectCount,
          worstHealth: agg.worstHealth,
          worstHealthBand: healthBand(agg.worstHealth),
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        };
      }),
    });
  });

  // GET /accounts/:id — detail + projects.
  fastify.get('/accounts/:id', async (request, reply) => {
    const firmId = request.jwtUser.firmId;
    const { id } = request.params as { id: string };
    const account = await getAccount(id, firmId);
    if (!account) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const projects = await listProjectsForAccount(account.id);
    return reply.send({
      account: {
        id: account.id,
        name: account.name,
        address: account.address,
        primaryContactName: account.primaryContactName,
        primaryContactEmail: account.primaryContactEmail,
        primaryContactPhone: account.primaryContactPhone,
        archived: account.archived,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
      projects: projects.map((p) => ({
        id: p.id,
        projectName: p.projectName,
        projectKind: p.projectKind,
        currentStage: p.currentStage,
        health: p.health,
        healthBand: healthBand(p.health),
        isArchived: p.isArchived,
        createdAt: p.createdAt,
      })),
    });
  });

  // POST /accounts — create a new account.
  fastify.post('/accounts', async (request, reply) => {
    const parsed = CreateAccountBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const account = await createAccount({
      firmId,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      primaryContactName: parsed.data.primaryContactName ?? null,
      primaryContactEmail: parsed.data.primaryContactEmail ?? null,
      primaryContactPhone: parsed.data.primaryContactPhone ?? null,
    });
    return reply.code(201).send({ account });
  });

  // POST /accounts/:id/projects — create a project under this account.
  fastify.post('/accounts/:id/projects', async (request, reply) => {
    const parsed = CreateProjectBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;
    const { id } = request.params as { id: string };
    const account = await getAccount(id, firmId);
    if (!account) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    }
    const startStage = (parsed.data.startStage as CustomerStage) ?? 'LEAD';
    if (!(CUSTOMER_STAGES as readonly string[]).includes(startStage)) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid startStage' },
      });
    }
    const { projectId } = await createProject({
      accountId: account.id,
      firmId,
      projectName: parsed.data.projectName,
      projectKind: parsed.data.projectKind ?? 'INITIAL_IMPLEMENTATION',
      initialStage: startStage,
      salesOwnerUserId: parsed.data.salesOwnerUserId ?? null,
      projectLeadUserId: parsed.data.projectLeadUserId ?? null,
      csmUserId: parsed.data.csmUserId ?? null,
      arOwnerUserId: parsed.data.arOwnerUserId ?? null,
    });
    // Best-effort matching Engagement row so child rows that key off
    // engagementId still resolve. Mirrors Phase 52.1 backfill behaviour.
    const db = getDb();
    try {
      await db.execute({
        sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
              VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
        args: [projectId, firmId, account.name, new Date().toISOString(), new Date().toISOString()],
      });
    } catch {
      /* engagement row already exists */
    }
    await writeActivity({
      customerId: projectId,
      firmId,
      actorUserId: userId,
      action: 'PROJECT_CREATED',
      details: {
        projectName: parsed.data.projectName,
        projectKind: parsed.data.projectKind ?? 'INITIAL_IMPLEMENTATION',
        startStage,
        accountId: account.id,
      },
    });
    return reply.code(201).send({ projectId, accountId: account.id });
  });

  // POST /leads — convenience flow for "new lead came in".
  fastify.post('/leads', async (request, reply) => {
    const parsed = NewLeadBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      });
    }
    const firmId = request.jwtUser.firmId;
    const userId = request.jwtUser.userId;

    let accountId: string;
    let accountName: string;
    let createdNewAccount = false;
    if (parsed.data.accountId) {
      const acct = await getAccount(parsed.data.accountId, firmId);
      if (!acct) return reply.code(404).send({ error: { code: 'ACCOUNT_NOT_FOUND' } });
      accountId = acct.id;
      accountName = acct.name;
    } else {
      // newAccount path
      const na = parsed.data.newAccount!;
      const acct = await createAccount({
        firmId,
        name: na.name,
        address: na.address ?? null,
        primaryContactName: na.primaryContactName ?? null,
        primaryContactEmail: na.primaryContactEmail ?? null,
        primaryContactPhone: na.primaryContactPhone ?? null,
      });
      accountId = acct.id;
      accountName = acct.name;
      createdNewAccount = true;
    }

    const { projectId } = await createProject({
      accountId,
      firmId,
      projectName: parsed.data.projectName,
      projectKind: 'INITIAL_IMPLEMENTATION',
      initialStage: 'LEAD',
      salesOwnerUserId: userId,
    });
    // Parallel Engagement row.
    const db = getDb();
    try {
      await db.execute({
        sql: `INSERT INTO Engagement (id, firmId, clientName, status, createdAt, updatedAt)
              VALUES (?, ?, ?, 'PROSPECT', ?, ?)`,
        args: [projectId, firmId, accountName, new Date().toISOString(), new Date().toISOString()],
      });
    } catch {
      /* idempotent */
    }
    await writeActivity({
      customerId: projectId,
      firmId,
      actorUserId: userId,
      action: 'LEAD_CREATED',
      details: {
        projectName: parsed.data.projectName,
        accountId,
        createdNewAccount,
      },
    });
    return reply.code(201).send({
      accountId,
      projectId,
      createdNewAccount,
    });
  });
}
