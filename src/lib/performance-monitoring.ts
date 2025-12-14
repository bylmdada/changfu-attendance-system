import { NextRequest } from 'next/server';

// 性能監控接口
interface PerformanceMetrics {
  endpoint: string;
  responseTime: number;
  timestamp: Date;
  statusCode: number;
  userAgent?: string;
  ip?: string;
}

interface SystemPerformance {
  averageResponseTime: number;
  totalRequests: number;
  errorRate: number;
  slowestEndpoints: Array<{
    endpoint: string;
    averageTime: number;
    requestCount: number;
  }>;
  peakUsageHours: Array<{
    hour: number;
    requestCount: number;
  }>;
}

// 內存存儲（生產環境建議使用時間序列數據庫）
const performanceData: PerformanceMetrics[] = [];
const MAX_PERFORMANCE_RECORDS = 100000; // 保留最近10萬條記錄

// 記錄 API 性能數據
export function recordPerformanceMetric(
  endpoint: string,
  responseTime: number,
  statusCode: number,
  request?: NextRequest
): void {
  const metric: PerformanceMetrics = {
    endpoint,
    responseTime,
    statusCode,
    timestamp: new Date(),
    userAgent: request?.headers.get('user-agent') || undefined,
    ip: getClientIP(request)
  };

  performanceData.push(metric);

  // 保持記錄數量在限制內
  if (performanceData.length > MAX_PERFORMANCE_RECORDS) {
    performanceData.splice(0, performanceData.length - MAX_PERFORMANCE_RECORDS);
  }
}

// 獲取系統性能統計
export function getSystemPerformance(timeRangeHours = 24): SystemPerformance {
  const cutoffTime = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
  const recentData = performanceData.filter(d => d.timestamp >= cutoffTime);

  if (recentData.length === 0) {
    return {
      averageResponseTime: 0,
      totalRequests: 0,
      errorRate: 0,
      slowestEndpoints: [],
      peakUsageHours: []
    };
  }

  // 計算平均響應時間
  const averageResponseTime = recentData.reduce((sum, d) => sum + d.responseTime, 0) / recentData.length;

  // 計算錯誤率
  const errorCount = recentData.filter(d => d.statusCode >= 400).length;
  const errorRate = (errorCount / recentData.length) * 100;

  // 找出最慢的端點
  const endpointStats = new Map<string, { total: number; count: number }>();
  
  recentData.forEach(d => {
    const existing = endpointStats.get(d.endpoint) || { total: 0, count: 0 };
    endpointStats.set(d.endpoint, {
      total: existing.total + d.responseTime,
      count: existing.count + 1
    });
  });

  const slowestEndpoints = Array.from(endpointStats.entries())
    .map(([endpoint, stats]) => ({
      endpoint,
      averageTime: stats.total / stats.count,
      requestCount: stats.count
    }))
    .sort((a, b) => b.averageTime - a.averageTime)
    .slice(0, 10);

  // 分析使用高峰時段
  const hourlyStats = new Map<number, number>();
  
  recentData.forEach(d => {
    const hour = d.timestamp.getHours();
    hourlyStats.set(hour, (hourlyStats.get(hour) || 0) + 1);
  });

  const peakUsageHours = Array.from(hourlyStats.entries())
    .map(([hour, count]) => ({ hour, requestCount: count }))
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 5);

  return {
    averageResponseTime: Math.round(averageResponseTime * 100) / 100,
    totalRequests: recentData.length,
    errorRate: Math.round(errorRate * 100) / 100,
    slowestEndpoints,
    peakUsageHours
  };
}

// 獲取特定端點的詳細性能數據
export function getEndpointPerformance(endpoint: string, timeRangeHours = 24) {
  const cutoffTime = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
  const endpointData = performanceData.filter(
    d => d.endpoint === endpoint && d.timestamp >= cutoffTime
  );

  if (endpointData.length === 0) {
    return null;
  }

  const responseTimes = endpointData.map(d => d.responseTime).sort((a, b) => a - b);
  const errorCount = endpointData.filter(d => d.statusCode >= 400).length;

  return {
    endpoint,
    totalRequests: endpointData.length,
    averageResponseTime: responseTimes.reduce((a, b) => a + b) / responseTimes.length,
    medianResponseTime: responseTimes[Math.floor(responseTimes.length / 2)],
    p95ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.95)],
    p99ResponseTime: responseTimes[Math.floor(responseTimes.length * 0.99)],
    errorRate: (errorCount / endpointData.length) * 100,
    requestsPerHour: endpointData.length / timeRangeHours
  };
}

