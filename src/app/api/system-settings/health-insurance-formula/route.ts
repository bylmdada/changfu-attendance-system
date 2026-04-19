import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import {
  normalizeSupplementaryPremiumSettings,
  SUPPLEMENTARY_PREMIUM_SETTINGS_KEY,
} from '@/lib/supplementary-premium-config';
import { getStoredSupplementaryPremiumSettings } from '@/lib/supplementary-premium-settings';
import { safeParseJSON } from '@/lib/validation';

const DEFAULT_HEALTH_INSURANCE_CONFIG = {
  id: 0,
  premiumRate: 0.0517,
  employeeContributionRatio: 0.30,
  maxDependents: 3,
  supplementaryRate: 0.0211,
  supplementaryThreshold: 4,
  isActive: true
};

const DEFAULT_HEALTH_INSURANCE_SALARY_LEVELS = [
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSalaryLevelEntry(value: unknown) {
  if (!isPlainObject(value)) {
    return { success: false as const, error: '薪資級距資料格式無效' };
  }

  const { level, minSalary, maxSalary, insuredAmount } = value;

  if (
    typeof level !== 'number' || !Number.isInteger(level) || level < 1 ||
    typeof minSalary !== 'number' || !Number.isFinite(minSalary) || minSalary < 0 ||
    typeof maxSalary !== 'number' || !Number.isFinite(maxSalary) || maxSalary < minSalary ||
    typeof insuredAmount !== 'number' || !Number.isFinite(insuredAmount) || insuredAmount < 0
  ) {
    return { success: false as const, error: '薪資級距資料格式無效' };
  }

  return {
    success: true as const,
    value: {
      level,
      minSalary,
      maxSalary,
      insuredAmount,
    },
  };
}

function parseEffectiveDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return parsedDate;
}

// 驗證 admin 權限
async function verifyAdmin(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    return user?.role === 'ADMIN' ? user : null;
  } catch {
    return null;
  }
}

