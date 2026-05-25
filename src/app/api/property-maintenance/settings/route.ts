import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canManageSite } from '@/lib/property-access';
import { resolveSiteConfig, type SiteConfigOverride } from '@/lib/app-config';
import { parsePositiveInt } from '@/lib/property-query';

const MAX_SUPERVISOR_EMAILS = 20;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRawSettings(settings: string | null): SiteConfigOverride {
  if (!settings) return {};
  try {
    const parsed = JSON.parse(settings);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as SiteConfigOverride)
      : {};
  } catch {
    return {};
  }
}

function normalizeSettingsInput(settings: unknown): SiteConfigOverride | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const input = settings as Record<string, unknown>;
  const reminderDays = Number(input.reminderDays);
  const maintenanceWeekday = Number(input.maintenanceWeekday);
  const reviewWeekday = Number(input.reviewWeekday);
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) return null;
  if (!Number.isInteger(maintenanceWeekday) || maintenanceWeekday < 0 || maintenanceWeekday > 6) {
    return null;
  }
  if (!Number.isInteger(reviewWeekday) || reviewWeekday < 0 || reviewWeekday > 6) return null;

  const supervisorEmail = Array.isArray(input.supervisorEmail)
    ? input.supervisorEmail.map((value) => String(value).trim()).filter(Boolean)
    : typeof input.supervisorEmail === 'string'
      ? input.supervisorEmail.split(',').map((value) => value.trim()).filter(Boolean)
      : [];
  if (
    supervisorEmail.length > MAX_SUPERVISOR_EMAILS ||
    supervisorEmail.some((email) => !EMAIL_PATTERN.test(email))
  ) {
    return null;
  }

  return {
    emailEnabled: input.emailEnabled !== false,
    reminderDays,
    maintenanceWeekday,
    reviewWeekday,
    supervisorEmail,
  };
}

// GET ?siteId=：取得該據點設定（原始 JSON + 解析後值）
export async function GET(request: NextRequest) {
  const g = await guard(request);
  if ('res' in g) return g.res;
  const siteId = parsePositiveInt(request.nextUrl.searchParams.get('siteId'));
  if (!siteId) return fail('缺少 siteId');
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);

  const site = await prisma.propertySite.findUnique({ where: { id: siteId } });
  if (!site) return fail('找不到據點', 404);
  if (!site.isActive) return fail('據點已停用，無法修改設定', 403);
  return ok({
    siteId,
    raw: parseRawSettings(site.settings),
    resolved: resolveSiteConfig(site.settings),
  });
}

// PUT：更新該據點設定（§11：維護人員/主管/頻率/時段/email開關）
export async function PUT(request: NextRequest) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;
  const body = await request.json().catch(() => null);
  const siteId = parsePositiveInt(body?.siteId);
  if (!siteId) return fail('缺少 siteId');
  if (!canManageSite(g.ctx.access, siteId)) return fail('無權限', 403);
  const site = await prisma.propertySite.findUnique({
    where: { id: siteId },
    select: { id: true, isActive: true },
  });
  if (!site) return fail('找不到據點', 404);
  if (!site.isActive) return fail('據點已停用，無法修改設定', 403);

  const settings = normalizeSettingsInput(body?.settings);
  if (!settings) return fail('settings 格式錯誤');

  try {
    const updated = await prisma.propertySite.update({
      where: { id: siteId },
      data: { settings: JSON.stringify(settings) },
    });
    return ok({ siteId, resolved: resolveSiteConfig(updated.settings) }, '已儲存設定');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return fail('找不到據點', 404);
    }
    console.error('更新財產管理設定失敗:', error);
    return fail('系統錯誤', 500);
  }
}
