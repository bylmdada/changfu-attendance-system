const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const workflows = [
  { workflowType: 'SHIFT_CHANGE', workflowName: '調班申請', approvalLevel: 1, requireManager: true, finalApprover: 'MANAGER', deadlineMode: 'FIXED', deadlineHours: 48 },
  { workflowType: 'SHIFT_SWAP', workflowName: '換班申請', approvalLevel: 1, requireManager: true, finalApprover: 'MANAGER', deadlineMode: 'FIXED', deadlineHours: 48 },
  { workflowType: 'MISSED_CLOCK', workflowName: '補打卡申請', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FREEZE_BASED', deadlineHours: null },
  { workflowType: 'LEAVE', workflowName: '請假申請', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FREEZE_BASED', deadlineHours: null },
  { workflowType: 'OVERTIME', workflowName: '加班申請', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FREEZE_BASED', deadlineHours: null },
  { workflowType: 'PURCHASE', workflowName: '請購申請', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FIXED', deadlineHours: 72 },
  { workflowType: 'RESIGNATION', workflowName: '離職申請', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FIXED', deadlineHours: 168 },
  { workflowType: 'PAYROLL_DISPUTE', workflowName: '薪資異議申請', approvalLevel: 2, requireManager: false, finalApprover: 'ADMIN', deadlineMode: 'FIXED', deadlineHours: 72 },
  { workflowType: 'DEPENDENT_APP', workflowName: '眷屬申請', approvalLevel: 2, requireManager: false, finalApprover: 'ADMIN', deadlineMode: 'FIXED', deadlineHours: 72 },
  { workflowType: 'ANNOUNCEMENT', workflowName: '公告發布', approvalLevel: 2, requireManager: true, finalApprover: 'ADMIN', deadlineMode: 'FIXED', deadlineHours: 72 }
];

async function seed() {
  for (const wf of workflows) {
    await prisma.approvalWorkflow.upsert({
      where: { workflowType: wf.workflowType },
      update: wf,
      create: wf
    });
  }
  
  // 建立預設凍結提醒設定
  const existing = await prisma.approvalFreezeReminder.findFirst();
  if (!existing) {
    await prisma.approvalFreezeReminder.create({
      data: { daysBeforeFreeze1: 3, daysBeforeFreeze2: 1, freezeDayReminderTime: '09:00' }
    });
  }
  
  console.log('審核流程預設設定已建立');
  await prisma.$disconnect();
}

seed();
