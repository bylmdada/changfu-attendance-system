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

// GET - 取得健保配置設定
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得最新的健保配置
    const config = await prisma.healthInsuranceConfig.findFirst({
      where: { isActive: true },
      orderBy: { effectiveDate: 'desc' },
      include: {
        salaryLevels: {
          orderBy: { level: 'asc' }
        }
      }
    });

    if (!config) {
      // 如果沒有配置，創建預設配置
      const defaultConfig = await prisma.healthInsuranceConfig.create({
        data: {
          premiumRate: 0.0517, // 5.17%
          employeeContributionRatio: 0.30, // 30%
          maxDependents: 3,
          supplementaryRate: 0.0211, // 2.11%
          supplementaryThreshold: 4, // 4倍
          effectiveDate: new Date(),
          isActive: true
        },
        include: {
          salaryLevels: true
        }
      });

      // 創建預設薪資級距
      const defaultSalaryLevels = [
        { level: 1, minSalary: 0, maxSalary: 25000, insuredAmount: 25200 },
        { level: 2, minSalary: 25001, maxSalary: 30000, insuredAmount: 30300 },
        { level: 3, minSalary: 30001, maxSalary: 36000, insuredAmount: 36300 },
        { level: 4, minSalary: 36001, maxSalary: 40000, insuredAmount: 40100 },
        { level: 5, minSalary: 40001, maxSalary: 44000, insuredAmount: 44000 },
        { level: 6, minSalary: 44001, maxSalary: 50000, insuredAmount: 50800 },
        { level: 7, minSalary: 50001, maxSalary: 55000, insuredAmount: 55800 },
        { level: 8, minSalary: 55001, maxSalary: 60000, insuredAmount: 60100 },
        { level: 9, minSalary: 60001, maxSalary: 70000, insuredAmount: 69100 },
        { level: 10, minSalary: 70001, maxSalary: 80000, insuredAmount: 78800 },
        { level: 11, minSalary: 80001, maxSalary: 90000, insuredAmount: 87600 },
        { level: 12, minSalary: 90001, maxSalary: 100000, insuredAmount: 96200 },
        { level: 13, minSalary: 100001, maxSalary: 110000, insuredAmount: 105500 },
        { level: 14, minSalary: 110001, maxSalary: 120000, insuredAmount: 115500 },
        { level: 15, minSalary: 120001, maxSalary: 999999999, insuredAmount: 182000 }
      ];

      for (const salaryLevel of defaultSalaryLevels) {
        await prisma.healthInsuranceSalaryLevel.create({
          data: {
            ...salaryLevel,
            configId: defaultConfig.id
          }
        });
      }

      // 重新取得完整資料
      const fullConfig = await prisma.healthInsuranceConfig.findUnique({
        where: { id: defaultConfig.id },
        include: {
          salaryLevels: {
            orderBy: { level: 'asc' }
          }
        }
      });

      return NextResponse.json({
        success: true,
        config: {
          id: fullConfig!.id,
          premiumRate: fullConfig!.premiumRate,
          employeeContributionRatio: fullConfig!.employeeContributionRatio,
          maxDependents: fullConfig!.maxDependents,
          supplementaryRate: fullConfig!.supplementaryRate,
          supplementaryThreshold: fullConfig!.supplementaryThreshold,
          effectiveDate: fullConfig!.effectiveDate.toISOString().split('T')[0],
          isActive: fullConfig!.isActive
        },
        salaryLevels: fullConfig!.salaryLevels.map(level => ({
          id: level.id,
          level: level.level,
          minSalary: level.minSalary,
          maxSalary: level.maxSalary,
          insuredAmount: level.insuredAmount
        }))
      });
    }

    return NextResponse.json({
      success: true,
      config: {
        id: config.id,
        premiumRate: config.premiumRate,
        employeeContributionRatio: config.employeeContributionRatio,
        maxDependents: config.maxDependents,
        supplementaryRate: config.supplementaryRate,
        supplementaryThreshold: config.supplementaryThreshold,
        effectiveDate: config.effectiveDate.toISOString().split('T')[0],
        isActive: config.isActive
      },
      salaryLevels: config.salaryLevels.map(level => ({
        id: level.id,
        level: level.level,
        minSalary: level.minSalary,
        maxSalary: level.maxSalary,
        insuredAmount: level.insuredAmount
      }))
    });

  } catch (error) {
    console.error('取得健保配置失敗:', error);
    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST - 更新健保配置設定
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/health-insurance-formula');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '健保設定操作過於頻繁，請稍後再試',
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
    if (jsonString.length > 15000) { // 健保設定可能較大，15KB限制
      return NextResponse.json(
        { error: '健保設定資料過大' },
        { status: 400 }
      );
    }
    const { config, salaryLevels } = data;

    // 驗證必填欄位
    if (!config || !config.premiumRate || !config.employeeContributionRatio || !config.effectiveDate) {
      return NextResponse.json(
        { error: '請填寫所有必填欄位' },
        { status: 400 }
      );
    }

    // 驗證費率範圍
    if (config.premiumRate < 0 || config.premiumRate > 0.1) {
      return NextResponse.json(
        { error: '健保費率必須在 0% 到 10% 之間' },
        { status: 400 }
      );
    }

    if (config.employeeContributionRatio < 0 || config.employeeContributionRatio > 1) {
      return NextResponse.json(
        { error: '員工負擔比例必須在 0% 到 100% 之間' },
        { status: 400 }
      );
    }

    // 驗證薪資級距
    if (salaryLevels && salaryLevels.length > 0) {
      // 檢查級距是否有重疊
      for (let i = 0; i < salaryLevels.length - 1; i++) {
        const current = salaryLevels[i];
        const next = salaryLevels[i + 1];
        
        if (current.maxSalary >= next.minSalary) {
          return NextResponse.json(
            { error: `級距 ${current.level} 和 ${next.level} 有重疊` },
            { status: 400 }
          );
        }
      }
    }

    // 開始交易
    const result = await prisma.$transaction(async (tx) => {
      // 如果是更新現有配置
      let savedConfig;
      if (config.id) {
        // 更新配置
        savedConfig = await tx.healthInsuranceConfig.update({
          where: { id: config.id },
          data: {
            premiumRate: config.premiumRate,
            employeeContributionRatio: config.employeeContributionRatio,
            maxDependents: config.maxDependents,
            supplementaryRate: config.supplementaryRate,
            supplementaryThreshold: config.supplementaryThreshold,
            effectiveDate: new Date(config.effectiveDate),
            isActive: config.isActive
          }
        });

        // 刪除舊的薪資級距
        await tx.healthInsuranceSalaryLevel.deleteMany({
          where: { configId: config.id }
        });
      } else {
        // 新建配置
        savedConfig = await tx.healthInsuranceConfig.create({
          data: {
            premiumRate: config.premiumRate,
            employeeContributionRatio: config.employeeContributionRatio,
            maxDependents: config.maxDependents,
            supplementaryRate: config.supplementaryRate,
            supplementaryThreshold: config.supplementaryThreshold,
            effectiveDate: new Date(config.effectiveDate),
            isActive: config.isActive
          }
        });
      }

      // 新增薪資級距
      if (salaryLevels && salaryLevels.length > 0) {
        for (const level of salaryLevels) {
          await tx.healthInsuranceSalaryLevel.create({
            data: {
              configId: savedConfig.id,
              level: level.level,
              minSalary: level.minSalary,
              maxSalary: level.maxSalary,
              insuredAmount: level.insuredAmount
            }
          });
        }
      }

      return savedConfig;
    });

    return NextResponse.json({
      success: true,
      config: {
        id: result.id,
        premiumRate: result.premiumRate,
        employeeContributionRatio: result.employeeContributionRatio,
        maxDependents: result.maxDependents,
        supplementaryRate: result.supplementaryRate,
        supplementaryThreshold: result.supplementaryThreshold,
        effectiveDate: result.effectiveDate.toISOString().split('T')[0],
        isActive: result.isActive
      }
    });

  } catch (error) {
    console.error('儲存健保配置失敗:', error);
    return NextResponse.json(
      { error: '儲存失敗，請檢查資料格式' },
      { status: 500 }
    );
  }
}
