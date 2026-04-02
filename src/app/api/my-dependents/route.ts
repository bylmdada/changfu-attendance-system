/**
 * 員工眷屬申請 API（員工端）
 * GET: 取得自己的眷屬和申請記錄
 * POST: 提交新申請（加保/退保/變更）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';
import { createApprovalForRequest } from '@/lib/approval-helper';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const employeeId = userRecord.employee.id;

    // 取得自己的眷屬
    const dependents = await prisma.healthInsuranceDependent.findMany({
      where: { employeeId },
      orderBy: { dependentName: 'asc' }
    });

    // 取得自己的申請記錄
    const applications = await prisma.dependentApplication.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      employee: {
        id: userRecord.employee.id,
        name: userRecord.employee.name,
        department: userRecord.employee.department
      },
      dependents: dependents.map(d => ({
        id: d.id,
        dependentName: d.dependentName,
        relationship: d.relationship,
        idNumber: d.idNumber,
        birthDate: d.birthDate.toISOString().split('T')[0],
        isActive: d.isActive,
        startDate: d.startDate.toISOString().split('T')[0],
        endDate: d.endDate?.toISOString().split('T')[0]
      })),
      applications: applications.map(a => ({
        id: a.id,
        applicationType: a.applicationType,
        status: a.status,
        dependentName: a.dependentName,
        relationship: a.relationship,
        effectiveDate: a.effectiveDate.toISOString().split('T')[0],
        remarks: a.remarks,
        reviewNote: a.reviewNote,
        createdAt: a.createdAt.toISOString()
      }))
    });

  } catch (error) {
    console.error('取得眷屬資料失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    const data = await request.json();
    const { 
      applicationType, 
      dependentId,
      dependentName, 
      relationship, 
      idNumber, 
      birthDate, 
      effectiveDate,
      changeField,
      oldValue,
      newValue,
      remarks 
    } = data;

    // 驗證必填欄位
    if (!applicationType || !dependentName || !effectiveDate) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 驗證申請類型
    if (!['ADD', 'REMOVE', 'UPDATE'].includes(applicationType)) {
      return NextResponse.json({ error: '無效的申請類型' }, { status: 400 });
    }

    // 建立申請
    const application = await prisma.dependentApplication.create({
      data: {
        employeeId: userRecord.employee.id,
        employeeName: userRecord.employee.name,
        applicationType,
        dependentId: dependentId || null,
        dependentName,
        relationship: relationship || '',
        idNumber: idNumber || '',
        birthDate: birthDate ? new Date(birthDate) : new Date(),
        effectiveDate: new Date(effectiveDate),
        changeField,
        oldValue,
        newValue,
        remarks
      }
    });

    // 建立審核實例
    await createApprovalForRequest({
      requestType: 'DEPENDENT_APP',
      requestId: application.id,
      applicantId: userRecord.employee.id,
      applicantName: userRecord.employee.name,
      department: userRecord.employee.department
    });

    const typeLabel = applicationType === 'ADD' ? '加保' : applicationType === 'REMOVE' ? '退保' : '變更';

    return NextResponse.json({
      success: true,
      message: `${typeLabel}申請已提交，等待審核`,
      application
    });

  } catch (error) {
    console.error('提交申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
