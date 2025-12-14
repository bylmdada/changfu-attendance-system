import { NextRequest } from 'next/server';

// 緩存條目接口
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to Live in milliseconds
  tags: string[];
  accessCount: number;
  lastAccess: number;
}

// 緩存統計接口
interface CacheStats {
  totalEntries: number;
  hitRate: number;
  totalHits: number;
  totalMisses: number;
  memoryUsage: number;
  oldestEntry: number;
  mostAccessed: string | null;
}

// 緩存配置接口
interface CacheConfig {
  maxEntries: number;
  defaultTTL: number;
  cleanupInterval: number;
  compressionEnabled: boolean;
}

class IntelligentCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0
  };
  
  private config: CacheConfig = {
    maxEntries: 10000,
    defaultTTL: 5 * 60 * 1000, // 5 minutes
    cleanupInterval: 60 * 1000, // 1 minute
    compressionEnabled: true
  };

  private cleanupTimer?: NodeJS.Timeout;

  constructor(config?: Partial<CacheConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // 啟動定期清理
    this.startCleanup();
  }

  // 設置緩存
  set<T>(key: string, data: T, options?: {
    ttl?: number;
    tags?: string[];
  }): void {
    const now = Date.now();
    const ttl = options?.ttl || this.config.defaultTTL;
    
    // 檢查緩存容量
    if (this.cache.size >= this.config.maxEntries) {
      this.evictLeastRecentlyUsed();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl,
      tags: options?.tags || [],
      accessCount: 0,
      lastAccess: now
    };

    this.cache.set(key, entry);
    this.stats.sets++;
  }

  // 獲取緩存
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    const now = Date.now();
    
    // 檢查是否過期
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // 更新訪問統計
    entry.accessCount++;
    entry.lastAccess = now;
    this.stats.hits++;
    
    return entry.data as T;
  }

  // 檢查緩存是否存在
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  // 刪除緩存
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    if (result) {
      this.stats.deletes++;
    }
    return result;
  }

  // 根據標籤刪除緩存
  deleteByTags(tags: string[]): number {
    let deleted = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      const hasMatchingTag = tags.some(tag => entry.tags.includes(tag));
      if (hasMatchingTag) {
        this.cache.delete(key);
        deleted++;
      }
    }
    
    this.stats.deletes += deleted;
    return deleted;
  }

  // 清空所有緩存
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
  }

  // 獲取緩存統計
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    // 計算內存使用量 (粗略估計)
    let memoryUsage = 0;
    let oldestTimestamp = Date.now();
    let mostAccessedKey: string | null = null;
    let maxAccessCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      // 粗略計算條目大小
      const entrySize = JSON.stringify(entry).length * 2; // Unicode 字符占 2 字節
      memoryUsage += entrySize;
      
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      
      if (entry.accessCount > maxAccessCount) {
        maxAccessCount = entry.accessCount;
        mostAccessedKey = key;
      }
    }

    return {
      totalEntries: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      totalHits: this.stats.hits,
      totalMisses: this.stats.misses,
      memoryUsage,
      oldestEntry: oldestTimestamp,
      mostAccessed: mostAccessedKey
    };
  }

  // 淘汰最少使用的條目 (LRU)
  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  // 清理過期條目
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`緩存清理: 刪除了 ${keysToDelete.length} 個過期條目`);
    }
  }

  // 啟動定期清理
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  // 停止清理定時器
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// 全局緩存實例
const globalCache = new IntelligentCache({
  maxEntries: 5000,
  defaultTTL: 10 * 60 * 1000, // 10 minutes
  cleanupInterval: 2 * 60 * 1000 // 2 minutes
});

// API 響應緩存實例 (較短TTL)
const apiCache = new IntelligentCache({
  maxEntries: 2000,
  defaultTTL: 2 * 60 * 1000, // 2 minutes
  cleanupInterval: 30 * 1000 // 30 seconds
});

// 數據庫查詢緩存實例 (較長TTL)
const dbCache = new IntelligentCache({
  maxEntries: 1000,
  defaultTTL: 15 * 60 * 1000, // 15 minutes
  cleanupInterval: 5 * 60 * 1000 // 5 minutes
});

// 緩存鍵生成器
export function generateCacheKey(prefix: string, ...parts: (string | number)[]): string {
  return `${prefix}:${parts.join(':')}`;
}

// 請求緩存中間件
export function withCache<T>(
  keyGenerator: (request: NextRequest) => string,
  ttl?: number,
  tags?: string[]
) {
  return function(handler: (request: NextRequest) => Promise<T>) {
    return async (request: NextRequest): Promise<T> => {
      const cacheKey = keyGenerator(request);
      
      // 嘗試從緩存獲取
      const cached = apiCache.get<T>(cacheKey);
      if (cached) {
        return cached;
      }
      
      // 執行原始處理器
      const result = await handler(request);
      
      // 存入緩存
      apiCache.set(cacheKey, result, { ttl, tags });
      
      return result;
    };
  };
}

// 數據庫查詢緩存包裝器
export function cacheDbQuery<T>(
  queryKey: string,
  queryFn: () => Promise<T>,
  options?: { ttl?: number; tags?: string[] }
): Promise<T> {
  const cached = dbCache.get<T>(queryKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  
  return queryFn().then(result => {
    dbCache.set(queryKey, result, options);
    return result;
  });
}

// 智能預熱緩存
export async function preWarmCache(routes: Array<{
  key: string;
  dataFetcher: () => Promise<unknown>;
  ttl?: number;
  tags?: string[];
}>): Promise<void> {
  console.log('開始預熱緩存...');
  
  const preWarmPromises = routes.map(async (route) => {
    try {
      const data = await route.dataFetcher();
      globalCache.set(route.key, data, {
        ttl: route.ttl,
        tags: route.tags
      });
      console.log(`✅ 預熱完成: ${route.key}`);
    } catch (error) {
      console.error(`❌ 預熱失敗: ${route.key}`, error);
    }
  });
  
  await Promise.all(preWarmPromises);
  console.log('緩存預熱完成');
}

// 導出緩存實例
export {
  globalCache,
  apiCache,
  dbCache,
  IntelligentCache
};

// 緩存管理器
export const CacheManager = {
  // 獲取所有緩存統計
  getAllStats() {
    return {
      global: globalCache.getStats(),
      api: apiCache.getStats(),
      database: dbCache.getStats()
    };
  },
  
  // 清理所有過期緩存
  cleanupAll() {
    const globalStats = globalCache.getStats();
    const apiStats = apiCache.getStats();
    const dbStats = dbCache.getStats();
    
    // 強制清理（通過獲取一個不存在的鍵觸發清理）
    globalCache.get('__cleanup_trigger__');
    apiCache.get('__cleanup_trigger__');
    dbCache.get('__cleanup_trigger__');
    
    return {
      before: { globalStats, apiStats, dbStats },
      after: {
        global: globalCache.getStats(),
        api: apiCache.getStats(),
        database: dbCache.getStats()
      }
    };
  },
  
  // 根據標籤批量清理
  invalidateByTags(tags: string[]) {
    return {
      global: globalCache.deleteByTags(tags),
      api: apiCache.deleteByTags(tags),
      database: dbCache.deleteByTags(tags)
    };
  },
  
  // 清空所有緩存
  clearAll() {
    globalCache.clear();
    apiCache.clear();
    dbCache.clear();
  }
};
