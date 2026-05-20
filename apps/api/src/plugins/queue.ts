/**
 * BullMQ job queue plugin
 *
 * Registers:
 *   fastify.generationQueue  — Queue instance (for enqueuing jobs)
 *   fastify.generationWorker — Worker instance (processes jobs)
 *
 * The worker calls processJob() for each job dequeued, exactly matching
 * the synchronous implementation it replaces. Jobs now run out-of-process
 * from the HTTP request, enabling proper QUEUED → RUNNING → COMPLETE
 * lifecycle transitions visible to polling clients.
 *
 * Phase-52.9.2 hotfix:
 *   - If REDIS_HOST is not set (and we're not in test), skip registering
 *     the queue + worker entirely. Previously ioredis defaulted to
 *     `localhost:6379`, failed continuously on Render where there is no
 *     local Redis, and the Worker emitted an `error` event every ~20s
 *     (the crash-loop the operator observed in the prod logs).
 *   - Callers (engagements.ts) already guard on
 *     `fastify.generationQueue` being undefined and fall back to
 *     `setImmediate(processJob)`, so the no-Redis path is safe.
 *   - Error handlers now serialize the full stack / JSON instead of
 *     reading `.message` (which was often empty on BullMQ-wrapped
 *     connection errors, hiding the real cause).
 */
import fp from 'fastify-plugin';
import { Queue, Worker, type Job } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';
import { processJob } from '../services/generation.js';
import * as db from '../db/index.js';

export const GENERATION_QUEUE = 'generation';

export interface GenerationJobData {
  jobId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    generationQueue?: Queue<GenerationJobData>;
    generationWorker?: Worker<GenerationJobData>;
  }
}

/**
 * Serialize an unknown error for the log. Reading `.message` alone
 * silently dropped Redis connection errors whose message lives on
 * `.cause` or whose type wraps the original — we now always emit
 * something useful.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? `${err.name}: ${err.message}`;
  }
  // JSON.stringify(undefined) returns undefined (not a string) and
  // can throw on circular refs — guard both. Empty falsy serialisations
  // fall through to String() so the logger never emits a blank message.
  try {
    const json = JSON.stringify(err);
    if (json) return json;
  } catch {
    /* fall through */
  }
  return String(err);
}

const queuePlugin: FastifyPluginAsync = fp(async (fastify) => {
  // Skip queue registration when Redis isn't configured. Production
  // crash-loops surfaced because ioredis fell back to localhost:6379
  // (no Redis on Render) and emitted an `error` event on every retry.
  const redisHost = process.env.REDIS_HOST;
  const queueDisabled = process.env.QUEUE_DISABLED === 'true';
  if (!redisHost || queueDisabled) {
    fastify.log.warn(
      '[queue] Skipping BullMQ registration: ' +
        (queueDisabled
          ? 'QUEUE_DISABLED=true'
          : 'REDIS_HOST not set — set it to enable async job processing. ' +
            'Routes that depend on the queue will fall back to in-process execution.'),
    );
    return;
  }

  const redisConnection = {
    host: redisHost,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    // Fail fast on connection errors rather than retrying forever.
    // Without this, ioredis emits 'error' on every backoff tick and
    // the prod logs filled with empty-message errors every ~20s.
    maxRetriesPerRequest: null as number | null,
    enableOfflineQueue: false,
  };

  // ── Queue (producer) ────────────────────────────────────────────────────────
  const generationQueue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  // ── Worker (consumer) ───────────────────────────────────────────────────────
  const generationWorker = new Worker<GenerationJobData>(
    GENERATION_QUEUE,
    async (job: Job<GenerationJobData>) => {
      fastify.log.info(`[queue] Processing job ${job.data.jobId}`);
      await processJob(job.data.jobId, db);
    },
    {
      connection: redisConnection,
      concurrency: 2,
    },
  );

  generationWorker.on('completed', (job) => {
    fastify.log.info(`[queue] Job ${job.data.jobId} completed`);
  });

  generationWorker.on('failed', (job, err) => {
    fastify.log.error(`[queue] Job ${job?.data.jobId} failed: ${describeError(err)}`);
  });

  generationWorker.on('error', (err) => {
    fastify.log.error(`[queue] Worker error: ${describeError(err)}`);
  });

  generationQueue.on('error', (err) => {
    fastify.log.error(`[queue] Queue error: ${describeError(err)}`);
  });

  fastify.decorate('generationQueue', generationQueue);
  fastify.decorate('generationWorker', generationWorker);

  fastify.addHook('onClose', async () => {
    await generationWorker.close();
    await generationQueue.close();
  });
});

// Exported only so the route + plugin tests can exercise the
// serializer without spinning up a Redis connection.
export const _testOnlyDescribeError = describeError;

export default queuePlugin;
