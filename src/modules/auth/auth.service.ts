import { query } from '../../config/db';
import { hashPassword, verifyPassword } from '../../lib/password';
import { signToken } from '../../lib/jwt';
import { AppError } from '../../lib/AppError';
import { RegisterInput, LoginInput } from './auth.schemas';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
}

function publicUser(u: { id: string; name: string; email: string }) {
  return { id: u.id, name: u.name, email: u.email };
}

export async function register(input: RegisterInput) {
  const existing = await query<UserRow>('SELECT id FROM users WHERE email = $1', [input.email]);
  if (existing.rowCount && existing.rowCount > 0) {
    throw AppError.conflict('An account with that email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const res = await query<UserRow>(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email`,
    [input.name, input.email, passwordHash]
  );
  const user = res.rows[0];
  const token = signToken({ sub: user.id, email: user.email, name: user.name });
  return { user: publicUser(user), token };
}

export async function login(input: LoginInput) {
  const res = await query<UserRow>(
    'SELECT id, name, email, password_hash FROM users WHERE email = $1',
    [input.email]
  );
  const user = res.rows[0];

  // Run a compare to avoid leaking which emails exist via timing.
  const dummyHash = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO0jJ0J0J0J0J0J0J0J0J0J0J0J0J0J0a';
  const ok = await verifyPassword(input.password, user?.password_hash ?? dummyHash);

  if (!user || !ok) {
    throw AppError.unauthorized('Invalid email or password');
  }

  const token = signToken({ sub: user.id, email: user.email, name: user.name });
  return { user: publicUser(user), token };
}
