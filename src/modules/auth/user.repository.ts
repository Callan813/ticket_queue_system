import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/** Fields that are safe to send to clients (never the password hash). */
export const publicUserSelect = { id: true, name: true, email: true, role: true, createdAt: true } as const;

export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findPublicById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  },

  create(data: { name: string; email: string; passwordHash: string; role: Role }) {
    return prisma.user.create({ data, select: publicUserSelect });
  },
};
