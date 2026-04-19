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
import { safeParseJSON } from '@/lib/validation';

const DEPENDENT_ID_NUMBER_REGEX = /^[A-Z][0-9]{9}$/;
const ALLOWED_UPDATE_FIELDS = new Set(['dependentName', 'relationship', 'idNumber', 'birthDate']);

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return Number(value);
  }

  return null;
}

function parseDateInput(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const applicationType = typeof parsedBody.data?.applicationType === 'string' ? parsedBody.data.applicationType : null;
    const dependentId = parsePositiveInteger(parsedBody.data?.dependentId);
    const dependentName = getTrimmedString(parsedBody.data?.dependentName);
    const relationship = getTrimmedString(parsedBody.data?.relationship);
    const idNumber = getTrimmedString(parsedBody.data?.idNumber).toUpperCase();
    const birthDate = parsedBody.data?.birthDate;
    const effectiveDate = parsedBody.data?.effectiveDate;
    const changeField = getTrimmedString(parsedBody.data?.changeField);
    const newValue = getTrimmedString(parsedBody.data?.newValue);
    const remarks = typeof parsedBody.data?.remarks === 'string'
      ? parsedBody.data.remarks.trim() || null
      : null;

    // 取得員工資料
    const userRecord = await prisma.user.findUnique({
      where: { id: user.userId },
      include: { employee: true }
    });

    if (!userRecord?.employee) {
      return NextResponse.json({ error: '找不到員工資料' }, { status: 404 });
    }

    // 驗證申請類型
    if (!applicationType || !['ADD', 'REMOVE', 'UPDATE'].includes(applicationType)) {
      return NextResponse.json({ error: '無效的申請類型' }, { status: 400 });
    }

    const parsedEffectiveDate = parseDateInput(effectiveDate);
    if (!parsedEffectiveDate) {
      return NextResponse.json({ error: '生效日期格式無效' }, { status: 400 });
    }

    let applicationData: {
      dependentId: number | null;
      dependentName: string;
      relationship: string;
      idNumber: string;
      birthDate: Date;
      changeField: string | null;
      oldValue: string | null;
      newValue: string | null;
    } | null = null;

    if (applicationType === 'ADD') {
      const parsedBirthDate = parseDateInput(birthDate);
      if (!dependentName || !relationship || !idNumber || !parsedBirthDate) {
        return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
      }

      if (!DEPENDENT_ID_NUMBER_REGEX.test(idNumber)) {
        return NextResponse.json({ error: '身分證號格式無效' }, { status: 400 });
      }

      const [existingDependent, existingPendingApplication] = await Promise.all([
        prisma.healthInsuranceDependent.findFirst({
          where: {
            employeeId: userRecord.employee.id,
            idNumber,
            isActive: true
          }
        }),
        prisma.dependentApplication.findFirst({
          where: {
            employeeId: userRecord.employee.id,
            applicationType: 'ADD',
            idNumber,
            status: 'PENDING'
          }
        })
      ]);

      if (existingDependent) {
        return NextResponse.json({ error: '此眷屬已在投保名單中' }, { status: 409 });
      }

      if (existingPendingApplication) {
        return NextResponse.json({ error: '此眷屬已有待審核的加保申請' }, { status: 409 });
      }

      applicationData = {
        dependentId: null,
        dependentName,
        relationship,
        idNumber,
        birthDate: parsedBirthDate,
        changeField: null,
        oldValue: null,
        newValue: null
      };
    } else if (applicationType === 'REMOVE') {
      if (!dependentId) {
        return NextResponse.json({ error: '缺少眷屬資料' }, { status: 400 });
      }

      const [existingDependent, existingPendingApplication] = await Promise.all([
        prisma.healthInsuranceDependent.findFirst({
          where: {
            id: dependentId,
            employeeId: userRecord.employee.id,
            isActive: true
          }
        }),
        prisma.dependentApplication.findFirst({
          where: {
            employeeId: userRecord.employee.id,
            dependentId,
            applicationType: 'REMOVE',
            status: 'PENDING'
          }
        })
      ]);

      if (!existingDependent) {
        return NextResponse.json({ error: '找不到可退保的眷屬資料' }, { status: 404 });
      }

      if (existingPendingApplication) {
        return NextResponse.json({ error: '此眷屬已有待審核的退保申請' }, { status: 409 });
      }

      applicationData = {
        dependentId: existingDependent.id,
        dependentName: existingDependent.dependentName,
        relationship: existingDependent.relationship,
        idNumber: existingDependent.idNumber,
        birthDate: existingDependent.birthDate,
        changeField: null,
        oldValue: null,
        newValue: null
      };
    } else {
      if (!dependentId || !changeField || !newValue) {
        return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
      }

      if (!ALLOWED_UPDATE_FIELDS.has(changeField)) {
        return NextResponse.json({ error: '無效的變更欄位' }, { status: 400 });
      }

      const [existingDependent, existingPendingApplication] = await Promise.all([
        prisma.healthInsuranceDependent.findFirst({
          where: {
            id: dependentId,
            employeeId: userRecord.employee.id
          }
        }),
        prisma.dependentApplication.findFirst({
          where: {
            employeeId: userRecord.employee.id,
            dependentId,
            applicationType: 'UPDATE',
            status: 'PENDING'
          }
        })
      ]);

      if (!existingDependent) {
        return NextResponse.json({ error: '找不到可變更的眷屬資料' }, { status: 404 });
      }

      if (existingPendingApplication) {
        return NextResponse.json({ error: '此眷屬已有待審核的變更申請' }, { status: 409 });
      }

      let normalizedNewValue = newValue;
      if (changeField === 'idNumber') {
        normalizedNewValue = newValue.toUpperCase();
        if (!DEPENDENT_ID_NUMBER_REGEX.test(normalizedNewValue)) {
          return NextResponse.json({ error: '身分證號格式無效' }, { status: 400 });
        }
      }

      if (changeField === 'birthDate' && !parseDateInput(newValue)) {
        return NextResponse.json({ error: '生日格式無效' }, { status: 400 });
      }

      const oldValue = changeField === 'birthDate'
        ? existingDependent.birthDate.toISOString().split('T')[0]
        : changeField === 'idNumber'
          ? existingDependent.idNumber
          : existingDependent[changeField as 'dependentName' | 'relationship'];

      applicationData = {
        dependentId: existingDependent.id,
        dependentName: existingDependent.dependentName,
        relationship: existingDependent.relationship,
        idNumber: existingDependent.idNumber,
        birthDate: existingDependent.birthDate,
        changeField,
        oldValue,
        newValue: normalizedNewValue
      };
    }

    // 建立申請
    const application = await prisma.dependentApplication.create({
      data: {
        employeeId: userRecord.employee.id,
        employeeName: userRecord.employee.name,
        applicationType,
        dependentId: applicationData.dependentId,
        dependentName: applicationData.dependentName,
        relationship: applicationData.relationship,
        idNumber: applicationData.idNumber,
        birthDate: applicationData.birthDate,
        effectiveDate: parsedEffectiveDate,
        changeField: applicationData.changeField,
        oldValue: applicationData.oldValue,
        newValue: applicationData.newValue,
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
      id: application.id,
      message: `${typeLabel}申請已提交，等待審核`,
      application
    });

  } catch (error) {
    console.error('提交申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
