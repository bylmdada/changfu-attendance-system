import { prisma } from '@/lib/database';

// GPS 模擬偵測結果
interface FraudDetectionResult {
  isSuspicious: boolean;
  reasons: string[];
  riskScore: number; // 0-100
}

// 位置記錄（用於跳變偵測）
interface LocationRecord {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: Date;
}

// 內存存儲最近的位置記錄（生產環境建議使用 Redis）
const recentLocationsStore = new Map<number, LocationRecord[]>();
const MAX_STORED_LOCATIONS = 10;

/**
 * 計算兩點之間的距離（公尺）
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // 地球半徑（公尺）
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * 偵測 GPS 座標是否疑似模擬
 */
export function detectGpsSpoofing(
  latitude: number,
  longitude: number,
  accuracy: number,
  employeeId: number
): FraudDetectionResult {
  const reasons: string[] = [];
  let riskScore = 0;

  // 1. 檢查「完美」座標（可能是手動輸入或模擬器）
  const latDecimals = (latitude.toString().split('.')[1] || '').length;
  const lngDecimals = (longitude.toString().split('.')[1] || '').length;
  
  if (latDecimals < 4 || lngDecimals < 4) {
    reasons.push('座標精度異常低（小數位數不足）');
    riskScore += 25;
  }

  // 2. 檢查座標是否是「完美整數」
  if (Number.isInteger(latitude) || Number.isInteger(longitude)) {
    reasons.push('座標為完美整數（極不尋常）');
    riskScore += 40;
  }

  // 3. 檢查精度是否異常完美（模擬器通常回報完美精度）
  if (accuracy === 0 || accuracy < 3) {
    reasons.push('GPS 精度異常完美');
    riskScore += 20;
  }

  // 4. 檢查座標跳變（與最近的位置比較）
  const recentLocations = recentLocationsStore.get(employeeId) || [];
  const now = new Date();

  if (recentLocations.length > 0) {
    const lastLocation = recentLocations[recentLocations.length - 1];
    const distance = calculateDistance(
      lastLocation.latitude, lastLocation.longitude,
      latitude, longitude
    );
    const timeDiff = (now.getTime() - lastLocation.timestamp.getTime()) / 1000; // 秒

    // 如果 60 秒內移動超過 500 公尺，可能是 GPS 跳變或欺騙
    if (timeDiff < 60 && distance > 500) {
      const speed = distance / timeDiff; // 公尺/秒
      reasons.push(`座標異常跳變（${Math.round(distance)}公尺/${Math.round(timeDiff)}秒，時速${Math.round(speed * 3.6)}公里）`);
      riskScore += 35;
    }

    // 如果 5 分鐘內移動超過 10 公里，極其可疑
    if (timeDiff < 300 && distance > 10000) {
      reasons.push('位置瞬間移動距離過大');
      riskScore += 50;
    }
  }

  // 5. 更新位置記錄
  recentLocations.push({
    latitude,
    longitude,
    accuracy,
    timestamp: now
  });

  // 只保留最近的記錄
  if (recentLocations.length > MAX_STORED_LOCATIONS) {
    recentLocations.shift();
  }
  recentLocationsStore.set(employeeId, recentLocations);

  return {
    isSuspicious: riskScore >= 30,
    reasons,
    riskScore: Math.min(riskScore, 100)
  };
}

/**
 * 偵測異常打卡模式
 */
export async function detectAbnormalClockPattern(
  employeeId: number,
  clockType: 'in' | 'out'
): Promise<FraudDetectionResult> {
  const reasons: string[] = [];
  let riskScore = 0;
  const now = new Date();

  // 1. 檢查是否在異常時段打卡（深夜 0:00-5:00）
  const hour = now.getHours();
  if (hour >= 0 && hour < 5) {
    reasons.push('深夜/凌晨時段打卡');
    riskScore += 15;
  }

  // 2. 檢查最近1分鐘內是否重複打卡嘗試
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  
  try {
    const recentAttempts = await prisma.auditLog.count({
      where: {
        employeeId,
        action: { in: ['CLOCK_IN', 'CLOCK_OUT', 'CLOCK_FAILED'] },
        createdAt: { gte: oneMinuteAgo }
      }
    });

    if (recentAttempts >= 3) {
      reasons.push(`1分鐘內有${recentAttempts}次打卡嘗試`);
      riskScore += 20;
    }
  } catch {
    // 忽略查詢錯誤
  }

  // 3. 檢查今日是否有異常多次打卡嘗試
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  try {
    const todayAttempts = await prisma.auditLog.count({
      where: {
        employeeId,
        action: { in: ['CLOCK_IN', 'CLOCK_OUT', 'CLOCK_FAILED'] },
        createdAt: { gte: todayStart }
      }
    });

    if (todayAttempts >= 10) {
      reasons.push(`今日打卡嘗試次數異常多（${todayAttempts}次）`);
      riskScore += 25;
    }
  } catch {
    // 忽略查詢錯誤
  }

  // 4. 檢查上班打卡後很快下班（可能是代打卡）
  if (clockType === 'out') {
    try {
      const todayRecord = await prisma.attendanceRecord.findFirst({
        where: {
          employeeId,
          workDate: { gte: todayStart },
          clockInTime: { not: null }
        }
      });

      if (todayRecord?.clockInTime) {
        const clockInTime = new Date(todayRecord.clockInTime);
        const workDuration = (now.getTime() - clockInTime.getTime()) / (1000 * 60); // 分鐘

        if (workDuration < 30) {
          reasons.push(`上班到下班間隔過短（僅${Math.round(workDuration)}分鐘）`);
          riskScore += 30;
        }
      }
    } catch {
      // 忽略查詢錯誤
    }
  }

  return {
    isSuspicious: riskScore >= 30,
    reasons,
    riskScore: Math.min(riskScore, 100)
  };
}

/**
 * 清理過期的位置記錄
 */
export function cleanupLocationRecords(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  
  for (const [employeeId, locations] of recentLocationsStore.entries()) {
    const validLocations = locations.filter(loc => loc.timestamp.getTime() > oneHourAgo);
    if (validLocations.length === 0) {
      recentLocationsStore.delete(employeeId);
    } else {
      recentLocationsStore.set(employeeId, validLocations);
    }
  }
}
