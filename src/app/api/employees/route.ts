import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { getManageableDepartments } from '@/lib/schedule-management-permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { evaluatePasswordStrength } from '@/lib/password-policy';
import { getStoredPasswordPolicy } from '@/lib/password-policy-store';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePayrollNumber(value: unknown): number | null {
  const parsedValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function isValidDateInput(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const isFullAdmin = user.role === 'ADMIN' || user.role === 'HR';
    
    const manageableLocations = await getManageableDepartments(user);

    // 非管理員且無任何管理權限無權限
    if (!isFullAdmin && manageableLocations.length === 0) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const pageResult = parseIntegerQueryParam(searchParams.get('page'), {
      defaultValue: 1,
      min: 1,
    });
    if (!pageResult.isValid) {
      return NextResponse.json({ error: 'page 參數格式無效' }, { status: 400 });
    }

    const limitResult = parseIntegerQueryParam(searchParams.get('limit'), {
      defaultValue: 10,
      min: 1,
      max: 1000,
    });
    if (!limitResult.isValid) {
      return NextResponse.json({ error: 'limit 參數格式無效' }, { status: 400 });
    }

    const page = pageResult.value ?? 1;
    const limit = limitResult.value ?? 10;
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const position = searchParams.get('position') || '';
    const status = searchParams.get('status') || '';

    const skip = (page - 1) * limit;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    
    // 非管理員只能查詢自己可管理的部門
    if (!isFullAdmin && manageableLocations.length > 0) {
      if (manageableLocations.length === 1) {
        where.department = manageableLocations[0];
      } else {
        where.department = { in: manageableLocations };
      }
      // 如果有指定部門篩選，且在可管理範圍內才生效
      if (department && manageableLocations.includes(department)) {
        where.department = department;
      }
    } else if (department) {
      // 管理員可按部門篩選
      where.department = department;
    }
    
    // 搜尋條件
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { employeeId: { contains: search } }
      ];
    }

    // 職位篩選條件
    if (position) {
      where.position = position;
    }

    // 狀態篩選條件
    if (status) {
      where.isActive = status === 'active';
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              role: true,
              isActive: true
            }
          },
          // 部門主管資料
          departmentManagers: {
            where: { isActive: true },
            select: {
              id: true,
              department: true,
              isPrimary: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.employee.count({ where })
    ]);

    return NextResponse.json({
      employees,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('獲取員工列表錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const data = parsedBody.data;
    const {
      employeeId,
      name,
      birthday,
      phone,
      email,
      address,
      emergencyContact,
      emergencyPhone,
      hireDate,
      baseSalary,
      hourlyRate,
      department,
      position,
      employeeType,
      laborInsuranceActive,
      username,
      password,
      createAccount
    } = data;

    const normalizedEmployeeId = isNonEmptyString(employeeId) ? employeeId.trim() : '';
    const normalizedName = isNonEmptyString(name) ? name.trim() : '';
    const normalizedEmail = isNonEmptyString(email) ? email.trim() : '';
    const normalizedDepartment = isNonEmptyString(department) ? department.trim() : '';
    const normalizedPosition = isNonEmptyString(position) ? position.trim() : '';
    const normalizedUsername = isNonEmptyString(username) ? username.trim() : '';
    const normalizedPassword = isNonEmptyString(password) ? password : '';
    const normalizedBaseSalary = parsePayrollNumber(baseSalary);
    const normalizedHourlyRate = parsePayrollNumber(hourlyRate);
    const normalizedEmployeeType = employeeType === 'HOURLY' ? 'HOURLY' : 'MONTHLY';

    if (!normalizedEmployeeId || !normalizedName || !isValidDateInput(birthday) || !isValidDateInput(hireDate) || !normalizedDepartment || !normalizedPosition || normalizedBaseSalary === null || normalizedHourlyRate === null) {
      return NextResponse.json({ error: '缺少必要欄位或欄位格式無效' }, { status: 400 });
    }

    if (createAccount !== undefined && typeof createAccount !== 'boolean') {
      return NextResponse.json({ error: 'createAccount 參數格式無效' }, { status: 400 });
    }

    if (createAccount === true && (!normalizedUsername || !normalizedPassword)) {
      return NextResponse.json({ error: '建立帳號時必須提供 username 和 password' }, { status: 400 });
    }
    
    // 檢查員工編號是否已存在
    const existingEmployee = await prisma.employee.findUnique({
      where: { employeeId: normalizedEmployeeId }
    });
    
    if (existingEmployee) {
      return NextResponse.json({ error: '員工編號已存在' }, { status: 400 });
    }

    // 如果要創建帳號，檢查用戶名是否已存在
    if (createAccount && normalizedUsername) {
      const existingUser = await prisma.user.findUnique({
        where: { username: normalizedUsername }
      });
      
      if (existingUser) {
        return NextResponse.json({ error: '用戶名已存在' }, { status: 400 });
      }
    }

    if (createAccount && normalizedPassword) {
      const passwordPolicy = await getStoredPasswordPolicy();
      const passwordValidation = evaluatePasswordStrength(normalizedPassword, passwordPolicy);
      if (!passwordValidation.passesPolicy) {
        return NextResponse.json({
          error: '密碼不符合安全要求',
          details: passwordValidation.violations
        }, { status: 400 });
      }
    }

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 建立員工記錄
      const employee = await tx.employee.create({
        data: {
          employeeId: normalizedEmployeeId,
          name: normalizedName,
          birthday: new Date(birthday),
          phone: isNonEmptyString(phone) ? phone.trim() : '',
          email: normalizedEmail || null,
          address: isNonEmptyString(address) ? address.trim() : '',
          emergencyContact: isNonEmptyString(emergencyContact) ? emergencyContact.trim() : '',
          emergencyPhone: isNonEmptyString(emergencyPhone) ? emergencyPhone.trim() : '',
          hireDate: new Date(hireDate),
          baseSalary: normalizedBaseSalary,
          hourlyRate: normalizedHourlyRate,
          department: normalizedDepartment,
          position: normalizedPosition,
          employeeType: normalizedEmployeeType,
          laborInsuranceActive: laborInsuranceActive !== false
        }
      });

      // 如果需要創建帳號
      if (createAccount && normalizedUsername && normalizedPassword) {
        const hashedPassword = await hashPassword(normalizedPassword);
        
        await tx.user.create({
          data: {
            username: normalizedUsername,
            passwordHash: hashedPassword,
            role: 'EMPLOYEE',
            employeeId: employee.id,
            isActive: true
          }
        });
      }

      return employee;
    });

    console.log('✅ 員工創建成功:', result);
    return NextResponse.json({ 
      message: '員工已新增',
      employee: result
    }, { status: 201 });

  } catch (error) {
    console.error('💥 新增員工失敗:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '系統錯誤' 
    }, { status: 500 });
  }
}
