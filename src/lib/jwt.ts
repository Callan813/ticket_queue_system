import jwt from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { config } from '../config';

export interface AuthUser {
  id: string;
  role: Role;
}

interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role };
  return jwt.sign(payload, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Returns the user encoded in the token, or null if it is invalid/expired. */
export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload;
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}
