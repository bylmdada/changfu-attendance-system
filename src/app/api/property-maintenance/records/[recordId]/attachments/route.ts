import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { guard, ok, fail } from '@/lib/property-api';
import { canAccessSite, canMaintainSite } from '@/lib/property-access';
import { resolvePropertyAttachmentPath } from '@/lib/property-attachment-paths';
import {
  detectPropertyAssessmentMimeType,
  getPropertyAssessmentFileExtension,
  optimizePropertyAssessmentFile,
  PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES,
  PROPERTY_ASSESSMENT_MAX_FILE_SIZE,
  PROPERTY_ASSESSMENT_MAX_FILES,
} from '@/lib/property-maintenance-attachments';

async function loadRecord(recordId: string) {
  return prisma.maintenanceRecord.findUnique({
    where: { recordId },
    include: {
      site: { select: { code: true } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  });
}

function parseAttachmentId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeSiteCode(value: string): string | null {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '');
  return sanitized || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request);
  if ('res' in g) return g.res;

  const { recordId } = await params;
  const rid = decodeURIComponent(recordId);
  const rec = await loadRecord(rid);
  if (!rec) return fail('找不到紀錄', 404);
  if (!canAccessSite(g.ctx.access, rec.siteId)) return fail('無權限', 403);

  const attachmentId = parseAttachmentId(request.nextUrl.searchParams.get('id'));
  if (!attachmentId) {
    return ok(rec.attachments);
  }

  const attachment = rec.attachments.find((item) => item.id === attachmentId);
  if (!attachment) return fail('找不到附件', 404);
  if (!PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES.has(attachment.mimeType)) {
    return fail('附件格式不支援', 415);
  }
  const fullPath = resolvePropertyAttachmentPath(attachment.filePath);
  if (!fullPath) return fail('附件路徑無效', 404);

  try {
    const buf = await readFile(fullPath);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      },
    });
  } catch {
    return fail('檔案不存在', 404);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;

  const { recordId } = await params;
  const rid = decodeURIComponent(recordId);
  const rec = await loadRecord(rid);
  if (!rec) return fail('找不到紀錄', 404);
  if (!canMaintainSite(g.ctx.access, rec.siteId)) return fail('僅維護人員可上傳評量附件', 403);
  if (rec.status !== 'PENDING') return fail('此紀錄已提交或完成，無法修改附件', 409);
  if (rec.attachments.length >= PROPERTY_ASSESSMENT_MAX_FILES) {
    return fail(`評量附件最多 ${PROPERTY_ASSESSMENT_MAX_FILES} 個`);
  }

  const form = await request.formData();
  const file = form.get('file') as File | null;
  if (!file) return fail('請選擇檔案');
  if (file.size > PROPERTY_ASSESSMENT_MAX_FILE_SIZE) return fail('檔案過大（上限 10MB）');
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const detectedMimeType = detectPropertyAssessmentMimeType(inputBuffer);
  if (!detectedMimeType || !PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES.has(detectedMimeType)) {
    return fail('僅支援 PDF、Word、PNG、JPG、JPEG');
  }

  const ext = getPropertyAssessmentFileExtension(detectedMimeType);
  if (!ext) return fail('檔案格式不支援');

  const siteCode = sanitizeSiteCode(rec.site.code);
  if (!siteCode) return fail('據點代碼格式錯誤', 500);

  const outputBuffer = await optimizePropertyAssessmentFile(inputBuffer, detectedMimeType);
  const safeRid = rid.replace(/[^A-Za-z0-9_-]/g, '_');
  const storedName = `${safeRid}.assessment.${Date.now()}.${randomUUID()}.${ext}`;
  const dir = join(process.cwd(), 'uploads', 'property-maintenance', siteCode, 'assessments');
  await mkdir(dir, { recursive: true });

  const fullPath = join(dir, storedName);
  const relPath = `uploads/property-maintenance/${siteCode}/assessments/${storedName}`;
  await writeFile(fullPath, outputBuffer);

  let attachment;
  try {
    attachment = await prisma.$transaction(async (tx) => {
      const pendingRecord = await tx.maintenanceRecord.findFirst({
        where: { id: rec.id, status: 'PENDING' },
        select: { id: true },
      });
      if (!pendingRecord) throw new Error('RECORD_NOT_PENDING');

      const attachmentCount = await tx.maintenanceRecordAttachment.count({
        where: { maintenanceRecordId: rec.id },
      });
      if (attachmentCount >= PROPERTY_ASSESSMENT_MAX_FILES) throw new Error('TOO_MANY_FILES');

      return tx.maintenanceRecordAttachment.create({
        data: {
          maintenanceRecordId: rec.id,
          originalName: file.name || storedName,
          storedName,
          filePath: relPath,
          fileSize: outputBuffer.length,
          mimeType: detectedMimeType,
          uploadedByUserId: g.ctx.user.userId,
        },
      });
    });
  } catch (error) {
    await unlink(fullPath).catch((unlinkError) => {
      console.warn('回復財產維護附件檔案失敗:', unlinkError);
    });
    if (error instanceof Error && error.message === 'RECORD_NOT_PENDING') {
      return fail('此紀錄已提交或完成，無法修改附件', 409);
    }
    if (error instanceof Error && error.message === 'TOO_MANY_FILES') {
      return fail(`評量附件最多 ${PROPERTY_ASSESSMENT_MAX_FILES} 個`);
    }
    throw error;
  }

  return ok(attachment, '已上傳');
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const g = await guard(request, { csrf: true });
  if ('res' in g) return g.res;

  const { recordId } = await params;
  const rid = decodeURIComponent(recordId);
  const rec = await loadRecord(rid);
  if (!rec) return fail('找不到紀錄', 404);
  if (!canMaintainSite(g.ctx.access, rec.siteId)) return fail('僅維護人員可刪除評量附件', 403);
  if (rec.status !== 'PENDING') return fail('此紀錄已提交或完成，無法修改附件', 409);

  const attachmentId = parseAttachmentId(request.nextUrl.searchParams.get('id'));
  if (!attachmentId) return fail('附件 ID 錯誤');
  const attachment = rec.attachments.find((item) => item.id === attachmentId);
  if (!attachment) return fail('找不到附件', 404);

  await prisma.maintenanceRecordAttachment.delete({ where: { id: attachment.id } });
  const fullPath = resolvePropertyAttachmentPath(attachment.filePath);
  if (fullPath) {
    await unlink(fullPath).catch((error) => {
      console.warn('刪除財產維護附件檔案失敗:', error);
    });
  }

  return ok(null, '已刪除');
}
