import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';
import { logSecurityEvent, SecurityEventType } from '@/lib/security-monitoring';
import { recordPerformanceMetric } from '@/lib/performance-monitoring';
import { apiCache, generateCacheKey } from '@/lib/intelligent-cache';

// API Gateway 配置接口
interface GatewayConfig {
  rateLimit: {
    enabled: boolean;
    maxRequests?: number;
    windowMs?: number;
  };
  cache: {
    enabled: boolean;
    ttl?: number;
    tags?: string[];
  };
  auth: {
    required: boolean;
    roles?: string[];
  };
  csrf: {
    enabled: boolean;
  };
  monitoring: {
    enabled: boolean;
  };
  validation?: {
    maxBodySize?: number;
    allowedMethods?: string[];
  };
}

// 路由配置
interface RouteConfig {
  path: string;
  handler: (request: NextRequest, context?: Record<string, unknown>) => Promise<Response>;
  rateLimit?: {
    enabled: boolean;
    maxRequests?: number;
    windowMs?: number;
  };
  cache?: {
    enabled: boolean;
    ttl?: number;
    tags?: string[];
  };
  auth?: {
    required: boolean;
    roles?: string[];
  };
  csrf?: {
    enabled: boolean;
  };
  monitoring?: {
    enabled: boolean;
  };
  validation?: {
    maxBodySize?: number;
    allowedMethods?: string[];
  };
}

// API Gateway 類
class APIGateway {
  private routes = new Map<string, RouteConfig>();
  private globalConfig: GatewayConfig = {
    rateLimit: { enabled: true, maxRequests: 100, windowMs: 60000 },
    cache: { enabled: false },
    auth: { required: false },
    csrf: { enabled: false },
    monitoring: { enabled: true },
    validation: { maxBodySize: 10 * 1024 * 1024, allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }
  };

  // 註冊路由
  register(config: RouteConfig): void {
    this.routes.set(config.path, config);
  }

  // 處理請求
  async handle(request: NextRequest, pathname: string): Promise<Response> {
    const startTime = Date.now();
    
    try {
      // 尋找匹配的路由
      const route = this.findRoute(pathname);
      if (!route) {
        return this.createErrorResponse('Route not found', 404);
      }

      // 合併配置（路由配置優先於全局配置）
      const config = this.mergeConfig(this.globalConfig, route);

      // 1. 方法驗證
      if (config.validation?.allowedMethods && 
          !config.validation.allowedMethods.includes(request.method)) {
        return this.createErrorResponse('Method not allowed', 405);
      }

      // 2. 請求大小驗證
      if (config.validation?.maxBodySize && 
          request.headers.get('content-length')) {
        const contentLength = parseInt(request.headers.get('content-length') || '0');
        if (contentLength > config.validation.maxBodySize) {
          return this.createErrorResponse('Request entity too large', 413);
        }
      }

      // 3. Rate Limiting
      if (config.rateLimit?.enabled) {
        const rateLimitResult = await checkRateLimit(request);
        if (!rateLimitResult.allowed) {
          if (config.monitoring?.enabled) {
            logSecurityEvent(SecurityEventType.RATE_LIMIT_EXCEEDED, request, {
              message: '速率限制超出',
              additionalData: { path: pathname }
            });
          }
          return this.createErrorResponse('Too many requests', 429);
        }
      }

      // 4. 身份驗證
      if (config.auth?.required) {
        const user = await getUserFromRequest(request);
        if (!user) {
          return this.createErrorResponse('Authentication required', 401);
        }
        
        // 角色檢查
        if (config.auth.roles && !config.auth.roles.includes(user.role)) {
          if (config.monitoring?.enabled) {
            logSecurityEvent(SecurityEventType.AUTHORIZATION_FAILED, request, {
              message: '權限不足',
              additionalData: { 
                path: pathname, 
                requiredRoles: config.auth.roles,
                userRole: user.role 
              }
            });
          }
          return this.createErrorResponse('Insufficient permissions', 403);
        }
      }

      // 5. CSRF 保護
      if (config.csrf?.enabled && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
        const csrfResult = await validateCSRF(request);
        if (!csrfResult.valid) {
          if (config.monitoring?.enabled) {
            logSecurityEvent(SecurityEventType.CSRF_VIOLATION, request, {
              message: 'CSRF驗證失敗',
              additionalData: { path: pathname, error: csrfResult.error }
            });
          }
          return this.createErrorResponse('CSRF validation failed', 403);
        }
      }

      // 6. 緩存檢查 (僅限 GET 請求)
      if (config.cache?.enabled && request.method === 'GET') {
        const cacheKey = this.generateCacheKey(pathname, request);
        const cached = apiCache.get<Response>(cacheKey);
        if (cached) {
          // 添加緩存命中標頭
          const response = new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: new Headers(cached.headers)
          });
          response.headers.set('X-Cache', 'HIT');
          return response;
        }
      }

      // 7. 執行路由處理器
      const response = await route.handler(request);

      // 8. 緩存響應 (成功的 GET 請求)
      if (config.cache?.enabled && 
          request.method === 'GET' && 
          response.status >= 200 && 
          response.status < 300) {
        const cacheKey = this.generateCacheKey(pathname, request);
        // 注意：實際實現中需要處理 Response 的克隆
        apiCache.set(cacheKey, response, {
          ttl: config.cache.ttl,
          tags: config.cache.tags
        });
        response.headers.set('X-Cache', 'MISS');
      }

