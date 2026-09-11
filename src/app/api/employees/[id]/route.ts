import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { parseIntegerQueryParam } from '@/lib/query-params';
import { safeParseJSON } from '@/lib/validation';
import { evaluatePasswordStrength } from '@/lib/password-policy';
import { getStoredPasswordPolicy } from '@/lib/password-policy-store';
import { getPasswordReuseViolation } from '@/lib/password-reuse';
import { calculateMonthlySalaryHourlyRate } from '@/lib/hourly-rate';
import { getPayrollImpactWarning } from '@/lib/payroll-impact-warning';

function parseEmployeeIdParam(rawValue: string) {
  return parseIntegerQueryParam(rawValue, { min: 1 });
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

const EMPLOYEE_DELETION_RELATION_LABELS = {
  annualLeaves: '年假資料',
  leaveRequests: '請假申請',
  overtimeRequests: '加班申請',
  attendanceRecords: '考勤記錄',
  payrollRecords: '薪資記錄',
  announcements: '公告資料',
  schedules: '班表資料',
  passwordExceptions: '密碼例外設定',
  shiftExchangeRequestsMade: '發起的調班申請',
  shiftExchangeRequestsTarget: '被調班申請',
  shiftExchangeRequestsApproved: '審核過的調班申請',
  gpsPermissions: 'GPS 打卡權限',
  approvedLeaveRequests: '審核過的請假申請',
  approvedOvertimeRequests: '審核過的加班申請',
  attendanceFreezes: '考勤凍結紀錄',
  annualBonusRecords: '年終獎金資料',
  bonusRecords: '獎金資料',
  createdBonusRecords: '建立過的獎金資料',
  healthInsuranceDependents: '健保眷屬資料',
  missedClockRequests: '忘打卡申請',
  auditLogs: '操作紀錄',
  compLeaveTransactions: '補休異動紀錄',
  processedSettlements: '處理過的離職結算',
  resignationRecords: '離職申請',
  overtimeClockRecords: '加班打卡紀錄',
  delegatedFrom: '委派出去的代理審核',
  delegatedTo: '被委派的代理審核',
  notifications: '通知資料',
  purchaseRequests: '請購單',
  approvedPurchaseRequests: '審核過的請購單',
  leaveBalanceHistory: '年假餘額歷史',
  inAppNotifications: '系統內通知',
  holidayCompensations: '國定假日補休',
  payrollDisputes: '薪資異議',
  reviewedDisputes: '審核過的薪資異議',
  createdAdjustments: '薪資調整紀錄',
  createdDisasterDayOffs: '天災假紀錄',
  departmentManagers: '部門主管設定',
  managerDeputies: '主管代理設定',
  approvalReviews: '審核流程紀錄',
  ccsSent: '發起的知會紀錄',
  ccsReceived: '收到的知會紀錄',
  salaryHistories: '薪資歷史',
  approvedSalaryChanges: '核准過的薪資異動',
  scheduleReleases: '班表發布紀錄',
  scheduleConfirmations: '班表確認紀錄',
  pensionApplications: '勞退申請',
  reviewedPensionApps: '人資審核過的勞退申請',
  approvedPensionApps: '管理員核准過的勞退申請',
} as const;

const EMPLOYEE_DELETION_RELATION_SELECT = Object.fromEntries(
  Object.keys(EMPLOYEE_DELETION_RELATION_LABELS).map((field) => [field, true])
) as Record<keyof typeof EMPLOYEE_DELETION_RELATION_LABELS, true>;

const EMPLOYEE_SINGLE_RELATION_LABELS = {
  attendancePermission: '考勤權限設定',
  compLeaveBalance: '補休餘額',
  resignationSettlement: '離職結算',
  notificationSettings: '通知設定',
} as const;

const USER_DELETION_RELATION_LABELS = {
  createdGPSPermissions: '建立過的 GPS 權限',
  approvedMissedClockRequests: '審核過的忘打卡申請',
  createdPasswordExceptions: '建立過的密碼例外',
  auditLogs: '帳號操作紀錄',
  loginLogs: '登入紀錄',
} as const;

const USER_DELETION_RELATION_SELECT = Object.fromEntries(
  Object.keys(USER_DELETION_RELATION_LABELS).map((field) => [field, true])
) as Record<keyof typeof USER_DELETION_RELATION_LABELS, true>;

async function getPermanentDeletionBlockers(employeeId: number) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      attendancePermission: { select: { id: true } },
      compLeaveBalance: { select: { id: true } },
      resignationSettlement: { select: { id: true } },
      notificationSettings: { select: { id: true } },
      user: {
        select: {
          id: true,
          _count: {
            select: USER_DELETION_RELATION_SELECT,
          },
        },
      },
      _count: {
        select: EMPLOYEE_DELETION_RELATION_SELECT,
      },
    },
  });

  if (!employee) return null;

  const blockers: string[] = [];

  Object.entries(EMPLOYEE_DELETION_RELATION_LABELS).forEach(([field, label]) => {
    const count = employee._count[field as keyof typeof EMPLOYEE_DELETION_RELATION_LABELS];
    if (count > 0) blockers.push(`${label} ${count} 筆`);
  });

  Object.entries(EMPLOYEE_SINGLE_RELATION_LABELS).forEach(([field, label]) => {
    if (employee[field as keyof typeof EMPLOYEE_SINGLE_RELATION_LABELS]) {
      blockers.push(label);
    }
  });

  if (employee.user) {
    Object.entries(USER_DELETION_RELATION_LABELS).forEach(([field, label]) => {
      const count = employee.user?._count[field as keyof typeof USER_DELETION_RELATION_LABELS] ?? 0;
      if (count > 0) blockers.push(`${label} ${count} 筆`);
    });
  }

  return blockers;
}

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
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeIdResult = parseEmployeeIdParam(idParam);
    if (!employeeIdResult.isValid || employeeIdResult.value === null) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    const employeeId = employeeIdResult.value;

    const parsedBody = await safeParseJSON(request);
    if (!parsedBody.success || !parsedBody.data) {
      return NextResponse.json({ error: '請求內容格式無效' }, { status: 400 });
    }

    const data = parsedBody.data;
    
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
      if (typeof data.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive 參數格式無效' }, { status: 400 });
      }

      const isActive = data.isActive;

      const result = await prisma.$transaction(async (tx) => {
        // 更新員工狀態
        const updatedEmployee = await tx.employee.update({
          where: { id: employeeId },
          data: { isActive }
        });

        // 如果有關聯用戶，同步更新用戶狀態
        if (existingEmployee.user) {
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: { isActive }
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
      createAccount,
      role // 新增角色欄位
    } = data;

    const normalizedEmpId = isNonEmptyString(empId) ? empId.trim() : '';
    const normalizedName = isNonEmptyString(name) ? name.trim() : '';
    const normalizedEmail = isNonEmptyString(email) ? email.trim() : '';
    const normalizedDepartment = isNonEmptyString(department) ? department.trim() : '';
    const normalizedPosition = isNonEmptyString(position) ? position.trim() : '';
    const normalizedUsername = isNonEmptyString(username) ? username.trim() : '';
    const normalizedPassword = isNonEmptyString(password) ? password : '';
    const normalizedBaseSalary = parsePayrollNumber(baseSalary);
    const normalizedHourlyRate = parsePayrollNumber(hourlyRate);
    const normalizedRole = typeof role === 'string' ? role : undefined;
    const normalizedEmployeeType = employeeType === 'HOURLY' ? 'HOURLY' : 'MONTHLY';

    // 驗證必填欄位
    if (!normalizedEmpId || !normalizedName || !isValidDateInput(birthday) || !isValidDateInput(hireDate) || normalizedBaseSalary === null || normalizedHourlyRate === null || !normalizedDepartment || !normalizedPosition) {
      return NextResponse.json({ error: '缺少必要欄位或欄位格式無效' }, { status: 400 });
    }

    if (createAccount !== undefined && typeof createAccount !== 'boolean') {
      return NextResponse.json({ error: 'createAccount 參數格式無效' }, { status: 400 });
    }

    if (laborInsuranceActive !== undefined && typeof laborInsuranceActive !== 'boolean') {
      return NextResponse.json({ error: 'laborInsuranceActive 參數格式無效' }, { status: 400 });
    }

    if (normalizedRole !== undefined && !['EMPLOYEE', 'MANAGER', 'HR', 'ADMIN'].includes(normalizedRole)) {
      return NextResponse.json({ error: 'role 參數格式無效' }, { status: 400 });
    }

    if (normalizedPassword) {
      const passwordPolicy = await getStoredPasswordPolicy();
      const passwordValidation = evaluatePasswordStrength(normalizedPassword, passwordPolicy);
      if (!passwordValidation.passesPolicy) {
        return NextResponse.json({
          error: '密碼不符合安全要求',
          details: passwordValidation.violations
        }, { status: 400 });
      }

      if (existingEmployee.user?.passwordHash) {
        const passwordReuseViolation = await getPasswordReuseViolation(
          existingEmployee.user.id,
          normalizedPassword,
          existingEmployee.user.passwordHash,
          passwordPolicy
        );
        if (passwordReuseViolation) {
          return NextResponse.json({
            error: '密碼不符合安全要求',
            details: [passwordReuseViolation]
          }, { status: 400 });
        }
      }
    }

    const effectiveHourlyRate = normalizedEmployeeType === 'MONTHLY'
      ? calculateMonthlySalaryHourlyRate(normalizedBaseSalary)
      : normalizedHourlyRate;
    const salaryChanged = existingEmployee.baseSalary !== normalizedBaseSalary
      || existingEmployee.hourlyRate !== effectiveHourlyRate;
    const salaryEffectiveDate = new Date();

    // 檢查員工編號是否重複（排除當前員工）
    if (normalizedEmpId !== existingEmployee.employeeId) {
      const duplicateEmpId = await prisma.employee.findFirst({
        where: {
          employeeId: normalizedEmpId,
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
          employeeId: normalizedEmpId,
          name: normalizedName,
          birthday: new Date(birthday),
          phone: isNonEmptyString(phone) ? phone.trim() : '',
          email: normalizedEmail || null,
          address: isNonEmptyString(address) ? address.trim() : '',
          emergencyContact: isNonEmptyString(emergencyContact) ? emergencyContact.trim() : '',
          emergencyPhone: isNonEmptyString(emergencyPhone) ? emergencyPhone.trim() : '',
          hireDate: new Date(hireDate),
          baseSalary: normalizedBaseSalary,
          hourlyRate: effectiveHourlyRate,
          department: normalizedDepartment,
          position: normalizedPosition,
          employeeType: normalizedEmployeeType,
          laborInsuranceActive: laborInsuranceActive !== false,
        }
      });

      if (salaryChanged) {
        const existingSalaryHistory = await tx.salaryHistory.findFirst({
          where: { employeeId },
          select: { id: true },
        });

        if (!existingSalaryHistory) {
          await tx.salaryHistory.create({
            data: {
              employeeId,
              effectiveDate: existingEmployee.hireDate,
              baseSalary: existingEmployee.baseSalary,
              hourlyRate: existingEmployee.hourlyRate,
              adjustmentType: 'INITIAL',
              reason: '入職薪資',
              approvedById: user.employeeId,
            },
          });
        }

        await tx.salaryHistory.create({
          data: {
            employeeId,
            effectiveDate: salaryEffectiveDate,
            baseSalary: normalizedBaseSalary,
            hourlyRate: effectiveHourlyRate,
            previousSalary: existingEmployee.baseSalary,
            adjustmentAmount: normalizedBaseSalary - existingEmployee.baseSalary,
            adjustmentType: 'ADJUSTMENT',
            reason: '員工資料維護',
            approvedById: user.employeeId,
          },
        });
      }

      // 處理帳號資訊
      if (createAccount) {
        const effectiveUsername = normalizedUsername || existingEmployee.user?.username || normalizedEmpId;
        const requiresPassword = !existingEmployee.user;

        if (!effectiveUsername || (requiresPassword && !normalizedPassword)) {
          throw new Error('建立帳號時必須提供 username 和 password');
        }

        // 檢查用戶名是否重複（排除當前用戶）
        const duplicateUsername = await tx.user.findFirst({
          where: {
            username: effectiveUsername,
            id: existingEmployee.user ? { not: existingEmployee.user.id } : undefined
          }
        });

        if (duplicateUsername) {
          throw new Error('用戶名已存在');
        }

        if (existingEmployee.user) {
          // 更新現有用戶（包含角色）
          const updateData: {
            username: string;
            passwordHash?: string;
            currentSessionId?: null;
            role?: string;
            passwordHistories?: { create: { passwordHash: string } };
          } = {
            username: effectiveUsername
          };
          
          // 只有當提供密碼時才更新密碼
          if (normalizedPassword) {
            updateData.passwordHash = await bcrypt.hash(normalizedPassword, 12);
            updateData.currentSessionId = null;
            updateData.passwordHistories = {
              create: {
                passwordHash: existingEmployee.user.passwordHash
              }
            };
          }
          
          // 更新角色（如果有提供）
          if (normalizedRole) {
            updateData.role = normalizedRole;
          }
          
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: updateData
          });
        } else {
          // 創建新用戶
          await tx.user.create({
            data: {
              username: effectiveUsername,
              passwordHash: await bcrypt.hash(normalizedPassword, 10),
              role: normalizedRole || 'EMPLOYEE',
              employeeId: updatedEmployee.id,
              isActive: true
            }
          });
        }
      } else {
        // createAccount = false 時
        // 如果已有用戶帳號，仍然更新角色（如果有提供）
        if (existingEmployee.user && normalizedRole) {
          await tx.user.update({
            where: { id: existingEmployee.user.id },
            data: { role: normalizedRole }
          });
          console.log(`✅ 角色已更新: ${existingEmployee.user.username} → ${normalizedRole}`);
        }
      }

      return updatedEmployee;
    });

    const payrollWarning = salaryChanged
      ? await getPayrollImpactWarning(prisma, {
          employeeId,
          startDate: salaryEffectiveDate,
          endDate: salaryEffectiveDate,
        })
      : null;

    console.log('✅ 員工更新成功:', result);
    return NextResponse.json({ 
      message: '員工資料已更新',
      employee: result,
      payrollWarning,
    });

  } catch (error) {
    console.error('💥 更新員工失敗:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '系統錯誤' 
    }, { status: 500 });
  }
}

