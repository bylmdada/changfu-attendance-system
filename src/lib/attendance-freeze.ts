import { prisma } from '@/lib/database';

export interface FreezeCheckResult {
  isFrozen: boolean;
  freezeInfo?: {
    freezeDate: Date;
    description?: string;
    creator: {
      name: string;
    };
  };
}

/**
 * 檢查指定日期是否被凍結
 * @param targetDate 目標日期
 * @returns 凍結檢查結果
 */
export async function checkAttendanceFreeze(targetDate: Date): Promise<FreezeCheckResult> {
  try {
    const targetMonth = targetDate.getMonth() + 1; // JavaScript月份從0開始
    const targetYear = targetDate.getFullYear();

    const freeze = await prisma.attendanceFreeze.findFirst({
      where: {
        targetMonth,
        targetYear,
        isActive: true
      },
      include: {
        creator: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        freezeDate: 'desc' // 取最新的凍結設定
      }
    });

    if (!freeze) {
      return { isFrozen: false };
    }

    // 檢查當前時間是否已經超過凍結時間
    const now = new Date();
    if (now >= freeze.freezeDate) {
      return {
        isFrozen: true,
        freezeInfo: {
          freezeDate: freeze.freezeDate,
          description: freeze.description || undefined,
          creator: freeze.creator
        }
      };
    }

    return { isFrozen: false };
  } catch (error) {
    console.error('檢查凍結狀態失敗:', error);
    // 出錯時預設為不凍結，避免影響正常功能
    return { isFrozen: false };
  }
}

/**
 * 檢查多個日期是否被凍結
 * @param targetDates 目標日期數組
 * @returns 第一個被凍結的日期檢查結果，如果都沒有凍結則返回null
 */
export async function checkMultipleDatesFreeze(targetDates: Date[]): Promise<FreezeCheckResult | null> {
  for (const date of targetDates) {
    const result = await checkAttendanceFreeze(date);
    if (result.isFrozen) {
      return result;
    }
  }
  return null;
}
