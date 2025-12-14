import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 驗證 admin 權限
async function verifyAdmin(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        employee: true
      }
    });

    return user?.role === 'ADMIN' ? user : null;
  } catch {
    return null;
  }
}

// GET - 取得所有員工及其眷屬資料
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得所有員工資料
    const employees = await prisma.employee.findMany({
      select: {
        id: true,
        employeeId: true,
        name: true,
        department: true,
        position: true
      },
      orderBy: [
        { department: 'asc' },
        { name: 'asc' }
      ]
    });

    // 取得所有眷屬資料
    const allDependents = await prisma.healthInsuranceDependent.findMany({
      orderBy: [
        { employeeId: 'asc' },
        { dependentName: 'asc' }
      ]
    });

    // 組合員工與眷屬資料
    const dependentSummaries = employees.map(employee => {
      const dependents = allDependents.filter(dep => dep.employeeId === employee.id);
      return {
        employeeId: employee.id,
        employeeName: employee.name,
        department: employee.department,
        dependentCount: dependents.filter(dep => dep.isActive).length,
        dependents: dependents.map(dep => ({
          id: dep.id,
          employeeId: dep.employeeId,
          dependentName: dep.dependentName,
          relationship: dep.relationship,
          idNumber: dep.idNumber,
          birthDate: dep.birthDate.toISOString().split('T')[0],
          isActive: dep.isActive,
          startDate: dep.startDate.toISOString().split('T')[0],
          endDate: dep.endDate ? dep.endDate.toISOString().split('T')[0] : undefined,
          remarks: dep.remarks || undefined
        }))
      };
    });

    return NextResponse.json({
      success: true,
      dependentSummaries
    });

  } catch (error) {
    console.error('取得眷屬資料失敗:', error);
    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST - 新增或更新眷屬資料
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/health-insurance-dependents');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '健保眷屬設定操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 管理員權限驗證
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const data = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(data);
    if (jsonString.length > 5000) { // 5KB限制
      return NextResponse.json(
        { error: '健保眷屬資料過大' },
        { status: 400 }
      );
    }
    const {
      id,
      employeeId,
      dependentName,
      relationship,
      idNumber,
      birthDate,
      isActive,
      startDate,
      endDate,
      remarks
    } = data;

    // 驗證必填欄位
    if (!employeeId || !dependentName || !relationship || !idNumber || !birthDate || !startDate) {
      return NextResponse.json(
        { error: '請填寫所有必填欄位' },
        { status: 400 }
      );
    }

    // 驗證員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId }
    });

    if (!employee) {
      return NextResponse.json(
        { error: '員工不存在' },
        { status: 400 }
      );
    }

    // 驗證身分證號格式
    const idNumberRegex = /^[A-Z][0-9]{9}$/;
    if (!idNumberRegex.test(idNumber)) {
      return NextResponse.json(
        { error: '身分證號格式不正確' },
        { status: 400 }
      );
    }

    // 檢查身分證號是否重複（排除自己）
    const existingDependent = await prisma.healthInsuranceDependent.findFirst({
      where: {
        idNumber,
        id: id ? { not: id } : undefined
      }
    });

    if (existingDependent) {
      return NextResponse.json(
        { error: '此身分證號已存在' },
        { status: 400 }
      );
    }

    // 準備儲存的資料
    const dependentData = {
      employeeId,
      dependentName,
      relationship,
      idNumber,
      birthDate: new Date(birthDate),
      isActive,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      remarks: remarks || null
    };

    let savedDependent;

    if (id) {
      // 更新現有眷屬
      savedDependent = await prisma.healthInsuranceDependent.update({
        where: { id },
        data: dependentData
      });
    } else {
      // 新增眷屬
      savedDependent = await prisma.healthInsuranceDependent.create({
        data: dependentData
      });
    }

    return NextResponse.json({
      success: true,
      dependent: {
        id: savedDependent.id,
        employeeId: savedDependent.employeeId,
        dependentName: savedDependent.dependentName,
        relationship: savedDependent.relationship,
        idNumber: savedDependent.idNumber,
        birthDate: savedDependent.birthDate.toISOString().split('T')[0],
        isActive: savedDependent.isActive,
        startDate: savedDependent.startDate.toISOString().split('T')[0],
        endDate: savedDependent.endDate ? savedDependent.endDate.toISOString().split('T')[0] : null,
        remarks: savedDependent.remarks
      }
    });

  } catch (error) {
    console.error('儲存眷屬資料失敗:', error);
    return NextResponse.json(
      { error: '儲存失敗，請檢查資料格式' },
      { status: 500 }
    );
  }
}

// DELETE - 刪除眷屬資料
export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/health-insurance-dependents');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '健保眷屬設定操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少眷屬 ID' },
        { status: 400 }
      );
    }

    // 檢查眷屬是否存在
    const dependent = await prisma.healthInsuranceDependent.findUnique({
      where: { id: parseInt(id) }
    });

    if (!dependent) {
      return NextResponse.json(
        { error: '眷屬資料不存在' },
        { status: 404 }
      );
    }

    // 刪除眷屬資料
    await prisma.healthInsuranceDependent.delete({
      where: { id: parseInt(id) }
    });

    return NextResponse.json({
      success: true,
      message: '眷屬資料已刪除'
    });

  } catch (error) {
    console.error('刪除眷屬資料失敗:', error);
    return NextResponse.json(
      { error: '刪除失敗' },
      { status: 500 }
    );
  }
}
