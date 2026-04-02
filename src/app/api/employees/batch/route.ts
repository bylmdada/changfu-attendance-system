import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

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
  error?: string;
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

    const body = await request.json();
    const { employees } = body as { employees: EmployeeData[] };

    if (!employees || !Array.isArray(employees) || employees.length === 0) {
      return NextResponse.json({ error: '沒有提供員工資料' }, { status: 400 });
    }

    if (employees.length > 100) {
      return NextResponse.json({ error: '單次最多匯入 100 位員工' }, { status: 400 });
    }

    const results: ImportResult[] = [];
    let successCount = 0;
    let failCount = 0;

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
        let employeeId = emp.employeeId?.trim() || '';
        if (!employeeId) {
          employeeId = generateEmployeeId();
        }

        // 驗證必填欄位（員工編號已處理，不再檢查）
        if (!emp.name || !emp.birthday || !emp.hireDate || 
            !emp.baseSalary || !emp.hourlyRate || !emp.department || !emp.position) {
          results.push({
            success: false,
            employeeId: employeeId || '未知',
            name: emp.name || '未知',
            error: '缺少必填欄位（姓名、生日、到職日期、底薪、時薪、部門、職位）'
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

        // 生成預設密碼 (員工編號 + 123)
        const defaultPassword = `${employeeId}123`;
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);

        // 創建員工和用戶帳號
        await prisma.employee.create({
          data: {
            employeeId: employeeId,
            name: emp.name,
            birthday: new Date(emp.birthday),
            phone: emp.phone || '',
            address: emp.address || '',
            emergencyContact: emp.emergencyContact || '',
            emergencyPhone: emp.emergencyPhone || '',
            hireDate: new Date(emp.hireDate),
            baseSalary: Number(emp.baseSalary),
            hourlyRate: Number(emp.hourlyRate),
            department: emp.department,
            position: emp.position,
            employeeType: emp.employeeType === 'HOURLY' ? 'HOURLY' : 'MONTHLY',
            laborInsuranceActive: emp.laborInsuranceActive !== false,
            isActive: true,
            user: {
              create: {
                username: employeeId,
                passwordHash: hashedPassword,
                role: 'USER',
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
          name: emp.name
        });
        successCount++;

      } catch (error) {
        console.error(`匯入員工 ${emp.employeeId} 失敗:`, error);
        results.push({
          success: false,
          employeeId: emp.employeeId || '未知',
          name: emp.name || '未知',
          error: error instanceof Error ? error.message : '系統錯誤'
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