// 檢測性能異常
export function detectPerformanceAnomalies(): Array<{
  type: 'slow_response' | 'high_error_rate' | 'spike_in_requests';
  endpoint?: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  value: number;
  threshold: number;
}> {
  const anomalies = [];
  const recentData = performanceData.filter(
    d => d.timestamp >= new Date(Date.now() - 60 * 60 * 1000) // 最近1小時
  );

  // 檢測慢響應
  const slowRequests = recentData.filter(d => d.responseTime > 5000); // 超過5秒
  if (slowRequests.length > 0) {
    anomalies.push({
      type: 'slow_response' as const,
      endpoint: slowRequests[0].endpoint,
      severity: slowRequests.length > 10 ? 'high' as const : 'medium' as const,
      description: `檢測到 ${slowRequests.length} 個慢響應請求`,
      value: slowRequests.length,
      threshold: 10
    });
  }

  // 檢測高錯誤率
  const errorRequests = recentData.filter(d => d.statusCode >= 500);
  const errorRate = recentData.length > 0 ? (errorRequests.length / recentData.length) * 100 : 0;
  
  if (errorRate > 5) { // 錯誤率超過5%
    anomalies.push({
      type: 'high_error_rate' as const,
      severity: errorRate > 20 ? 'high' as const : 'medium' as const,
      description: `系統錯誤率為 ${errorRate.toFixed(2)}%`,
      value: errorRate,
      threshold: 5
    });
  }

  // 檢測請求量激增
  const currentHourRequests = recentData.length;
  const previousHourData = performanceData.filter(
    d => d.timestamp >= new Date(Date.now() - 2 * 60 * 60 * 1000) && 
         d.timestamp < new Date(Date.now() - 60 * 60 * 1000)
  );
  
  if (previousHourData.length > 0) {
    const growthRate = ((currentHourRequests - previousHourData.length) / previousHourData.length) * 100;
    
    if (growthRate > 200) { // 請求量增長超過200%
      anomalies.push({
        type: 'spike_in_requests' as const,
        severity: growthRate > 500 ? 'high' as const : 'medium' as const,
        description: `請求量增長 ${growthRate.toFixed(0)}%`,
        value: growthRate,
        threshold: 200
      });
    }
  }

  return anomalies;
}

// 性能優化建議
export function getPerformanceRecommendations(): Array<{
  priority: 'high' | 'medium' | 'low';
  category: 'response_time' | 'error_handling' | 'caching' | 'database' | 'security';
  title: string;
  description: string;
  expectedImprovement: string;
}> {
  const recommendations = [];
  const systemPerf = getSystemPerformance();

  if (systemPerf.averageResponseTime > 2000) {
    recommendations.push({
      priority: 'high' as const,
      category: 'response_time' as const,
      title: '響應時間優化',
      description: '系統平均響應時間超過2秒，建議優化數據庫查詢和添加緩存',
      expectedImprovement: '可減少50-70%響應時間'
    });
  }

  if (systemPerf.errorRate > 2) {
    recommendations.push({
      priority: 'high' as const,
      category: 'error_handling' as const,
      title: '錯誤處理改進',
      description: '系統錯誤率較高，建議加強錯誤處理和日誌記錄',
      expectedImprovement: '可降低80%系統錯誤'
    });
  }

  // 檢查是否有需要緩存的慢端點
  const slowEndpoints = systemPerf.slowestEndpoints.filter(e => e.averageTime > 1000);
  if (slowEndpoints.length > 0) {
    recommendations.push({
      priority: 'medium' as const,
      category: 'caching' as const,
      title: 'API 響應緩存',
      description: `為慢響應端點添加緩存: ${slowEndpoints.map(e => e.endpoint).join(', ')}`,
      expectedImprovement: '可減少30-50%響應時間'
    });
  }

  return recommendations;
}

// 清理過期的性能數據
export function cleanupPerformanceData(daysToKeep = 7): void {
  const cutoffTime = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  
  let removedCount = 0;
  for (let i = performanceData.length - 1; i >= 0; i--) {
    if (performanceData[i].timestamp < cutoffTime) {
      performanceData.splice(i, 1);
      removedCount++;
    }
  }
  
  console.log(`性能數據清理完成，刪除了 ${removedCount} 條過期記錄`);
}

// 獲取客戶端 IP
function getClientIP(request?: NextRequest): string | undefined {
  if (!request) return undefined;
  
  return request.headers.get('x-forwarded-for')?.split(',')[0] ||
         request.headers.get('x-real-ip') ||
         request.headers.get('cf-connecting-ip') ||
         undefined;
}

// 性能監控中間件
export function withPerformanceMonitoring(
  handler: (request: NextRequest, ...args: unknown[]) => Promise<Response>,
  endpoint: string
) {
  return async (request: NextRequest, ...args: unknown[]): Promise<Response> => {
    const startTime = Date.now();
    
    try {
      const response = await handler(request, ...args);
      const responseTime = Date.now() - startTime;
      
      recordPerformanceMetric(endpoint, responseTime, response.status, request);
      
      return response;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      recordPerformanceMetric(endpoint, responseTime, 500, request);
      throw error;
    }
  };
}
