import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';

// 登入狀態常數
export const LOGIN_STATUS = {
  SUCCESS: 'SUCCESS',
  FAILED_PASSWORD: 'FAILED_PASSWORD',
  FAILED_LOCKED: 'FAILED_LOCKED',
  FAILED_INACTIVE: 'FAILED_INACTIVE',
  FAILED_NOT_FOUND: 'FAILED_NOT_FOUND',
  FAILED_2FA: 'FAILED_2FA',
} as const;

/**
 * 解析 User-Agent 獲取裝置資訊
 */
function parseUserAgent(userAgent: string | null): { device: string; browser: string; os: string } {
  if (!userAgent) {
    return { device: '未知', browser: '未知', os: '未知' };
  }

  // 簡易解析裝置類型
  let device = '電腦';
  if (/mobile/i.test(userAgent)) {
    device = '手機';
  } else if (/tablet|ipad/i.test(userAgent)) {
    device = '平板';
  }

  // 簡易解析瀏覽器
  let browser = '未知';
  if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) {
    browser = 'Chrome';
  } else if (/firefox/i.test(userAgent)) {
    browser = 'Firefox';
  } else if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) {
    browser = 'Safari';
  } else if (/edg/i.test(userAgent)) {
    browser = 'Edge';
  } else if (/msie|trident/i.test(userAgent)) {
    browser = 'IE';
  }

  // 簡易解析作業系統
  let os = '未知';
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = 'iOS';
  } else if (/android/i.test(userAgent)) {
    os = 'Android';
  } else if (/windows/i.test(userAgent)) {
    os = 'Windows';
  } else if (/macintosh|mac os/i.test(userAgent)) {
    os = 'macOS';
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux';
  }

  return { device, browser, os };
}

/**
 * 獲取客戶端 IP
 */
function getClientIP(request: NextRequest): string {
  // 嘗試從各種標頭獲取實際 IP
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // 預設值
  return '127.0.0.1';
}

/**
 * 記錄登入日誌
 */
export async function logLogin(
  request: NextRequest,
  username: string,
  status: string,
  userId?: number,
  failReason?: string
): Promise<void> {
  try {
    const userAgent = request.headers.get('user-agent');
    const ipAddress = getClientIP(request);
    const { device, browser, os } = parseUserAgent(userAgent);

    await prisma.loginLog.create({
      data: {
        userId: userId || null,
        username,
        ipAddress,
        userAgent: userAgent || null,
        device,
        browser,
        os,
        status,
        failReason: failReason || null,
      }
    });
  } catch (error) {
    // 登入日誌記錄失敗不應影響登入流程
    console.error('記錄登入日誌失敗:', error);
  }
}
