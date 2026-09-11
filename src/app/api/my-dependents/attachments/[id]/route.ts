import { NextRequest, NextResponse } from 'next/server';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { parseIntegerQueryParam } from '@/lib/query-params';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: '未授權' }, { status: 401 });
    const parsed = parseIntegerQueryParam((await params).id, { min: 1 });
    if (!parsed.isValid || parsed.value === null) return NextResponse.json({ error: '附件 ID 格式無效' }, { status: 400 });
    const attachment = await prisma.dependentApplicationAttachment.findUnique({
      where: { id: parsed.value }, include: { application: { select: { employeeId: true } } },
    });
    if (!attachment || (attachment.application.employeeId !== user.employeeId && !['ADMIN', 'HR'].includes(user.role))) {
      return NextResponse.json({ error: '找不到附件或無權限' }, { status: 404 });
    }
    const match = /^\/?uploads\/dependent-attachments\/([^/\\]+)$/.exec(attachment.filePath);
    if (!match || match[1] === '.' || match[1] === '..') return NextResponse.json({ error: '檔案路徑無效' }, { status: 404 });
    const root = await realpath(path.join(process.cwd(), 'uploads', 'dependent-attachments'));
    const filePath = await realpath(path.join(root, match[1]));
    if (path.dirname(filePath) !== root) return NextResponse.json({ error: '檔案路徑無效' }, { status: 404 });
    return new NextResponse(await readFile(filePath), { headers: {
      'Content-Type': attachment.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return NextResponse.json({ error: '檔案不存在' }, { status: 404 });
    console.error('下載眷屬附件失敗:', error);
    return NextResponse.json({ error: '下載失敗' }, { status: 500 });
  }
}
