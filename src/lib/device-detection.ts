export const MOBILE_CLOCKING_REQUIRED_MESSAGE = '此系統僅限使用手機打卡，請改用 iPhone 或 Android 手機操作。';

export function isMobileClockingDevice(userAgent: string | null | undefined): boolean {
  if (!userAgent) {
    return false;
  }

  const normalized = userAgent.toLowerCase();
  const isIPhone = /iphone|ipod/.test(normalized);
  const isAndroidPhone = /android/.test(normalized) && /mobile/.test(normalized);

  return isIPhone || isAndroidPhone;
}