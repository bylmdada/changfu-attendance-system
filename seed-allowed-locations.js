const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedAllowedLocations() {
  try {
    // 檢查是否已經有資料
    const count = await prisma.allowedLocation.count();
    
    if (count === 0) {
      // 創建預設的允許位置
      await prisma.allowedLocation.createMany({
        data: [
          {
            name: '總公司',
            latitude: 25.0330,
            longitude: 121.5654,
            radius: 100,
            isActive: true,
            department: null,
            workHours: '09:00-18:00'
          },
          {
            name: '分店A',
            latitude: 25.0478,
            longitude: 121.5318,
            radius: 50,
            isActive: true,
            department: null,
            workHours: '08:00-17:00'
          }
        ]
      });
      
      console.log('✅ 已創建預設的GPS允許位置');
    } else {
      console.log('ℹ️ GPS允許位置已存在，跳過種子資料創建');
    }
  } catch (error) {
    console.error('❌ 創建GPS允許位置失敗:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedAllowedLocations();
