import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import {
  canUserAccessAnnouncement,
  parseAnnouncementDate,
  validateAnnouncementTargetDepartments,
} from '@/lib/announcement-utils';
import { parseIntegerQueryParam } from '@/lib/query-params';

// Minimal types to avoid using any
type AttachmentLite = { id: number; fileName: string; originalName: string; fileSize: number; mimeType: string };
type PublisherLite = { id: number; employeeId: string; name: string; department: string | null; position: string | null };
type ApprovalInstanceLite = { id: number; currentLevel: number; maxLevel: number; status: string };
interface AnnouncementLite {
  id: number;
  title: string;
  content: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  category: 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL';
  publisherId: number;
  isPublished: boolean;
  publishedAt: string | null;
  expiryDate: string | null;
  targetDepartments?: string | null;
  isGlobalAnnouncement?: boolean;
  createdAt: string;
  updatedAt: string;
  publisher?: PublisherLite;
  attachments?: AttachmentLite[];
}
interface PrismaAnnouncementClient {
  announcement: {
    findUnique: (args: { where: { id: number }; include?: { publisher?: { select: Record<string, boolean> }; attachments?: { select: Record<string, boolean> } } }) => Promise<AnnouncementLite | null>;
    update: (args: { where: { id: number }; data: Partial<{ title: string; content: string; priority: 'HIGH' | 'NORMAL' | 'LOW'; category: 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL'; isPublished: boolean; publishedAt: Date | null; expiryDate: Date | null; scheduledPublishAt: Date | null; isGlobalAnnouncement: boolean; targetDepartments: string | null }> }) => Promise<AnnouncementLite>;
    delete: (args: { where: { id: number } }) => Promise<AnnouncementLite>;
  };
  announcementAttachment: {
    findMany: (args: { where: { announcementId: number } }) => Promise<AttachmentLite[]>;
  };
  approvalInstance: {
    findFirst: (args: { where: { requestType: string; requestId: number } }) => Promise<ApprovalInstanceLite | null>;
    update: (args: { where: { id: number }; data: { status: string; currentLevel: number } }) => Promise<ApprovalInstanceLite>;
    deleteMany: (args: { where: { requestType: string; requestId: number } }) => Promise<{ count: number }>;
  };
  approvalReview: {
    create: (args: { data: { instanceId: number; level: number; reviewerId: number; reviewerName: string; reviewerRole: string; action: string; comment?: string } }) => Promise<unknown>;
  };
  employee: {
    findUnique: (args: { where: { id: number }; select: { name?: boolean } }) => Promise<{ name?: string | null } | null>;
  };
  $transaction: <T>(callback: (tx: PrismaAnnouncementTransactionClient) => Promise<T>) => Promise<T>;
}

interface PrismaAnnouncementTransactionClient {
  announcement: PrismaAnnouncementClient['announcement'];
  approvalInstance: Pick<PrismaAnnouncementClient['approvalInstance'], 'update' | 'deleteMany'>;
  approvalReview: PrismaAnnouncementClient['approvalReview'];
}

const db = prisma as unknown as PrismaAnnouncementClient;

function parseAnnouncementId(rawId: string) {
  const parsed = parseIntegerQueryParam(rawId, { min: 1, max: 99999999 });
  if (!parsed.isValid || parsed.value === null) {
    return null;
  }

  return parsed.value;
}

// 獲取單個公告
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const id = parseAnnouncementId(idParam);
    if (id === null) {
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
      const employee = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { department: true }
      });
      const canView = canUserAccessAnnouncement({
        isGlobalAnnouncement: announcement.isGlobalAnnouncement,
        targetDepartments: announcement.targetDepartments,
        employeeDepartment: employee?.department ?? null,
      });

      if (!announcement.isPublished || !notExpired || !canView) {
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
    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseAnnouncementId(idParam);
    if (id === null) {
      return NextResponse.json({ error: '無效的公告ID' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '請求內容不是有效的 JSON' }, { status: 400 });
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const { 
      title, 
      content, 
      priority,
      category,
      isPublished, 
      expiryDate,
      isGlobalAnnouncement,
      targetDepartments
    } = body as Partial<AnnouncementLite> & { 
      expiryDate?: string | null;
      isGlobalAnnouncement?: boolean;
      targetDepartments?: string | null;
    };

    if (title !== undefined && !String(title).trim()) {
      return NextResponse.json({ error: '標題不能為空' }, { status: 400 });
    }

    if (content !== undefined && !String(content).trim()) {
      return NextResponse.json({ error: '內容不能為空' }, { status: 400 });
    }

    if (priority !== undefined && !['HIGH', 'NORMAL', 'LOW'].includes(priority)) {
      return NextResponse.json({ error: 'priority 格式無效' }, { status: 400 });
    }

    if (category !== undefined && !['PERSONNEL', 'POLICY', 'EVENT', 'SYSTEM', 'BENEFITS', 'URGENT', 'GENERAL'].includes(category)) {
      return NextResponse.json({ error: 'category 格式無效' }, { status: 400 });
    }

    // 驗證部門選擇
    if (isGlobalAnnouncement === false && !targetDepartments) {
      return NextResponse.json({ error: '請至少選擇一個部門，或選擇全部部門發送通告' }, { status: 400 });
    }

    const normalizedTargetDepartments = isGlobalAnnouncement === true
      ? null
      : targetDepartments !== undefined
        ? validateAnnouncementTargetDepartments(targetDepartments)
        : null;

    if (normalizedTargetDepartments && normalizedTargetDepartments.error) {
      return NextResponse.json({ error: normalizedTargetDepartments.error }, { status: 400 });
    }

    const expiryDateResult = expiryDate !== undefined
      ? parseAnnouncementDate(expiryDate, '到期日')
      : { value: null as Date | null };

    if (expiryDateResult.error) {
      return NextResponse.json({ error: expiryDateResult.error }, { status: 400 });
    }

    const existingAnnouncement = await db.announcement.findUnique({
      where: { id }
    });
    if (!existingAnnouncement) {
      return NextResponse.json({ error: '找不到公告' }, { status: 404 });
    }

    // 決定 publishedAt 變化
    let publishedAtUpdate: Date | null | undefined = undefined;
    if (typeof isPublished === 'boolean') {
      if (isPublished && !existingAnnouncement.isPublished) {
        publishedAtUpdate = new Date();
      } else if (!isPublished && existingAnnouncement.isPublished) {
        publishedAtUpdate = null;
      }
    }

    const updateData = {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(content !== undefined ? { content: String(content).trim() } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(isPublished !== undefined ? { isPublished } : {}),
      ...(publishedAtUpdate !== undefined ? { publishedAt: publishedAtUpdate } : {}),
      ...(expiryDate !== undefined ? { expiryDate: expiryDateResult.value } : {}),
      ...(typeof isPublished === 'boolean' && isPublished ? { scheduledPublishAt: null } : {}),
      ...(isGlobalAnnouncement !== undefined ? { isGlobalAnnouncement } : {}),
      ...(targetDepartments !== undefined || isGlobalAnnouncement === true
        ? { targetDepartments: isGlobalAnnouncement ? null : normalizedTargetDepartments?.normalized ?? targetDepartments ?? null }
        : {})
    };

    const shouldApprovePendingFlow = isPublished === true && !existingAnnouncement.isPublished;
    const approvalInstance = shouldApprovePendingFlow
      ? await db.approvalInstance.findFirst({
          where: {
            requestType: 'ANNOUNCEMENT',
            requestId: id,
          },
        })
      : null;

    const reviewerProfile = shouldApprovePendingFlow
      ? await db.employee.findUnique({
          where: { id: user.employeeId },
          select: { name: true },
        })
      : null;

    const reviewerName = reviewerProfile?.name?.trim() || user.username;

    const updated = shouldApprovePendingFlow && approvalInstance && approvalInstance.status !== 'APPROVED'
      ? await db.$transaction(async (tx) => {
          const announcement = await tx.announcement.update({
            where: { id },
            data: updateData,
          });

          await tx.approvalReview.create({
            data: {
              instanceId: approvalInstance.id,
              level: approvalInstance.currentLevel,
              reviewerId: user.employeeId,
              reviewerName,
              reviewerRole: user.role,
              action: 'APPROVE',
              comment: '由公告管理頁面直接發布',
            },
          });

          await tx.approvalInstance.update({
            where: { id: approvalInstance.id },
            data: {
              status: 'APPROVED',
              currentLevel: approvalInstance.maxLevel,
            },
          });

          return announcement;
        })
      : await db.announcement.update({
          where: { id },
          data: updateData,
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
    const user = await getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: csrfValidation.error }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseAnnouncementId(idParam);
    if (id === null) {
      return NextResponse.json({ error: '無效的公告ID' }, { status: 400 });
    }

    const existingAnnouncement = await db.announcement.findUnique({
      where: { id }
    });
    if (!existingAnnouncement) {
      return NextResponse.json({ error: '找不到公告' }, { status: 404 });
    }

    // 先查附件以便刪除檔案
    const attachments = await (prisma as unknown as { announcementAttachment: { findMany: (args: { where: { announcementId: number } }) => Promise<AttachmentLite[]> } }).announcementAttachment.findMany({
      where: { announcementId: id }
    });

    await db.$transaction(async (tx) => {
      await tx.approvalInstance.deleteMany({
        where: {
          requestType: 'ANNOUNCEMENT',
          requestId: id,
        },
      });
      await tx.announcement.delete({ where: { id } });
    });

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
