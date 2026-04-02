import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { apiGateway } from '@/lib/api-gateway';

// API Gateway 管理 API
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限查看 API Gateway 狀態' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'overview';

    switch (action) {
      case 'overview':
        const stats = apiGateway.getStats();
        
        return NextResponse.json({
          success: true,
          data: {
            ...stats,
            systemStatus: {
              healthy: true,
              lastCheck: new Date().toISOString(),
              uptime: process.uptime()
            }
          }
        });

      case 'routes':
        const routeStats = apiGateway.getStats();
        
        return NextResponse.json({
          success: true,
          data: {
            routes: routeStats.routes,
            totalRoutes: routeStats.totalRoutes
          }
        });

      case 'config':
        const configStats = apiGateway.getStats();
        
        return NextResponse.json({
          success: true,
          data: {
            globalConfig: configStats.globalConfig
          }
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('API Gateway 管理錯誤:', error);
    return NextResponse.json({ error: '獲取 Gateway 數據時發生錯誤' }, { status: 500 });
  }
}

// API Gateway 配置管理
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
      return NextResponse.json({ error: '需要管理員權限管理 API Gateway' }, { status: 403 });
    }

    const { action, config, routes } = await request.json();

    switch (action) {
      case 'update-global-config':
        if (!config) {
          return NextResponse.json({ error: '需要提供配置數據' }, { status: 400 });
        }

        // 驗證配置格式
        const validatedConfig = validateGatewayConfig(config);
        if (!validatedConfig.valid) {
          return NextResponse.json({ 
            error: '配置格式無效', 
            details: validatedConfig.errors 
          }, { status: 400 });
        }

        apiGateway.setGlobalConfig(config);

        return NextResponse.json({
          success: true,
          message: '全局配置已更新',
          data: { updatedConfig: config }
        });

      case 'reload-routes':
        // 重新載入路由配置
        apiGateway.clear();
        
        if (routes && Array.isArray(routes)) {
          routes.forEach((route) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            apiGateway.register(route as any);
          });
        }

        return NextResponse.json({
          success: true,
          message: `已重新載入 ${routes?.length || 0} 個路由`,
          data: { routeCount: routes?.length || 0 }
        });

      case 'clear-routes':
        apiGateway.clear();

        return NextResponse.json({
          success: true,
          message: '所有路由已清空'
        });

      default:
        return NextResponse.json({ error: '不支援的操作類型' }, { status: 400 });
    }

  } catch (error) {
    console.error('API Gateway 管理錯誤:', error);
    return NextResponse.json({ error: '管理 Gateway 時發生錯誤' }, { status: 500 });
  }
}

// 驗證 Gateway 配置
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateGatewayConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 驗證 rateLimit 配置
  if (config.rateLimit && typeof config.rateLimit === 'object') {
    if (config.rateLimit.enabled !== undefined && typeof config.rateLimit.enabled !== 'boolean') {
      errors.push('rateLimit.enabled 必須是布林值');
    }
    if (config.rateLimit.maxRequests !== undefined && (typeof config.rateLimit.maxRequests !== 'number' || config.rateLimit.maxRequests <= 0)) {
      errors.push('rateLimit.maxRequests 必須是正整數');
    }
    if (config.rateLimit.windowMs !== undefined && (typeof config.rateLimit.windowMs !== 'number' || config.rateLimit.windowMs <= 0)) {
      errors.push('rateLimit.windowMs 必須是正整數');
    }
  }

  // 驗證 cache 配置
  if (config.cache && typeof config.cache === 'object') {
    if (config.cache.enabled !== undefined && typeof config.cache.enabled !== 'boolean') {
      errors.push('cache.enabled 必須是布林值');
    }
    if (config.cache.ttl !== undefined && (typeof config.cache.ttl !== 'number' || config.cache.ttl <= 0)) {
      errors.push('cache.ttl 必須是正整數');
    }
    if (config.cache.tags !== undefined && !Array.isArray(config.cache.tags)) {
      errors.push('cache.tags 必須是字符串陣列');
    }
  }

  // 驗證 auth 配置
  if (config.auth && typeof config.auth === 'object') {
    if (config.auth.required !== undefined && typeof config.auth.required !== 'boolean') {
      errors.push('auth.required 必須是布林值');
    }
    if (config.auth.roles !== undefined && !Array.isArray(config.auth.roles)) {
      errors.push('auth.roles 必須是字符串陣列');
    }
  }

  // 驗證 validation 配置
  if (config.validation && typeof config.validation === 'object') {
    if (config.validation.maxBodySize !== undefined && (typeof config.validation.maxBodySize !== 'number' || config.validation.maxBodySize <= 0)) {
      errors.push('validation.maxBodySize 必須是正整數');
    }
    if (config.validation.allowedMethods !== undefined && !Array.isArray(config.validation.allowedMethods)) {
      errors.push('validation.allowedMethods 必須是字符串陣列');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
