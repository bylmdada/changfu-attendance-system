import { NextRequest } from 'next/server';

// 安全事件類型
export enum SecurityEventType {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  AUTHENTICATION_SUCCESS = 'AUTHENTICATION_SUCCESS',
  AUTHORIZATION_FAILED = 'AUTHORIZATION_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CSRF_VIOLATION = 'CSRF_VIOLATION',
  SUSPICIOUS_REQUEST = 'SUSPICIOUS_REQUEST',
  DATA_ACCESS_VIOLATION = 'DATA_ACCESS_VIOLATION',
  INPUT_VALIDATION_FAILED = 'INPUT_VALIDATION_FAILED',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION'
}

// 風險等級
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

// 安全事件接口
export interface SecurityEvent {
  id: string;
  timestamp: Date;
  type: SecurityEventType;
  riskLevel: RiskLevel;
  source: {
    ip: string;
    userAgent?: string;
    userId?: number;
    username?: string;
  };
  details: {
    endpoint?: string;
    method?: string;
    message: string;
    additionalData?: Record<string, unknown>;
  };
  context?: {
    sessionId?: string;
    requestId?: string;
  };
}

// 威脅指標
interface ThreatIndicator {
  ip: string;
  events: SecurityEvent[];
  riskScore: number;
  isBlocked: boolean;
  lastActivity: Date;
}

// 內存存儲（生產環境建議使用數據庫）
const securityEvents: SecurityEvent[] = [];
const threatIndicators = new Map<string, ThreatIndicator>();

// 配置
const MAX_EVENTS_IN_MEMORY = 10000;
const AUTO_BLOCK_THRESHOLD = 150;

// 風險評分規則
const RISK_SCORES = {
  [SecurityEventType.AUTHENTICATION_FAILED]: 5,
  [SecurityEventType.AUTHENTICATION_SUCCESS]: -1,
  [SecurityEventType.AUTHORIZATION_FAILED]: 10,
  [SecurityEventType.RATE_LIMIT_EXCEEDED]: 15,
  [SecurityEventType.CSRF_VIOLATION]: 25,
  [SecurityEventType.SUSPICIOUS_REQUEST]: 20,
  [SecurityEventType.DATA_ACCESS_VIOLATION]: 30,
  [SecurityEventType.INPUT_VALIDATION_FAILED]: 5,
  [SecurityEventType.SYSTEM_ERROR]: 2,
  [SecurityEventType.PRIVILEGE_ESCALATION]: 50
};

// 生成事件ID
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 獲取客戶端IP
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

// 記錄安全事件
export function logSecurityEvent(
  type: SecurityEventType,
  request: NextRequest,
  details: {
    message: string;
    userId?: number;
    username?: string;
    additionalData?: Record<string, unknown>;
  }
): SecurityEvent {
  const ip = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || undefined;
  const url = new URL(request.url);
  
  // 確定風險等級
  let riskLevel: RiskLevel;
  const score = RISK_SCORES[type] || 0;
  
  if (score >= 30) {
    riskLevel = RiskLevel.CRITICAL;
  } else if (score >= 15) {
    riskLevel = RiskLevel.HIGH;
  } else if (score >= 5) {
    riskLevel = RiskLevel.MEDIUM;
  } else {
    riskLevel = RiskLevel.LOW;
  }
  
  const event: SecurityEvent = {
    id: generateEventId(),
    timestamp: new Date(),
    type,
    riskLevel,
    source: {
      ip,
      userAgent,
      userId: details.userId,
      username: details.username
    },
    details: {
      endpoint: url.pathname,
      method: request.method,
      message: details.message,
      additionalData: details.additionalData
    }
  };
  
  // 存儲事件
  securityEvents.push(event);
  
  // 限制內存使用
  if (securityEvents.length > MAX_EVENTS_IN_MEMORY) {
    securityEvents.shift(); // 移除最舊的事件
  }
  
  // 更新威脅指標
  updateThreatIndicator(ip, event);
  
  // 記錄到控制台（開發環境）
  if (process.env.NODE_ENV === 'development' || riskLevel === RiskLevel.CRITICAL) {
    console.warn(`[SECURITY] ${riskLevel} - ${type}: ${details.message}`, {
      ip,
      endpoint: url.pathname,
      userId: details.userId
    });
  }
  
  return event;
}

// 更新威脅指標
function updateThreatIndicator(ip: string, event: SecurityEvent): void {
  let indicator = threatIndicators.get(ip);
  
  if (!indicator) {
    indicator = {
      ip,
      events: [],
      riskScore: 0,
      isBlocked: false,
      lastActivity: new Date()
    };
    threatIndicators.set(ip, indicator);
  }
  
  // 添加事件
  indicator.events.push(event);
  indicator.lastActivity = new Date();
  
  // 計算風險分數（最近1小時的事件）
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentEvents = indicator.events.filter(e => e.timestamp > oneHourAgo);
  
  indicator.riskScore = recentEvents.reduce((score, e) => {
    return score + (RISK_SCORES[e.type] || 0);
  }, 0);
  
  // 自動封鎖高風險IP
  if (indicator.riskScore >= AUTO_BLOCK_THRESHOLD && !indicator.isBlocked) {
    indicator.isBlocked = true;
    console.error(`[SECURITY] AUTO-BLOCKED IP: ${ip} (Risk Score: ${indicator.riskScore})`);
  }
  
  // 限制事件數量
  if (indicator.events.length > 100) {
    indicator.events = indicator.events.slice(-50); // 保留最近50個事件
  }
}

