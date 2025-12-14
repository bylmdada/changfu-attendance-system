import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting - this is a sensitive setup operation
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    // Admin authorization required for setup operations
    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required for setup operations' }, { status: 403 });
    }

    // 檢查是否已存在員工用戶
    const existingEmployee = await prisma.user.findUnique({
      where: { username: 'employee' }
    });

    if (existingEmployee) {
      return NextResponse.json({ 
        message: '員工測試帳號已存在', 
        success: true 
      });
    }

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

    return NextResponse.json({ 
      message: '員工測試帳號建立成功', 
      success: true,
      testAccount: {
        username: 'employee',
        password: 'emp123'
      }
    });
  } catch (error) {
    console.error('建立員工帳號失敗:', error);
    return NextResponse.json({ 
      error: '建立員工帳號失敗', 
      details: error instanceof Error ? error.message : '未知錯誤'
    }, { status: 500 });
  }
}
