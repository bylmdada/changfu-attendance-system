import { NextRequest, NextResponse } from 'next/server';
import { getAuthResultFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { Prisma } from '@prisma/client';
import { buildActiveDeputyAssignmentWhere } from '@/lib/schedule-management-permissions';
import { normalizeAttendancePermissions } from '@/lib/attendance-permission-scopes';

function buildEmployeeSelect(): Prisma.EmployeeSelect {
  return {
    id: true,
    employeeId: true,
    name: true,
    department: true,
    position: true
  };
}

function buildEmployeeResponse(employee: {
  id: number;
  employeeId: string;
  name: string | null;
  department: string | null;
  position: string | null;
} | null | undefined) {
  if (!employee) {
    return undefined;
  }

  return {
    id: employee.id,
    employeeId: employee.employeeId,
    name: employee.name,
    department: employee.department,
    position: employee.position
  };
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await getAuthResultFromRequest(request);

    if (authResult.reason === 'session_invalid') {
      return NextResponse.json(
        {
          error: '您已在其他裝置登入，此會話已失效',
          code: 'SESSION_INVALID'
        },
        { status: 401 }
      );
    }

    const user = authResult.user;
    
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const userData = await prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        employee: { select: buildEmployeeSelect() }
      }
    });

    if (!userData) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }

    // 檢查 sessionId 是否匹配（單一會話登入控制）
    if (user.sessionId && userData.currentSessionId && user.sessionId !== userData.currentSessionId) {
      return NextResponse.json(
        { 
          error: '您已在其他裝置登入，此會話已失效',
          code: 'SESSION_INVALID' // 特殊錯誤碼供前端識別
        },
        { status: 401 }
      );
    }

    // 檢查是否為部門主管或代理人
    let isDepartmentManager = false;
    let isDeputyManager = false;
    let hasSchedulePermission = false;
    const attendancePermissions = normalizeAttendancePermissions(undefined);

    if (userData.employee) {
      // 檢查部門主管
      const managerRecord = await prisma.departmentManager.findFirst({
        where: { 
          employeeId: userData.employee.id, 
          isActive: true 
        }
      });
      isDepartmentManager = !!managerRecord;

      // 檢查代理人
      const now = new Date();
      const deputyRecord = await prisma.managerDeputy.findFirst({
        where: buildActiveDeputyAssignmentWhere(userData.employee.id, now)
      });

      let delegatedManagerRecord = null;
      if (!deputyRecord) {
        const approvalDelegates = await prisma.approvalDelegate.findMany({
          where: {
            delegateId: userData.employee.id,
            isActive: true,
            startDate: { lte: now },
            endDate: { gte: now }
          },
          select: {
            delegatorId: true
          }
        });

        if (approvalDelegates.length > 0) {
          delegatedManagerRecord = await prisma.departmentManager.findFirst({
            where: {
              employeeId: { in: approvalDelegates.map((delegate) => delegate.delegatorId) },
              isActive: true
            }
          });
        }
      }
      isDeputyManager = !!deputyRecord || !!delegatedManagerRecord;

      // 檢查班表管理權限（從 JSON permissions 欄位中讀取）
      const permissionRecord = await prisma.attendancePermission.findUnique({
        where: { employeeId: userData.employee.id }
      });
      const normalizedPermissions = normalizeAttendancePermissions(permissionRecord?.permissions);
      attendancePermissions.leaveRequests = normalizedPermissions.leaveRequests;
      attendancePermissions.overtimeRequests = normalizedPermissions.overtimeRequests;
      attendancePermissions.shiftExchanges = normalizedPermissions.shiftExchanges;
      attendancePermissions.scheduleManagement = normalizedPermissions.scheduleManagement;
      hasSchedulePermission = attendancePermissions.scheduleManagement.length > 0;
    }

    const employee = buildEmployeeResponse(userData.employee);

    return NextResponse.json({
      user: {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        employeeId: employee?.id,
        employee,
        isDepartmentManager,
        isDeputyManager,
        hasSchedulePermission,
        attendancePermissions
      }
    });
  } catch (error) {
    console.error('獲取用戶資訊錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
