import { NextRequest } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { prisma } from './database';
import { extractTokenFromRequest, verifyToken } from './auth';

// 配置
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24小時
const CSRF_HEADER_NAME = 'x-csrf-token';

// 生成CSRF令牌
export function generateCSRFToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

// 創建令牌哈希
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// 存儲CSRF令牌（SQLite 持久化）
export async function storeCSRFToken(sessionId: string, token: string): Promise<void> {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + CSRF_TOKEN_EXPIRY);
  
  try {
    await prisma.csrfToken.upsert({
      where: { sessionId },
      create: { sessionId, tokenHash, expiresAt },
      update: { tokenHash, expiresAt }
    });
  } catch (error) {
    console.error('Store CSRF token error:', error);
  }
}

// 驗證CSRF令牌
export async function validateCSRFToken(sessionId: string, token: string): Promise<boolean> {
  try {
    const stored = await prisma.csrfToken.findUnique({
      where: { sessionId }
    });
    
    if (!stored || stored.expiresAt < new Date()) {
      // 令牌不存在或已過期
      if (stored) {
        await prisma.csrfToken.delete({ where: { sessionId } });
      }
      return false;
    }
    
    const hashedToken = hashToken(token);
    return stored.tokenHash === hashedToken;
  } catch (error) {
    console.error('Validate CSRF token error:', error);
    return false;
  }
}

// 從請求中獲取會話ID
function getSessionId(request: NextRequest): string | null {
  const authToken = extractTokenFromRequest(request);

  if (authToken) {
    const payload = verifyToken(authToken);

    if (payload?.sessionId) {
      return `session_${payload.sessionId}`;
    }

    if (payload?.userId) {
      return `user_${payload.userId}`;
    }
  }
  
  // 備選方案：使用IP地址
  const ip = getClientIP(request);
  return `ip_${ip}`;
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  return 'unknown';
}

// 檢查是否需要CSRF保護
export function requiresCSRFProtection(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  
  // 只對狀態改變的方法進行CSRF保護
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return false;
  }
  
  // 排除某些端點（如登入頁面）
  const exemptPaths = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/csrf-token' // 獲取CSRF令牌的端點
  ];
  
  return !exemptPaths.includes(url.pathname);
}

// CSRF保護中間件
export async function validateCSRF(request: NextRequest): Promise<{
  valid: boolean;
  error?: string;
}> {
  if (!requiresCSRFProtection(request)) {
    return { valid: true };
  }
  
  const sessionId = getSessionId(request);
  if (!sessionId) {
    return { valid: false, error: '無法識別會話' };
  }
  
  // 從標頭或表單數據獲取CSRF令牌
  const tokenFromHeader = request.headers.get(CSRF_HEADER_NAME);
  
  if (!tokenFromHeader) {
    return { valid: false, error: '缺少CSRF令牌' };
  }
  
  const isValid = await validateCSRFToken(sessionId, tokenFromHeader);
  
  if (!isValid) {
    return { valid: false, error: 'CSRF令牌無效或已過期' };
  }
  
  return { valid: true };
}

// 為用戶生成CSRF令牌
export async function generateCSRFTokenForUser(request: NextRequest): Promise<{
  token: string;
  sessionId: string | null;
}> {
  const token = generateCSRFToken();
  const sessionId = getSessionId(request);
  
  if (sessionId) {
    await storeCSRFToken(sessionId, token);
  }
  
  return { token, sessionId };
}

// 清理過期的CSRF令牌
export async function cleanupExpiredCSRFTokens(): Promise<void> {
  try {
    await prisma.csrfToken.deleteMany({
      where: { expiresAt: { lt: new Date() } }
    });
  } catch (error) {
    console.error('Cleanup CSRF tokens error:', error);
  }
}

// 獲取CSRF保護統計
export async function getCSRFStats(): Promise<{
  activeTokens: number;
  totalSessions: number;
}> {
  try {
    const now = new Date();
    const activeCount = await prisma.csrfToken.count({
      where: { expiresAt: { gte: now } }
    });
    const totalCount = await prisma.csrfToken.count();
    
    return {
      activeTokens: activeCount,
      totalSessions: totalCount
    };
  } catch (error) {
    console.error('Get CSRF stats error:', error);
    return { activeTokens: 0, totalSessions: 0 };
  }
}

// CSRF錯誤類
export class CSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CSRFError';
  }
}

// 中間件函數
export function withCSRFProtection(handler: (request: NextRequest) => Promise<Response>) {
  return async (request: NextRequest): Promise<Response> => {
    const csrfResult = await validateCSRF(request);
    
    if (!csrfResult.valid) {
      return new Response(
        JSON.stringify({ 
          error: 'CSRF保護違規', 
          details: csrfResult.error 
        }),
        { 
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    return handler(request);
  };
}
