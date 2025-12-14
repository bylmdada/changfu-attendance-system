import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedBonusConfigurations() {
  console.log('開始初始化獎金配置...');

  const bonusConfigs = [
    {
      bonusType: 'YEAR_END',
      bonusTypeName: '年終獎金',
      description: '每年年底發放的年終獎金，到職未滿一年按比例發放',
      isActive: true,
      defaultAmount: 0,
      calculationFormula: 'base_salary * service_months / 12',
      eligibilityRules: {
        minimumServiceMonths: 3, // 最少服務3個月才能領取年終獎金
        mustBeActive: true,
        proRatedForPartialYear: true,
        proRatedCalculation: 'service_months_in_year' // 按年度服務月數比例計算
      },
      paymentSchedule: {
        paymentMonth: 12,
        paymentDay: 25,
        advancePaymentAllowed: false,
        cutoffDate: '12-31' // 以12月31日為基準計算服務期間
      }
    },
    {
      bonusType: 'FESTIVAL',
      bonusTypeName: '三節獎金',
      description: '春節、端午節、中秋節發放的節慶獎金，到職未滿指定期間按比例發放',
      isActive: true,
      defaultAmount: 5000,
      calculationFormula: 'fixed_amount * service_ratio',
      eligibilityRules: {
        minimumServiceMonths: 1, // 最少服務1個月才能領取三節獎金
        mustBeActive: true,
        proRatedForPartialYear: true,
        proRatedCalculation: 'service_months_before_festival', // 按節日前服務月數比例計算
        proRatedThreshold: 12 // 服務滿12個月後不再按比例計算
      },
      paymentSchedule: {
        festivals: [
          { name: 'spring_festival', month: 1, description: '春節獎金' },
          { name: 'dragon_boat', month: 6, description: '端午節獎金' },
          { name: 'mid_autumn', month: 9, description: '中秋節獎金' }
        ],
        paymentDaysBefore: 3
      }
    },
    {
      bonusType: 'PERFORMANCE',
      bonusTypeName: '績效獎金',
      description: '根據個人或團隊績效發放的獎金',
      isActive: true,
      defaultAmount: 0,
      calculationFormula: 'performance_rating * base_amount',
      eligibilityRules: {
        minimumServiceMonths: 3,
        mustBeActive: true,
        performanceRating: 'satisfactory_or_above'
      },
      paymentSchedule: {
        frequency: 'quarterly',
        paymentDay: 15
      }
    }
  ];

  for (const config of bonusConfigs) {
    try {
      const existing = await prisma.bonusConfiguration.findUnique({
        where: { bonusType: config.bonusType }
      });

      if (!existing) {
        await prisma.bonusConfiguration.create({
          data: {
            ...config,
            eligibilityRules: config.eligibilityRules,
            paymentSchedule: config.paymentSchedule
          }
        });
        console.log(`✅ 創建獎金配置: ${config.bonusTypeName}`);
      } else {
        console.log(`⏭️ 獎金配置已存在: ${config.bonusTypeName}`);
      }
    } catch (error) {
      console.error(`❌ 創建獎金配置失敗: ${config.bonusTypeName}`, error);
    }
  }

  console.log('獎金配置初始化完成！');
}

