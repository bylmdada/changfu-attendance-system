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
    const user = getUserFromRequest(request);
    
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

    return NextResponse.json({
      user: {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        employeeId: userData.employee ? userData.employee.id : undefined,
        employee: userData.employee ?? undefined
      }
    });
  } catch (error) {
    console.error('獲取用戶資訊錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
