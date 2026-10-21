import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors';
import { type AuthUser, verifyAccessToken } from '../lib/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/** preHandler: requires a valid JWT and sets `request.user`. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  const token = readBearerToken(request);
  const user = token ? verifyAccessToken(token) : null;
  if (!user) throw unauthorized('Missing or invalid access token');
  request.user = user;
}

/** preHandler: sets `request.user` when a valid token is present, but never rejects. */
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply) {
  const token = readBearerToken(request);
  request.user = (token && verifyAccessToken(token)) || undefined;
}

/** preHandler factory: requires the authenticated user to have the given role. */
export function requireRole(role: Role) {
  return async function checkRole(request: FastifyRequest, reply: FastifyReply) {
    await authenticate(request, reply);
    if (request.user!.role !== role) throw forbidden(`Only ${role.toLowerCase()}s can do this`);
  };
}

/** For handlers behind `authenticate`: the user is guaranteed to be present. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw unauthorized();
  return request.user;
}
