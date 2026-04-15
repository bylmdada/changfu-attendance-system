import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';

interface PasswordResetSettings {
  emailResetEnabled: boolean;
  adminContact: string;
}

const SETTINGS_KEY = 'password_reset_settings';

const DEFAULT_SETTINGS: PasswordResetSettings = {
  emailResetEnabled: false,
  adminContact: '請聯繫系統管理員',
};

function normalizeSettings(input: Partial<PasswordResetSettings>): PasswordResetSettings {
  return {
    emailResetEnabled: input.emailResetEnabled ?? DEFAULT_SETTINGS.emailResetEnabled,
    adminContact:
      typeof input.adminContact === 'string' && input.adminContact.trim().length > 0
        ? input.adminContact
        : DEFAULT_SETTINGS.adminContact,
  };
}

async function getStoredSettings(): Promise<PasswordResetSettings> {
  const setting = await prisma.systemSettings.findUnique({
    where: { key: SETTINGS_KEY },
  });

  if (!setting?.value) {
    return DEFAULT_SETTINGS;
  }

  return normalizeSettings(
    safeParseSystemSettingsValue<Partial<PasswordResetSettings>>(setting.value, {}, SETTINGS_KEY)
  );
}

export async function GET() {
  try {
    const settings = await getStoredSettings();

    return NextResponse.json(settings);
  } catch (error) {
    console.error('讀取密碼重設設定失敗:', error);
    return NextResponse.json(
      { error: '讀取設定失敗' },
      { status: 500 }
    );
  }
}
