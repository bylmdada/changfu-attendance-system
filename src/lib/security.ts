import { NextRequest } from 'next/server';
import { prisma } from './database';

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000; // 15分鐘
const ATTEMPT_WINDOW = 5 * 60 * 1000; // 5分鐘內的嘗試

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

// 記錄登入嘗試（使用 SQLite 持久化）
export async function recordLoginAttempt(request: NextRequest, success: boolean): Promise<void> {
  const ip = getClientIP(request);
  const now = new Date();
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW);
  
  try {
    // 清理舊的嘗試記錄
    await prisma.rateLimitRecord.deleteMany({
      where: {
        key: { startsWith: `login:${ip}:` },
        resetTime: { lt: windowStart }
      }
    });

    // 記錄新的嘗試
    const attemptKey = `login:${ip}:${now.getTime()}`;
    await prisma.rateLimitRecord.create({
      data: {
        key: attemptKey,
        count: success ? 1 : 0, // 用 count 區分成功(1)失敗(0)
        resetTime: new Date(now.getTime() + ATTEMPT_WINDOW)
      }
    });

    // 如果失敗，檢查是否需要封鎖
    if (!success) {
      const failedCount = await prisma.rateLimitRecord.count({
        where: {
          key: { startsWith: `login:${ip}:` },
          count: 0, // 失敗的嘗試
          resetTime: { gte: now }
        }
      });

      if (failedCount >= MAX_ATTEMPTS) {
        const blockedUntil = new Date(now.getTime() + BLOCK_DURATION);
        await prisma.ipBlock.upsert({
          where: { ipAddress_reason: { ipAddress: ip, reason: 'login_failed' } },
          create: { ipAddress: ip, reason: 'login_failed', failedCount, blockedUntil },
          update: { failedCount, blockedUntil }
        });
      }
    } else {
      // 登入成功，清除封鎖記錄
      await prisma.ipBlock.deleteMany({
        where: { ipAddress: ip, reason: 'login_failed' }
      });
    }
  } catch (error) {
    console.error('Record login attempt error:', error);
  }
}

// 檢查 IP 是否被封鎖
export async function isIPBlocked(request: NextRequest): Promise<boolean> {
  const ip = getClientIP(request);
  const now = new Date();
  
  try {
    const block = await prisma.ipBlock.findUnique({
      where: { ipAddress_reason: { ipAddress: ip, reason: 'login_failed' } }
    });
    
    if (!block) return false;
    
    if (now > block.blockedUntil) {
      // 封鎖已過期，刪除記錄
      await prisma.ipBlock.delete({
        where: { ipAddress_reason: { ipAddress: ip, reason: 'login_failed' } }
      });
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Check IP blocked error:', error);
    return false;
  }
}

// 獲取剩餘封鎖時間
export async function getRemainingBlockTime(request: NextRequest): Promise<number> {
  const ip = getClientIP(request);
  const now = new Date();
  
  try {
    const block = await prisma.ipBlock.findUnique({
      where: { ipAddress_reason: { ipAddress: ip, reason: 'login_failed' } }
    });
    
    if (!block) return 0;
    
    const remaining = block.blockedUntil.getTime() - now.getTime();
    return remaining > 0 ? remaining : 0;
  } catch (error) {
    console.error('Get remaining block time error:', error);
    return 0;
  }
}

// 清理過期的記錄
export async function cleanupExpiredRecords(): Promise<void> {
  const now = new Date();
  
  try {
    // 清理過期的登入嘗試記錄
    await prisma.rateLimitRecord.deleteMany({
      where: {
        key: { startsWith: 'login:' },
        resetTime: { lt: now }
      }
    });
    
    // 清理過期的封鎖記錄
    await prisma.ipBlock.deleteMany({
      where: {
        reason: 'login_failed',
        blockedUntil: { lt: now }
      }
    });
  } catch (error) {
    console.error('Cleanup expired records error:', error);
  }
}

// 獲取安全統計信息
export async function getSecurityStats(): Promise<{
  totalAttempts: number;
  failedAttempts: number;
  activeBlocks: number;
  successRate: string;
}> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW);
  
  try {
    // 統計登入嘗試
    const attempts = await prisma.rateLimitRecord.findMany({
      where: {
        key: { startsWith: 'login:' },
        resetTime: { gte: windowStart }
      }
    });
    
    const totalAttempts = attempts.length;
    const failedAttempts = attempts.filter(a => a.count === 0).length;
    
    // 統計活躍封鎖
    const activeBlocks = await prisma.ipBlock.count({
      where: {
        reason: 'login_failed',
        blockedUntil: { gte: now }
      }
    });
    
    return {
      totalAttempts,
      failedAttempts,
      activeBlocks,
      successRate: totalAttempts > 0 
        ? ((totalAttempts - failedAttempts) / totalAttempts * 100).toFixed(2) 
        : '0'
    };
  } catch (error) {
    console.error('Get security stats error:', error);
    return { totalAttempts: 0, failedAttempts: 0, activeBlocks: 0, successRate: '0' };
  }
}
