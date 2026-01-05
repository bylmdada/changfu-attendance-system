import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// PUT - 更新員工
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/employees/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '員工操作過於頻繁，請稍後再試',
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
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeId = parseInt(idParam);
    if (isNaN(employeeId)) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    const data = await request.json();
    
    // 檢查員工是否存在
    const existingEmployee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true }
    });

    if (!existingEmployee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    // 如果只是更新 isActive 狀態（部分更新）
    if (data.isActive !== undefined && Object.keys(data).length === 1) {
      const result = await prisma.$transaction(async (tx) => {
        // 更新員工狀態
        const updatedEmployee = await tx.employee.update({
          where: { id: employeeId },
          data: { isActive: data.isActive }
        });

        // 如果有關聯用戶，同步更新用戶狀態
        if (existingEmployee.user) {
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: { isActive: data.isActive }
          });
        }

        return updatedEmployee;
      });

      console.log('✅ 員工狀態更新成功:', result.id, 'isActive:', result.isActive);
      return NextResponse.json({ 
        message: data.isActive ? '員工已啟用' : '員工已停用',
        employee: result
      });
    }

    // 完整更新模式
    const {
      employeeId: empId,
      name,
      birthday,
      phone,
      address,
      emergencyContact,
      emergencyPhone,
      hireDate,
      baseSalary,
      hourlyRate,
      department,
      position,
      username,
      password,
      createAccount,
      role // 新增角色欄位
    } = data;

    // 驗證必填欄位
    if (!empId || !name || !birthday || !hireDate || !baseSalary || !hourlyRate || !department || !position) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    // 檢查員工編號是否重複（排除當前員工）
    if (empId !== existingEmployee.employeeId) {
      const duplicateEmpId = await prisma.employee.findFirst({
        where: {
          employeeId: empId,
          id: { not: employeeId }
        }
      });

      if (duplicateEmpId) {
        return NextResponse.json({ error: '員工編號已存在' }, { status: 400 });
      }
    }

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 更新員工資料
      const updatedEmployee = await tx.employee.update({
        where: { id: employeeId },
        data: {
          employeeId: empId,
          name,
          birthday: new Date(birthday),
          phone,
          address,
          emergencyContact,
          emergencyPhone,
          hireDate: new Date(hireDate),
          baseSalary: parseInt(baseSalary),
          hourlyRate: parseInt(hourlyRate),
          department,
          position
        }
      });

      // 處理帳號資訊
      if (createAccount) {
        if (!username || !password) {
          throw new Error('帳號和密碼為必填項');
        }

        // 檢查用戶名是否重複（排除當前用戶）
        const duplicateUsername = await tx.user.findFirst({
          where: {
            username,
            id: existingEmployee.user ? { not: existingEmployee.user.id } : undefined
          }
        });

        if (duplicateUsername) {
          throw new Error('用戶名已存在');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        if (existingEmployee.user) {
          // 更新現有用戶（包含角色）
          const updateData: { username: string; passwordHash?: string; role?: string } = {
            username
          };
          
          // 只有當提供密碼時才更新密碼
          if (password) {
            updateData.passwordHash = hashedPassword;
          }
          
          // 更新角色（如果有提供）
          if (role && ['EMPLOYEE', 'HR', 'ADMIN'].includes(role)) {
            updateData.role = role;
          }
          
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: updateData
          });
        } else {
          // 創建新用戶
          await tx.user.create({
            data: {
              username,
              passwordHash: hashedPassword,
              role: 'EMPLOYEE',
              employeeId: updatedEmployee.id,
              isActive: true
            }
          });
        }
      } else {
        // createAccount = false 時
        // 如果已有用戶帳號，仍然更新角色（如果有提供）
        if (existingEmployee.user && role && ['EMPLOYEE', 'HR', 'ADMIN'].includes(role)) {
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: { role }
          });
          console.log(`✅ 角色已更新: ${existingEmployee.user.username} → ${role}`);
        }
      }

      return updatedEmployee;
    });

    console.log('✅ 員工更新成功:', result);
    return NextResponse.json({ 
      message: '員工資料已更新',
      employee: result
    });

  } catch (error) {
    console.error('💥 更新員工失敗:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '系統錯誤' 
    }, { status: 500 });
  }
}

// DELETE - 停用員工
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/employees/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '員工操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeId = parseInt(idParam);
    if (isNaN(employeeId)) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    // 檢查員工是否存在
    const existingEmployee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true }
    });

    if (!existingEmployee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    // 開始事務處理
    await prisma.$transaction(async (tx) => {
      // 停用員工
      await tx.employee.update({
        where: { id: employeeId },
        data: { isActive: false }
      });

      // 如果有關聯用戶，也停用用戶
      if (existingEmployee.user) {
        await tx.user.update({
          where: { id: existingEmployee.user.id },
          data: { isActive: false }
        });
      }
    });

    console.log('✅ 員工停用成功:', employeeId);
    return NextResponse.json({ message: '員工已停用' });

  } catch (error) {
    console.error('💥 停用員工失敗:', error);
    return NextResponse.json({ 
      error: '系統錯誤' 
    }, { status: 500 });
  }
}

// GET - 獲取單個員工詳情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/employees/[id]');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeId = parseInt(idParam);
    if (isNaN(employeeId)) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            role: true,
            isActive: true
          }
        }
      }
    });

    if (!employee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    return NextResponse.json({ employee });

  } catch (error) {
    console.error('💥 獲取員工詳情失敗:', error);
    return NextResponse.json({ 
      error: '系統錯誤' 
    }, { status: 500 });
  }
}
