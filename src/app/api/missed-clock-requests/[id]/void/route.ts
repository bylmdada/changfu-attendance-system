import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// POST: ADMIN/HR 直接作廢補卡申請
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: '請求太頻繁' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (!['ADMIN', 'HR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要 HR 或管理員權限' }, { status: 403 });
    }

    const { id } = await params;
    const parsedRequestId = parseIntegerQueryParam(id, { min: 1 });
    if (!parsedRequestId.isValid || parsedRequestId.value === null) {
      return NextResponse.json({ error: '申請ID格式錯誤' }, { status: 400 });
    }
    const requestId = parsedRequestId.value;

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的補卡作廢資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的補卡作廢資料' }, { status: 400 });
    }

    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    if (!reason || reason.trim() === '') {
      return NextResponse.json({ error: '請填寫作廢原因' }, { status: 400 });
    }

    const missedClockRequest = await prisma.missedClockRequest.findUnique({
      where: { id: requestId }
    });

    if (!missedClockRequest) {
      return NextResponse.json({ error: '找不到此補卡申請' }, { status: 404 });
    }

    if (missedClockRequest.status !== 'APPROVED') {
      return NextResponse.json({ error: '只能作廢已核准的申請' }, { status: 400 });
    }

    await prisma.missedClockRequest.update({
      where: { id: requestId },
      data: {
        status: 'VOIDED',
        voidedBy: decoded.employeeId,
        voidedAt: new Date(),
        voidReason: reason.trim()
      }
    });

    return NextResponse.json({
      success: true,
      message: '補卡申請已作廢'
    });
  } catch (error) {
    console.error('作廢補卡申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
