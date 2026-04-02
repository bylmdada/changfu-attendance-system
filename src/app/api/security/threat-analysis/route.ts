import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { 
  getSecurityStats
} from '@/lib/security-monitoring';

type SecurityStats = ReturnType<typeof getSecurityStats>;

interface ThreatAnalysisReport {
  summary: {
    totalThreats: number;
    activeThreats: number;
    resolvedThreats: number;
    criticalAlerts: number;
    riskScore: number;
  };
  recentAttacks: {
    type: string;
    count: number;
    lastOccurrence: Date;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }[];
  topAttackerIPs: {
    ip: string;
    attackCount: number;
    lastAttack: Date;
    isBlocked: boolean;
  }[];
  securityTrends: {
    date: string;
    authFailures: number;
    rateLimitHits: number;
    csrfViolations: number;
    suspiciousRequests: number;
  }[];
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    action: string;
  }[];
}

// 生成威脅分析報告
function generateThreatAnalysisReport(): ThreatAnalysisReport {
  const stats = getSecurityStats();
  const now = new Date();
  
  // 模擬威脅分析數據（實際應該從真實的安全事件數據計算）
  const report: ThreatAnalysisReport = {
    summary: {
      totalThreats: stats.totalEvents,
      activeThreats: Math.floor(stats.totalEvents * 0.1),
      resolvedThreats: Math.floor(stats.totalEvents * 0.9),
      criticalAlerts: Math.floor(stats.blockedIPs * 0.3),
      riskScore: calculateRiskScore(stats)
    },
    recentAttacks: [
      {
        type: '暴力破解攻擊',
        count: Math.floor(stats.totalEvents * 0.4),
        lastOccurrence: new Date(now.getTime() - 15 * 60 * 1000),
        severity: 'high'
      },
      {
        type: 'CSRF 攻擊嘗試',
        count: Math.floor(stats.totalEvents * 0.2),
        lastOccurrence: new Date(now.getTime() - 45 * 60 * 1000),
        severity: 'medium'
      },
      {
        type: '速率限制觸發',
        count: Math.floor(stats.totalEvents * 0.3),
        lastOccurrence: new Date(now.getTime() - 5 * 60 * 1000),
        severity: 'medium'
      },
      {
        type: '可疑請求模式',
        count: Math.floor(stats.totalEvents * 0.1),
        lastOccurrence: new Date(now.getTime() - 120 * 60 * 1000),
        severity: 'low'
      }
    ],
    topAttackerIPs: generateTopAttackerIPs(stats),
    securityTrends: generateSecurityTrends(),
    recommendations: generateSecurityRecommendations(stats)
  };

  return report;
}

function calculateRiskScore(stats: SecurityStats): number {
  let score = 0;
  
  // 基於各種威脅指標計算風險分數 (0-100)
  score += stats.blockedIPs * 2; // 被封鎖的IP數量
  score += stats.totalEvents * 0.1; // 總安全事件數量
  score += (stats.topThreats?.length || 0) * 5; // 活躍威脅數量
  
  // 確保分數在 0-100 範圍內
  return Math.min(Math.max(Math.floor(score), 0), 100);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function generateTopAttackerIPs(_stats: SecurityStats) {
  const attackerIPs = [
    '192.168.1.100', '10.0.0.150', '172.16.0.200',
    '203.123.45.67', '45.76.123.89', '188.92.34.156'
  ];
  
  return attackerIPs.slice(0, 5).map((ip, index) => ({
    ip,
    attackCount: Math.floor(Math.random() * 50) + 10,
    lastAttack: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000),
    isBlocked: index < 3 // 前3個IP被封鎖
  }));
}

function generateSecurityTrends() {
  const trends = [];
  const now = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    trends.push({
      date: date.toISOString().split('T')[0],
      authFailures: Math.floor(Math.random() * 20) + 5,
      rateLimitHits: Math.floor(Math.random() * 15) + 3,
      csrfViolations: Math.floor(Math.random() * 8) + 1,
      suspiciousRequests: Math.floor(Math.random() * 10) + 2
    });
  }
  
  return trends;
}

function generateSecurityRecommendations(stats: SecurityStats) {
  const recommendations = [];
  
  if (stats.blockedIPs > 10) {
    recommendations.push({
      priority: 'high' as const,
      title: 'IP封鎖數量偏高',
      description: '檢測到大量惡意IP攻擊活動',
      action: '建議加強網路層防護並檢查防火牆規則'
    });
  }
  
  if (stats.totalEvents > 100) {
    recommendations.push({
      priority: 'medium' as const,
      title: '安全事件頻率增加',
      description: '近期安全事件數量超過正常範圍',
      action: '建議進行安全審查並更新安全策略'
    });
  }
  
  recommendations.push({
    priority: 'low' as const,
    title: '定期安全檢查',
    description: '保持系統安全性的最佳實踐',
    action: '建議每週執行安全掃描和日誌分析'
  });
  
  return recommendations;
}

// 威脅分析儀表板 API
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限查看威脅分析' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'full';

    const report = generateThreatAnalysisReport();

    // 根據請求類型返回不同的報告部分
    switch (reportType) {
      case 'summary':
        return NextResponse.json({
          success: true,
          data: { summary: report.summary }
        });
        
      case 'attacks':
        return NextResponse.json({
          success: true,
          data: { 
            recentAttacks: report.recentAttacks,
            topAttackerIPs: report.topAttackerIPs 
          }
        });
        
      case 'trends':
        return NextResponse.json({
          success: true,
          data: { securityTrends: report.securityTrends }
        });
        
      case 'recommendations':
        return NextResponse.json({
          success: true,
          data: { recommendations: report.recommendations }
        });
        
      default:
        return NextResponse.json({
          success: true,
          data: report
        });
    }

  } catch (error) {
    console.error('威脅分析API錯誤:', error);
    return NextResponse.json({ error: '生成威脅分析報告時發生錯誤' }, { status: 500 });
  }
}
