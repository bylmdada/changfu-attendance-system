import { prisma } from '@/lib/database';
import { safeParseSystemSettingsValue } from '@/lib/system-settings-json';
import {
  type PasswordPolicy,
  getDefaultPasswordPolicy,
  normalizePasswordPolicy,
} from '@/lib/password-policy';

export const PASSWORD_POLICY_SETTINGS_KEY = 'password_policy';

export async function getStoredPasswordPolicy(): Promise<PasswordPolicy> {
  const setting = await prisma.systemSettings.findUnique({
    where: { key: PASSWORD_POLICY_SETTINGS_KEY }
  });

  if (!setting?.value) {
    return getDefaultPasswordPolicy();
  }

  return normalizePasswordPolicy(
    safeParseSystemSettingsValue<Partial<PasswordPolicy>>(setting.value, {}, PASSWORD_POLICY_SETTINGS_KEY)
  );
}
