import { NextRequest } from 'next/server';
import { prisma } from './database';

// 配置
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分鐘
const RATE_LIMIT_MAX_REQUESTS = 100; // 每分鐘最大請求數

export function getRateLimitKey(request: NextRequest, endpoint?: string): string {
  const ip = getClientIP(request);
  const path = endpoint || new URL(request.url).pathname;
  return `${ip}:${path}`;
}

export async function checkRateLimit(request: NextRequest, endpoint?: string): Promise<{
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
  retryAfter?: number;
}> {
  const path = endpoint || new URL(request.url).pathname;
  const rateLimitConfig = getEndpointRateLimit(path);
  const windowMs = rateLimitConfig?.windowMs ?? RATE_LIMIT_WINDOW;
  const maxRequests = rateLimitConfig?.maxRequests ?? RATE_LIMIT_MAX_REQUESTS;
  const key = getRateLimitKey(request, path);
  const now = new Date();
  const resetTime = new Date(now.getTime() + windowMs);
  
  try {
    // 清理過期記錄
    await prisma.rateLimitRecord.deleteMany({
      where: { resetTime: { lt: now } }
    });

    // 查找或創建記錄
    const existing = await prisma.rateLimitRecord.findUnique({
      where: { key }
    });

    if (!existing || existing.resetTime < now) {
      // 創建新的時間窗口
      await prisma.rateLimitRecord.upsert({
        where: { key },
        create: { key, count: 1, resetTime },
        update: { count: 1, resetTime }
      });
      
      return {
        allowed: true,
        remainingRequests: maxRequests - 1,
        resetTime: resetTime.getTime()
      };
    }

    // 增加計數
    const updated = await prisma.rateLimitRecord.update({
      where: { key },
      data: { count: { increment: 1 } }
    });

    if (updated.count > maxRequests) {
      return {
        allowed: false,
        remainingRequests: 0,
        resetTime: existing.resetTime.getTime(),
        retryAfter: Math.ceil((existing.resetTime.getTime() - now.getTime()) / 1000)
      };
    }

    return {
      allowed: true,
      remainingRequests: maxRequests - updated.count,
      resetTime: existing.resetTime.getTime()
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // 發生錯誤時允許請求通過（降級處理）
    return {
      allowed: true,
      remainingRequests: maxRequests,
      resetTime: resetTime.getTime()
    };
  }
}

export async function applyRateLimit(request: NextRequest, endpoint?: string) {
  const result = await checkRateLimit(request, endpoint);
  
  if (!result.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
      result.retryAfter || 60
    );
  }
  
  return result;
}

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const remoteAddress = request.headers.get('x-vercel-forwarded-for');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP;
  }
  
  if (remoteAddress) {
    return remoteAddress;
  }
  
  return 'unknown';
}

