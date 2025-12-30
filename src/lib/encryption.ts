/**
 * 資料加密工具
 * 用於加密敏感資料如身分證字號
 */

import crypto from 'crypto';

// 加密金鑰（從環境變數取得，或使用預設值）
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'changfu-attendance-system-key-32';
const IV_LENGTH = 16;

// 確保金鑰長度為 32 bytes
function getKey(): Buffer {
  const key = Buffer.from(ENCRYPTION_KEY);
  if (key.length >= 32) {
    return key.slice(0, 32);
  }
  // 如果金鑰太短，用填充補滿
  const paddedKey = Buffer.alloc(32);
  key.copy(paddedKey);
  return paddedKey;
}

/**
 * 加密字串
 */
export function encrypt(text: string): string {
  if (!text) return '';
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // 返回 iv:encrypted 格式
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 解密字串
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return '';
  
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      // 如果不是加密格式，可能是舊資料，直接返回
      return encryptedText;
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch {
    // 解密失敗，可能是未加密的舊資料
    return encryptedText;
  }
}

/**
 * 遮蔽身分證字號顯示
 * 例如: A123456789 -> A12****789
 */
export function maskIdNumber(idNumber: string): string {
  if (!idNumber || idNumber.length < 6) return idNumber;
  
  // 解密後再遮蔽
  const decrypted = decrypt(idNumber);
  if (decrypted.length < 6) return decrypted;
  
  const start = decrypted.slice(0, 3);
  const end = decrypted.slice(-3);
  const masked = '*'.repeat(decrypted.length - 6);
  
  return start + masked + end;
}

/**
 * 遮蔽銀行帳號顯示
 * 例如: 20592000081113 -> 2059****1113
 */
export function maskBankAccount(account: string): string {
  if (!account || account.length < 8) return account;
  
  const start = account.slice(0, 4);
  const end = account.slice(-4);
  const masked = '*'.repeat(account.length - 8);
  
  return start + masked + end;
}

/**
 * 驗證身分證字號格式（台灣）
 */
export function validateTaiwanIdNumber(id: string): boolean {
  if (!id || id.length !== 10) return false;
  
  // 第一碼必須是英文字母
  const firstChar = id.charAt(0).toUpperCase();
  if (!/^[A-Z]$/.test(firstChar)) return false;
  
  // 後九碼必須是數字
  const numbers = id.slice(1);
  if (!/^\d{9}$/.test(numbers)) return false;
  
  // 驗證檢查碼
  const letterMap: Record<string, number> = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
    K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
    U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33
  };
  
  const n1 = letterMap[firstChar];
  if (!n1) return false;
  
  const n1First = Math.floor(n1 / 10);
  const n1Second = n1 % 10;
  
  const digits = [n1First, n1Second, ...numbers.split('').map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += digits[i] * weights[i];
  }
  
  return sum % 10 === 0;
}
