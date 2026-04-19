import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function parseDateValue(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDuplicateDependentError(error: unknown) {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
}

// 驗證管理權限
async function verifyAdmin(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
    return null;
  }

  return user;
}

// GET - 取得所有員工及其眷屬資料
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理或人資權限' }, { status: 403 });
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
      return NextResponse.json({ error: '需要管理或人資權限' }, { status: 403 });
    }

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的眷屬資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;
    if (!isPlainObject(data)) {
      return NextResponse.json(
        { error: '請提供有效的眷屬資料' },
        { status: 400 }
      );
    }
    
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
    const parsedId = id === undefined || id === null || id === '' ? null : parsePositiveInteger(id);
    const parsedEmployeeId = parsePositiveInteger(employeeId);
    const parsedBirthDate = parseDateValue(birthDate);
    const parsedStartDate = parseDateValue(startDate);
    const parsedEndDate = endDate ? parseDateValue(endDate) : null;
    const normalizedDependentName = typeof dependentName === 'string' ? dependentName.trim() : '';
    const normalizedRelationship = typeof relationship === 'string' ? relationship.trim() : '';
    const normalizedIdNumber = typeof idNumber === 'string' ? idNumber.trim().toUpperCase() : '';
    const normalizedRemarks = typeof remarks === 'string' ? remarks.trim() : '';
    const normalizedIsActive = typeof isActive === 'boolean'
      ? isActive
      : isActive === 'true'
        ? true
        : isActive === 'false'
          ? false
          : Boolean(isActive);

    // 驗證必填欄位
    if (!employeeId || !normalizedDependentName || !normalizedRelationship || !normalizedIdNumber || !birthDate || !startDate) {
      return NextResponse.json(
        { error: '請填寫所有必填欄位' },
        { status: 400 }
      );
    }

    if (!parsedEmployeeId) {
      return NextResponse.json(
        { error: '員工 ID 格式無效' },
        { status: 400 }
      );
    }

    if ((id !== undefined && id !== null && id !== '') && !parsedId) {
      return NextResponse.json(
        { error: '眷屬 ID 格式無效' },
        { status: 400 }
      );
    }

    if (!parsedBirthDate || !parsedStartDate || (endDate && !parsedEndDate)) {
      return NextResponse.json(
        { error: '日期格式無效' },
        { status: 400 }
      );
    }

    // 驗證員工是否存在
    const employee = await prisma.employee.findUnique({
      where: { id: parsedEmployeeId }
    });

    if (!employee) {
      return NextResponse.json(
        { error: '員工不存在' },
        { status: 400 }
      );
    }

    // 驗證身分證號格式
    const idNumberRegex = /^[A-Z][0-9]{9}$/;
    if (!idNumberRegex.test(normalizedIdNumber)) {
      return NextResponse.json(
        { error: '身分證號格式不正確' },
        { status: 400 }
      );
    }

    // 檢查身分證號是否重複（排除自己）
    const existingDependent = await prisma.healthInsuranceDependent.findFirst({
      where: {
        idNumber: normalizedIdNumber,
        id: parsedId ? { not: parsedId } : undefined
      }
    });

    const shouldReactivateExistingDependent = !parsedId
      && !!existingDependent
      && !existingDependent.isActive
      && existingDependent.employeeId === parsedEmployeeId;

    if (existingDependent && !shouldReactivateExistingDependent) {
      return NextResponse.json(
        { error: '此身分證號已存在' },
        { status: 400 }
      );
    }

    // 準備儲存的資料
    const dependentData = {
      employeeId: parsedEmployeeId,
      dependentName: normalizedDependentName,
      relationship: normalizedRelationship,
      idNumber: normalizedIdNumber,
      birthDate: parsedBirthDate,
      isActive: normalizedIsActive,
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      remarks: normalizedRemarks || null
    };

    let savedDependent;
    const changedBy = user.username;

    if (parsedId) {
      // 取得舊資料用於記錄變更
      const oldDependent = await prisma.healthInsuranceDependent.findUnique({
        where: { id: parsedId },
        include: { employee: { select: { name: true } } }
      });

      if (!oldDependent) {
        return NextResponse.json(
          { error: '眷屬資料不存在' },
          { status: 404 }
        );
      }
      
      // 更新現有眷屬
      savedDependent = await prisma.healthInsuranceDependent.update({
        where: { id: parsedId },
        data: dependentData,
        include: { employee: { select: { name: true } } }
      });

      // 記錄更新歷史
      if (oldDependent) {
        const changes: { field: string; oldVal: string; newVal: string }[] = [];
        if (oldDependent.dependentName !== dependentData.dependentName) {
          changes.push({ field: 'dependentName', oldVal: oldDependent.dependentName, newVal: dependentData.dependentName });
        }
        if (oldDependent.relationship !== dependentData.relationship) {
          changes.push({ field: 'relationship', oldVal: oldDependent.relationship, newVal: dependentData.relationship });
        }
        if (oldDependent.isActive !== dependentData.isActive) {
          changes.push({ field: 'isActive', oldVal: String(oldDependent.isActive), newVal: String(dependentData.isActive) });
        }
        
        for (const change of changes) {
          await prisma.dependentHistoryLog.create({
            data: {
              dependentId: parsedId,
              dependentName: dependentData.dependentName,
              employeeName: savedDependent.employee.name,
              action: 'UPDATE',
              fieldName: change.field,
              oldValue: change.oldVal,
              newValue: change.newVal,
              changedBy
            }
          });
        }
      }
    } else {
      if (shouldReactivateExistingDependent && existingDependent) {
        savedDependent = await prisma.healthInsuranceDependent.update({
          where: { id: existingDependent.id },
          data: {
            ...dependentData,
            endDate: null,
          },
          include: { employee: { select: { name: true } } }
        });

        await prisma.dependentHistoryLog.create({
          data: {
            dependentId: savedDependent.id,
            dependentName: dependentData.dependentName,
            employeeName: savedDependent.employee.name,
            action: 'UPDATE',
            fieldName: 'isActive',
            oldValue: 'false',
            newValue: 'true',
            changedBy
          }
        });
      } else {
        // 新增眷屬
        savedDependent = await prisma.healthInsuranceDependent.create({
          data: dependentData,
          include: { employee: { select: { name: true } } }
        });

        // 記錄新增歷史
        await prisma.dependentHistoryLog.create({
          data: {
            dependentId: savedDependent.id,
            dependentName: dependentData.dependentName,
            employeeName: savedDependent.employee.name,
            action: 'CREATE',
            changedBy
          }
        });
      }
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
    if (isDuplicateDependentError(error)) {
      return NextResponse.json(
        { error: '此身分證號已存在' },
        { status: 409 }
      );
    }

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
      return NextResponse.json({ error: '需要管理或人資權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const id = rawId ? parsePositiveInteger(rawId) : null;

    if (!rawId) {
      return NextResponse.json(
        { error: '缺少眷屬 ID' },
        { status: 400 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: '眷屬 ID 格式無效' },
        { status: 400 }
      );
    }

    // 檢查眷屬是否存在
    const dependent = await prisma.healthInsuranceDependent.findUnique({
      where: { id },
      include: {
        employee: {
          select: { name: true }
        }
      }
    });

    if (!dependent) {
      return NextResponse.json(
        { error: '眷屬資料不存在' },
        { status: 404 }
      );
    }

    const pendingApplication = await prisma.dependentApplication.findFirst({
      where: {
        dependentId: id,
        status: 'PENDING'
      }
    });

    if (pendingApplication) {
      return NextResponse.json(
        { error: '此眷屬仍有待審核申請，請先處理申請後再刪除' },
        { status: 409 }
      );
    }

    // 刪除眷屬資料前記錄歷史
    const changedBy = user.username;
    await prisma.$transaction([
      prisma.dependentHistoryLog.create({
        data: {
          dependentId: dependent.id,
          dependentName: dependent.dependentName,
          employeeName: dependent.employee?.name || '',
          action: 'DELETE',
          changedBy
        }
      }),
      prisma.healthInsuranceDependent.delete({
        where: { id }
      })
    ]);

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
