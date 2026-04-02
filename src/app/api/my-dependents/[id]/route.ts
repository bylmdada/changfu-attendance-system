import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

// 取得單一申請詳情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 取得申請（含附件）
    const application = await prisma.dependentApplication.findFirst({
      where: {
        id: applicationId,
        employeeId: userRecord.employee.id
      },
      include: {
        attachments: {
          orderBy: { uploadedAt: 'desc' }
        }
      }
    });

    if (!application) {
      return NextResponse.json({ error: '申請不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      application: {
        id: application.id,
        applicationType: application.applicationType,
        status: application.status,
        dependentName: application.dependentName,
        relationship: application.relationship,
        idNumber: application.idNumber,
        birthDate: application.birthDate.toISOString().split('T')[0],
        effectiveDate: application.effectiveDate.toISOString().split('T')[0],
        remarks: application.remarks,
        reviewNote: application.reviewNote,
        createdAt: application.createdAt.toISOString(),
        attachments: application.attachments.map(a => ({
          id: a.id,
          fileType: a.fileType,
          fileName: a.fileName,
          filePath: a.filePath,
          fileSize: a.fileSize,
          mimeType: a.mimeType
        }))
      }
    });

  } catch (error) {
    console.error('取得申請詳情失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 編輯申請（僅限 PENDING 狀態）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 檢查申請是否存在且屬於當前用戶
    const existingApplication = await prisma.dependentApplication.findFirst({
      where: {
        id: applicationId,
        employeeId: userRecord.employee.id
      }
    });

    if (!existingApplication) {
      return NextResponse.json({ error: '申請不存在' }, { status: 404 });
    }

    // 僅限待審核狀態可編輯
    if (existingApplication.status !== 'PENDING') {
      return NextResponse.json({ error: '已審核的申請無法編輯' }, { status: 400 });
    }

    const data = await request.json();
    const { 
      dependentName, 
      relationship, 
      idNumber, 
      birthDate, 
      effectiveDate,
      remarks 
    } = data;

    // 更新申請
    const updatedApplication = await prisma.dependentApplication.update({
      where: { id: applicationId },
      data: {
        dependentName: dependentName || existingApplication.dependentName,
        relationship: relationship || existingApplication.relationship,
        idNumber: idNumber || existingApplication.idNumber,
        birthDate: birthDate ? new Date(birthDate) : existingApplication.birthDate,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : existingApplication.effectiveDate,
        remarks: remarks !== undefined ? remarks : existingApplication.remarks
      }
    });

    return NextResponse.json({
      success: true,
      message: '申請已更新',
      application: updatedApplication
    });

  } catch (error) {
    console.error('更新申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

// 撤銷/刪除申請（僅限 PENDING 狀態）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { id } = await params;
    const applicationId = parseInt(id);

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 檢查申請是否存在且屬於當前用戶
    const existingApplication = await prisma.dependentApplication.findFirst({
      where: {
        id: applicationId,
        employeeId: userRecord.employee.id
      }
    });

    if (!existingApplication) {
      return NextResponse.json({ error: '申請不存在' }, { status: 404 });
    }

    // 僅限待審核狀態可撤銷
    if (existingApplication.status !== 'PENDING') {
      return NextResponse.json({ error: '已審核的申請無法撤銷' }, { status: 400 });
    }

    // 刪除申請（附件會因為 onDelete: Cascade 自動刪除）
    await prisma.dependentApplication.delete({
      where: { id: applicationId }
    });

    return NextResponse.json({
      success: true,
      message: '申請已撤銷'
    });

  } catch (error) {
    console.error('撤銷申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
