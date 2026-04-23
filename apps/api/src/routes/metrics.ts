import type { FastifyInstance } from 'fastify';
import { renderMetrics } from '../services/metrics.js';

/**
 * /metrics route (Phase 20).
 *
 * Returns Prometheus text exposition format. The onResponse hook that
 * counts http_requests_total is registered in the global
 * requestIdPlugin (fp-wrapped, not encapsulated) so it sees every route
 * in the app — not just this one.
 *
 * Deliberately unauthenticated for pilot simplicity. Post-pilot the
 * scraper either runs inside the private network or hits a shared-secret
 * header. See ROADMAP.md Observability slice.
 */
export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return renderMetrics();
  });
}
