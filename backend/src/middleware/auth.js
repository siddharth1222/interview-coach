import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../utils/token.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/User.js';

/**
 * Authenticates a request via Bearer token (preferred) or the access-token
 * cookie. Attaches `req.user` (lean user doc) and `req.userId`.
 */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  let token;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) throw ApiError.unauthorized('Authentication required');

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }

  const user = await User.findById(decoded.sub).lean();
  if (!user) throw ApiError.unauthorized('User no longer exists');

  req.user = user;
  req.userId = String(user._id);
  next();
});
