import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFinalReviewer(role: string) {
  return role === 'ADMIN' || role === 'HR';
}

async function getManagedDepartments(employeeId: number): Promise<string[]> {
  const records = await prisma.departmentManager.findMany({
    where: {
      employeeId,
      isActive: true,
    },
    select: { department: true },
  });

  return records.map((record) => record.department).filter(Boolean);
}

// POST - 批次審核忘打卡申請（二階審核：主管→Admin）
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || !['ADMIN', 'HR', 'MANAGER'].includes(user.role)) {
      return NextResponse.json({ error: '需要主管、人資或管理員權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的批次審核資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    if (!isPlainObject(body)) {
      return NextResponse.json({ error: '請提供有效的批次審核資料' }, { status: 400 });
    }

    const ids = Array.isArray(body.ids) ? body.ids : undefined;
    const action = typeof body.action === 'string' ? body.action : undefined;
    const opinion = typeof body.opinion === 'string' ? body.opinion : undefined;
    const remarks =
      typeof body.remarks === 'string'
        ? body.remarks
        : typeof body.reason === 'string'
          ? body.reason
          : undefined;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇要審核的申請' }, { status: 400 });
    }

    const normalizedIds: number[] = [];
    for (const rawId of ids) {
      const parsedId = parseIntegerQueryParam(String(rawId), { min: 1, max: 99999999 });
      if (!parsedId.isValid || parsedId.value === null) {
        return NextResponse.json({ error: 'ids 格式錯誤' }, { status: 400 });
      }

      normalizedIds.push(parsedId.value);
    }

    let updatedCount = 0;

    // 主管審核（提供意見，轉交 Admin）
    if (user.role === 'MANAGER' && opinion) {
      if (!['AGREE', 'DISAGREE'].includes(opinion ?? '')) {
        return NextResponse.json({ error: '請選擇同意或不同意' }, { status: 400 });
      }

      const pendingRequests = await prisma.missedClockRequest.findMany({
        where: {
          id: { in: normalizedIds },
          status: 'PENDING'
        },
        include: {
          employee: {
            select: { department: true },
          },
        },
      });

      if (pendingRequests.length === 0) {
        return NextResponse.json({ error: '申請已被處理', failedIds: normalizedIds }, { status: 400 });
      }

      const managedDepartments = await getManagedDepartments(user.employeeId);
      const hasOutOfScopeRequest =
        managedDepartments.length === 0 ||
        pendingRequests.some(
          (request) => !request.employee?.department || !managedDepartments.includes(request.employee.department)
        );

      if (hasOutOfScopeRequest) {
        return NextResponse.json({ error: '無權限審核其他部門的忘打卡申請' }, { status: 403 });
      }

      for (const req of pendingRequests) {
        await prisma.missedClockRequest.update({
          where: { id: req.id },
          data: {
            status: 'PENDING_ADMIN',
            managerReviewerId: user.employeeId,
            managerOpinion: opinion,
            managerNote: remarks || null,
            managerReviewedAt: new Date()
          }
        });
        updatedCount++;
      }

      const processedIds = pendingRequests.map((request) => request.id);
      const failedIds = normalizedIds.filter((id) => !processedIds.includes(id));

      return NextResponse.json({
        success: true,
        message:
          failedIds.length > 0
            ? `主管已審核 ${updatedCount} 筆申請，${failedIds.length} 筆已被處理，已轉交管理員決核`
            : `主管已審核 ${updatedCount} 筆申請，已轉交管理員決核`,
        count: updatedCount,
        failedCount: failedIds.length,
        failedIds
      });
    }

    // Admin / HR 最終決核
    if (isFinalReviewer(user.role)) {
      if (!action || !['APPROVED', 'REJECTED'].includes(action ?? '')) {
        return NextResponse.json({ error: '無效的審核操作' }, { status: 400 });
      }

      // Admin / HR 可以審核 PENDING 或 PENDING_ADMIN 狀態
      const pendingRequests = await prisma.missedClockRequest.findMany({
        where: {
          id: { in: normalizedIds },
          status: { in: ['PENDING', 'PENDING_ADMIN'] }
        }
      });

      if (pendingRequests.length === 0) {
        return NextResponse.json({ error: '申請已被處理', failedIds: normalizedIds }, { status: 400 });
      }

      for (const req of pendingRequests) {
        const approvedAt = new Date();

        if (action === 'APPROVED') {
          await prisma.$transaction(async (tx) => {
            await tx.missedClockRequest.update({
              where: { id: req.id },
              data: {
                status: action,
                approvedBy: user.employeeId,
                approvedAt,
                rejectReason: null
              }
            });

            const existingAttendance = await tx.attendanceRecord.findFirst({
              where: {
                employeeId: req.employeeId,
                workDate: new Date(req.workDate)
              }
            });

            if (existingAttendance) {
              const updateData: { clockInTime?: string; clockOutTime?: string } = {};
              if (req.clockType === 'CLOCK_IN') {
                updateData.clockInTime = req.requestedTime;
              } else {
                updateData.clockOutTime = req.requestedTime;
              }

              await tx.attendanceRecord.update({
                where: { id: existingAttendance.id },
                data: updateData
              });
            } else {
              const createData: {
                employeeId: number;
                workDate: Date;
                status: string;
                clockInTime?: string;
                clockOutTime?: string;
              } = {
                employeeId: req.employeeId,
                workDate: new Date(req.workDate),
                status: 'PRESENT'
              };

              if (req.clockType === 'CLOCK_IN') {
                createData.clockInTime = req.requestedTime;
              } else {
                createData.clockOutTime = req.requestedTime;
              }

              await tx.attendanceRecord.create({ data: createData });
            }
          });
        } else {
          await prisma.missedClockRequest.update({
            where: { id: req.id },
            data: {
              status: action,
              approvedBy: user.employeeId,
              approvedAt,
              rejectReason: remarks || null
            }
          });
        }

        updatedCount++;
      }

      const processedIds = pendingRequests.map((request) => request.id);
      const failedIds = normalizedIds.filter((id) => !processedIds.includes(id));

      return NextResponse.json({
        success: true,
        message:
          failedIds.length > 0
            ? `已${action === 'APPROVED' ? '批准' : '拒絕'} ${updatedCount} 筆忘打卡申請，${failedIds.length} 筆已被處理`
            : `已${action === 'APPROVED' ? '批准' : '拒絕'} ${updatedCount} 筆忘打卡申請`,
        count: updatedCount,
        failedCount: failedIds.length,
        failedIds
      });
    }

    return NextResponse.json({ error: '無權限執行此操作' }, { status: 403 });
  } catch (error) {
    console.error('批次審核忘打卡申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
