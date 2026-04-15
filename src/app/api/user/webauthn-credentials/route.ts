import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 獲取用戶的 WebAuthn 憑證列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const credentials = await prisma.webAuthnCredential.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({ 
      success: true,
      credentials: credentials.map(c => ({
        id: c.id,
        deviceName: c.deviceName || '未命名裝置',
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt
      }))
    });
  } catch (error) {
    console.error('獲取 WebAuthn 憑證失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除用戶的 WebAuthn 憑證
export async function DELETE(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json({ error: '無效的 JSON 格式' }, { status: 400 });
    }

    const body = parseResult.data;
    const credentialId = isPlainObject(body) && typeof body.credentialId === 'number'
      ? body.credentialId
      : null;

    if (!credentialId) {
      return NextResponse.json({ error: '缺少憑證 ID' }, { status: 400 });
    }

    // 確保只能刪除自己的憑證
    const credential = await prisma.webAuthnCredential.findFirst({
      where: {
        id: credentialId,
        userId: user.userId
      }
    });

    if (!credential) {
      return NextResponse.json({ error: '憑證不存在或無權限刪除' }, { status: 404 });
    }

    await prisma.webAuthnCredential.delete({
      where: { id: credentialId }
    });

    return NextResponse.json({ 
      success: true,
      message: 'Face ID / 指紋已刪除'
    });
  } catch (error) {
    console.error('刪除 WebAuthn 憑證失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
