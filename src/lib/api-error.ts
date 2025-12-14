/**
 * 統一 API 錯誤處理模組
 * 
 * 提供標準化的錯誤回應格式和錯誤類型定義
 */

import { NextResponse } from 'next/server';

// 錯誤類型枚舉
export enum ApiErrorCode {
  // 認證相關 (401)
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // 權限相關 (403)
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  CSRF_VALIDATION_FAILED = 'CSRF_VALIDATION_FAILED',
  TIME_RESTRICTION = 'TIME_RESTRICTION',
  
  // 請求相關 (400)
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  
  // 資源相關 (404)
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  
  // 衝突相關 (409)
  CONFLICT = 'CONFLICT',
  DUPLICATE_ENTRY = 'DUPLICATE_ENTRY',
  
  // 速率限制 (429)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  
  // 伺服器錯誤 (500)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  
  // 業務邏輯錯誤
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  ALREADY_CLOCKED_IN = 'ALREADY_CLOCKED_IN',
  ALREADY_CLOCKED_OUT = 'ALREADY_CLOCKED_OUT',
  INVALID_CLOCK_TYPE = 'INVALID_CLOCK_TYPE',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  OVERLAPPING_REQUEST = 'OVERLAPPING_REQUEST'
}

// 標準錯誤回應介面
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    path?: string;
  };
}

// 標準成功回應介面
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
  timestamp: string;
}

// 錯誤代碼對應的 HTTP 狀態碼
const errorCodeToStatus: Record<ApiErrorCode, number> = {
  [ApiErrorCode.UNAUTHORIZED]: 401,
  [ApiErrorCode.INVALID_TOKEN]: 401,
  [ApiErrorCode.TOKEN_EXPIRED]: 401,
  [ApiErrorCode.FORBIDDEN]: 403,
  [ApiErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ApiErrorCode.CSRF_VALIDATION_FAILED]: 403,
  [ApiErrorCode.TIME_RESTRICTION]: 403,
  [ApiErrorCode.BAD_REQUEST]: 400,
  [ApiErrorCode.VALIDATION_ERROR]: 400,
  [ApiErrorCode.MISSING_REQUIRED_FIELD]: 400,
  [ApiErrorCode.INVALID_PARAMETER]: 400,
  [ApiErrorCode.NOT_FOUND]: 404,
  [ApiErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ApiErrorCode.CONFLICT]: 409,
  [ApiErrorCode.DUPLICATE_ENTRY]: 409,
  [ApiErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ApiErrorCode.INTERNAL_ERROR]: 500,
  [ApiErrorCode.DATABASE_ERROR]: 500,
  [ApiErrorCode.BUSINESS_ERROR]: 400,
  [ApiErrorCode.ALREADY_CLOCKED_IN]: 400,
  [ApiErrorCode.ALREADY_CLOCKED_OUT]: 400,
  [ApiErrorCode.INVALID_CLOCK_TYPE]: 400,
  [ApiErrorCode.INSUFFICIENT_BALANCE]: 400,
  [ApiErrorCode.OVERLAPPING_REQUEST]: 409
};

