import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { canUserAccessAnnouncement } from '@/lib/announcement-utils';
import { parseIntegerQueryParam } from '@/lib/query-params';

function parseAttachmentId(rawId: string): number | null {
  const parsed = parseIntegerQueryParam(rawId, { min: 1 });
  return parsed.isValid ? parsed.value : null;
}

// 下載附件
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id } = await params;
    const attachmentId = parseAttachmentId(id);
    if (attachmentId === null) {
      return NextResponse.json({ error: '無效的附件ID' }, { status: 400 });
    }

    const attachment = await prisma.announcementAttachment.findUnique({
      where: { id: attachmentId },
      include: {
        announcement: {
          select: {
            isPublished: true,
            expiryDate: true,
            isGlobalAnnouncement: true,
            targetDepartments: true
          }
        }
      }
    });

    if (!attachment) {
      return NextResponse.json({ error: '找不到附件' }, { status: 404 });
    }

    // 如果是一般員工，檢查公告是否可訪問
    if (decoded.role === 'EMPLOYEE') {
      const employee = await prisma.employee.findUnique({
        where: { id: decoded.employeeId },
        select: { department: true }
      });
      const canView = canUserAccessAnnouncement({
        isGlobalAnnouncement: attachment.announcement.isGlobalAnnouncement,
        targetDepartments: attachment.announcement.targetDepartments,
        employeeDepartment: employee?.department ?? null,
      });

      if (!attachment.announcement.isPublished || 
          (attachment.announcement.expiryDate && attachment.announcement.expiryDate < new Date()) ||
          !canView) {
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
    const decoded = await getUserFromRequest(request);
    if (!decoded) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    // 只有管理員和HR可以刪除附件
    if (decoded.role !== 'ADMIN' && decoded.role !== 'HR') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { id } = await params;
    const attachmentId = parseAttachmentId(id);
    if (attachmentId === null) {
      return NextResponse.json({ error: '無效的附件ID' }, { status: 400 });
    }

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
