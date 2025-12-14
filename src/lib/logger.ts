/**
 * 日誌記錄系統
 * 提供結構化日誌記錄功能，支援不同等級和上下文
 */

// 日誌等級
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

// 日誌類別
export enum LogCategory {
  AUTH = 'AUTH',           // 認證相關
  ACCESS = 'ACCESS',       // 存取控制
  DATABASE = 'DATABASE',   // 資料庫操作
  SECURITY = 'SECURITY',   // 安全事件
  API = 'API',             // API 請求
  SYSTEM = 'SYSTEM',       // 系統操作
  AUDIT = 'AUDIT',         // 稽核追蹤
  PERFORMANCE = 'PERFORMANCE', // 效能監控
}

// 日誌項目介面
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context?: Record<string, unknown>;
  userId?: number;
  employeeId?: number;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// 敏感資料遮罩
const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'cookie'];

function maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      masked[key] = '***MASKED***';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// 格式化日誌輸出
function formatLogEntry(entry: LogEntry): string {
  const contextStr = entry.context 
    ? ` | context: ${JSON.stringify(maskSensitiveData(entry.context))}`
    : '';
  
  const userStr = entry.userId 
    ? ` | user: ${entry.userId}${entry.employeeId ? `(emp:${entry.employeeId})` : ''}`
    : '';
  
  const ipStr = entry.ip ? ` | ip: ${entry.ip}` : '';
  const durationStr = entry.duration ? ` | duration: ${entry.duration}ms` : '';
  
  return `[${entry.timestamp}] [${entry.level}] [${entry.category}] ${entry.message}${userStr}${ipStr}${durationStr}${contextStr}`;
}

// 日誌寫入（目前輸出到 console，未來可改為寫入檔案或外部服務）
function writeLog(entry: LogEntry): void {
  const formattedLog = formatLogEntry(entry);
  
  switch (entry.level) {
    case LogLevel.DEBUG:
      if (process.env.NODE_ENV === 'development') {
        console.debug(formattedLog);
      }
      break;
    case LogLevel.INFO:
      console.info(formattedLog);
      break;
    case LogLevel.WARN:
      console.warn(formattedLog);
      break;
    case LogLevel.ERROR:
    case LogLevel.CRITICAL:
      console.error(formattedLog);
      if (entry.error?.stack) {
        console.error('Stack trace:', entry.error.stack);
      }
      break;
  }
}

// Logger 類別
class Logger {
  private category: LogCategory;
  private defaultContext?: Record<string, unknown>;

  constructor(category: LogCategory, defaultContext?: Record<string, unknown>) {
    this.category = category;
    this.defaultContext = defaultContext;
  }

  private createEntry(
    level: LogLevel,
    message: string,
    options?: {
      context?: Record<string, unknown>;
      userId?: number;
      employeeId?: number;
      ip?: string;
      userAgent?: string;
      requestId?: string;
      duration?: number;
      error?: Error;
    }
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      category: this.category,
      message,
      context: { ...this.defaultContext, ...options?.context },
      userId: options?.userId,
      employeeId: options?.employeeId,
      ip: options?.ip,
      userAgent: options?.userAgent,
      requestId: options?.requestId,
      duration: options?.duration,
      error: options?.error ? {
        name: options.error.name,
        message: options.error.message,
        stack: options.error.stack,
      } : undefined,
    };
  }

  debug(message: string, options?: Parameters<typeof this.createEntry>[2]): void {
    writeLog(this.createEntry(LogLevel.DEBUG, message, options));
  }

  info(message: string, options?: Parameters<typeof this.createEntry>[2]): void {
    writeLog(this.createEntry(LogLevel.INFO, message, options));
  }

  warn(message: string, options?: Parameters<typeof this.createEntry>[2]): void {
    writeLog(this.createEntry(LogLevel.WARN, message, options));
  }

  error(message: string, options?: Parameters<typeof this.createEntry>[2]): void {
    writeLog(this.createEntry(LogLevel.ERROR, message, options));
  }

  critical(message: string, options?: Parameters<typeof this.createEntry>[2]): void {
    writeLog(this.createEntry(LogLevel.CRITICAL, message, options));
  }
}

// 預設日誌實例
export const authLogger = new Logger(LogCategory.AUTH);
export const accessLogger = new Logger(LogCategory.ACCESS);
export const dbLogger = new Logger(LogCategory.DATABASE);
export const securityLogger = new Logger(LogCategory.SECURITY);
export const apiLogger = new Logger(LogCategory.API);
export const systemLogger = new Logger(LogCategory.SYSTEM);
export const auditLogger = new Logger(LogCategory.AUDIT);
export const perfLogger = new Logger(LogCategory.PERFORMANCE);

// 工廠函式
export function createLogger(category: LogCategory, defaultContext?: Record<string, unknown>): Logger {
  return new Logger(category, defaultContext);
}

// 便捷函式：記錄 API 請求
export function logApiRequest(
  method: string,
  path: string,
  options?: {
    userId?: number;
    ip?: string;
    userAgent?: string;
    duration?: number;
    statusCode?: number;
  }
): void {
  apiLogger.info(`${method} ${path} ${options?.statusCode || ''}`.trim(), {
    userId: options?.userId,
    ip: options?.ip,
    userAgent: options?.userAgent,
    duration: options?.duration,
    context: { method, path, statusCode: options?.statusCode },
  });
}

// 便捷函式：記錄安全事件
export function logSecurityEvent(
  event: string,
  options?: {
    userId?: number;
    ip?: string;
    context?: Record<string, unknown>;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }
): void {
  const level = options?.severity === 'critical' ? LogLevel.CRITICAL 
    : options?.severity === 'high' ? LogLevel.ERROR
    : options?.severity === 'medium' ? LogLevel.WARN
    : LogLevel.INFO;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category: LogCategory.SECURITY,
    message: event,
    userId: options?.userId,
    ip: options?.ip,
    context: { ...options?.context, severity: options?.severity || 'low' },
  };

  writeLog(entry);
}

// 便捷函式：記錄稽核追蹤
export function logAuditEvent(
  action: string,
  options: {
    userId: number;
    employeeId?: number;
    targetType: string;
    targetId: number | string;
    changes?: Record<string, { old: unknown; new: unknown }>;
    ip?: string;
  }
): void {
  auditLogger.info(`${action} on ${options.targetType}:${options.targetId}`, {
    userId: options.userId,
    employeeId: options.employeeId,
    ip: options.ip,
    context: {
      action,
      targetType: options.targetType,
      targetId: options.targetId,
      changes: options.changes,
    },
  });
}

export { Logger };
export type { LogEntry };
