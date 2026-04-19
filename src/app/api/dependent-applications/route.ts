/**
 * 眷屬申請審核 API（管理員端）
 * GET: 取得所有申請（可篩選狀態）
 * PUT: 審核申請（通過/退回）
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { toTaiwanDateStr } from '@/lib/timezone';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

const DEPENDENT_ID_NUMBER_REGEX = /^[A-Z][0-9]{9}$/;
const ALLOWED_UPDATE_FIELDS = new Set(['dependentName', 'relationship', 'idNumber', 'birthDate']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeUpdateFieldValue(field: string, value: string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (field === 'idNumber') {
    const normalizedValue = trimmedValue.toUpperCase();
    return DEPENDENT_ID_NUMBER_REGEX.test(normalizedValue) ? normalizedValue : null;
  }

  if (field === 'birthDate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
      return null;
    }

    const parsedDate = new Date(trimmedValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return trimmedValue;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const applications = await prisma.dependentApplication.findMany({
      where,
      include: {
        attachments: true
      },
      orderBy: [
        { status: 'asc' }, // PENDING 排前面
        { createdAt: 'desc' }
      ]
    });

    // 統計
    const stats = {
      pending: await prisma.dependentApplication.count({ where: { status: 'PENDING' } }),
      approved: await prisma.dependentApplication.count({ where: { status: 'APPROVED' } }),
      rejected: await prisma.dependentApplication.count({ where: { status: 'REJECTED' } })
    };

    // 附件類型名稱對照
    const FILE_TYPE_NAMES: Record<string, string> = {
      'ID_FRONT': '身分證正面',
      'ID_BACK': '身分證反面',
      'HOUSEHOLD_REGISTER': '戶籍謄本',
      'HOUSEHOLD_BOOK': '戶口名簿',
      'OTHER': '其他證明'
    };

    return NextResponse.json({
      success: true,
      applications: applications.map(a => ({
        id: a.id,
        employeeId: a.employeeId,
        employeeName: a.employeeName,
        applicationType: a.applicationType,
        status: a.status,
        dependentId: a.dependentId,
        dependentName: a.dependentName,
        relationship: a.relationship,
        idNumber: a.idNumber,
        birthDate: toTaiwanDateStr(a.birthDate),
        effectiveDate: toTaiwanDateStr(a.effectiveDate),
        changeField: a.changeField,
        oldValue: a.oldValue,
        newValue: a.newValue,
        remarks: a.remarks,
        reviewedBy: a.reviewedBy,
        reviewedAt: a.reviewedAt?.toISOString(),
        reviewNote: a.reviewNote,
        createdAt: a.createdAt.toISOString(),
        attachments: a.attachments.map(att => ({
          id: att.id,
          fileType: att.fileType,
          fileTypeName: FILE_TYPE_NAMES[att.fileType] || att.fileType,
          fileName: att.fileName,
          filePath: att.filePath,
          fileSize: att.fileSize,
          mimeType: att.mimeType
        }))
      })),
      stats
    });

  } catch (error) {
    console.error('取得申請列表失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success) {
      const error = parsedBody.error === 'empty_body'
        ? '請提供有效的眷屬申請審核資料'
        : '無效的 JSON 格式';
      return NextResponse.json({ error }, { status: 400 });
    }

    if (!isPlainObject(parsedBody.data)) {
      return NextResponse.json({ error: '請提供有效的眷屬申請審核資料' }, { status: 400 });
    }

    const data = parsedBody.data;
    const rawId = data.id;
    const id = typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && rawId.trim()
        ? Number(rawId)
        : NaN;
    const action = typeof data.action === 'string' ? data.action : '';
    const reviewNote = typeof data.reviewNote === 'string' ? data.reviewNote : undefined;

    if (!Number.isInteger(id) || id <= 0 || !action) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (action !== 'APPROVE' && action !== 'REJECT') {
      return NextResponse.json({ error: '無效的操作' }, { status: 400 });
    }

    const reviewAction: 'APPROVE' | 'REJECT' = action;

    // 取得申請
    const application = await prisma.dependentApplication.findUnique({
      where: { id }
    });

    if (!application) {
      return NextResponse.json({ error: '找不到申請' }, { status: 404 });
    }

    if (application.status !== 'PENDING') {
      return NextResponse.json({ error: '此申請已審核' }, { status: 400 });
    }

    const newStatus = reviewAction === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    await prisma.$transaction(async (tx) => {
      const updatedApplication = await tx.dependentApplication.updateMany({
        where: {
          id,
          status: 'PENDING'
        },
        data: {
          status: newStatus,
          reviewedBy: user.username,
          reviewedAt: new Date(),
          reviewNote: reviewNote || null
        }
      });

      if (updatedApplication.count !== 1) {
        throw new Error('申請狀態已變更，請重新整理後再試');
      }

      const approvalInstance = await tx.approvalInstance.findFirst({
        where: {
          requestType: 'DEPENDENT_APP',
          requestId: id
        }
      });

      if (approvalInstance) {
        await tx.approvalReview.create({
          data: {
            instanceId: approvalInstance.id,
            level: approvalInstance.currentLevel,
            reviewerId: user.employeeId,
            reviewerName: user.username,
            reviewerRole: user.role,
            action: reviewAction,
            comment: reviewNote || null
          }
        });

        const updatedInstance = await tx.approvalInstance.updateMany({
          where: {
            id: approvalInstance.id,
            currentLevel: approvalInstance.currentLevel,
            status: approvalInstance.status
          },
          data: {
            status: newStatus,
            currentLevel: approvalInstance.maxLevel
          }
        });

        if (updatedInstance.count !== 1) {
          throw new Error('審核流程狀態已變更，請重新整理後再試');
        }
      }

      if (reviewAction !== 'APPROVE') {
        return;
      }

      if (application.applicationType === 'ADD') {
        const existingDependent = await tx.healthInsuranceDependent.findFirst({
          where: { idNumber: application.idNumber }
        });

        let savedDependent;
        if (existingDependent) {
          if (existingDependent.isActive) {
            throw new Error('此身分證號已在投保名單中');
          }

          if (existingDependent.employeeId !== application.employeeId) {
            throw new Error('此眷屬已有其他員工關聯，請改由管理員處理');
          }

          savedDependent = await tx.healthInsuranceDependent.update({
            where: { id: existingDependent.id },
            data: {
              dependentName: application.dependentName,
              relationship: application.relationship,
              idNumber: application.idNumber,
              birthDate: application.birthDate,
              isActive: true,
              startDate: application.effectiveDate,
              endDate: null,
              remarks: application.remarks ?? existingDependent.remarks
            }
          });
        } else {
          savedDependent = await tx.healthInsuranceDependent.create({
            data: {
              employeeId: application.employeeId,
              dependentName: application.dependentName,
              relationship: application.relationship,
              idNumber: application.idNumber,
              birthDate: application.birthDate,
              isActive: true,
              startDate: application.effectiveDate,
              remarks: application.remarks
            }
          });
        }

        await tx.dependentEnrollmentLog.create({
          data: {
            dependentId: savedDependent.id,
            employeeId: application.employeeId,
            dependentName: application.dependentName,
            employeeName: application.employeeName,
            type: 'ENROLL',
            effectiveDate: application.effectiveDate,
            createdBy: user.username
          }
        });
      } else if (application.applicationType === 'REMOVE' && application.dependentId) {
        const updatedDependent = await tx.healthInsuranceDependent.updateMany({
          where: {
            id: application.dependentId,
            employeeId: application.employeeId,
            isActive: true
          },
          data: {
            isActive: false,
            endDate: application.effectiveDate
          }
        });

        if (updatedDependent.count !== 1) {
          throw new Error('找不到可退保的眷屬資料');
        }

        await tx.dependentEnrollmentLog.create({
          data: {
            dependentId: application.dependentId,
            employeeId: application.employeeId,
            dependentName: application.dependentName,
            employeeName: application.employeeName,
            type: 'WITHDRAW',
            effectiveDate: application.effectiveDate,
            createdBy: user.username
          }
        });
      } else if (application.applicationType === 'UPDATE' && application.dependentId && application.changeField) {
        if (!ALLOWED_UPDATE_FIELDS.has(application.changeField)) {
          throw new Error('不支援的眷屬變更欄位');
        }

        const normalizedValue = normalizeUpdateFieldValue(application.changeField, application.newValue);
        if (normalizedValue === null) {
          throw new Error('眷屬變更資料格式無效');
        }

        const existingDependent = await tx.healthInsuranceDependent.findFirst({
          where: {
            id: application.dependentId,
            employeeId: application.employeeId
          }
        });

        if (!existingDependent) {
          throw new Error('找不到可變更的眷屬資料');
        }

        const updateData: Record<string, unknown> = {
          [application.changeField]: normalizedValue
        };

        await tx.healthInsuranceDependent.update({
          where: { id: application.dependentId },
          data: updateData
        });

        await tx.dependentHistoryLog.create({
          data: {
            dependentId: application.dependentId,
            dependentName: application.dependentName,
            employeeName: application.employeeName,
            action: 'UPDATE',
            fieldName: application.changeField,
            oldValue: application.oldValue,
            newValue: normalizedValue instanceof Date
              ? normalizedValue.toISOString().split('T')[0]
              : normalizedValue,
            changedBy: user.username
          }
        });
      }
    });

    return NextResponse.json({
      success: true,
      message: action === 'APPROVE' ? '申請已通過' : '申請已退回'
    });

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('狀態已變更')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }

      if (
        error.message.includes('投保名單') ||
        error.message.includes('其他員工關聯') ||
        error.message.includes('不支援的眷屬變更欄位') ||
        error.message.includes('資料格式無效') ||
        error.message.includes('找不到可')
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    console.error('審核申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