async function seedHealthInsuranceConfig() {
  console.log('開始初始化健保費配置...');

  try {
    const existingConfig = await prisma.healthInsuranceConfig.findFirst({
      where: { isActive: true }
    });

    if (!existingConfig) {
      // 創建健保費配置
      const healthConfig = await prisma.healthInsuranceConfig.create({
        data: {
          premiumRate: 0.0517,
          employeeContributionRatio: 0.30,
          maxDependents: 3,
          supplementaryRate: 0.0211, // 更新為2024年費率
          supplementaryThreshold: 744000, // 186000 * 4
          effectiveDate: new Date('2024-01-01'),
          isActive: true
        }
      });

      console.log(`✅ 創建健保費配置 (ID: ${healthConfig.id})`);

      // 創建健保投保金額分級表
      const salaryLevels = [
        { minSalary: 0, maxSalary: 25000, insuredAmount: 25200, level: 1 },
        { minSalary: 25001, maxSalary: 26400, insuredAmount: 26400, level: 2 },
        { minSalary: 26401, maxSalary: 27600, insuredAmount: 27600, level: 3 },
        { minSalary: 27601, maxSalary: 28800, insuredAmount: 28800, level: 4 },
        { minSalary: 28801, maxSalary: 30300, insuredAmount: 30300, level: 5 },
        { minSalary: 30301, maxSalary: 31800, insuredAmount: 31800, level: 6 },
        { minSalary: 31801, maxSalary: 33300, insuredAmount: 33300, level: 7 },
        { minSalary: 33301, maxSalary: 34800, insuredAmount: 34800, level: 8 },
        { minSalary: 34801, maxSalary: 36300, insuredAmount: 36300, level: 9 },
        { minSalary: 36301, maxSalary: 38200, insuredAmount: 38200, level: 10 },
        { minSalary: 38201, maxSalary: 40100, insuredAmount: 40100, level: 11 },
        { minSalary: 40101, maxSalary: 42000, insuredAmount: 42000, level: 12 },
        { minSalary: 42001, maxSalary: 43900, insuredAmount: 43900, level: 13 },
        { minSalary: 43901, maxSalary: 45800, insuredAmount: 45800, level: 14 },
        { minSalary: 45801, maxSalary: 48200, insuredAmount: 48200, level: 15 },
        { minSalary: 48201, maxSalary: 50600, insuredAmount: 50600, level: 16 },
        { minSalary: 50601, maxSalary: 53000, insuredAmount: 53000, level: 17 },
        { minSalary: 53001, maxSalary: 55400, insuredAmount: 55400, level: 18 },
        { minSalary: 55401, maxSalary: 57800, insuredAmount: 57800, level: 19 },
        { minSalary: 57801, maxSalary: 60800, insuredAmount: 60800, level: 20 },
        { minSalary: 60801, maxSalary: 63800, insuredAmount: 63800, level: 21 },
        { minSalary: 63801, maxSalary: 66800, insuredAmount: 66800, level: 22 },
        { minSalary: 66801, maxSalary: 69800, insuredAmount: 69800, level: 23 },
        { minSalary: 69801, maxSalary: 72800, insuredAmount: 72800, level: 24 },
        { minSalary: 72801, maxSalary: 76500, insuredAmount: 76500, level: 25 },
        { minSalary: 76501, maxSalary: 80200, insuredAmount: 80200, level: 26 },
        { minSalary: 80201, maxSalary: 83900, insuredAmount: 83900, level: 27 },
        { minSalary: 83901, maxSalary: 87600, insuredAmount: 87600, level: 28 },
        { minSalary: 87601, maxSalary: 92100, insuredAmount: 92100, level: 29 },
        { minSalary: 92101, maxSalary: 96600, insuredAmount: 96600, level: 30 },
        { minSalary: 96601, maxSalary: 101100, insuredAmount: 101100, level: 31 },
        { minSalary: 101101, maxSalary: 105600, insuredAmount: 105600, level: 32 },
        { minSalary: 105601, maxSalary: 110100, insuredAmount: 110100, level: 33 },
        { minSalary: 110101, maxSalary: 115500, insuredAmount: 115500, level: 34 },
        { minSalary: 115501, maxSalary: 120900, insuredAmount: 120900, level: 35 },
        { minSalary: 120901, maxSalary: 126300, insuredAmount: 126300, level: 36 },
        { minSalary: 126301, maxSalary: 131700, insuredAmount: 131700, level: 37 },
        { minSalary: 131701, maxSalary: 137100, insuredAmount: 137100, level: 38 },
        { minSalary: 137101, maxSalary: 142500, insuredAmount: 142500, level: 39 },
        { minSalary: 142501, maxSalary: 147900, insuredAmount: 147900, level: 40 },
        { minSalary: 147901, maxSalary: 154200, insuredAmount: 154200, level: 41 },
        { minSalary: 154201, maxSalary: 160500, insuredAmount: 160500, level: 42 },
        { minSalary: 160501, maxSalary: 166800, insuredAmount: 166800, level: 43 },
        { minSalary: 166801, maxSalary: 173100, insuredAmount: 173100, level: 44 },
        { minSalary: 173101, maxSalary: 179400, insuredAmount: 179400, level: 45 },
        { minSalary: 179401, maxSalary: 186000, insuredAmount: 186000, level: 46 },
        { minSalary: 186001, maxSalary: 999999999, insuredAmount: 186000, level: 47 }
      ];

      for (const level of salaryLevels) {
        await prisma.healthInsuranceSalaryLevel.create({
          data: {
            configId: healthConfig.id,
            ...level
          }
        });
      }

      console.log(`✅ 創建健保投保金額分級表 (共${salaryLevels.length}級)`);
    } else {
      console.log('⏭️ 健保費配置已存在');
    }
  } catch (error) {
    console.error('❌ 健保費配置初始化失敗:', error);
  }

  console.log('健保費配置初始化完成！');
}

async function main() {
  try {
    await seedBonusConfigurations();
    await seedHealthInsuranceConfig();
  } catch (error) {
    console.error('初始化失敗:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
