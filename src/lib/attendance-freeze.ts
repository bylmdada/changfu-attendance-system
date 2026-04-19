import { prisma } from '@/lib/database';
import {
  DEFAULT_ATTENDANCE_FREEZE_SETTINGS,
  getFreezeExecutionDateForTargetMonth,
  isAttendanceFrozenBySettings,
  type AttendanceFreezeSettings,
} from '@/lib/attendance-freeze-rules';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import { toTaiwanDate } from '@/lib/timezone';

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

const SETTINGS_KEY = 'attendance_freeze';

async function getRecurringFreezeSettings(): Promise<AttendanceFreezeSettings> {
  const storedSettings = await prisma.systemSettings.findFirst({
    where: { key: SETTINGS_KEY }
  });

  return {
    ...DEFAULT_ATTENDANCE_FREEZE_SETTINGS,
    ...safeParseSystemSettingsValue<Partial<AttendanceFreezeSettings>>(
      storedSettings?.value,
      {},
      SETTINGS_KEY
    ),
  };
}

/**
 * 檢查指定日期是否被凍結
 * @param targetDate 目標日期
 * @returns 凍結檢查結果
 */
export async function checkAttendanceFreeze(targetDate: Date): Promise<FreezeCheckResult> {
  try {
    const taiwanTargetDate = toTaiwanDate(targetDate);
    const targetMonth = taiwanTargetDate.getMonth() + 1;
    const targetYear = taiwanTargetDate.getFullYear();
    const now = new Date();

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
      const settings = await getRecurringFreezeSettings();

      if (!isAttendanceFrozenBySettings(targetDate, settings, now)) {
        return { isFrozen: false };
      }

      return {
        isFrozen: true,
        freezeInfo: {
          freezeDate: getFreezeExecutionDateForTargetMonth(targetDate, settings),
          description: settings.description || undefined,
          creator: {
            name: '系統設定'
          }
        }
      };
    }

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
    throw error;
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
