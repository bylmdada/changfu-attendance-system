import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { Prisma } from '@prisma/client';

function buildEmployeeSelect(): Prisma.EmployeeSelect {
  const employeeModel = Prisma.dmmf.datamodel.models.find(m => m.name === 'Employee');
  const fields = new Set((employeeModel?.fields ?? []).map(f => f.name));
  const base: Record<string, boolean> = {
    id: true,
    employeeId: true,
    name: true,
    department: true,
    position: true,
    baseSalary: true,
    hourlyRate: true
  };
  if (fields.has('insuredBase')) base.insuredBase = true;
  if (fields.has('dependents')) base.dependents = true;
  if (fields.has('laborPensionSelfRate')) base.laborPensionSelfRate = true;
  return base as Prisma.EmployeeSelect;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    
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
      const deputyRecord = await prisma.managerDeputy.findFirst({
        where: { 
          deputyEmployeeId: userData.employee.id, 
          isActive: true,
          OR: [
            { startDate: null },
            { startDate: { lte: new Date() } }
          ]
        }
      });
      isDeputyManager = !!deputyRecord;

      // 檢查班表管理權限（從 JSON permissions 欄位中讀取）
      const permissionRecord = await prisma.attendancePermission.findUnique({
        where: { employeeId: userData.employee.id }
      });
      if (permissionRecord?.permissions) {
        const permissions = permissionRecord.permissions as { scheduleManagement?: string[] };
        hasSchedulePermission = Array.isArray(permissions.scheduleManagement) && permissions.scheduleManagement.length > 0;
      }
    }

    return NextResponse.json({
      user: {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        employeeId: userData.employee ? userData.employee.id : undefined,
        employee: userData.employee ?? undefined,
        isDepartmentManager,
        isDeputyManager,
        hasSchedulePermission
      }
    });
  } catch (error) {
    console.error('獲取用戶資訊錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
