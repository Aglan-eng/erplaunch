import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyPluginAsync } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    redis: InstanceType<typeof Redis>;
  }
}

const redisPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    retryStrategy: () => null,       // disable reconnect loop
    reconnectOnError: () => false,   // don't reconnect on command errors
  });

  // Suppress unhandled error events — Redis is optional
  redis.on('error', () => {/* silenced */});

  try {
    await redis.connect();
  } catch {
    fastify.log.warn('Redis unavailable — running without cache');
  }

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    redis.disconnect();
  });
});

export default redisPlugin;
