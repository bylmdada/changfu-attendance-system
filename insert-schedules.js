const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function insertSchedules() {
  try {
    console.log('開始插入8月份班表...');
    
    // 刪除現有班表
    await prisma.schedule.deleteMany({
      where: { employeeId: 3 }
    });
    
    console.log('已刪除現有班表');
    
    // 創建新班表
    const schedules = [];
    for (let day = 1; day <= 31; day++) {
      const date = `2025-08-${day.toString().padStart(2, '0')}`;
      const dayOfWeek = new Date(2025, 7, day).getDay(); // 0=週日, 6=週六
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      schedules.push({
        employeeId: 3,
        workDate: date,
        shiftType: isWeekend ? 'B' : 'A',
        startTime: isWeekend ? '10:00' : '09:00',
        endTime: isWeekend ? '19:00' : '18:00'
      });
    }
    
    const result = await prisma.schedule.createMany({
      data: schedules
    });
    
    console.log(`✅ 成功插入 ${result.count} 筆班表記錄`);
    
    // 驗證
    const count = await prisma.schedule.count({
      where: { employeeId: 3 }
    });
    
    console.log(`驗證：員工ID=3 共有 ${count} 筆班表`);
    
    // 顯示前5筆
    const samples = await prisma.schedule.findMany({
      where: { employeeId: 3 },
      take: 5,
      orderBy: { workDate: 'asc' }
    });
    
    console.log('前5筆班表:');
    samples.forEach(s => {
      console.log(`  ${s.workDate}: ${s.shiftType} (${s.startTime}-${s.endTime})`);
    });
    
  } catch (error) {
    console.error('插入失敗:', error);
  } finally {
    await prisma.$disconnect();
  }
}

insertSchedules();
