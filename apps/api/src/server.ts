import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import staticPlugin from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import queuePlugin from './plugins/queue.js';
import requestIdPlugin from './plugins/requestId.js';
import { metricsRoutes } from './routes/metrics.js';
import { authRoutes } from './routes/auth.js';
import { googleAuthRoutes } from './routes/googleAuth.js';
import { engagementRoutes } from './routes/engagements.js';
import { riskRoutes } from './routes/risks.js';
import { issueRoutes } from './routes/issues.js';
import { decisionRoutes } from './routes/decisions.js';
import { meetingRoutes } from './routes/meetings.js';
import { migrationRoutes } from './routes/migration.js';
import { activityRoutes } from './routes/activity.js';
import { actionItemRoutes } from './routes/actionItems.js';
import { teamRoutes } from './routes/team.js';
import { closeoutRoutes } from './routes/closeout.js';
import { slaPortfolioRoutes } from './routes/slaPortfolio.js';
import { portalRoutes } from './routes/portal.js';
import { portalAuthRoutes } from './routes/portalAuth.js';
import { pendingSubmissionsRoutes } from './routes/pendingSubmissions.js';
// Phase 29 — WIZARD_ANSWER acceptor + payload schema. Side-effect import
// registers the acceptor with the registry at module-load time. Phases
// 30-32 import their own acceptor modules the same way.
import './services/wizardAnswerAcceptor.js';
// Phase 30 — DATA_FILE acceptor + payload schema.
import './services/dataFileAcceptor.js';
import { scheduleStagedFileGc } from './services/stagedFileGc.js';
// Phase 31 — QA_MESSAGE acceptor + payload schema.
import './services/qaMessageAcceptor.js';
import { threadsRoutes } from './routes/threads.js';
// Phase 32 — DECISION_SIGNOFF acceptor + payload schema.
import './services/decisionSignoffAcceptor.js';
import { firmBrandingRoutes } from './routes/firmBranding.js';
import { adaptorRoutes } from './routes/adaptors.js';
import { customAdaptorRoutes } from './routes/customAdaptors.js';
import { registerBuiltinAdaptor } from '@ofoq/adaptor-registry';
import netsuiteAdaptor from '@ofoq/adaptor-netsuite';
import odooAdaptor from '@ofoq/adaptor-odoo';

