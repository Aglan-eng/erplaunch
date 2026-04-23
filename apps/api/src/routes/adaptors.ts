import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getAdaptorRegistry } from '@ofoq/adaptor-registry';

/**
 * Platform adaptor discovery API (Phase 1A).
 *
 * Today this just surfaces the adaptor-registry's listings. Future:
 * - POST /adaptors/custom/upload — uploads a questionnaire doc, triggers
 *   AI-parse, returns a draft CustomAdaptor the consultant can edit.
 * - GET /adaptors/:id/schema — full schema for the ERP picker's preview.
 */
export async function adaptorRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/adaptors',
    { preHandler: authenticate },
    async () => {
      const registry = getAdaptorRegistry();
      return { data: registry.list() };
    },
  );

  fastify.get(
    '/adaptors/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const registry = getAdaptorRegistry();
      const adaptor = registry.find(id);
      if (!adaptor) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown adaptor' } });
      }
      return {
        data: {
          manifest: adaptor.manifest,
          license: adaptor.license,
          phases: adaptor.phases,
          generators: adaptor.generators,
          schemaVersion: adaptor.schema.version,
          flowCount: adaptor.schema.flows.length,
          questionCount: adaptor.schema.flows.reduce(
            (n, f) => n + f.sections.reduce((m, s) => m + s.questions.length, 0),
            0,
          ),
        },
      };
    },
  );
}