      // 9. 性能監控
      if (config.monitoring?.enabled) {
        const responseTime = Date.now() - startTime;
        recordPerformanceMetric(pathname, responseTime, response.status, request);
      }

      return response;

    } catch (error) {
      // 錯誤處理和監控
      const responseTime = Date.now() - startTime;
      
      if (this.globalConfig.monitoring?.enabled) {
        recordPerformanceMetric(pathname, responseTime, 500, request);
        logSecurityEvent(SecurityEventType.SYSTEM_ERROR, request, {
          message: 'API Gateway 錯誤',
          additionalData: { 
            path: pathname, 
            error: error instanceof Error ? error.message : '未知錯誤' 
          }
        });
      }

      console.error('API Gateway 錯誤:', error);
      return this.createErrorResponse('Internal server error', 500);
    }
  }

  // 尋找匹配的路由
  private findRoute(pathname: string): RouteConfig | undefined {
    // 精確匹配
    if (this.routes.has(pathname)) {
      return this.routes.get(pathname);
    }

    // 模式匹配 (簡單的通配符支持)
    for (const [pattern, config] of this.routes.entries()) {
      if (this.matchPattern(pattern, pathname)) {
        return config;
      }
    }

    return undefined;
  }

  // 簡單的路徑模式匹配
  private matchPattern(pattern: string, pathname: string): boolean {
    // 支持 * 通配符
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(pathname);
    }
    
    // 支持動態參數 [param]
    if (pattern.includes('[') && pattern.includes(']')) {
      const regex = new RegExp('^' + pattern.replace(/\[([^\]]+)\]/g, '([^/]+)') + '$');
      return regex.test(pathname);
    }

    return pattern === pathname;
  }

  // 合併配置
  private mergeConfig(global: GatewayConfig, route: RouteConfig): GatewayConfig {
    return {
      rateLimit: { 
        enabled: route.rateLimit?.enabled ?? global.rateLimit.enabled,
        maxRequests: route.rateLimit?.maxRequests ?? global.rateLimit.maxRequests,
        windowMs: route.rateLimit?.windowMs ?? global.rateLimit.windowMs
      },
      cache: { 
        enabled: route.cache?.enabled ?? global.cache.enabled,
        ttl: route.cache?.ttl ?? global.cache.ttl,
        tags: route.cache?.tags ?? global.cache.tags
      },
      auth: { 
        required: route.auth?.required ?? global.auth.required,
        roles: route.auth?.roles ?? global.auth.roles
      },
      csrf: { 
        enabled: route.csrf?.enabled ?? global.csrf.enabled
      },
      monitoring: { 
        enabled: route.monitoring?.enabled ?? global.monitoring.enabled
      },
      validation: { ...global.validation, ...route.validation }
    };
  }

  // 生成緩存鍵
  private generateCacheKey(pathname: string, request: NextRequest): string {
    const url = new URL(request.url);
    const queryParams = Array.from(url.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    
    return generateCacheKey('api-gateway', pathname, queryParams || 'no-params');
  }

  // 創建錯誤響應
  private createErrorResponse(message: string, status: number): Response {
    return NextResponse.json(
      { error: message, timestamp: new Date().toISOString() },
      { status }
    );
  }

  // 設置全局配置
  setGlobalConfig(config: Partial<GatewayConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...config };
  }

  // 獲取路由統計
  getStats() {
    return {
      totalRoutes: this.routes.size,
      routes: Array.from(this.routes.keys()),
      globalConfig: this.globalConfig
    };
  }

  // 移除路由
  unregister(path: string): boolean {
    return this.routes.delete(path);
  }

  // 清空所有路由
  clear(): void {
    this.routes.clear();
  }
}

// 全局 API Gateway 實例
export const apiGateway = new APIGateway();

// 設置預設的安全配置
apiGateway.setGlobalConfig({
  rateLimit: { enabled: true, maxRequests: 100, windowMs: 60000 },
  monitoring: { enabled: true },
  validation: { 
    maxBodySize: 10 * 1024 * 1024, // 10MB
    allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
  }
});

// 便利的路由註冊函數
export function registerSecureRoute(
  path: string,
  handler: (request: NextRequest) => Promise<Response>,
  config?: Partial<GatewayConfig>
): void {
  apiGateway.register({
    path,
    handler,
    auth: { required: true, roles: ['ADMIN', 'HR', 'EMPLOYEE'] },
    csrf: { enabled: true },
    rateLimit: { enabled: true },
    monitoring: { enabled: true },
    ...config
  });
}

export function registerPublicRoute(
  path: string,
  handler: (request: NextRequest) => Promise<Response>,
  config?: Partial<GatewayConfig>
): void {
  apiGateway.register({
    path,
    handler,
    auth: { required: false },
    csrf: { enabled: false },
    rateLimit: { enabled: true, maxRequests: 200 },
    monitoring: { enabled: true },
    ...config
  });
}

export function registerCachedRoute(
  path: string,
  handler: (request: NextRequest) => Promise<Response>,
  cacheTTL: number = 5 * 60 * 1000,
  config?: Partial<GatewayConfig>
): void {
  apiGateway.register({
    path,
    handler,
    cache: { enabled: true, ttl: cacheTTL },
    auth: { required: true },
    rateLimit: { enabled: true },
    monitoring: { enabled: true },
    ...config
  });
}

// 中間件包裝器
export function withAPIGateway(pathname: string) {
  return async (request: NextRequest): Promise<Response> => {
    return apiGateway.handle(request, pathname);
  };
}

export { APIGateway };
