/**
 * 檔案上傳驗證工具
 * 統一管理檔案上傳的大小限制、類型驗證等
 */

// 檔案大小限制（單位：bytes）
export const FILE_SIZE_LIMITS = {
  IMAGE: 5 * 1024 * 1024,         // 5MB - 圖片
  DOCUMENT: 10 * 1024 * 1024,     // 10MB - 文件
  EXCEL: 5 * 1024 * 1024,         // 5MB - Excel
  ATTACHMENT: 10 * 1024 * 1024,   // 10MB - 一般附件
  TOTAL_UPLOAD: 20 * 1024 * 1024, // 20MB - 單次上傳總量
} as const;

// 允許的 MIME 類型
export const ALLOWED_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  DOCUMENT: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ],
  EXCEL: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ],
  ALL: [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
} as const;

// 允許的副檔名
export const ALLOWED_EXTENSIONS = {
  IMAGE: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  DOCUMENT: ['.pdf', '.doc', '.docx'],
  EXCEL: ['.xls', '.xlsx', '.csv'],
  ALL: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv']
} as const;

interface FileValidationResult {
  valid: boolean;
  error?: string;
}

interface FileValidationOptions {
  maxSize?: number;
  allowedMimeTypes?: readonly string[];
  allowedExtensions?: readonly string[];
}

/**
 * 驗證單一檔案
 */
export function validateFile(file: File, options: FileValidationOptions = {}): FileValidationResult {
  const {
    maxSize = FILE_SIZE_LIMITS.ATTACHMENT,
    allowedMimeTypes = ALLOWED_MIME_TYPES.ALL,
    allowedExtensions = ALLOWED_EXTENSIONS.ALL
  } = options;

  // 檢查檔案大小
  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `檔案「${file.name}」大小 ${fileSizeMB}MB 超過限制 ${maxSizeMB}MB`
    };
  }

  // 檢查 MIME 類型
  if (!allowedMimeTypes.includes(file.type)) {
    return {
      valid: false,
      error: `檔案「${file.name}」格式不支援，請上傳 ${allowedExtensions.join(', ')} 格式`
    };
  }

  // 檢查副檔名
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `檔案「${file.name}」副檔名不支援，請上傳 ${allowedExtensions.join(', ')} 格式`
    };
  }

  return { valid: true };
}

/**
 * 驗證多個檔案
 */
export function validateFiles(
  files: File[],
  options: FileValidationOptions & { maxTotalSize?: number } = {}
): FileValidationResult {
  const { maxTotalSize = FILE_SIZE_LIMITS.TOTAL_UPLOAD, ...fileOptions } = options;

  // 檢查每個檔案
  for (const file of files) {
    const result = validateFile(file, fileOptions);
    if (!result.valid) {
      return result;
    }
  }

  // 檢查總大小
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > maxTotalSize) {
    const maxSizeMB = (maxTotalSize / (1024 * 1024)).toFixed(1);
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `總檔案大小 ${totalSizeMB}MB 超過限制 ${maxSizeMB}MB`
    };
  }

  return { valid: true };
}

/**
 * 格式化檔案大小為可讀字串
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 取得檔案類型的大小限制（用於前端顯示）
 */
export function getFileSizeLimitMB(type: keyof typeof FILE_SIZE_LIMITS): number {
  return FILE_SIZE_LIMITS[type] / (1024 * 1024);
}
