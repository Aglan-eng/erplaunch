import type { FastifyRequest, FastifyReply } from 'fastify';

export interface JWTPayload {
  userId: string;
  firmId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    jwtUser: JWTPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request.jwtUser = (request as any).user as JWTPayload;
  } catch {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
}
