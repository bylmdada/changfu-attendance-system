import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const username = isPlainObject(body) && typeof body.username === 'string'
      ? body.username
      : '';

    if (!username) {
      return NextResponse.json({ hasCredentials: false });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        employee: true,
        webauthnCredentials: {
          select: {
            id: true,
            deviceName: true,
            createdAt: true,
            lastUsedAt: true
          }
        }
      }
    });

    if (!user || !user.isActive || !user.employee) {
      return NextResponse.json({ hasCredentials: false });
    }

    const authenticatedUser = await getUserFromRequest(request);

    if (!authenticatedUser || authenticatedUser.userId !== user.id) {
      return NextResponse.json({ hasCredentials: false });
    }

    return NextResponse.json({ hasCredentials: user.webauthnCredentials.length > 0 });
  } catch (error) {
    console.error('檢查 WebAuthn 憑證錯誤:', error);
    return NextResponse.json({ hasCredentials: false });
  }
}
