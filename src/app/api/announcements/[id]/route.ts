import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';

// Minimal types to avoid using any
type AttachmentLite = { id: number; fileName: string; originalName: string; fileSize: number; mimeType: string };
type PublisherLite = { id: number; employeeId: string; name: string; department: string | null; position: string | null };
interface AnnouncementLite {
  id: number;
  title: string;
  content: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  publisherId: number;
  isPublished: boolean;
  publishedAt: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
  publisher?: PublisherLite;
  attachments?: AttachmentLite[];
}
interface PrismaAnnouncementClient {
  announcement: {
    findUnique: (args: { where: { id: number }; include?: { publisher?: { select: Record<string, boolean> }; attachments?: { select: Record<string, boolean> } } }) => Promise<AnnouncementLite | null>;
    update: (args: { where: { id: number }; data: Partial<{ title: string; content: string; priority: 'HIGH' | 'NORMAL' | 'LOW'; isPublished: boolean; publishedAt: Date | null; expiryDate: Date | null }> }) => Promise<AnnouncementLite>;
    delete: (args: { where: { id: number } }) => Promise<AnnouncementLite>;
  };
  announcementAttachment: {
    findMany: (args: { where: { announcementId: number } }) => Promise<AttachmentLite[]>;
  };
}

const db = prisma as unknown as PrismaAnnouncementClient;

// 獲取單個公告
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: '無效的公告ID' }, { status: 400 });
    }

    const announcement = await db.announcement.findUnique({
      where: { id },
      include: {
        publisher: { select: { id: true, employeeId: true, name: true, department: true, position: true } },
        attachments: { select: { id: true, fileName: true, originalName: true, fileSize: true, mimeType: true } }
      }
    });

    if (!announcement) {
      return NextResponse.json({ error: '找不到公告' }, { status: 404 });
    }

    // 員工只能查看已發布且未過期
    if (user.role === 'EMPLOYEE') {
      const notExpired = !announcement.expiryDate || new Date(announcement.expiryDate) > new Date();
      if (!announcement.isPublished || !notExpired) {
        return NextResponse.json({ error: '無權限查看此公告' }, { status: 403 });
      }
    }

    return NextResponse.json({ success: true, announcement });
  } catch (error) {
    console.error('獲取公告失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 更新公告
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: '無效的公告ID' }, { status: 400 });
    }

    const body = await request.json();
    const { 
      title, 
      content, 
      priority, 
      isPublished, 
      expiryDate,
      isGlobalAnnouncement,
      targetDepartments
    } = body as Partial<AnnouncementLite> & { 
      expiryDate?: string | null;
      isGlobalAnnouncement?: boolean;
      targetDepartments?: string | null;
    };

    // 驗證部門選擇
    if (isGlobalAnnouncement === false && !targetDepartments) {
      return NextResponse.json({ error: '請至少選擇一個部門，或選擇全部部門發送通告' }, { status: 400 });
    }

    // 決定 publishedAt 變化
    let publishedAtUpdate: Date | null | undefined = undefined;
    if (typeof isPublished === 'boolean') {
      if (isPublished) {
        publishedAtUpdate = new Date();
      } else {
        publishedAtUpdate = null;
      }
    }

    const updated = await db.announcement.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(isPublished !== undefined ? { isPublished } : {}),
        ...(publishedAtUpdate !== undefined ? { publishedAt: publishedAtUpdate } : {}),
        ...(expiryDate !== undefined ? { expiryDate: expiryDate ? new Date(expiryDate) : null } : {}),
        ...(isGlobalAnnouncement !== undefined ? { isGlobalAnnouncement } : {}),
        ...(targetDepartments !== undefined ? { targetDepartments: isGlobalAnnouncement ? null : targetDepartments } : {})
      }
    });

    return NextResponse.json({ success: true, message: '公告更新成功', announcement: updated });
  } catch (error) {
    console.error('更新公告失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除公告
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam);
    if (isNaN(id)) {
      return NextResponse.json({ error: '無效的公告ID' }, { status: 400 });
    }

    // 先查附件以便刪除檔案
    const attachments = await (prisma as unknown as { announcementAttachment: { findMany: (args: { where: { announcementId: number } }) => Promise<AttachmentLite[]> } }).announcementAttachment.findMany({
      where: { announcementId: id }
    });

    await db.announcement.delete({ where: { id } });

    // 嘗試刪除檔案（忽略錯誤）
    for (const att of attachments) {
      const filePath = join(process.cwd(), 'uploads', 'announcements', att.fileName);
      try {
        if (existsSync(filePath)) {
          await unlink(filePath);
        }
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ success: true, message: '公告刪除成功' });
  } catch (error) {
    console.error('刪除公告失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
