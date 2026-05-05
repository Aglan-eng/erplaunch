import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { initDb } from '../db/index.js';
import type { Client } from '@libsql/client';

declare module 'fastify' {
  interface FastifyInstance {
    db: Client;
  }
}

const dbPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const db = await initDb();
  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});

export default dbPlugin;
