import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import * as authService from '../services/auth.service.js';

const baseCookie = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? 'none' : 'lax',
  path: '/',
};

const ACCESS_MAX_AGE = 15 * 60 * 1000; // 15m
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7d

function setAuthCookies(res, { accessToken, refreshToken }) {
  res.cookie('accessToken', accessToken, { ...baseCookie, maxAge: ACCESS_MAX_AGE });
  res.cookie('refreshToken', refreshToken, {
    ...baseCookie,
    maxAge: REFRESH_MAX_AGE,
    path: '/api/auth',
  });
}

function clearAuthCookies(res) {
  res.clearCookie('accessToken', { ...baseCookie });
  res.clearCookie('refreshToken', { ...baseCookie, path: '/api/auth' });
}

export const register = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body);
  setAuthCookies(res, { accessToken, refreshToken });
  res.status(201).json({ success: true, user, accessToken });
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body);
  setAuthCookies(res, { accessToken, refreshToken });
  res.json({ success: true, user, accessToken });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  const { user, accessToken, refreshToken } = await authService.refresh(token);
  setAuthCookies(res, { accessToken, refreshToken });
  res.json({ success: true, user, accessToken });
});

export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookies(res);
  res.json({ success: true, message: 'Logged out' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: { id: req.userId, ...req.user, _id: undefined } });
});