export class RateLimitError extends Error {
  constructor(message: string, public retryAfter: number) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// 清理過期記錄
export async function cleanupRateLimitStore() {
  try {
    await prisma.rateLimitRecord.deleteMany({
      where: { resetTime: { lt: new Date() } }
    });
  } catch (error) {
    console.error('Cleanup rate limit store error:', error);
  }
}

// 獲取速率限制統計
export async function getRateLimitStats() {
  try {
    const now = new Date();
    const records = await prisma.rateLimitRecord.findMany({
      where: { resetTime: { gte: now } }
    });
    
    return {
      activeIPs: records.length,
      totalRequests: records.reduce((sum, r) => sum + r.count, 0),
      storeSize: records.length
    };
  } catch (error) {
    console.error('Get rate limit stats error:', error);
    return { activeIPs: 0, totalRequests: 0, storeSize: 0 };
  }
}

// 重點保護的端點配置
export const PROTECTED_ENDPOINTS = {
  '/api/auth/login': { maxRequests: 5, windowMs: 15 * 60 * 1000 }, // 15分鐘5次
  '/api/auth/forgot-password': { maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 1小時3次
  '/api/auth/2fa/setup': { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  '/api/auth/2fa/verify': { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  '/api/auth/2fa/disable': { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  '/api/approval-delegates': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/bonuses': { maxRequests: 20, windowMs: 60 * 1000 },
  '/api/overtime-requests': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/overtime-requests/[id]': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/overtime-requests/batch': { maxRequests: 10, windowMs: 60 * 1000 },
  '/api/overtime-requests/batch-approve': { maxRequests: 10, windowMs: 60 * 1000 },
  '/api/payroll': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/payroll/preview': { maxRequests: 10, windowMs: 60 * 1000 },
  '/api/payroll/generate': { maxRequests: 10, windowMs: 60 * 1000 },
  '/api/payroll/[id]': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/pro-rated-bonuses': { maxRequests: 10, windowMs: 60 * 1000 },
  '/api/schedule-confirmation': { maxRequests: 120, windowMs: 60 * 1000 },
  '/api/schedule-confirmation/confirm': { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  '/api/system-settings/approval-workflows': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/system-settings/schedule-confirm': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/system-settings/login-logs': { maxRequests: 60, windowMs: 60 * 1000 },
  '/api/system-settings/supplementary-premium': { maxRequests: 30, windowMs: 60 * 1000 },
  '/api/password': { maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 1小時3次
  '/api/setup-employee': { maxRequests: 3, windowMs: 60 * 60 * 1000 }, // 1小時3次
  '/api/webauthn/register-options': { maxRequests: 5, windowMs: 15 * 60 * 1000 }, // 15分鐘5次
  '/api/webauthn/register-verify': { maxRequests: 10, windowMs: 15 * 60 * 1000 }, // 15分鐘10次
  '/api/attendance/verify-clock': { maxRequests: 10, windowMs: 60 * 1000 }, // 1分鐘10次
} as const;

export function getEndpointRateLimit(endpoint: string) {
  return PROTECTED_ENDPOINTS[endpoint as keyof typeof PROTECTED_ENDPOINTS];
}

// 打卡 API 專用速率限制檢查
const CLOCK_RATE_LIMIT_WINDOW = 60 * 1000; // 1分鐘
const CLOCK_RATE_LIMIT_MAX = 10; // 每分鐘最多10次
const FAILED_ATTEMPT_WINDOW = 5 * 60 * 1000; // 5分鐘
const MAX_FAILED_ATTEMPTS = 5; // 5次失敗後鎖定

export async function checkClockRateLimit(request: NextRequest, username?: string): Promise<{
  allowed: boolean;
  reason?: string;
  retryAfter?: number;
}> {
  const ip = getClientIP(request);
  const now = new Date();

  try {
    // 1. 檢查 IP 速率限制
    const ipKey = `clock:${ip}`;
    const resetTime = new Date(now.getTime() + CLOCK_RATE_LIMIT_WINDOW);
    
    const ipRecord = await prisma.rateLimitRecord.findUnique({ where: { key: ipKey } });
    
    if (!ipRecord || ipRecord.resetTime < now) {
      await prisma.rateLimitRecord.upsert({
        where: { key: ipKey },
        create: { key: ipKey, count: 1, resetTime },
        update: { count: 1, resetTime }
      });
    } else {
      const updated = await prisma.rateLimitRecord.update({
        where: { key: ipKey },
        data: { count: { increment: 1 } }
      });
      
      if (updated.count > CLOCK_RATE_LIMIT_MAX) {
        return {
          allowed: false,
          reason: '打卡請求過於頻繁，請稍後再試',
          retryAfter: Math.ceil((ipRecord.resetTime.getTime() - now.getTime()) / 1000)
        };
      }
    }

    // 2. 檢查用戶失敗嘗試（使用 IpBlock）
    if (username) {
      const block = await prisma.ipBlock.findUnique({
        where: { ipAddress_reason: { ipAddress: username, reason: 'failed_clock' } }
      });
      
      if (block && block.blockedUntil > now && block.failedCount >= MAX_FAILED_ATTEMPTS) {
        return {
          allowed: false,
          reason: '帳號已被暫時鎖定，請稍後再試',
          retryAfter: Math.ceil((block.blockedUntil.getTime() - now.getTime()) / 1000)
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.error('Check clock rate limit error:', error);
    return { allowed: true }; // 降級處理
  }
}

// 記錄失敗的打卡嘗試
export async function recordFailedClockAttempt(username: string): Promise<void> {
  const now = new Date();
  const blockedUntil = new Date(now.getTime() + FAILED_ATTEMPT_WINDOW);
  
  try {
    await prisma.ipBlock.upsert({
      where: { ipAddress_reason: { ipAddress: username, reason: 'failed_clock' } },
      create: { ipAddress: username, reason: 'failed_clock', failedCount: 1, blockedUntil },
      update: { failedCount: { increment: 1 }, blockedUntil }
    });
  } catch (error) {
    console.error('Record failed clock attempt error:', error);
  }
}

// 清除失敗嘗試記錄（登入成功時）
export async function clearFailedAttempts(username: string): Promise<void> {
  try {
    await prisma.ipBlock.deleteMany({
      where: { ipAddress: username, reason: 'failed_clock' }
    });
  } catch (error) {
    console.error('Clear failed attempts error:', error);
  }
}

// 導出 getClientIP 以供其他模組使用
export { getClientIP };
