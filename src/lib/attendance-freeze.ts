import { prisma } from '@/lib/database';
import {
  DEFAULT_ATTENDANCE_FREEZE_SETTINGS,
  getAttendanceFreezeDescription,
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

export function getAttendanceFreezeError(result: FreezeCheckResult | null) {
  if (!result?.isFrozen) return null;

  const freezeDate = result.freezeInfo?.freezeDate.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
  return `該日期所在月份已凍結${freezeDate ? `（生效時間：${freezeDate}）` : ''}，無法修改考勤資料`;
}

const SETTINGS_KEY = 'attendance_freeze';

export async function getAttendanceFreezeSettings(): Promise<AttendanceFreezeSettings> {
  const storedSettings = await prisma.systemSettings.findFirst({
    where: { key: SETTINGS_KEY }
  });

  const settings = {
    ...DEFAULT_ATTENDANCE_FREEZE_SETTINGS,
    ...safeParseSystemSettingsValue<Partial<AttendanceFreezeSettings>>(
      storedSettings?.value,
      {},
      SETTINGS_KEY
    ),
  };
  return {
    ...settings,
    description: getAttendanceFreezeDescription(settings.freezeDay, settings.freezeTime),
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

    const settings = await getAttendanceFreezeSettings();
    const recurringFreezeDate = getFreezeExecutionDateForTargetMonth(targetDate, settings);
    const recurringIsFrozen = isAttendanceFrozenBySettings(targetDate, settings, now);

    if (freeze && now >= freeze.freezeDate) {
      return {
        isFrozen: true,
        freezeInfo: {
          freezeDate: freeze.freezeDate,
          description: freeze.description || undefined,
          creator: freeze.creator
        }
      };
    }

    // 手動凍結尚未生效時，不能遮蔽已生效的週期凍結。
    if (recurringIsFrozen) {
      return {
        isFrozen: true,
        freezeInfo: {
          freezeDate: recurringFreezeDate,
          description: settings.description || undefined,
          creator: { name: '系統設定' }
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
  const datesByMonth = new Map<string, Date>();
  for (const date of targetDates) {
    const taiwanDate = toTaiwanDate(date);
    const key = `${taiwanDate.getFullYear()}-${taiwanDate.getMonth() + 1}`;
    if (!datesByMonth.has(key)) {
      datesByMonth.set(key, date);
    }
  }

  for (const date of datesByMonth.values()) {
    const result = await checkAttendanceFreeze(date);
    if (result.isFrozen) {
      return result;
    }
  }
  return null;
}
