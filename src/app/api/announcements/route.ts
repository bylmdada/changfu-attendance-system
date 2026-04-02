import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { sendNotification } from '@/lib/realtime-notifications';
import { createApprovalForRequest } from '@/lib/approval-helper';

// Minimal interfaces to avoid explicit any while Prisma client types are pending
interface AttachmentLite { id: number; fileName: string; originalName: string; fileSize: number; mimeType: string }
interface PublisherLite { id: number; employeeId: string; name: string; department: string | null; position: string | null }
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
  scheduledPublishAt: string | null;
  createdAt: string;
  updatedAt: string;
  publisher?: PublisherLite;
  attachments?: AttachmentLite[];
}
interface PrismaAnnouncementClient {
  announcement: {
    findMany: (args: {
      where?: Record<string, unknown>;
      orderBy?: { updatedAt: 'asc' | 'desc' };
      include?: {
        publisher?: { select: Record<string, boolean> };
        attachments?: { select: Record<string, boolean> };
      };
    }) => Promise<AnnouncementLite[]>;
    // Allow both scalar FK and nested connect for compatibility
    create: (args: { data: (
      { title: string; content: string; priority: 'HIGH' | 'NORMAL' | 'LOW'; isPublished: boolean; publishedAt: Date | null; expiryDate: Date | null }
      & (
        { publisherId: number } |
        { publisher: { connect: { id: number } } }
      )
    ) }) => Promise<AnnouncementLite>;
  };
  announcementAttachment: {
    create: (args: { data: { announcementId: number; fileName: string; originalName: string; filePath: string; fileSize: number; mimeType: string } }) => Promise<AttachmentLite>;
  };
}

const db = prisma as unknown as PrismaAnnouncementClient;

