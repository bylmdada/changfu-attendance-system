import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedPayrollItemConfigs() {
  console.log('開始初始化薪資項目配置...');

  const configs = [
    // 薪資項目
    { code: 'BASE_SALARY', name: '基本薪資', type: 'EARNING', category: 'SALARY', sortOrder: 1 },
    { code: 'OVERTIME_PAY', name: '加班費', type: 'EARNING', category: 'SALARY', sortOrder: 2 },
    { code: 'YEAR_END_BONUS', name: '年終獎金', type: 'EARNING', category: 'ALLOWANCE', sortOrder: 3 },
    { code: 'FESTIVAL_BONUS', name: '三節獎金', type: 'EARNING', category: 'ALLOWANCE', sortOrder: 4 },
    { code: 'PERFORMANCE_BONUS', name: '績效獎金', type: 'EARNING', category: 'ALLOWANCE', sortOrder: 5 },
    { code: 'TRANSPORT_ALLOWANCE', name: '交通津貼', type: 'EARNING', category: 'ALLOWANCE', sortOrder: 6 },
    { code: 'MEAL_ALLOWANCE', name: '餐費津貼', type: 'EARNING', category: 'ALLOWANCE', sortOrder: 7 },

    // 扣除項目
    { code: 'LABOR_INSURANCE', name: '勞工保險', type: 'DEDUCTION', category: 'INSURANCE', sortOrder: 1 },
    { code: 'HEALTH_INSURANCE', name: '健康保險', type: 'DEDUCTION', category: 'INSURANCE', sortOrder: 2 },
    { code: 'SUPPLEMENTARY_INSURANCE', name: '補充保費', type: 'DEDUCTION', category: 'INSURANCE', sortOrder: 3 },
    { code: 'LABOR_PENSION', name: '勞工退休金', type: 'DEDUCTION', category: 'PENSION', sortOrder: 4 },
    { code: 'INCOME_TAX', name: '所得稅', type: 'DEDUCTION', category: 'TAX', sortOrder: 5 },
    { code: 'ADVANCE_PAYMENT', name: '預支款', type: 'DEDUCTION', category: 'DEDUCTION', sortOrder: 6 },
  ];

  for (const config of configs) {
    try {
      const existing = await prisma.payrollItemConfig.findUnique({
        where: { code: config.code }
      });

      if (!existing) {
        await prisma.payrollItemConfig.create({
          data: config
        });
        console.log(`✅ 創建薪資項目配置: ${config.name}`);
      } else {
        console.log(`⏭️ 薪資項目配置已存在: ${config.name}`);
      }
    } catch (error) {
      console.error(`❌ 創建薪資項目配置失敗: ${config.name}`, error);
    }
  }

  console.log('薪資項目配置初始化完成！');
}

seedPayrollItemConfigs()
  .catch((e) => {
    console.error('初始化失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
