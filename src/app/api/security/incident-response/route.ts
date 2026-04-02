import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { 
  logSecurityEvent, 
  SecurityEventType, 
  blockIP,
  unblockIP
} from '@/lib/security-monitoring';

interface IncidentResponse {
  id: string;
  type: 'block_ip' | 'unblock_ip' | 'investigate' | 'escalate' | 'resolve';
  target: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  operator: string;
  status: 'pending' | 'executed' | 'failed';
}

const incidentResponses: IncidentResponse[] = [];

// 安全事件響應 API
export async function POST(request: NextRequest) {
  try {
    // Rate limiting - critical security operations
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection for security actions
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限執行安全響應' }, { status: 403 });
    }

    const { action, target, reason, severity } = await request.json();

    if (!action || !target || !reason) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const responseId = `INCIDENT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const response: IncidentResponse = {
      id: responseId,
      type: action,
      target,
      reason,
      severity: severity || 'medium',
      timestamp: new Date(),
      operator: user.username,
      status: 'pending'
    };

    try {
      switch (action) {
        case 'block_ip':
          blockIP(target, reason);
          logSecurityEvent(SecurityEventType.SUSPICIOUS_REQUEST, request, {
            message: `管理員手動封鎖IP: ${target}`,
            additionalData: { reason, operator: user.username }
          });
          response.status = 'executed';
          break;

        case 'unblock_ip':
          unblockIP(target);
          logSecurityEvent(SecurityEventType.AUTHENTICATION_SUCCESS, request, {
            message: `管理員解除IP封鎖: ${target}`,
            additionalData: { reason, operator: user.username }
          });
          response.status = 'executed';
          break;

        case 'investigate':
          logSecurityEvent(SecurityEventType.SUSPICIOUS_REQUEST, request, {
            message: `開始調查安全事件: ${target}`,
            additionalData: { reason, operator: user.username, severity }
          });
          response.status = 'executed';
          break;

        case 'escalate':
          logSecurityEvent(SecurityEventType.PRIVILEGE_ESCALATION, request, {
            message: `安全事件升級: ${target}`,
            additionalData: { reason, operator: user.username, severity }
          });
          response.status = 'executed';
          break;

        default:
          response.status = 'failed';
          return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
      }

      incidentResponses.push(response);

      return NextResponse.json({
        success: true,
        message: '安全響應執行成功',
        responseId,
        action: response.type,
        target,
        status: response.status
      });

    } catch (error) {
      response.status = 'failed';
      incidentResponses.push(response);
      
      return NextResponse.json({
        error: '執行安全響應時發生錯誤',
        responseId,
        details: error instanceof Error ? error.message : '未知錯誤'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('安全響應API錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 獲取響應歷史
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const type = searchParams.get('type');

    let filteredResponses = [...incidentResponses];
    
    if (type) {
      filteredResponses = filteredResponses.filter(r => r.type === type);
    }

    // 按時間倒序排列，取最近的記錄
    const recentResponses = filteredResponses
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    return NextResponse.json({
      success: true,
      responses: recentResponses,
      total: filteredResponses.length
    });

  } catch (error) {
    console.error('獲取響應歷史錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
