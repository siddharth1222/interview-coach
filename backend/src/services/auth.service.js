import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/token.js';

function issueTokens(user) {
  const payload = { sub: String(user._id), email: user.email };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register({ name, email, password }) {
  const existing = await User.findOne({ email }).lean();
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const user = new User({ name, email });
  await user.setPassword(password);
  await user.save();

  return { user: user.toJSON(), ...issueTokens(user) };
}

export async function login({ email, password }) {
  // passwordHash is select:false — request it explicitly for comparison.
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Invalid email or password');

  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Invalid email or password');

  return { user: user.toJSON(), ...issueTokens(user) };
}

export async function refresh(refreshToken) {
  if (!refreshToken) throw ApiError.unauthorized('Missing refresh token');
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }
  const user = await User.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('User no longer exists');
  return { user: user.toJSON(), ...issueTokens(user) };
}