// 檢查IP是否被封鎖
export function isIPBlocked(ip: string): boolean {
  const indicator = threatIndicators.get(ip);
  return indicator ? indicator.isBlocked : false;
}

// 檢查請求是否可疑
export function isSuspiciousRequest(request: NextRequest): boolean {
  const userAgent = request.headers.get('user-agent') || '';
  const url = new URL(request.url);
  
  // 檢查可疑的用戶代理
  const suspiciousUserAgents = [
    'bot', 'crawler', 'spider', 'scraper', 'automated',
    'python', 'curl', 'wget', 'scanner'
  ];
  
  if (suspiciousUserAgents.some(pattern => 
    userAgent.toLowerCase().includes(pattern)
  )) {
    return true;
  }
  
  // 檢查可疑的路徑
  const suspiciousPaths = [
    '/wp-admin', '/admin', '/.env', '/config',
    '/phpMyAdmin', '/wp-config.php', '/.git'
  ];
  
  if (suspiciousPaths.some(path => url.pathname.includes(path))) {
    return true;
  }
  
  // 檢查異常大的請求
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB
    return true;
  }
  
  return false;
}

// 獲取安全統計
export function getSecurityStats(): {
  totalEvents: number;
  recentEvents: number;
  riskDistribution: Record<RiskLevel, number>;
  topThreats: Array<{ ip: string; riskScore: number; eventCount: number }>;
  blockedIPs: number;
} {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentEvents = securityEvents.filter(e => e.timestamp > oneHourAgo);
  
  const riskDistribution = {
    [RiskLevel.LOW]: 0,
    [RiskLevel.MEDIUM]: 0,
    [RiskLevel.HIGH]: 0,
    [RiskLevel.CRITICAL]: 0
  };
  
  recentEvents.forEach(event => {
    riskDistribution[event.riskLevel]++;
  });
  
  const topThreats = Array.from(threatIndicators.values())
    .filter(indicator => indicator.riskScore > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10)
    .map(indicator => ({
      ip: indicator.ip,
      riskScore: indicator.riskScore,
      eventCount: indicator.events.length
    }));
  
  const blockedIPs = Array.from(threatIndicators.values())
    .filter(indicator => indicator.isBlocked).length;
  
  return {
    totalEvents: securityEvents.length,
    recentEvents: recentEvents.length,
    riskDistribution,
    topThreats,
    blockedIPs
  };
}

// 獲取特定IP的威脅詳情
export function getThreatDetails(ip: string): ThreatIndicator | null {
  return threatIndicators.get(ip) || null;
}

// 手動解封IP
export function unblockIP(ip: string): boolean {
  const indicator = threatIndicators.get(ip);
  if (indicator && indicator.isBlocked) {
    indicator.isBlocked = false;
    indicator.riskScore = 0; // 重置風險分數
    return true;
  }
  return false;
}

// 手動封鎖IP
export function blockIP(ip: string, reason: string): void {
  let indicator = threatIndicators.get(ip);
  
  if (!indicator) {
    indicator = {
      ip,
      events: [],
      riskScore: AUTO_BLOCK_THRESHOLD,
      isBlocked: true,
      lastActivity: new Date()
    };
    threatIndicators.set(ip, indicator);
  } else {
    indicator.isBlocked = true;
    indicator.riskScore = Math.max(indicator.riskScore, AUTO_BLOCK_THRESHOLD);
  }
  
  console.warn(`[SECURITY] MANUALLY BLOCKED IP: ${ip} - Reason: ${reason}`);
}

// 清理舊數據
export function cleanupSecurityData(): void {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // 清理舊事件
  const validEvents = securityEvents.filter(e => e.timestamp > oneDayAgo);
  securityEvents.length = 0;
  securityEvents.push(...validEvents);
  
  // 清理舊威脅指標
  for (const [ip, indicator] of threatIndicators.entries()) {
    if (indicator.lastActivity < oneDayAgo && !indicator.isBlocked) {
      threatIndicators.delete(ip);
    } else {
      // 清理舊事件
      indicator.events = indicator.events.filter(e => e.timestamp > oneDayAgo);
    }
  }
}

// 導出事件到文件（用於審計）
export function exportSecurityEvents(startDate?: Date, endDate?: Date): SecurityEvent[] {
  let events = securityEvents;
  
  if (startDate) {
    events = events.filter(e => e.timestamp >= startDate);
  }
  
  if (endDate) {
    events = events.filter(e => e.timestamp <= endDate);
  }
  
  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

// 安全中間件
export function withSecurityMonitoring(
  handler: (request: NextRequest) => Promise<Response>
) {
  return async (request: NextRequest): Promise<Response> => {
    const ip = getClientIP(request);
    
    // 檢查IP是否被封鎖
    if (isIPBlocked(ip)) {
      logSecurityEvent(SecurityEventType.SUSPICIOUS_REQUEST, request, {
        message: '封鎖的IP嘗試訪問',
        additionalData: { reason: 'blocked_ip' }
      });
      
      return new Response(
        JSON.stringify({ error: 'Access denied' }),
        { 
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // 檢查可疑請求
    if (isSuspiciousRequest(request)) {
      logSecurityEvent(SecurityEventType.SUSPICIOUS_REQUEST, request, {
        message: '檢測到可疑請求',
        additionalData: { 
          userAgent: request.headers.get('user-agent'),
          path: new URL(request.url).pathname
        }
      });
    }
    
    try {
      return await handler(request);
    } catch (error) {
      logSecurityEvent(SecurityEventType.SYSTEM_ERROR, request, {
        message: '系統錯誤',
        additionalData: { 
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  };
}
