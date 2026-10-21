import bcrypt from 'bcrypt';
import { AppError, conflict, notFound } from '../../lib/errors';
import { signAccessToken } from '../../lib/jwt';
import { isUniqueViolation } from '../../lib/prisma';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { userRepository } from './user.repository';

const BCRYPT_ROUNDS = 10;

// Compared against when the email doesn't exist, so a login for an unknown
// email takes as long as one with a wrong password (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

export const authService = {
  async register(input: RegisterInput) {
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    try {
      const user = await userRepository.create({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
      });
      return { user, token: signAccessToken(user) };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      throw err;
    }
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email);
    const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    const { passwordHash: _omit, ...publicUser } = user;
    return { user: publicUser, token: signAccessToken(user) };
  },

  async me(userId: string) {
    const user = await userRepository.findPublicById(userId);
    if (!user) throw notFound('User');
    return user;
  },
};
