import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../plugins/auth';
import { toOpenApi } from '../../lib/validation';
import { loginBody, registerBody } from './auth.schemas';
import { authController } from './auth.controller';

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/register',
    { schema: { tags: ['Auth'], summary: 'Create an account', body: toOpenApi(registerBody) } },
    authController.register,
  );

  app.post(
    '/auth/login',
    { schema: { tags: ['Auth'], summary: 'Log in and receive a JWT', body: toOpenApi(loginBody) } },
    authController.login,
  );

  app.get(
    '/auth/me',
    {
      schema: { tags: ['Auth'], summary: 'The current user', security: [{ bearerAuth: [] }] },
      preHandler: authenticate,
    },
    authController.me,
  );
}
