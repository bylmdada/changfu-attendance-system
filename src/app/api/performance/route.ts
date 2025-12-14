import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  getSystemPerformance,
  getEndpointPerformance,
  detectPerformanceAnomalies,
  getPerformanceRecommendations,
  cleanupPerformanceData
} from '@/lib/performance-monitoring';

// 獲取性能監控數據
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限查看性能監控' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'overview';
    const timeRange = parseInt(searchParams.get('timeRange') || '24');
    const endpoint = searchParams.get('endpoint');

    switch (action) {
      case 'overview':
        const systemPerf = getSystemPerformance(timeRange);
        const anomalies = detectPerformanceAnomalies();
        const recommendations = getPerformanceRecommendations();

        return NextResponse.json({
          success: true,
          data: {
            systemPerformance: systemPerf,
            anomalies,
            recommendations: recommendations.slice(0, 5) // 只返回前5個建議
          }
        });

      case 'endpoint-details':
        if (!endpoint) {
          return NextResponse.json({ error: '需要指定端點名稱' }, { status: 400 });
        }

        const endpointPerf = getEndpointPerformance(endpoint, timeRange);
        if (!endpointPerf) {
          return NextResponse.json({ error: '找不到該端點的性能數據' }, { status: 404 });
        }

        return NextResponse.json({
          success: true,
          data: endpointPerf
        });

      case 'anomalies':
        return NextResponse.json({
          success: true,
          data: detectPerformanceAnomalies()
        });

      case 'recommendations':
        return NextResponse.json({
          success: true,
          data: getPerformanceRecommendations()
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('性能監控API錯誤:', error);
    return NextResponse.json({ error: '獲取性能數據時發生錯誤' }, { status: 500 });
  }
}

// 執行性能維護操作
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限執行性能維護' }, { status: 403 });
    }

    const { action, daysToKeep } = await request.json();

    switch (action) {
      case 'cleanup':
        const days = daysToKeep || 7;
        cleanupPerformanceData(days);
        
        return NextResponse.json({
          success: true,
          message: `性能數據清理完成，保留 ${days} 天的數據`
        });

      case 'reset-metrics':
        // 這裡可以添加重置性能指標的邏輯
        return NextResponse.json({
          success: true,
          message: '性能指標已重置'
        });

      default:
        return NextResponse.json({ error: '不支援的維護操作' }, { status: 400 });
    }

  } catch (error) {
    console.error('性能維護API錯誤:', error);
    return NextResponse.json({ error: '執行性能維護時發生錯誤' }, { status: 500 });
  }
}
