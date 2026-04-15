/**
 * 帶 CSRF 保護的 Fetch 工具函數
 * 
 * 用於自動處理 CSRF token 的獲取和傳送
 */

// 緩存 CSRF token
let cachedCSRFToken: string | null = null;
let tokenExpiry: number = 0;
const TOKEN_CACHE_DURATION = 23 * 60 * 60 * 1000; // 23小時（token 24小時過期）

async function isCSRFErrorResponse(response: Response): Promise<boolean> {
  if (response.status !== 403) {
    return false;
  }

  try {
    const payload = await response.clone().json();
    const text = [payload?.error, payload?.details]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();

    return text.includes('csrf');
  } catch {
    return false;
  }
}

/**
 * 獲取 CSRF Token
 */
export async function getCSRFToken(): Promise<string | null> {
  // 檢查緩存是否有效
  if (cachedCSRFToken && Date.now() < tokenExpiry) {
    return cachedCSRFToken;
  }

  try {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      console.error('獲取 CSRF Token 失敗:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (data.success && data.csrfToken) {
      cachedCSRFToken = data.csrfToken;
      tokenExpiry = Date.now() + TOKEN_CACHE_DURATION;
      return cachedCSRFToken;
    }
    
    return null;
  } catch (error) {
    console.error('獲取 CSRF Token 錯誤:', error);
    return null;
  }
}

/**
 * 清除緩存的 CSRF Token
 */
export function clearCSRFToken(): void {
  cachedCSRFToken = null;
  tokenExpiry = 0;
}

/**
 * 需要 CSRF 保護的 HTTP 方法
 */
const CSRF_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * 帶 CSRF 保護的 Fetch 函數
 * 
 * @param url - 請求 URL
 * @param options - Fetch 選項
 * @returns Promise<Response>
 */
export async function fetchWithCSRF(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase();
  
  // 始終包含 credentials
  const fetchOptions: RequestInit = {
    ...options,
    credentials: 'include'
  };
  
  // 如果是需要 CSRF 保護的方法
  if (CSRF_METHODS.includes(method)) {
    const csrfToken = await getCSRFToken();
    
    if (!csrfToken) {
      throw new Error('無法獲取安全令牌，請刷新頁面重試');
    }
    
    // 合併 headers
    const existingHeaders = options.headers || {};
    fetchOptions.headers = {
      ...existingHeaders,
      'x-csrf-token': csrfToken
    };
  }

  const response = await fetch(url, fetchOptions);

  if (CSRF_METHODS.includes(method) && await isCSRFErrorResponse(response)) {
    clearCSRFToken();

    const freshToken = await getCSRFToken();
    if (!freshToken) {
      return response;
    }

    const retryHeaders = {
      ...((fetchOptions.headers as Record<string, string> | undefined) || {}),
      'x-csrf-token': freshToken,
    };

    return fetch(url, {
      ...fetchOptions,
      headers: retryHeaders,
    });
  }

  return response;
}

/**
 * 帶 CSRF 保護的 JSON Fetch 函數選項
 */
interface FetchJSONOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * 帶 CSRF 保護的 JSON Fetch 函數
 * 
 * @param url - 請求 URL
 * @param options - Fetch 選項（body 會自動 JSON.stringify）
 * @returns Promise<Response>
 */
export async function fetchJSONWithCSRF(
  url: string,
  options: FetchJSONOptions = {}
): Promise<Response> {
  const { body, headers: customHeaders, ...restOptions } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders || {})
  };
  
  return fetchWithCSRF(url, {
    ...restOptions,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

export default fetchWithCSRF;
