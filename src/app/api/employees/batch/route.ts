import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';
import { generatePasswordForPolicy } from '@/lib/password-policy';
import { getStoredPasswordPolicy } from '@/lib/password-policy-store';

interface EmployeeData {
  employeeId: string;
  name: string;
  birthday: string;
  phone?: string;
  address?: string;
  emergencyContact?: string;
  emergencyPhone?: string;
  hireDate: string;
  baseSalary: number;
  hourlyRate: number;
  department: string;
  position: string;
  employeeType?: string; // MONTHLY | HOURLY
  laborInsuranceActive?: boolean;
}

interface ImportResult {
  success: boolean;
  employeeId: string;
  name: string;
  temporaryPassword?: string;
  error?: string;
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDuplicateEmployeeImportError(error: unknown): boolean {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';

  return code === 'P2002' || message.includes('UNIQUE constraint failed');
}

// POST - 批量匯入員工
export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/employees/batch');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF 保護
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    // 認證和權限檢查
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const { employees } = parsedBody.data as { employees?: EmployeeData[] };

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return NextResponse.json({ error: '沒有提供員工資料' }, { status: 400 });
    }

    if (employees.length > 100) {
      return NextResponse.json({ error: '單次最多匯入 100 位員工' }, { status: 400 });
    }

    const results: ImportResult[] = [];
    let successCount = 0;
    let failCount = 0;
    const passwordPolicy = await getStoredPasswordPolicy();

    // 獲取所有現有員工編號，用於檢查重複
    const existingEmployees = await prisma.employee.findMany({
      select: { employeeId: true }
    });
    const existingIds = new Set(existingEmployees.map(e => e.employeeId));

    // 獲取所有現有用戶名，用於檢查重複
    const existingUsers = await prisma.user.findMany({
      select: { username: true }
    });
    const existingUsernames = new Set(existingUsers.map(u => u.username));

    // 自動生成員工編號的函式
    const generateEmployeeId = (): string => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      let newId = '';
      let attempts = 0;
      
      // 嘗試生成不重複的編號
      while (attempts < 100) {
        const sequence = String(Math.floor(Math.random() * 9000) + 1000);
        newId = `${year}${month}${sequence}`;
        if (!existingIds.has(newId) && !existingUsernames.has(newId)) {
          break;
        }
        attempts++;
      }
      return newId;
    };

    // 處理每個員工
    for (const emp of employees) {
      try {
        // 如果員工編號為空，自動生成
        let employeeId = isNonEmptyString(emp.employeeId) ? emp.employeeId.trim() : '';
        if (!employeeId) {
          employeeId = generateEmployeeId();
        }

        const normalizedName = isNonEmptyString(emp.name) ? emp.name.trim() : '';
        const normalizedDepartment = isNonEmptyString(emp.department) ? emp.department.trim() : '';
        const normalizedPosition = isNonEmptyString(emp.position) ? emp.position.trim() : '';
        const normalizedBaseSalary = parsePayrollNumber(emp.baseSalary);
        const normalizedHourlyRate = parsePayrollNumber(emp.hourlyRate);

        // 驗證必填欄位（員工編號已處理，不再檢查）
        if (!normalizedName || !isValidDateInput(emp.birthday) || !isValidDateInput(emp.hireDate) || normalizedBaseSalary === null || normalizedHourlyRate === null || !normalizedDepartment || !normalizedPosition) {
          results.push({
            success: false,
            employeeId: employeeId || '未知',
            name: normalizedName || '未知',
            error: '缺少必填欄位或欄位格式無效（姓名、生日、到職日期、底薪、時薪、部門、職位）'
          });
          failCount++;
          continue;
        }

        if (emp.employeeType !== undefined && emp.employeeType !== 'MONTHLY' && emp.employeeType !== 'HOURLY') {
          results.push({
            success: false,
            employeeId,
            name: normalizedName,
            error: '員工類型格式無效'
          });
          failCount++;
          continue;
        }

        // 檢查員工編號是否重複
        if (existingIds.has(employeeId)) {
          results.push({
            success: false,
            employeeId: employeeId,
            name: emp.name,
            error: '員工編號已存在'
          });
          failCount++;
          continue;
        }

        // 檢查用戶名是否重複
        if (existingUsernames.has(employeeId)) {
          results.push({
            success: false,
            employeeId: employeeId,
            name: emp.name,
            error: '用戶名已存在'
          });
          failCount++;
          continue;
        }

        const temporaryPassword = generatePasswordForPolicy(passwordPolicy);
        const hashedPassword = await hashPassword(temporaryPassword);

        // 創建員工和用戶帳號
        await prisma.employee.create({
          data: {
            employeeId: employeeId,
            name: normalizedName,
            birthday: new Date(emp.birthday),
            phone: isNonEmptyString(emp.phone) ? emp.phone.trim() : '',
            address: isNonEmptyString(emp.address) ? emp.address.trim() : '',
            emergencyContact: isNonEmptyString(emp.emergencyContact) ? emp.emergencyContact.trim() : '',
            emergencyPhone: isNonEmptyString(emp.emergencyPhone) ? emp.emergencyPhone.trim() : '',
            hireDate: new Date(emp.hireDate),
            baseSalary: normalizedBaseSalary,
            hourlyRate: normalizedHourlyRate,
            department: normalizedDepartment,
            position: normalizedPosition,
            employeeType: emp.employeeType === 'HOURLY' ? 'HOURLY' : 'MONTHLY',
            laborInsuranceActive: emp.laborInsuranceActive !== false,
            isActive: true,
            user: {
              create: {
                username: employeeId,
                passwordHash: hashedPassword,
                role: 'EMPLOYEE',
                isActive: true
              }
            }
          }
        });

        // 更新集合，防止後續重複
        existingIds.add(employeeId);
        existingUsernames.add(employeeId);

        results.push({
          success: true,
          employeeId: employeeId,
          name: normalizedName,
          temporaryPassword
        });
        successCount++;

      } catch (error) {
        console.error(`匯入員工 ${emp.employeeId} 失敗:`, error);
        results.push({
          success: false,
          employeeId: emp.employeeId || '未知',
          name: emp.name || '未知',
          error: isDuplicateEmployeeImportError(error)
            ? '員工編號或帳號已存在'
            : error instanceof Error
              ? error.message
              : '系統錯誤'
        });
        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `匯入完成：成功 ${successCount} 位，失敗 ${failCount} 位`,
      summary: {
        total: employees.length,
        success: successCount,
        failed: failCount
      },
      results
    });

  } catch (error) {
    console.error('批量匯入員工失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
