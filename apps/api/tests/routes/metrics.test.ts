import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import requestIdPlugin from '../../src/plugins/requestId.js';
import { metricsRoutes } from '../../src/routes/metrics.js';
import { __resetMetricsForTests } from '../../src/services/metrics.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(requestIdPlugin);
  await app.register(metricsRoutes);
  // Add a trivial route so we can probe the global onResponse hook.
  app.get('/probe/ok', async () => ({ ok: true }));
  app.get('/probe/fail', async (_req, reply) => reply.code(500).send({ err: 'boom' }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  __resetMetricsForTests();
});

describe('requestIdPlugin', () => {
  it('adds x-request-id to every response when no incoming header is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe/ok' });
    expect(res.statusCode).toBe(200);
    const header = res.headers['x-request-id'];
    expect(typeof header).toBe('string');
    expect((header as string).length).toBeGreaterThan(10);
  });

  it('echoes the incoming X-Request-Id header back on the response', async () => {
    const upstream = 'req-abc-123';
    const res = await app.inject({
      method: 'GET', url: '/probe/ok',
      headers: { 'x-request-id': upstream },
    });
    expect(res.headers['x-request-id']).toBe(upstream);
  });

  it('rejects absurdly long incoming ids and falls back to a fresh UUID', async () => {
    const tooLong = 'a'.repeat(1024);
    const res = await app.inject({
      method: 'GET', url: '/probe/ok',
      headers: { 'x-request-id': tooLong },
    });
    const header = res.headers['x-request-id'] as string;
    expect(header).not.toBe(tooLong);
    expect(header.length).toBeLessThan(128);
  });
});

describe('GET /metrics', () => {
  it('serves Prometheus text format with counter defaults', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# TYPE http_requests_total counter');
    expect(res.body).toContain('auth_login_total 0');
  });

  it('increments http_requests_total on every probed response', async () => {
    await app.inject({ method: 'GET', url: '/probe/ok' });
    await app.inject({ method: 'GET', url: '/probe/ok' });
    await app.inject({ method: 'GET', url: '/probe/fail' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('http_requests_total{method="GET",status_class="2xx"} 2');
    expect(res.body).toContain('http_requests_total{method="GET",status_class="5xx"} 1');
    // /metrics itself just fired — should be counted too but not read here;
    // it would land in a subsequent snapshot.
  });
});
