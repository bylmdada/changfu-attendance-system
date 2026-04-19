import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';

// 允許的檔案類型
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx'];

// 附件類型
const FILE_TYPES = {
  ID_FRONT: '身分證正面',
  ID_BACK: '身分證反面',
  HOUSEHOLD_REGISTER: '戶籍謄本',
  HOUSEHOLD_BOOK: '戶口名簿',
  OTHER: '其他證明'
};

function parseAttachmentId(value: unknown) {
  if (typeof value !== 'string') {
    return { isValid: false, value: null };
  }

  return parseIntegerQueryParam(value, { min: 1, max: 99999999 });
}

// 上傳附件
export async function POST(request: NextRequest) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const formData = await request.formData();
    const applicationId = formData.get('applicationId');
    const fileType = formData.get('fileType') as string;
    const file = formData.get('file') as File;

    if (!applicationId || !fileType || !file) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const applicationIdResult = parseAttachmentId(applicationId);
    if (!applicationIdResult.isValid || applicationIdResult.value === null) {
      return NextResponse.json({ error: '申請 ID 格式無效' }, { status: 400 });
    }

    const parsedApplicationId = applicationIdResult.value;

    // 驗證檔案類型
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ 
        error: '不支援的檔案格式，僅支援 JPG、PNG、PDF、Word 檔' 
      }, { status: 400 });
    }

    // 驗證副檔名
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ 
        error: '不支援的檔案格式' 
      }, { status: 400 });
    }

    // 驗證附件類型
    if (!Object.keys(FILE_TYPES).includes(fileType)) {
      return NextResponse.json({ error: '無效的附件類型' }, { status: 400 });
    }

    // 驗證檔案大小（使用共用驗證工具）
    const { validateFile, FILE_SIZE_LIMITS } = await import('@/lib/upload-validation');
    const validation = validateFile(file, { maxSize: FILE_SIZE_LIMITS.ATTACHMENT });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // 驗證申請是否存在且屬於當前用戶
    const application = await prisma.dependentApplication.findFirst({
      where: {
        id: parsedApplicationId,
        employeeId: user.employeeId || 0,
        status: 'PENDING'
      }
    });

    if (!application) {
      return NextResponse.json({ error: '申請不存在、無權限，或已無法修改附件' }, { status: 404 });
    }

    // 確保目錄存在
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'dependent-attachments');
    await mkdir(uploadDir, { recursive: true });

    // 生成唯一檔名
    const timestamp = Date.now();
    const uniqueFileName = `${parsedApplicationId}_${fileType}_${timestamp}${ext}`;
    const filePath = path.join(uploadDir, uniqueFileName);

    // 儲存檔案
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // 儲存到資料庫
    const attachment = await prisma.dependentApplicationAttachment.create({
        data: {
          applicationId: parsedApplicationId,
          fileType,
        fileName: file.name,
        filePath: `/uploads/dependent-attachments/${uniqueFileName}`,
        fileSize: file.size,
        mimeType: file.type
      }
    });

    return NextResponse.json({
      success: true,
      attachment: {
        id: attachment.id,
        fileType: attachment.fileType,
        fileTypeName: FILE_TYPES[fileType as keyof typeof FILE_TYPES],
        fileName: attachment.fileName,
        filePath: attachment.filePath,
        fileSize: attachment.fileSize
      }
    });
  } catch (error) {
    console.error('上傳附件失敗:', error);
    return NextResponse.json({ error: '上傳失敗' }, { status: 500 });
  }
}

// 取得申請的附件列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const applicationId = searchParams.get('applicationId');

    if (!applicationId) {
      return NextResponse.json({ error: '缺少申請 ID' }, { status: 400 });
    }

    const applicationIdResult = parseAttachmentId(applicationId);
    if (!applicationIdResult.isValid || applicationIdResult.value === null) {
      return NextResponse.json({ error: '申請 ID 格式無效' }, { status: 400 });
    }

    // 驗證權限
    const application = await prisma.dependentApplication.findFirst({
      where: {
        id: applicationIdResult.value,
        ...(user.role !== 'ADMIN' && user.role !== 'HR' 
          ? { employeeId: user.employeeId || 0 } 
          : {})
      },
      include: {
        attachments: {
          orderBy: { uploadedAt: 'desc' }
        }
      }
    });

    if (!application) {
      return NextResponse.json({ error: '申請不存在或無權限' }, { status: 404 });
    }

    return NextResponse.json({
      attachments: application.attachments.map(a => ({
        id: a.id,
        fileType: a.fileType,
        fileTypeName: FILE_TYPES[a.fileType as keyof typeof FILE_TYPES] || a.fileType,
        fileName: a.fileName,
        filePath: a.filePath,
        fileSize: a.fileSize,
        mimeType: a.mimeType,
        uploadedAt: a.uploadedAt
      }))
    });
  } catch (error) {
    console.error('取得附件失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 刪除附件
export async function DELETE(request: NextRequest) {
  try {
    const csrfValidation = await validateCSRF(request);
    if (!csrfValidation.valid) {
      return NextResponse.json({ error: `CSRF驗證失敗: ${csrfValidation.error}` }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少附件 ID' }, { status: 400 });
    }

    const attachmentIdResult = parseAttachmentId(id);
    if (!attachmentIdResult.isValid || attachmentIdResult.value === null) {
      return NextResponse.json({ error: '附件 ID 格式無效' }, { status: 400 });
    }

    // 驗證權限
    const attachment = await prisma.dependentApplicationAttachment.findFirst({
      where: { id: attachmentIdResult.value },
      include: { application: true }
    });

    if (!attachment) {
      return NextResponse.json({ error: '附件不存在' }, { status: 404 });
    }

    // 只有申請人或管理員可以刪除
    if (attachment.application.employeeId !== (user.employeeId || 0) && 
        user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    // 只有待審核狀態可以刪除
    if (attachment.application.status !== 'PENDING') {
      return NextResponse.json({ error: '已審核的申請無法刪除附件' }, { status: 400 });
    }

    // 刪除資料庫記錄（檔案保留作為備份）
    await prisma.dependentApplicationAttachment.delete({
      where: { id: attachmentIdResult.value }
    });

    return NextResponse.json({ success: true, message: '附件已刪除' });
  } catch (error) {
    console.error('刪除附件失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
