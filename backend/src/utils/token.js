import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ACCESS = 'access';
const REFRESH = 'refresh';

export function signAccessToken(payload) {
  return jwt.sign({ ...payload, typ: ACCESS }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign({ ...payload, typ: REFRESH }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES,
  });
}

export function verifyAccessToken(token) {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (decoded.typ !== ACCESS) throw new Error('Invalid token type');
  return decoded;
}

export function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
  if (decoded.typ !== REFRESH) throw new Error('Invalid token type');
  return decoded;
}
