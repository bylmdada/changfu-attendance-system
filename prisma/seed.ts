import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 建立測試管理員
  const adminEmployee = await prisma.employee.create({
    data: {
      employeeId: 'EMP001',
      name: '測試管理員',
      birthday: new Date('1990-01-01'),
      phone: '0912345678',
      address: '台北市信義區',
      emergencyContact: '緊急聯絡人',
      emergencyPhone: '0987654321',
      hireDate: new Date('2020-01-01'),
      baseSalary: 50000,
      hourlyRate: 300,
      department: '管理部',
      position: '系統管理員'
    }
  });

  // 建立測試員工
  const employee = await prisma.employee.create({
    data: {
      employeeId: 'EMP002',
      name: '測試員工',
      birthday: new Date('1992-05-15'),
      phone: '0923456789',
      address: '台北市大安區',
      emergencyContact: '家人',
      emergencyPhone: '0956789012',
      hireDate: new Date('2021-03-01'),
      baseSalary: 40000,
      hourlyRate: 250,
      department: '業務部',
      position: '業務專員'
    }
  });

  // 建立管理員帳號
  const adminPassword = await bcrypt.hash('admin123', 12);
  await prisma.user.create({
    data: {
      employeeId: adminEmployee.id,
      username: 'admin',
      passwordHash: adminPassword,
      role: 'ADMIN'
    }
  });

  // 建立員工帳號
  const employeePassword = await bcrypt.hash('emp123', 12);
  await prisma.user.create({
    data: {
      employeeId: employee.id,
      username: 'employee',
      passwordHash: employeePassword,
      role: 'EMPLOYEE'
    }
  });

  console.log('✅ 種子資料建立完成');
  console.log('📋 測試帳號：');
  console.log('   管理員: admin / admin123');
  console.log('   員工: employee / emp123');
}

main()
  .catch((e) => {
    console.error('❌ 種子資料建立失敗:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
