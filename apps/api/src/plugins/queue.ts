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
    generationQueue: Queue<GenerationJobData>;
    generationWorker: Worker<GenerationJobData>;
  }
}

const queuePlugin: FastifyPluginAsync = fp(async (fastify) => {
  const redisConnection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
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
    }
  );

  generationWorker.on('completed', (job) => {
    fastify.log.info(`[queue] Job ${job.data.jobId} completed`);
  });

  generationWorker.on('failed', (job, err) => {
    fastify.log.error(`[queue] Job ${job?.data.jobId} failed: ${err.message}`);
  });

  // Prevent crashes if Redis is unavailable
  generationWorker.on('error', (err) => {
    fastify.log.error(`[queue] Worker error: ${err.message}`);
  });

  generationQueue.on('error', (err) => {
    fastify.log.error(`[queue] Queue error: ${err.message}`);
  });

  fastify.decorate('generationQueue', generationQueue);
  fastify.decorate('generationWorker', generationWorker);

  fastify.addHook('onClose', async () => {
    await generationWorker.close();
    await generationQueue.close();
  });
});

export default queuePlugin;