// Register built-in platform adaptors once at module load. Idempotent because
// each adaptor has a unique `manifest.id` and the registry refuses duplicates;
// but since registerBuiltinAdaptor is only called here, we avoid re-registering
// on hot-reload by guarding on an env-level flag.
if (!(globalThis as { __erplaunch_adaptors_registered?: boolean }).__erplaunch_adaptors_registered) {
  registerBuiltinAdaptor(netsuiteAdaptor);
  registerBuiltinAdaptor(odooAdaptor);
  (globalThis as { __erplaunch_adaptors_registered?: boolean }).__erplaunch_adaptors_registered = true;
}
import { verticalsRoutes } from './routes/verticals.js';
import { dataCollectionRoutes } from './routes/dataCollection.js';
import { exportRoutes } from './routes/export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  });

  // CORS_ORIGIN may be a single origin or a comma-separated allowlist. This
  // lets a deploy serve multiple SPA URLs (e.g. a legacy vercel.app preview
  // and the canonical subdomain) without an env-var change. When a list is
  // given, @fastify/cors reflects the request's Origin header only if it is
  // in the allowlist; otherwise the browser blocks the request.
  const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await fastify.register(cors, {
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  await fastify.register(cookie);

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  await fastify.register(jwt, {
    secret: jwtSecret || 'ofoq-dev-secret-local-only',
    cookie: { cookieName: 'token', signed: false },
  });

  // Portal session JWT — dedicated namespace + cookie + secret. Separate
  // secret ensures a leaked consultant JWT secret cannot mint portal sessions.
  const portalSecret = process.env.PORTAL_SESSION_COOKIE_SECRET;
  if (!portalSecret && process.env.NODE_ENV === 'production') {
    throw new Error('PORTAL_SESSION_COOKIE_SECRET environment variable is required in production');
  }
  await fastify.register(jwt, {
    namespace: 'portal',
    secret: portalSecret || 'erplaunch-dev-portal-secret-local-only',
    cookie: { cookieName: 'portal_token', signed: false },
  });

  // Phase 38.2 — bumped multipart server-level cap from 5MB → 11MB so
  // section images can carry up to 10MB of content. Per-route caps still
  // enforce smaller limits where appropriate (custom-adaptor docs are 5MB
  // soft-checked after read, section images are 10MB soft-checked).
  await fastify.register(multipart, { limits: { fileSize: 11 * 1024 * 1024 } });

  // Request-ID plugin (Phase 20). Registered before routes so every
  // route handler + log line sees the id.
  await fastify.register(requestIdPlugin);

  await fastify.register(dbPlugin);
  await fastify.register(redisPlugin);

  // Queue plugin must register after Redis — uses its own connection config
  // Gracefully skips if Redis is unavailable (jobs fall back to setImmediate)
  try {
    await fastify.register(queuePlugin);
  } catch {
    fastify.log.warn('BullMQ queue unavailable — generation jobs will run inline');
  }

  const outputDir = path.join(__dirname, '..', 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  await fastify.register(staticPlugin, {
    root: outputDir,
    prefix: '/outputs/',
    wildcard: true,
    decorateReply: false,
  });

  // Uploads directory for section images
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  await fastify.register(staticPlugin, {
    root: uploadsDir,
    prefix: '/uploads/',
    wildcard: true,
    decorateReply: false,
  });

  await fastify.register(authRoutes, { prefix: '/api/v1' });
  // Google OAuth routes — module is a no-op when GOOGLE_CLIENT_ID/SECRET/CALLBACK
  // env vars aren't set, except for the /auth/google/available probe which
  // always returns {available: false} so the UI can hide the button.
  await fastify.register(googleAuthRoutes, { prefix: '/api/v1' });
  await fastify.register(engagementRoutes, { prefix: '/api/v1' });
  await fastify.register(riskRoutes, { prefix: '/api/v1' });
  await fastify.register(issueRoutes, { prefix: '/api/v1' });
  await fastify.register(decisionRoutes, { prefix: '/api/v1' });
  await fastify.register(meetingRoutes, { prefix: '/api/v1' });
  await fastify.register(migrationRoutes, { prefix: '/api/v1' });
  await fastify.register(activityRoutes, { prefix: '/api/v1' });
  await fastify.register(actionItemRoutes, { prefix: '/api/v1' });
  // Phase 43.4 — Settings → Team page API.
  await fastify.register(teamRoutes, { prefix: '/api/v1' });
  // Phase 45.1 — Closeout checklist routes.
  await fastify.register(closeoutRoutes, { prefix: '/api/v1' });
  // Phase 45.5 — SLA portfolio dashboard.
  await fastify.register(slaPortfolioRoutes, { prefix: '/api/v1' });
  await fastify.register(portalAuthRoutes, { prefix: '/api/v1' });
  await fastify.register(portalRoutes, { prefix: '/api/v1' });
  // Phase 28 — pending-submission infrastructure (§5.1 foundation). Hosts
  // both the client portal-side POST /portal/submissions and the consultant-
  // side review CRUD; routes share the same prefix because they intermix
  // portal and consultant auth at the route level rather than the plugin
  // level (same pattern as portal.ts).
  await fastify.register(pendingSubmissionsRoutes, { prefix: '/api/v1' });
  // Phase 31 — consultant threads + messages (bypasses pending-review).
  await fastify.register(threadsRoutes, { prefix: '/api/v1' });
  await fastify.register(firmBrandingRoutes, { prefix: '/api/v1' });
  await fastify.register(adaptorRoutes, { prefix: '/api/v1' });
  await fastify.register(customAdaptorRoutes, { prefix: '/api/v1' });
  await fastify.register(verticalsRoutes, { prefix: '/api/v1' });
  await fastify.register(dataCollectionRoutes, { prefix: '/api/v1' });
  await fastify.register(exportRoutes, { prefix: '/api/v1' });
  // /metrics sits at the root (not /api/v1) so scrapers can hit a stable
  // path. The onResponse hook it registers counts ALL responses.
  await fastify.register(metricsRoutes);

  fastify.get('/health', async () => ({ ok: true, version: '0.2.0' }));

  fastify.setErrorHandler((error, _request, reply) => {
    fastify.log.error(error);
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: { code: 'INTERNAL_ERROR', message: statusCode === 500 ? 'Internal server error' : error.message },
    });
  });

  // Phase 30 — schedule the staged-file orphan GC. No-op under
  // NODE_ENV=test so vitest doesn't accumulate background timers.
  // Hourly sweep; default 24h max age. Logs + tolerates FS errors.
  const gcInterval = scheduleStagedFileGc();
  if (gcInterval) {
    fastify.addHook('onClose', async () => {
      clearInterval(gcInterval);
    });
  }

  return fastify;
}

const port = parseInt(process.env.API_PORT || '3000', 10);
const host = process.env.API_HOST || '0.0.0.0';

const server = await buildServer();

try {
  await server.listen({ port, host });
  console.log(`\n🚀 OFOQ API running at http://localhost:${port}\n`);
  // One-line env check at boot — makes it easy to verify APP_URL is wired
  // correctly in Render (password-reset + portal invite links both use it).
  // If this prints localhost in production, outbound email links will be
  // broken; fix the env var and redeploy.
  console.log(`[env] APP_URL=${process.env.APP_URL ?? '(unset → default http://localhost:5173)'}`);
  console.log(`[env] RESEND_API_KEY=${process.env.RESEND_API_KEY ? 'set' : '(unset — emails log to stdout only)'}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
