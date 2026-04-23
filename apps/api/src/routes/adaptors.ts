import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { getAdaptorRegistry } from '@ofoq/adaptor-registry';
import * as db from '../db/index.js';

/**
 * Platform adaptor discovery API.
 *
 * Phase 1A surfaced the process-wide registry for built-ins only. Phase 2
 * adds a firm-scoped overlay so published custom adaptors show up in the
 * same list — the ERP picker treats them identically, identified by the
 * `custom:<slug>` id prefix.
 */
export async function adaptorRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/adaptors',
    { preHandler: authenticate },
    async (request) => {
      const registry = getAdaptorRegistry();
      const builtins = registry.list();

      const customs = await db.listPublishedCustomAdaptorsForFirm(request.jwtUser.firmId);
      const customListings = customs.map((row) => {
        const manifest = (row.parsedManifest ?? {}) as Record<string, unknown>;
        return {
          id: `custom:${row.slug}`,
          name: row.name,
          tagline: (manifest.tagline as string | undefined) ?? 'Custom firm-authored adaptor',
          vendor: (manifest.vendor as string | undefined) ?? 'Custom',
          version: (manifest.version as string | undefined) ?? '1.0.0',
          sourceKind: 'custom' as const,
          capabilities: (manifest.capabilities as string[] | undefined) ?? ['document'],
          minSdk: (manifest.minSdk as string | undefined) ?? '0.1.0',
        };
      });

      return { data: [...builtins, ...customListings] };
    },
  );

  fastify.get(
    '/adaptors/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // Custom adaptor lookup — firm-scoped, only PUBLISHED rows are visible
      if (id.startsWith('custom:')) {
        const slug = id.slice('custom:'.length);
        const row = await db.findCustomAdaptorByFirmAndSlug(request.jwtUser.firmId, slug);
        if (!row || row.status !== 'PUBLISHED') {
          return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown adaptor' } });
        }
        const schema = (row.parsedSchema ?? { version: '1.0.0', flows: [] }) as { version: string; flows: Array<{ sections: Array<{ questions: unknown[] }> }> };
        const flowCount = Array.isArray(schema.flows) ? schema.flows.length : 0;
        const questionCount = Array.isArray(schema.flows)
          ? schema.flows.reduce((n, f) => n + (Array.isArray(f.sections) ? f.sections.reduce((m, s) => m + (Array.isArray(s.questions) ? s.questions.length : 0), 0) : 0), 0)
          : 0;
        return {
          data: {
            manifest: row.parsedManifest,
            license: row.parsedLicense,
            phases: row.parsedPhases,
            generators: row.parsedGenerators,
            schemaVersion: schema.version ?? '1.0.0',
            flowCount,
            questionCount,
          },
        };
      }

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
