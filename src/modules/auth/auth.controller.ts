import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentUser } from '../../plugins/auth';
import { parse } from '../../lib/validation';
import { loginBody, registerBody } from './auth.schemas';
import { authService } from './auth.service';

export const authController = {
  async register(request: FastifyRequest, reply: FastifyReply) {
    const input = parse(registerBody, request.body);
    const result = await authService.register(input);
    return reply.status(201).send(result);
  },

  async login(request: FastifyRequest) {
    const input = parse(loginBody, request.body);
    return authService.login(input);
  },

  async me(request: FastifyRequest) {
    return { user: await authService.me(currentUser(request).id) };
  },
};
