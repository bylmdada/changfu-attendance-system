/**
 * TOTP 雙因素驗證工具函數
 */
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomInt } from 'crypto';

// 配置 TOTP
authenticator.options = {
  step: 30,      // 30 秒有效期
  window: 1,     // 允許前後各 1 個時間窗口
};

/**
 * 產生新的 TOTP 密鑰
 */
export function generateTOTPSecret(): string {
  return authenticator.generateSecret();
}

/**
 * 產生 TOTP URI (用於 QR Code)
 */
export function generateTOTPUri(secret: string, username: string, issuer: string = '長福會考勤系統'): string {
  return authenticator.keyuri(username, issuer, secret);
}

/**
 * 產生 QR Code (Base64 Data URL)
 */
export async function generateQRCode(secret: string, username: string): Promise<string> {
  const uri = generateTOTPUri(secret, username);
  return QRCode.toDataURL(uri, {
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

/**
 * 驗證 TOTP 驗證碼
 */
export function verifyTOTP(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

/**
 * 產生備用碼 (用於手機遺失時)
 */
export function generateBackupCodes(count: number = 8): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes = new Set<string>();

  while (codes.size < count) {
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += alphabet[randomInt(0, alphabet.length)];
    }
    codes.add(code);
  }

  return Array.from(codes);
}

/**
 * 驗證備用碼
 */
export function verifyBackupCode(inputCode: string, storedCodes: string[]): { valid: boolean; remainingCodes: string[] } {
  const normalizedInput = inputCode.toUpperCase().replace(/\s/g, '');
  const index = storedCodes.findIndex(code => code === normalizedInput);
  
  if (index === -1) {
    return { valid: false, remainingCodes: storedCodes };
  }
  
  // 移除已使用的備用碼
  const remainingCodes = [...storedCodes];
  remainingCodes.splice(index, 1);
  
  return { valid: true, remainingCodes };
}