// GET: 取得公告列表（依角色與查詢條件過濾）
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const priority = searchParams.get('priority'); // HIGH | NORMAL | LOW | null
    const category = searchParams.get('category'); // PERSONNEL | POLICY | EVENT | SYSTEM | BENEFITS | URGENT | GENERAL | null
    const published = searchParams.get('published'); // 'true' | 'false' | null

    // 基本 where 條件
    const where: Record<string, unknown> = {};

    if (priority && ['HIGH', 'NORMAL', 'LOW'].includes(priority)) {
      where.priority = priority;
    }

    if (category && ['PERSONNEL', 'POLICY', 'EVENT', 'SYSTEM', 'BENEFITS', 'URGENT', 'GENERAL'].includes(category)) {
      where.category = category;
    }

    // 員工只能看到已發布且未過期的公告
    if (user.role === 'EMPLOYEE') {
      where.isPublished = true;
      where.OR = [
        { expiryDate: null },
        { expiryDate: { gt: new Date() } }
      ];
    } else if (published !== null) {
      // 管理端可依發布狀態過濾
      where.isPublished = published === 'true';
    }

    const announcements = await db.announcement.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        publisher: {
          select: { id: true, employeeId: true, name: true, department: true, position: true }
        },
        attachments: {
          select: { id: true, fileName: true, originalName: true, fileSize: true, mimeType: true }
        }
      }
    });

    return NextResponse.json({
      success: true,
      announcements,
      total: announcements.length
    });
  } catch (error) {
    console.error('取得公告失敗:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// POST: 新增公告（支援 multipart/form-data 與附件）
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    
    // 判斷是否可直接發布（ADMIN/HR 可直接發布，其他人需審核）
    const canDirectPublish = user.role === 'ADMIN' || user.role === 'HR';

    // 解析表單（前端以 FormData 傳送）
    const form = await request.formData();
    const title = String(form.get('title') || '').trim();
    const content = String(form.get('content') || '').trim();
    const priorityRaw = String(form.get('priority') || 'NORMAL').toUpperCase();
    const categoryRaw = String(form.get('category') || 'GENERAL').toUpperCase();
    const isPublished = String(form.get('isPublished') || 'false') === 'true';
    const expiryDateStr = form.get('expiryDate') ? String(form.get('expiryDate')) : '';
    
    // 新增：部門相關字段解析
    const isGlobalAnnouncement = String(form.get('isGlobalAnnouncement') || 'true') === 'true';
    const targetDepartmentsStr = form.get('targetDepartments') ? String(form.get('targetDepartments')) : null;
    
    // 新增：定時發布
    const scheduledPublishAtStr = form.get('scheduledPublishAt') ? String(form.get('scheduledPublishAt')) : null;

    if (!title || !content) {
      return NextResponse.json({ success: false, error: '標題和內容為必填項目' }, { status: 400 });
    }

    // 驗證部門選擇
    if (!isGlobalAnnouncement && !targetDepartmentsStr) {
      return NextResponse.json({ success: false, error: '請至少選擇一個部門，或選擇全部部門發送通告' }, { status: 400 });
    }

    const priority = ['HIGH', 'NORMAL', 'LOW'].includes(priorityRaw) ? priorityRaw as 'HIGH' | 'NORMAL' | 'LOW' : 'NORMAL';
    const category = ['PERSONNEL', 'POLICY', 'EVENT', 'SYSTEM', 'BENEFITS', 'URGENT', 'GENERAL'].includes(categoryRaw) 
      ? categoryRaw as 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL' 
      : 'GENERAL';

    const now = new Date();
    const expiryDate = expiryDateStr ? new Date(expiryDateStr) : null;
    const scheduledPublishAt = scheduledPublishAtStr ? new Date(scheduledPublishAtStr) : null;

    // If Prisma client isn't generated with Announcement yet, short-circuit in demo mode
    const anyPrisma = prisma as unknown as { announcement?: { create?: (args: unknown) => Promise<unknown> } };
    if (!anyPrisma.announcement || typeof anyPrisma.announcement.create !== 'function') {
      return NextResponse.json({ success: true, message: '公告創建成功（目前為展示模式）' }, { status: 201 });
    }

    // 動態偵測是否可用 relation 巢狀 connect
    const announcementModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Announcement');
    const fieldSet = new Set((announcementModel?.fields ?? []).map(f => f.name));

    // 非 ADMIN/HR 用戶的公告強制設為未發布（需審核）
    const finalIsPublished = canDirectPublish ? (scheduledPublishAt ? false : isPublished) : false;
    
    const baseData = {
      title,
      content,
      priority,
      category,
      isPublished: finalIsPublished,
      publishedAt: finalIsPublished ? now : null,
      expiryDate,
      scheduledPublishAt: canDirectPublish ? scheduledPublishAt : null, // 員工不支持定時發布
      // 新增：部門相關字段
      isGlobalAnnouncement,
      targetDepartments: isGlobalAnnouncement ? null : targetDepartmentsStr,
      // 新增：審核狀態
      status: canDirectPublish ? 'APPROVED' : 'PENDING_APPROVAL'
    } as const;

    let createData:
      ({ publisherId: number } | { publisher: { connect: { id: number } } })
      & typeof baseData;

    if (fieldSet.has('publisher')) {
      // Preferred: nested connect
      createData = { ...baseData, publisher: { connect: { id: user.employeeId } } };
    } else if (fieldSet.has('publisherId')) {
      // Fallback: scalar FK if relation field not exposed
      createData = { ...baseData, publisherId: user.employeeId };
    } else {
      // Extreme fallback: demo mode to avoid runtime errors
      return NextResponse.json({ success: true, message: '公告創建成功（目前為展示模式）' }, { status: 201 });
    }

    // 建立公告（型別支援兩種寫法）
    const created = await db.announcement.create({
      data: createData,
    });

    // 如果不是立即發布或需要審核（非 ADMIN/HR），建立審核實例
    if (!canDirectPublish || (!finalIsPublished && canDirectPublish)) {
      // 取得發布者資訊
      const publisher = await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { id: true, name: true, department: true }
      });
      
      await createApprovalForRequest({
        requestType: 'ANNOUNCEMENT',
        requestId: created.id,
        applicantId: user.employeeId,
        applicantName: publisher?.name || user.username,
        department: publisher?.department || null
      });
    }

    // 如果是緊急通知或高優先級且直接發布（ADMIN/HR），發送即時通知
    if (finalIsPublished && canDirectPublish && (category === 'URGENT' || priority === 'HIGH')) {
      try {
        await sendNotification({
          type: 'ANNOUNCEMENT',
          priority: category === 'URGENT' ? 'URGENT' : 'HIGH',
          channels: ['WEB', 'IN_APP'],
          title: category === 'URGENT' ? '🚨 緊急通知' : '📢 重要公告',
          message: title,
          data: { 
            announcementId: created.id,
            category,
            priority
          },
          createdBy: user.username
        });
        console.log(`📢 已發送公告通知: ${title}`);
      } catch (notifError) {
        console.error('發送公告通知失敗:', notifError);
        // 不影響公告創建成功的回應
      }
    }

    // 儲存附件（若有）
    const uploadDir = join(process.cwd(), 'uploads', 'announcements');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const attachments = form.getAll('attachments');
    const createdAttachments: AttachmentLite[] = [];

    // 驗證附件大小和類型
    const uploadFiles: File[] = [];
    for (const item of attachments) {
      if (typeof item === 'string') continue;
      const file = item as File;
      if (file && file.name) {
        uploadFiles.push(file);
      }
    }

    if (uploadFiles.length > 0) {
      const { validateFiles, FILE_SIZE_LIMITS, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } = await import('@/lib/upload-validation');
      const validation = validateFiles(uploadFiles, {
        maxSize: FILE_SIZE_LIMITS.ATTACHMENT,
        maxTotalSize: FILE_SIZE_LIMITS.TOTAL_UPLOAD,
        allowedMimeTypes: ALLOWED_MIME_TYPES.ALL,
        allowedExtensions: ALLOWED_EXTENSIONS.ALL
      });
      
      if (!validation.valid) {
        return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
      }
    }


    for (const item of attachments) {
      if (typeof item === 'string') continue; // 跳過非檔案
      const file = item as File;
      if (!file || !file.name) continue;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 以時間戳+隨機字串避免重名
      const safeOriginal = file.name.replace(/[^\w.\-]+/g, '_');
      const uniqueName = `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeOriginal}`;
      const filePath = join(uploadDir, uniqueName);

      await writeFile(filePath, buffer);

      const createdAttachment = await (prisma as unknown as { announcementAttachment: { create: (args: { data: { announcementId: number; fileName: string; originalName: string; filePath: string; fileSize: number; mimeType: string } }) => Promise<AttachmentLite> } }).announcementAttachment.create({
        data: {
          announcementId: created.id,
          fileName: uniqueName,
          originalName: file.name,
          filePath: `uploads/announcements/${uniqueName}`,
          fileSize: buffer.length,
          mimeType: file.type || 'application/octet-stream'
        }
      });
      createdAttachments.push({
        id: createdAttachment.id,
        fileName: createdAttachment.fileName,
        originalName: createdAttachment.originalName,
        fileSize: createdAttachment.fileSize,
        mimeType: createdAttachment.mimeType
      });
    }

    return NextResponse.json({
      success: true,
      message: canDirectPublish 
        ? (finalIsPublished ? '公告已發布' : '公告已儲存，將於指定時間發布')
        : '公告已提交，待審核通過後發布',
      needsApproval: !canDirectPublish,
      announcement: {
        ...created,
        attachments: createdAttachments
      }
    }, { status: 201 });
  } catch (error) {
    console.error('新增公告失敗:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}