// 錯誤代碼對應的預設訊息
const defaultMessages: Record<ApiErrorCode, string> = {
  [ApiErrorCode.UNAUTHORIZED]: '未授權訪問',
  [ApiErrorCode.INVALID_TOKEN]: '無效的認證令牌',
  [ApiErrorCode.TOKEN_EXPIRED]: '認證令牌已過期',
  [ApiErrorCode.FORBIDDEN]: '禁止訪問',
  [ApiErrorCode.INSUFFICIENT_PERMISSIONS]: '權限不足',
  [ApiErrorCode.CSRF_VALIDATION_FAILED]: 'CSRF 驗證失敗',
  [ApiErrorCode.TIME_RESTRICTION]: '時段限制',
  [ApiErrorCode.BAD_REQUEST]: '請求格式錯誤',
  [ApiErrorCode.VALIDATION_ERROR]: '資料驗證失敗',
  [ApiErrorCode.MISSING_REQUIRED_FIELD]: '缺少必要欄位',
  [ApiErrorCode.INVALID_PARAMETER]: '無效的參數',
  [ApiErrorCode.NOT_FOUND]: '資源不存在',
  [ApiErrorCode.RESOURCE_NOT_FOUND]: '找不到指定資源',
  [ApiErrorCode.CONFLICT]: '資源衝突',
  [ApiErrorCode.DUPLICATE_ENTRY]: '資料重複',
  [ApiErrorCode.RATE_LIMIT_EXCEEDED]: '請求過於頻繁',
  [ApiErrorCode.INTERNAL_ERROR]: '系統錯誤',
  [ApiErrorCode.DATABASE_ERROR]: '資料庫錯誤',
  [ApiErrorCode.BUSINESS_ERROR]: '業務邏輯錯誤',
  [ApiErrorCode.ALREADY_CLOCKED_IN]: '今日已打上班卡',
  [ApiErrorCode.ALREADY_CLOCKED_OUT]: '今日已打下班卡',
  [ApiErrorCode.INVALID_CLOCK_TYPE]: '無效的打卡類型',
  [ApiErrorCode.INSUFFICIENT_BALANCE]: '餘額不足',
  [ApiErrorCode.OVERLAPPING_REQUEST]: '申請期間重疊'
};

/**
 * 建立統一的錯誤回應
 */
export function createErrorResponse(
  code: ApiErrorCode,
  message?: string,
  details?: Record<string, unknown>,
  path?: string
): NextResponse<ApiErrorResponse> {
  const status = errorCodeToStatus[code] || 500;
  const errorMessage = message || defaultMessages[code] || '未知錯誤';

  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message: errorMessage,
      timestamp: new Date().toISOString(),
      ...(details && { details }),
      ...(path && { path })
    }
  };

  return NextResponse.json(response, { status });
}

/**
 * 建立統一的成功回應
 */
export function createSuccessResponse<T>(
  data: T,
  message?: string
): NextResponse<ApiSuccessResponse<T>> {
  const response: ApiSuccessResponse<T> = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(message && { message })
  };

  return NextResponse.json(response);
}

/**
 * 建立分頁成功回應
 */
export function createPaginatedResponse<T>(
  data: T[],
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  },
  message?: string
): NextResponse {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
      hasNext: pagination.page * pagination.pageSize < pagination.total,
      hasPrev: pagination.page > 1
    },
    timestamp: new Date().toISOString(),
    ...(message && { message })
  });
}

/**
 * 錯誤處理包裝器
 * 自動捕獲錯誤並返回統一格式
 */
export function withErrorHandler<T extends unknown[], R>(
  handler: (...args: T) => Promise<NextResponse<R>>
): (...args: T) => Promise<NextResponse<R | ApiErrorResponse>> {
  return async (...args: T): Promise<NextResponse<R | ApiErrorResponse>> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error('API Error:', error);
      
      if (error instanceof ApiError) {
        return createErrorResponse(
          error.code,
          error.message,
          error.details,
          error.path
        );
      }
      
      return createErrorResponse(
        ApiErrorCode.INTERNAL_ERROR,
        '系統發生錯誤，請稍後再試'
      );
    }
  };
}

/**
 * 自訂 API 錯誤類別
 */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message?: string,
    public details?: Record<string, unknown>,
    public path?: string
  ) {
    super(message || defaultMessages[code]);
    this.name = 'ApiError';
  }
}

// 快捷函數
export const unauthorized = (message?: string) => 
  createErrorResponse(ApiErrorCode.UNAUTHORIZED, message);

export const forbidden = (message?: string) => 
  createErrorResponse(ApiErrorCode.FORBIDDEN, message);

export const badRequest = (message?: string, details?: Record<string, unknown>) => 
  createErrorResponse(ApiErrorCode.BAD_REQUEST, message, details);

export const notFound = (message?: string) => 
  createErrorResponse(ApiErrorCode.NOT_FOUND, message);

export const rateLimitExceeded = (retryAfter?: number) => 
  createErrorResponse(ApiErrorCode.RATE_LIMIT_EXCEEDED, undefined, { retryAfter });

export const internalError = (message?: string) => 
  createErrorResponse(ApiErrorCode.INTERNAL_ERROR, message);
