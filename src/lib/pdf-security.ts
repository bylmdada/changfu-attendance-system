/**
 * PDF 加密輔助模組
 * 
 * 使用 pdf-lib 為 PDF 加密（設定開啟密碼）
 * 
 * 注意：pdf-lib 本身不支援密碼加密，需使用其他方式處理
 * 此模組提供密碼生成邏輯，實際加密需配合前端或其他工具
 */

import { prisma } from './database';

// 密碼類型
export type PasswordType = 'none' | 'id_last4' | 'birthday' | 'custom';

// 安全設定介面
export interface PDFSecurityConfig {
  passwordProtected: boolean;
  passwordType: PasswordType;
  customPassword?: string;
}

/**
 * 取得員工的 PDF 密碼
 * 
 * @param employeeId 員工 ID（資料庫 ID）
 * @param securityConfig 安全設定
 * @returns 密碼字串，如果不需密碼則返回 null
 */
export async function getEmployeePDFPassword(
  employeeId: number,
  securityConfig: PDFSecurityConfig
): Promise<string | null> {
  if (!securityConfig.passwordProtected || securityConfig.passwordType === 'none') {
    return null;
  }

  // 自訂密碼
  if (securityConfig.passwordType === 'custom') {
    return securityConfig.customPassword || null;
  }

  // 查詢員工資料
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      employeeId: true,
      birthday: true
    }
  });

  if (!employee) {
    return null;
  }

  // 身分證後4碼（使用員工編號後4碼代替）
  if (securityConfig.passwordType === 'id_last4') {
    const empId = employee.employeeId;
    return empId.slice(-4);
  }

  // 生日 (MMDD)
  if (securityConfig.passwordType === 'birthday') {
    const birthday = new Date(employee.birthday);
    const month = String(birthday.getMonth() + 1).padStart(2, '0');
    const day = String(birthday.getDate()).padStart(2, '0');
    return `${month}${day}`;
  }

  return null;
}

/**
 * 取得預設安全設定
 */
export function getDefaultSecurityConfig(): PDFSecurityConfig {
  return {
    passwordProtected: false,
    passwordType: 'none'
  };
}

/**
 * 產生 PDF 下載說明
 * 
 * @param passwordType 密碼類型
 * @returns 使用者說明文字
 */
export function getPasswordHint(passwordType: PasswordType): string {
  switch (passwordType) {
    case 'id_last4':
      return '密碼為您的員工編號後4碼';
    case 'birthday':
      return '密碼為您的生日 (MMDD)，例如 3月15日 = 0315';
    case 'custom':
      return '請輸入管理員提供的密碼';
    default:
      return '';
  }
}

/**
 * 驗證安全設定
 */
export function validateSecurityConfig(config: PDFSecurityConfig): boolean {
  if (!config.passwordProtected) {
    return true;
  }

  if (config.passwordType === 'custom' && !config.customPassword) {
    return false;
  }

  return true;
}