// GET - 取得健保配置設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const supplementarySettings = await getStoredSupplementaryPremiumSettings();

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
      // 尚未初始化時直接回傳預設值，避免 GET 產生 hidden write 與首讀競態
      return NextResponse.json({
        success: true,
        config: {
          ...DEFAULT_HEALTH_INSURANCE_CONFIG,
          supplementaryRate: supplementarySettings.premiumRate / 100,
          supplementaryThreshold: supplementarySettings.exemptThresholdMultiplier,
          effectiveDate: new Date().toISOString().split('T')[0]
        },
        salaryLevels: DEFAULT_HEALTH_INSURANCE_SALARY_LEVELS.map(level => ({
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
        supplementaryRate: supplementarySettings.premiumRate / 100,
        supplementaryThreshold: supplementarySettings.exemptThresholdMultiplier,
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '請提供有效的設定資料' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    if (!isPlainObject(data)) {
      return NextResponse.json(
        { error: '請提供有效的設定資料' },
        { status: 400 }
      );
    }
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify(data);
    if (jsonString.length > 15000) { // 健保設定可能較大，15KB限制
      return NextResponse.json(
        { error: '健保設定資料過大' },
        { status: 400 }
      );
    }
    const { config, salaryLevels } = data as {
      config?: {
        id?: number;
        premiumRate?: number;
        employeeContributionRatio?: number;
        maxDependents?: number;
        supplementaryRate?: number;
        supplementaryThreshold?: number;
        effectiveDate?: string;
        isActive?: boolean;
      };
      salaryLevels?: Array<{
        level: number;
        minSalary: number;
        maxSalary: number;
        insuredAmount: number;
      }>;
    };

    const normalizedConfig = config ? {
      id: typeof config.id === 'number' ? config.id : null,
      premiumRate: typeof config.premiumRate === 'number' ? config.premiumRate : null,
      employeeContributionRatio: typeof config.employeeContributionRatio === 'number' ? config.employeeContributionRatio : null,
      maxDependents: typeof config.maxDependents === 'number' ? config.maxDependents : DEFAULT_HEALTH_INSURANCE_CONFIG.maxDependents,
      supplementaryRate: typeof config.supplementaryRate === 'number' ? config.supplementaryRate : DEFAULT_HEALTH_INSURANCE_CONFIG.supplementaryRate,
      supplementaryThreshold: typeof config.supplementaryThreshold === 'number' ? config.supplementaryThreshold : DEFAULT_HEALTH_INSURANCE_CONFIG.supplementaryThreshold,
      effectiveDate: typeof config.effectiveDate === 'string' ? config.effectiveDate : '',
      isActive: typeof config.isActive === 'boolean' ? config.isActive : true,
    } : null;

    if (salaryLevels !== undefined && !Array.isArray(salaryLevels)) {
      return NextResponse.json(
        { error: '薪資級距資料格式無效' },
        { status: 400 }
      );
    }

    const normalizedSalaryLevels = Array.isArray(salaryLevels)
      ? salaryLevels.map((level) => parseSalaryLevelEntry(level))
      : [];

    const validatedSalaryLevels: Array<{
      level: number;
      minSalary: number;
      maxSalary: number;
      insuredAmount: number;
    }> = [];

    for (const result of normalizedSalaryLevels) {
      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      validatedSalaryLevels.push(result.value);
    }

    // 驗證必填欄位
    if (!normalizedConfig || normalizedConfig.premiumRate === null || normalizedConfig.employeeContributionRatio === null || !normalizedConfig.effectiveDate) {
      return NextResponse.json(
        { error: '請填寫所有必填欄位' },
        { status: 400 }
      );
    }

    // 驗證費率範圍
    if (normalizedConfig.premiumRate < 0 || normalizedConfig.premiumRate > 0.1) {
      return NextResponse.json(
        { error: '健保費率必須在 0% 到 10% 之間' },
        { status: 400 }
      );
    }

    if (normalizedConfig.employeeContributionRatio < 0 || normalizedConfig.employeeContributionRatio > 1) {
      return NextResponse.json(
        { error: '員工負擔比例必須在 0% 到 100% 之間' },
        { status: 400 }
      );
    }

    if (!Number.isInteger(normalizedConfig.maxDependents) || normalizedConfig.maxDependents < 0) {
      return NextResponse.json(
        { error: '最大眷屬人數必須為 0 以上整數' },
        { status: 400 }
      );
    }

    if (normalizedConfig.supplementaryRate < 0 || normalizedConfig.supplementaryRate > 0.1) {
      return NextResponse.json(
        { error: '補充保費費率必須在 0% 到 10% 之間' },
        { status: 400 }
      );
    }

    if (normalizedConfig.supplementaryThreshold <= 0) {
      return NextResponse.json(
        { error: '補充保費免扣門檻倍數必須大於 0' },
        { status: 400 }
      );
    }

    const parsedEffectiveDate = parseEffectiveDate(normalizedConfig.effectiveDate);
    if (!parsedEffectiveDate) {
      return NextResponse.json(
        { error: '生效日期格式無效' },
        { status: 400 }
      );
    }

    const validatedConfig = {
      id: normalizedConfig.id,
      premiumRate: normalizedConfig.premiumRate,
      employeeContributionRatio: normalizedConfig.employeeContributionRatio,
      maxDependents: normalizedConfig.maxDependents,
      supplementaryRate: normalizedConfig.supplementaryRate,
      supplementaryThreshold: normalizedConfig.supplementaryThreshold,
      effectiveDate: normalizedConfig.effectiveDate,
      isActive: normalizedConfig.isActive,
    };
    const storedSupplementarySettings = await getStoredSupplementaryPremiumSettings();
    const syncedSupplementarySettings = normalizeSupplementaryPremiumSettings({
      ...storedSupplementarySettings,
      premiumRate: validatedConfig.supplementaryRate * 100,
      exemptThresholdMultiplier: validatedConfig.supplementaryThreshold,
    });

    // 驗證薪資級距
    if (validatedSalaryLevels.length > 0) {
      // 檢查級距是否有重疊
      for (let i = 0; i < validatedSalaryLevels.length - 1; i++) {
        const current = validatedSalaryLevels[i];
        const next = validatedSalaryLevels[i + 1];
        
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
      if (validatedConfig.id !== null) {
        // 更新配置
        savedConfig = await tx.healthInsuranceConfig.update({
          where: { id: validatedConfig.id },
          data: {
            premiumRate: validatedConfig.premiumRate,
            employeeContributionRatio: validatedConfig.employeeContributionRatio,
            maxDependents: validatedConfig.maxDependents,
            supplementaryRate: validatedConfig.supplementaryRate,
            supplementaryThreshold: validatedConfig.supplementaryThreshold,
            effectiveDate: parsedEffectiveDate,
            isActive: validatedConfig.isActive
          }
        });

        // 刪除舊的薪資級距
        await tx.healthInsuranceSalaryLevel.deleteMany({
          where: { configId: validatedConfig.id }
        });
      } else {
        // 新建配置
        savedConfig = await tx.healthInsuranceConfig.create({
          data: {
            premiumRate: validatedConfig.premiumRate,
            employeeContributionRatio: validatedConfig.employeeContributionRatio,
            maxDependents: validatedConfig.maxDependents,
            supplementaryRate: validatedConfig.supplementaryRate,
            supplementaryThreshold: validatedConfig.supplementaryThreshold,
            effectiveDate: parsedEffectiveDate,
            isActive: validatedConfig.isActive
          }
        });
      }

      // 新增薪資級距
      if (validatedSalaryLevels.length > 0) {
        for (const level of validatedSalaryLevels) {
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

      const systemSettingsModel = (tx as typeof tx & {
        systemSettings?: {
          upsert: (args: {
            where: { key: string };
            update: { value: string };
            create: { key: string; value: string; category: string; description: string };
          }) => Promise<unknown>;
        };
      }).systemSettings;

      if (systemSettingsModel?.upsert) {
        await systemSettingsModel.upsert({
          where: { key: SUPPLEMENTARY_PREMIUM_SETTINGS_KEY },
          update: {
            value: JSON.stringify(syncedSupplementarySettings),
          },
          create: {
            key: SUPPLEMENTARY_PREMIUM_SETTINGS_KEY,
            value: JSON.stringify(syncedSupplementarySettings),
            category: 'insurance',
            description: '補充保費計算設定',
          },
        });
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
        supplementaryRate: syncedSupplementarySettings.premiumRate / 100,
        supplementaryThreshold: syncedSupplementarySettings.exemptThresholdMultiplier,
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
