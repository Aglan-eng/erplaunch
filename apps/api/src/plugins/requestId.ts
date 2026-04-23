import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { incrementCounter } from '../services/metrics.js';

/**
 * Request ID plugin (Phase 20).
 *
 * Every request gets a short UUID, either:
 *   - parsed from an incoming X-Request-Id header (useful for tracing
 *     fan-out from a Vercel edge function into the API), OR
 *   - generated fresh if absent.
 *
 * The ID is:
 *   - attached to request.id (Fastify's native field, visible on every
 *     log line through pino's default serializer), and
 *   - echoed back on the response as X-Request-Id so ops can correlate
 *     a user-visible request with server logs.
 *
 * Pino already prints `reqId=` with each log via Fastify's default
 * serializer, so no additional logger wiring is required — overriding
 * request.id before routing hooks fire is enough.
 */
const requestIdPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id = (typeof incoming === 'string' && incoming.trim().length > 0 && incoming.length <= 128)
      ? incoming.trim()
      : randomUUID();
    // Fastify's request.id is a getter backed by the log-context — we
    // overwrite it via the internal symbol to make pino pick it up. Use
    // a structural approach: stash on request (visible to logs + tests)
    // and set the reply header.
    (request as unknown as { id: string }).id = id;
    reply.header('x-request-id', id);
  });

  // Global HTTP counter (Phase 20). Registered here rather than inside
  // metricsRoutes because this plugin is fp-wrapped (= not encapsulated)
  // and therefore its hooks fire for every route in the app. A hook
  // registered inside metricsRoutes would only see /metrics itself.
  fastify.addHook('onResponse', async (request, reply) => {
    const statusClass = `${Math.floor(reply.statusCode / 100)}xx`;
    incrementCounter('http_requests_total', {
      method: request.method,
      status_class: statusClass,
    });
  });
});

export default requestIdPlugin;
