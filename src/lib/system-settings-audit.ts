import { NextRequest } from 'next/server';
import {
  AuditAction,
  AuditTargetType,
  getRequestInfo,
  logAudit,
} from '@/lib/audit';

type AuditUser = {
  id?: number;
  userId?: number;
  employeeId?: number;
  employee?: { id?: number } | null;
};

const SECRET_FIELD_PATTERN = /(password|token|secret|apiKey|accessKey|privateKey|idNumber)/i;
const MASKED_VALUE = '********';

function actorIds(user: AuditUser) {
  return {
    userId: typeof user.userId === 'number' ? user.userId : user.id,
    employeeId: typeof user.employeeId === 'number' ? user.employeeId : user.employee?.id,
  };
}

function sanitizeAuditValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeAuditValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SECRET_FIELD_PATTERN.test(key) ? MASKED_VALUE : sanitizeAuditValue(child),
    ])
  );
}

export async function logSystemSettingsChange(options: {
  request: NextRequest;
  user: AuditUser;
  settingKey: string;
  description: string;
  oldValue: unknown;
  newValue: unknown;
  targetId?: number;
}) {
  const { ip, userAgent } = getRequestInfo(options.request);
  const { userId, employeeId } = actorIds(options.user);

  await logAudit({
    userId,
    employeeId,
    action: AuditAction.SETTINGS_UPDATE,
    targetType: AuditTargetType.SYSTEM_SETTINGS,
    targetId: options.targetId,
    description: options.description,
    oldValue: {
      settingKey: options.settingKey,
      value: sanitizeAuditValue(options.oldValue),
    },
    newValue: {
      settingKey: options.settingKey,
      value: sanitizeAuditValue(options.newValue),
    },
    ipAddress: ip,
    userAgent,
  });
}
