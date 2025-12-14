import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { 
  getSecurityStats, 
  getThreatDetails, 
  unblockIP, 
  blockIP,
  exportSecurityEvents,
  cleanupSecurityData
} from '@/lib/security-monitoring';
import { checkRateLimit } from '@/lib/rate-limit';

// 獲取安全統計
export async function GET(request: NextRequest) {
  try {
    // Rate limiting for security monitoring access
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    
    // 只有管理員可以查看安全監控
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限訪問' }, { status: 403 });
    }
    
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const ip = searchParams.get('ip');
    
    switch (action) {
      case 'stats':
        const stats = getSecurityStats();
        return NextResponse.json({ success: true, stats });
        
      case 'threat-details':
        if (!ip) {
          return NextResponse.json({ error: 'IP參數是必須的' }, { status: 400 });
        }
        const details = getThreatDetails(ip);
        return NextResponse.json({ success: true, details });
        
      case 'export-events':
        const startDate = searchParams.get('startDate');
        const endDate = searchParams.get('endDate');
        const events = exportSecurityEvents(
          startDate ? new Date(startDate) : undefined,
          endDate ? new Date(endDate) : undefined
        );
        return NextResponse.json({ success: true, events });
        
      default:
        const defaultStats = getSecurityStats();
        return NextResponse.json({ success: true, stats: defaultStats });
    }
  } catch (error) {
    console.error('獲取安全監控數據失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 安全管理操作
export async function POST(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    
    // 只有管理員可以執行安全管理操作
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
    }
    
    const { action, ip, reason } = await request.json();
    
    switch (action) {
      case 'block-ip':
        if (!ip) {
          return NextResponse.json({ error: 'IP參數是必須的' }, { status: 400 });
        }
        blockIP(ip, reason || '管理員手動封鎖');
        return NextResponse.json({ 
          success: true, 
          message: `IP ${ip} 已被封鎖` 
        });
        
      case 'unblock-ip':
        if (!ip) {
          return NextResponse.json({ error: 'IP參數是必須的' }, { status: 400 });
        }
        const unblocked = unblockIP(ip);
        if (unblocked) {
          return NextResponse.json({ 
            success: true, 
            message: `IP ${ip} 已解除封鎖` 
          });
        } else {
          return NextResponse.json({ 
            success: false, 
            message: `IP ${ip} 未被封鎖或不存在` 
          });
        }
        
      case 'cleanup':
        cleanupSecurityData();
        return NextResponse.json({ 
          success: true, 
          message: '安全數據清理完成' 
        });
        
      default:
        return NextResponse.json({ error: '無效的操作' }, { status: 400 });
    }
  } catch (error) {
    console.error('安全管理操作失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
