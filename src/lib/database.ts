import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

export const prisma = globalThis.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "file:./prisma/dev.db"
    }
  }
});

// 🚀 資料庫連接優化（導出函數，需要時調用）
export async function optimizeDatabase() {
  try {
    // 啟用 WAL 模式提高並發性能
    await prisma.$queryRaw`PRAGMA journal_mode = WAL;`;
    
    // 增加快取大小 (10MB)
    await prisma.$queryRaw`PRAGMA cache_size = -10240;`;
    
    // 啟用外鍵約束
    await prisma.$queryRaw`PRAGMA foreign_keys = ON;`;
    
    // 設置同步模式為 NORMAL (平衡安全性和性能)
    await prisma.$queryRaw`PRAGMA synchronous = NORMAL;`;
    
    // 設置臨時儲存在記憶體中
    await prisma.$queryRaw`PRAGMA temp_store = MEMORY;`;
    
    // 設置 mmap 大小 (64MB)
    await prisma.$queryRaw`PRAGMA mmap_size = 67108864;`;
    
    console.log('✅ 資料庫效能優化完成');
  } catch (error) {
    console.warn('⚠️ 資料庫優化警告:', error);
  }
}

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}
