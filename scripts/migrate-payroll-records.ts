import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migratePayrollRecords() {
  console.log('開始遷移薪資記錄到新的靈活格式...');

  try {
    // 獲取所有薪資記錄
    const payrollRecords = await prisma.payrollRecord.findMany({
      include: { employee: true }
    });

    console.log(`找到 ${payrollRecords.length} 筆薪資記錄需要遷移`);

    // 獲取薪資項目配置
    const configs = await prisma.payrollItemConfig.findMany();
    const configMap = new Map(configs.map(c => [c.code, c]));

    for (const record of payrollRecords) {
      console.log(`遷移員工 ${record.employee.employeeId} 的 ${record.payYear}年${record.payMonth}月薪資記錄`);

      // 創建薪資項目
      const payrollItems = [];

      // 基本薪資
      if (record.basePay > 0) {
        const baseSalaryConfig = configMap.get('BASE_SALARY');
        if (baseSalaryConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: baseSalaryConfig.id,
            amount: record.basePay,
            quantity: 1,
            unitPrice: record.basePay,
            description: '基本薪資'
          });
        }
      }

      // 加班費
      if (record.overtimePay > 0) {
        const overtimeConfig = configMap.get('OVERTIME_PAY');
        if (overtimeConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: overtimeConfig.id,
            amount: record.overtimePay,
            quantity: record.overtimeHours,
            unitPrice: record.overtimeHours > 0 ? record.overtimePay / record.overtimeHours : 0,
            description: `加班費 (${record.overtimeHours}小時)`
          });
        }
      }

      // 勞工保險
      if (record.laborInsurance > 0) {
        const laborInsuranceConfig = configMap.get('LABOR_INSURANCE');
        if (laborInsuranceConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: laborInsuranceConfig.id,
            amount: record.laborInsurance,
            quantity: 1,
            unitPrice: record.laborInsurance,
            description: '勞工保險費'
          });
        }
      }

      // 健康保險
      if (record.healthInsurance > 0) {
        const healthInsuranceConfig = configMap.get('HEALTH_INSURANCE');
        if (healthInsuranceConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: healthInsuranceConfig.id,
            amount: record.healthInsurance,
            quantity: 1,
            unitPrice: record.healthInsurance,
            description: '健康保險費'
          });
        }
      }

      // 補充保費
      if (record.supplementaryInsurance > 0) {
        const supplementaryConfig = configMap.get('SUPPLEMENTARY_INSURANCE');
        if (supplementaryConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: supplementaryConfig.id,
            amount: record.supplementaryInsurance,
            quantity: 1,
            unitPrice: record.supplementaryInsurance,
            description: '補充保費'
          });
        }
      }

      // 所得稅
      if (record.incomeTax > 0) {
        const incomeTaxConfig = configMap.get('INCOME_TAX');
        if (incomeTaxConfig) {
          payrollItems.push({
            payrollId: record.id,
            itemConfigId: incomeTaxConfig.id,
            amount: record.incomeTax,
            quantity: 1,
            unitPrice: record.incomeTax,
            description: '所得稅'
          });
        }
      }

      // 批量創建薪資項目
      if (payrollItems.length > 0) {
        await prisma.payrollItem.createMany({
          data: payrollItems
        });
        console.log(`✅ 為薪資記錄 ${record.id} 創建了 ${payrollItems.length} 個薪資項目`);
      }
    }

    console.log('薪資記錄遷移完成！');
  } catch (error) {
    console.error('遷移失敗:', error);
    throw error;
  }
}

migratePayrollRecords()
  .catch((e) => {
    console.error('遷移腳本執行失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
