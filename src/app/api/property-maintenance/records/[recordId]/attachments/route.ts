import { mkdir, readFile, rm, unlink, writeFile } from 'fs/promises';
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
  PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE,
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

function parsePositiveInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInteger(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeUploadId(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : null;
}

function getFormString(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readUploadedFileBuffer(file: File): Promise<Buffer | null> {
  try {
    return Buffer.from(await file.arrayBuffer());
  } catch (error) {
    console.error('讀取財產評量附件內容失敗:', error);
    return null;
  }
}

async function createAssessmentAttachment(
  rec: NonNullable<Awaited<ReturnType<typeof loadRecord>>>,
  userId: number,
  rid: string,
  inputBuffer: Buffer,
  originalName: string
) {
  const detectedMimeType = detectPropertyAssessmentMimeType(inputBuffer);
  if (!detectedMimeType || !PROPERTY_ASSESSMENT_ALLOWED_MIME_TYPES.has(detectedMimeType)) {
    return fail('僅支援 PDF、Word、PNG、JPG、JPEG');
  }

  const ext = getPropertyAssessmentFileExtension(detectedMimeType);
  if (!ext) return fail('檔案格式不支援');

  const siteCode = sanitizeSiteCode(rec.site.code);
  if (!siteCode) return fail('據點代碼格式錯誤', 500);

  let outputBuffer: Buffer;
  try {
    outputBuffer = await optimizePropertyAssessmentFile(inputBuffer, detectedMimeType);
  } catch (error) {
    console.error('最佳化財產評量附件失敗:', error);
    return fail('附件處理失敗，請改用 JPG/JPEG 或重新上傳', 500);
  }

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
          originalName: originalName || storedName,
          storedName,
          filePath: relPath,
          fileSize: outputBuffer.length,
          mimeType: detectedMimeType,
          uploadedByUserId: userId,
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
    console.error('儲存財產評量附件失敗:', error);
    return fail('附件儲存失敗，請稍後再試', 500);
  }

  return ok(attachment, '已上傳');
}

async function handleChunkedAssessmentUpload(
  form: FormData,
  file: File,
  rec: NonNullable<Awaited<ReturnType<typeof loadRecord>>>,
  userId: number,
  rid: string
) {
  const uploadId = sanitizeUploadId(form.get('uploadId'));
  const chunkIndex = parseNonNegativeInteger(form.get('chunkIndex'));
  const chunkTotal = parsePositiveInteger(form.get('chunkTotal'));
  const declaredFileSize = parsePositiveInteger(form.get('fileSize'));
  const originalName = getFormString(form.get('fileName')) || file.name;

  if (!uploadId || chunkIndex === null || !chunkTotal || !declaredFileSize) {
    return fail('分段上傳參數不完整');
  }
  if (chunkTotal > Math.ceil(PROPERTY_ASSESSMENT_MAX_FILE_SIZE / PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE) + 1) {
    return fail('分段數量超過限制');
  }
  if (chunkIndex >= chunkTotal) {
    return fail('分段序號超過限制');
  }
  if (declaredFileSize > PROPERTY_ASSESSMENT_MAX_FILE_SIZE) {
    return fail('檔案過大（上限 10MB）');
  }
  if (file.size <= 0 || file.size > PROPERTY_ASSESSMENT_UPLOAD_CHUNK_SIZE + 64 * 1024) {
    return fail('分段檔案大小不正確');
  }

  const siteCode = sanitizeSiteCode(rec.site.code);
  if (!siteCode) return fail('據點代碼格式錯誤', 500);

  const safeRid = rid.replace(/[^A-Za-z0-9_-]/g, '_');
  const chunkDir = join(
    process.cwd(),
    'uploads',
    'property-maintenance',
    siteCode,
    'assessments',
    '.chunks',
    `${safeRid}.${uploadId}`
  );

  if (chunkIndex === 0) {
    await rm(chunkDir, { recursive: true, force: true });
  }
  await mkdir(chunkDir, { recursive: true });

  const chunkBuffer = await readUploadedFileBuffer(file);
  if (!chunkBuffer) {
    return fail('附件內容讀取失敗，請重新上傳', 400);
  }
  await writeFile(join(chunkDir, `${chunkIndex}.part`), chunkBuffer);

  if (chunkIndex < chunkTotal - 1) {
    return ok({ pending: true, uploadedChunk: chunkIndex + 1, totalChunks: chunkTotal }, '分段已上傳');
  }

  let chunks: Buffer[];
  try {
    chunks = await Promise.all(
      Array.from({ length: chunkTotal }, (_, index) => readFile(join(chunkDir, `${index}.part`)))
    );
  } catch (error) {
    console.error('讀取財產評量附件分段失敗:', error);
    return fail('附件分段尚未完整，請重新上傳', 409);
  }

  const inputBuffer = Buffer.concat(chunks);
  if (inputBuffer.length !== declaredFileSize || inputBuffer.length > PROPERTY_ASSESSMENT_MAX_FILE_SIZE) {
    await rm(chunkDir, { recursive: true, force: true });
    return fail('附件分段大小不一致，請重新上傳');
  }

  await rm(chunkDir, { recursive: true, force: true });
  return createAssessmentAttachment(rec, userId, rid, inputBuffer, originalName);
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.error('解析財產評量附件上傳內容失敗:', error);
    return fail('附件上傳內容無法解析，請重新選擇檔案後再試', 400);
  }

  const file = form.get('file') as File | null;
  if (!file) return fail('請選擇檔案');

  if (form.has('uploadId')) {
    return handleChunkedAssessmentUpload(form, file, rec, g.ctx.user.userId, rid);
  }

  if (file.size > PROPERTY_ASSESSMENT_MAX_FILE_SIZE) return fail('檔案過大（上限 10MB）');
  const inputBuffer = await readUploadedFileBuffer(file);
  if (!inputBuffer) {
    return fail('附件內容讀取失敗，請重新上傳', 400);
  }

  return createAssessmentAttachment(rec, g.ctx.user.userId, rid, inputBuffer, file.name);
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
