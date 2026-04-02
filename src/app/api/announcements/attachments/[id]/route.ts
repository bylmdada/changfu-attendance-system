import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// 下載附件
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    const { id } = await params;
    const attachmentId = parseInt(id);

    const attachment = await prisma.announcementAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        announcement: {
          select: {
            isPublished: true,
            expiryDate: true
          }
        }
      }
    });

    if (!attachment) {
      return NextResponse.json({ error: '找不到附件' }, { status: 404 });
    }

    // 如果是一般員工，檢查公告是否可訪問
    if (decoded.role === 'EMPLOYEE') {
      if (!attachment.announcement.isPublished || 
          (attachment.announcement.expiryDate && attachment.announcement.expiryDate < new Date())) {
        return NextResponse.json({ error: '無權限下載此附件' }, { status: 403 });
      }
    }

    const filePath = join(process.cwd(), 'uploads', 'announcements', attachment.fileName);
    
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: '檔案不存在' }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
        'Content-Length': attachment.fileSize.toString()
      }
    });
  } catch (error) {
    console.error('下載附件失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除附件
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded) {
      return NextResponse.json({ error: '無效的認證令牌' }, { status: 401 });
    }

    // 只有管理員和HR可以刪除附件
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { id } = await params;
    const attachmentId = parseInt(id);

    const attachment = await prisma.announcementAttachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      return NextResponse.json({ error: '找不到附件' }, { status: 404 });
    }

    // 刪除檔案
    const filePath = join(process.cwd(), 'uploads', 'announcements', attachment.fileName);
    try {
      if (existsSync(filePath)) {
        const { unlink } = await import('fs/promises');
        await unlink(filePath);
      }
    } catch (error) {
      console.warn('刪除附件檔案失敗:', attachment.fileName, error);
    }

    // 刪除資料庫記錄
    await prisma.announcementAttachment.delete({
      where: { id: attachmentId }
    });

    return NextResponse.json({
      success: true,
      message: '附件刪除成功'
    });
  } catch (error) {
    console.error('刪除附件失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
