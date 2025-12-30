import { NextResponse } from 'next/server';
import { prisma } from '@/lib/database';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();

    if (!username) {
      return NextResponse.json({ hasCredentials: false });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      include: {
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

    if (!user) {
      return NextResponse.json({ hasCredentials: false });
    }

    return NextResponse.json({
      hasCredentials: user.webauthnCredentials.length > 0,
      credentials: user.webauthnCredentials.map(c => ({
        id: c.id,
        deviceName: c.deviceName,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt
      }))
    });
  } catch (error) {
    console.error('檢查 WebAuthn 憑證錯誤:', error);
    return NextResponse.json({ hasCredentials: false });
  }
}
