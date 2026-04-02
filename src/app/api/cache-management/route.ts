import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { CacheManager, globalCache, apiCache, dbCache } from '@/lib/intelligent-cache';

// 緩存管理 API
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限查看緩存狀態' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'stats';

    switch (action) {
      case 'stats':
        const allStats = CacheManager.getAllStats();
        
        // 計算總體緩存效率
        const totalHits = allStats.global.totalHits + allStats.api.totalHits + allStats.database.totalHits;
        const totalMisses = allStats.global.totalMisses + allStats.api.totalMisses + allStats.database.totalMisses;
        const overallHitRate = totalHits + totalMisses > 0 ? (totalHits / (totalHits + totalMisses)) * 100 : 0;
        
        const totalMemory = allStats.global.memoryUsage + allStats.api.memoryUsage + allStats.database.memoryUsage;
        const totalEntries = allStats.global.totalEntries + allStats.api.totalEntries + allStats.database.totalEntries;

        return NextResponse.json({
          success: true,
          data: {
            overall: {
              totalEntries,
              totalMemoryUsage: totalMemory,
              overallHitRate: Math.round(overallHitRate * 100) / 100,
              totalHits,
              totalMisses
            },
            caches: allStats,
            recommendations: generateCacheRecommendations(allStats)
          }
        });

      case 'health':
        const healthStats = CacheManager.getAllStats();
        const healthCheck = {
          global: {
            healthy: healthStats.global.hitRate > 50,
            status: healthStats.global.hitRate > 70 ? 'excellent' : healthStats.global.hitRate > 50 ? 'good' : 'poor'
          },
          api: {
            healthy: healthStats.api.hitRate > 30,
            status: healthStats.api.hitRate > 50 ? 'excellent' : healthStats.api.hitRate > 30 ? 'good' : 'poor'
          },
          database: {
            healthy: healthStats.database.hitRate > 60,
            status: healthStats.database.hitRate > 80 ? 'excellent' : healthStats.database.hitRate > 60 ? 'good' : 'poor'
          }
        };

        return NextResponse.json({
          success: true,
          data: healthCheck
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('緩存管理API錯誤:', error);
    return NextResponse.json({ error: '獲取緩存數據時發生錯誤' }, { status: 500 });
  }
}

// 緩存維護操作
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限執行緩存維護' }, { status: 403 });
    }

    const { action, targets, tags } = await request.json();

    switch (action) {
      case 'cleanup':
        const cleanupResult = CacheManager.cleanupAll();
        
        return NextResponse.json({
          success: true,
          message: '緩存清理完成',
          data: {
            before: cleanupResult.before,
            after: cleanupResult.after
          }
        });

      case 'invalidate-tags':
        if (!tags || !Array.isArray(tags)) {
          return NextResponse.json({ error: '需要提供有效的標籤陣列' }, { status: 400 });
        }
        
        const invalidateResult = CacheManager.invalidateByTags(tags);
        
        return NextResponse.json({
          success: true,
          message: `已清除標籤 [${tags.join(', ')}] 相關的緩存`,
          data: {
            deletedEntries: invalidateResult.global + invalidateResult.api + invalidateResult.database,
            breakdown: invalidateResult
          }
        });

      case 'clear-all':
        const beforeStats = CacheManager.getAllStats();
        CacheManager.clearAll();
        const afterStats = CacheManager.getAllStats();
        
        return NextResponse.json({
          success: true,
          message: '所有緩存已清空',
          data: {
            before: beforeStats,
            after: afterStats
          }
        });

      case 'clear-specific':
        if (!targets || !Array.isArray(targets)) {
          return NextResponse.json({ error: '需要提供有效的目標緩存陣列' }, { status: 400 });
        }

        const clearResults = [];
        
        for (const target of targets) {
          switch (target) {
            case 'global':
              globalCache.clear();
              clearResults.push('global');
              break;
            case 'api':
              apiCache.clear();
              clearResults.push('api');
              break;
            case 'database':
              dbCache.clear();
              clearResults.push('database');
              break;
          }
        }
        
        return NextResponse.json({
          success: true,
          message: `已清空緩存: ${clearResults.join(', ')}`,
          data: { cleared: clearResults }
        });

      case 'optimize':
        // 執行緩存優化
        const optimization = performCacheOptimization();
        
        return NextResponse.json({
          success: true,
          message: '緩存優化完成',
          data: optimization
        });

      default:
        return NextResponse.json({ error: '不支援的維護操作' }, { status: 400 });
    }

  } catch (error) {
    console.error('緩存維護API錯誤:', error);
    return NextResponse.json({ error: '執行緩存維護時發生錯誤' }, { status: 500 });
  }
}

// 生成緩存優化建議
function generateCacheRecommendations(stats: ReturnType<typeof CacheManager.getAllStats>) {
  const recommendations = [];

  // 檢查命中率
  if (stats.global.hitRate < 60) {
    recommendations.push({
      type: 'performance',
      priority: 'high',
      title: '全局緩存命中率偏低',
      description: `當前命中率為 ${stats.global.hitRate}%，建議優化緩存策略`,
      action: '考慮增加TTL時間或預熱熱點數據'
    });
  }

  if (stats.api.hitRate < 40) {
    recommendations.push({
      type: 'performance',
      priority: 'medium',
      title: 'API 緩存效率需要改善',
      description: `API緩存命中率為 ${stats.api.hitRate}%，可能需要調整緩存策略`,
      action: '分析API調用模式，優化緩存鍵設計'
    });
  }

  // 檢查內存使用
  const totalMemory = stats.global.memoryUsage + stats.api.memoryUsage + stats.database.memoryUsage;
  if (totalMemory > 100 * 1024 * 1024) { // 100MB
    recommendations.push({
      type: 'memory',
      priority: 'medium',
      title: '緩存內存使用量較高',
      description: `總內存使用: ${Math.round(totalMemory / 1024 / 1024)}MB`,
      action: '考慮減少TTL時間或增加清理頻率'
    });
  }

  // 檢查條目數量
  const totalEntries = stats.global.totalEntries + stats.api.totalEntries + stats.database.totalEntries;
  if (totalEntries > 8000) {
    recommendations.push({
      type: 'capacity',
      priority: 'low',
      title: '緩存條目數量接近上限',
      description: `總條目數: ${totalEntries}`,
      action: '監控緩存容量，必要時擴展配置'
    });
  }

  return recommendations;
}

// 執行緩存優化
function performCacheOptimization() {
  const beforeStats = CacheManager.getAllStats();
  
  // 執行清理操作
  CacheManager.cleanupAll();
  
  const afterStats = CacheManager.getAllStats();
  
  // 計算優化效果
  const memoryFreed = (beforeStats.global.memoryUsage + beforeStats.api.memoryUsage + beforeStats.database.memoryUsage) -
                     (afterStats.global.memoryUsage + afterStats.api.memoryUsage + afterStats.database.memoryUsage);
  
  const entriesRemoved = (beforeStats.global.totalEntries + beforeStats.api.totalEntries + beforeStats.database.totalEntries) -
                        (afterStats.global.totalEntries + afterStats.api.totalEntries + afterStats.database.totalEntries);

  return {
    memoryFreed: Math.round(memoryFreed / 1024), // KB
    entriesRemoved,
    before: beforeStats,
    after: afterStats,
    optimizationTime: new Date().toISOString()
  };
}
