/**
 * 財產管理 API 共用前置：rate-limit + auth (+ 可選 CSRF) + 據點權限。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getSiteAccess, type SiteAccess } from '@/lib/property-access';

export interface AuthedContext {
  user: { userId: number; employeeId: number; username: string; role: string };
  access: SiteAccess;
}

type GuardResult = { ctx: AuthedContext } | { res: NextResponse };

export async function guard(
  request: NextRequest,
  opts: { csrf?: boolean } = {}
): Promise<GuardResult> {
  const rl = await checkRateLimit(request);
  if (!rl.allowed) {
    return { res: NextResponse.json({ error: 'Too many requests' }, { status: 429 }) };
  }
  if (opts.csrf) {
    const csrf = await validateCSRF(request);
    if (!csrf.valid) {
      return { res: NextResponse.json({ error: `CSRF驗證失敗: ${csrf.error}` }, { status: 403 }) };
    }
  }
  const user = await getUserFromRequest(request);
  if (!user) {
    return { res: NextResponse.json({ error: '未授權訪問' }, { status: 401 }) };
  }
  const access = await getSiteAccess({ userId: user.userId, role: user.role });
  return { ctx: { user, access } };
}

export function ok(data: unknown, message?: string) {
  return NextResponse.json({ success: true, data, ...(message ? { message } : {}) });
}

export function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}