// DELETE - 預設停用員工；mode=permanent 時才永久刪除未被歷史資料引用的員工
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

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeIdResult = parseEmployeeIdParam(idParam);
    if (!employeeIdResult.isValid || employeeIdResult.value === null) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    const employeeId = employeeIdResult.value;
    const deleteMode = new URL(request.url).searchParams.get('mode');
    const isPermanentDelete = deleteMode === 'permanent';

    // 檢查員工是否存在
    const existingEmployee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { user: true }
    });

    if (!existingEmployee) {
      return NextResponse.json({ error: '員工不存在' }, { status: 404 });
    }

    if (isPermanentDelete) {
      if (employeeId === user.employeeId) {
        return NextResponse.json({ error: '不可刪除目前登入帳號所屬員工資料' }, { status: 400 });
      }

      const parsedBody = await safeParseJSON(request);
      if (!parsedBody.success || !parsedBody.data) {
        return NextResponse.json({ error: '請提供刪除確認資訊' }, { status: 400 });
      }

      const confirmationEmployeeId = typeof parsedBody.data.confirmationEmployeeId === 'string'
        ? parsedBody.data.confirmationEmployeeId.trim()
        : '';
      const confirmationName = typeof parsedBody.data.confirmationName === 'string'
        ? parsedBody.data.confirmationName.trim()
        : '';

      if (
        confirmationEmployeeId !== existingEmployee.employeeId ||
        confirmationName !== existingEmployee.name
      ) {
        return NextResponse.json({ error: '刪除確認資訊不一致，已取消操作' }, { status: 400 });
      }

      const blockers = await getPermanentDeletionBlockers(employeeId);
      if (blockers === null) {
        return NextResponse.json({ error: '員工不存在' }, { status: 404 });
      }

      if (blockers.length > 0) {
        return NextResponse.json({
          error: '此員工已有系統歷史資料，為確保薪資、考勤與稽核資料真實性，請改用停用功能。',
          blockers: blockers.slice(0, 12),
          totalBlockers: blockers.length,
        }, { status: 409 });
      }

      await prisma.$transaction(async (tx) => {
        if (existingEmployee.user) {
          await tx.user.delete({ where: { id: existingEmployee.user.id } });
        }

        await tx.employee.delete({ where: { id: employeeId } });
      });

      console.log('✅ 員工永久刪除成功:', employeeId);
      return NextResponse.json({ message: '員工已永久刪除' });
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
    console.error('💥 員工刪除/停用失敗:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({
        error: '此員工仍有關聯資料，無法永久刪除；請改用停用功能以保留歷史資料正確性。',
      }, { status: 409 });
    }

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

    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const employeeIdResult = parseEmployeeIdParam(idParam);
    if (!employeeIdResult.isValid || employeeIdResult.value === null) {
      return NextResponse.json({ error: '無效的員工ID' }, { status: 400 });
    }

    const employeeId = employeeIdResult.value;

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
