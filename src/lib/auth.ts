import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';

export interface JWTPayload {
  userId: number;
  employeeId: number;
  username: string;
  role: string;
  sessionId?: string; // 會話 ID，用於單一會話登入控制
  iat?: number;
  exp?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('密碼長度至少需要8個字符');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('密碼需要包含至少一個大寫字母');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('密碼需要包含至少一個小寫字母');
  }
  
  if (!/\d/.test(password)) {
    errors.push('密碼需要包含至少一個數字');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('密碼需要包含至少一個特殊字符');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required for security');
  }
  return jwt.sign(payload, secret, { expiresIn: '8h' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is required for security');
    }
    return jwt.verify(token, secret) as JWTPayload;
  } catch {
    return null;
  }
}

async function validateSessionPayload(payload: JWTPayload): Promise<JWTPayload | null> {
  if (!payload.sessionId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      isActive: true,
      currentSessionId: true
    }
  });

  if (!user || !user.isActive) {
    return null;
  }

  if (!user.currentSessionId || user.currentSessionId !== payload.sessionId) {
    return null;
  }

  return payload;
}

function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      map[k] = v;
    }
  });
  return map;
}

export function extractTokenFromRequest(request: NextRequest | Request): string | null {
  try {
    const headers = 'headers' in request ? (request as Request).headers : (request as NextRequest).headers;
    const authHeader = headers.get('authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.replace('Bearer ', '')
      : undefined;

    let token: string | undefined = bearer;

    if (!token) {
      const candidate: unknown = request as unknown;
      if (
        typeof candidate === 'object' &&
        candidate !== null &&
        'cookies' in (candidate as Record<string, unknown>)
      ) {
        const cookiesApi = (candidate as { cookies?: { get?: (k: string) => { value?: string } | undefined } }).cookies;
        if (cookiesApi && typeof cookiesApi.get === 'function') {
          token = cookiesApi.get('token')?.value || cookiesApi.get('auth-token')?.value;
        }
      }
    }

    if (!token) {
      const cookieHeader = headers.get('cookie');
      const cookies = parseCookieHeader(cookieHeader || undefined);
      token = cookies['token'] || cookies['auth-token'];
    }

    return token || null;
  } catch {
    return null;
  }
}

export async function getUserFromToken(token: string): Promise<JWTPayload | null> {
  const payload = verifyToken(token);
  if (!payload) {
    return null;
  }

  return validateSessionPayload(payload);
}

export async function getUserFromRequest(request: NextRequest | Request): Promise<JWTPayload | null> {
  try {
    const token = extractTokenFromRequest(request);
    if (!token) return null;
    return getUserFromToken(token);
  } catch {
    return null;
  }
}
