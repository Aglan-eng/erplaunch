import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { LoginSchema } from '@ofoq/shared';
import { authenticate } from '../middleware/auth.js';
import { findUserByEmail, findUserById } from '../db/index.js';

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const result = LoginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: result.error.message } });
    }

    const { email, password } = result.data;

    const user = await findUserByEmail(email) as Record<string, unknown> & { passwordHash: string; id: string; firmId: string; role: string; email: string; name: string; firm: Record<string, unknown> } | null;

    if (!user || !(await bcrypt.compare(password, user.passwordHash as string))) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    const token = fastify.jwt.sign(
      { userId: user.id, firmId: user.firmId, role: user.role },
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Cross-origin cookie: web on vercel.app + api on onrender.com are
    // cross-site. Browsers require SameSite=None + Secure to share the cookie.
    // Fall back to Lax for local dev (http://localhost).
    const isProd = process.env.NODE_ENV === 'production';
    reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
      .send({
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            firmId: user.firmId,
            firm: user.firm,
          },
        },
      });
  });

  // POST /auth/logout
  fastify.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ data: { ok: true } });
  });

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await findUserById(request.jwtUser.userId) as Record<string, unknown> & { id: string; email: string; name: string; role: string; firmId: string; firm: Record<string, unknown> } | null;

    if (!user) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    return reply.send({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        firmId: user.firmId,
        firm: user.firm,
      },
    });
  });
}
