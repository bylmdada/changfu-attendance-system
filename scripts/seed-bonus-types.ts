/**
 * 預設獎金類型 Seed 腳本
 * 
 * 執行方式：npx ts-node scripts/seed-bonus-types.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_BONUS_TYPES = [
  // 主要獎金
  {
    bonusType: 'YEAR_END',
    bonusTypeName: '年終獎金',
    description: '依年資按比例發放的年終獎金',
    isActive: true,
    defaultAmount: null,
    calculationFormula: 'baseSalary * serviceMonths / 12',
    eligibilityRules: JSON.stringify({ minServiceMonths: 3 }),
    paymentSchedule: JSON.stringify({ month: 1, description: '農曆年前發放' })
  },
  {
    bonusType: 'SPRING_FESTIVAL',
    bonusTypeName: '春節獎金',
    description: '農曆新年三節禮金',
    isActive: true,
    defaultAmount: 2000,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ minServiceMonths: 3 }),
    paymentSchedule: JSON.stringify({ month: 1, description: '農曆年前發放' })
  },
  {
    bonusType: 'DRAGON_BOAT',
    bonusTypeName: '端午獎金',
    description: '端午節三節禮金',
    isActive: true,
    defaultAmount: 2000,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ minServiceMonths: 3 }),
    paymentSchedule: JSON.stringify({ month: 6, description: '端午節前發放' })
  },
  {
    bonusType: 'MID_AUTUMN',
    bonusTypeName: '中秋獎金',
    description: '中秋節三節禮金',
    isActive: true,
    defaultAmount: 2000,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ minServiceMonths: 3 }),
    paymentSchedule: JSON.stringify({ month: 9, description: '中秋節前發放' })
  },
  {
    bonusType: 'PERFECT_ATTENDANCE',
    bonusTypeName: '全勤獎金',
    description: '當月無缺勤發放（僅日照中心適用）',
    isActive: true,
    defaultAmount: 2000,
    calculationFormula: 'amount * attendanceRatio',
    eligibilityRules: JSON.stringify({ departments: ['日照中心'] }),
    paymentSchedule: JSON.stringify({ frequency: 'monthly', description: '每月隨薪資發放' })
  },
  {
    bonusType: 'PERFORMANCE',
    bonusTypeName: '績效獎金',
    description: '依考核成績發放的績效獎金',
    isActive: true,
    defaultAmount: null,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ minServiceMonths: 6 }),
    paymentSchedule: JSON.stringify({ frequency: 'quarterly', description: '季度或年度發放' })
  },
  // 激勵/特殊獎金
  {
    bonusType: 'SENIORITY',
    bonusTypeName: '資深獎金',
    description: '依年資發放的獎金',
    isActive: false,
    defaultAmount: null,
    calculationFormula: 'yearsOfService * 1000',
    eligibilityRules: JSON.stringify({ minYearsOfService: 1 }),
    paymentSchedule: JSON.stringify({ frequency: 'yearly', description: '每年發放' })
  },
  {
    bonusType: 'BIRTHDAY',
    bonusTypeName: '生日禮金',
    description: '員工生日當月發放',
    isActive: false,
    defaultAmount: 1000,
    calculationFormula: null,
    eligibilityRules: undefined,
    paymentSchedule: JSON.stringify({ frequency: 'birthday', description: '生日當月發放' })
  },
  {
    bonusType: 'MARRIAGE',
    bonusTypeName: '結婚禮金',
    description: '員工結婚時發放',
    isActive: false,
    defaultAmount: 6000,
    calculationFormula: null,
    eligibilityRules: undefined,
    paymentSchedule: undefined
  },
  {
    bonusType: 'CHILDBIRTH',
    bonusTypeName: '生育禮金',
    description: '員工生育時發放',
    isActive: false,
    defaultAmount: 6000,
    calculationFormula: null,
    eligibilityRules: undefined,
    paymentSchedule: undefined
  },
  // 津貼類
  {
    bonusType: 'MEAL',
    bonusTypeName: '伙食津貼',
    description: '每月伙食補助',
    isActive: false,
    defaultAmount: 2400,
    calculationFormula: null,
    eligibilityRules: undefined,
    paymentSchedule: JSON.stringify({ frequency: 'monthly', description: '每月隨薪資發放' })
  },
  {
    bonusType: 'TRANSPORT',
    bonusTypeName: '交通津貼',
    description: '通勤交通補助',
    isActive: false,
    defaultAmount: 1500,
    calculationFormula: null,
    eligibilityRules: undefined,
    paymentSchedule: JSON.stringify({ frequency: 'monthly', description: '每月隨薪資發放' })
  },
  {
    bonusType: 'PROFESSIONAL',
    bonusTypeName: '專業加給',
    description: '專業證照或技術加給',
    isActive: false,
    defaultAmount: null,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ requiresCertification: true }),
    paymentSchedule: JSON.stringify({ frequency: 'monthly', description: '每月隨薪資發放' })
  },
  {
    bonusType: 'SHIFT',
    bonusTypeName: '輪班加給',
    description: '夜班或假日班津貼',
    isActive: false,
    defaultAmount: null,
    calculationFormula: null,
    eligibilityRules: JSON.stringify({ requiresShiftWork: true }),
    paymentSchedule: JSON.stringify({ frequency: 'monthly', description: '每月隨薪資發放' })
  }
];

async function main() {
  console.log('🚀 開始建立預設獎金類型...\n');

  let created = 0;
  let skipped = 0;

  for (const bonusType of DEFAULT_BONUS_TYPES) {
    // 檢查是否已存在
    const existing = await prisma.bonusConfiguration.findFirst({
      where: { bonusType: bonusType.bonusType }
    });

    if (existing) {
      console.log(`⏭️  跳過: ${bonusType.bonusTypeName} (已存在)`);
      skipped++;
      continue;
    }

    // 建立獎金類型
    await prisma.bonusConfiguration.create({
      data: bonusType
    });

    console.log(`✅ 建立: ${bonusType.bonusTypeName}`);
    created++;
  }

  console.log(`\n📊 完成！建立 ${created} 個，跳過 ${skipped} 個`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
