import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { prisma } from '@/lib/database';
import bcrypt from 'bcryptjs';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const position = searchParams.get('position') || '';
    const status = searchParams.get('status') || '';

    const skip = (page - 1) * limit;
    
    const where: {
      OR?: Array<{
        name?: { contains: string };
        employeeId?: { contains: string };
        department?: { contains: string };
        position?: { contains: string };
      }>;
      department?: string;
      position?: string;
      isActive?: boolean;
    } = {};
    
    // 搜尋條件
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { employeeId: { contains: search } },
        { department: { contains: search } },
        { position: { contains: search } }
      ];
    }
    
    // 部門篩選條件
    if (department) {
      where.department = department;
    }

    // 職位篩選條件
    if (position) {
      where.position = position;
    }

    // 狀態篩選條件
    if (status) {
      where.isActive = status === 'active';
    }

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              role: true,
              isActive: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.employee.count({ where })
    ]);

    return NextResponse.json({
      employees,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('獲取員工列表錯誤:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF token validation failed' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const {
      employeeId,
      name,
      birthday,
      phone,
      address,
      emergencyContact,
      emergencyPhone,
      hireDate,
      baseSalary,
      hourlyRate,
      department,
      position,
      username,
      password,
      createAccount
    } = data;
    
    // 檢查員工編號是否已存在
    const existingEmployee = await prisma.employee.findUnique({
      where: { employeeId }
    });
    
    if (existingEmployee) {
      return NextResponse.json({ error: '員工編號已存在' }, { status: 400 });
    }

    // 如果要創建帳號，檢查用戶名是否已存在
    if (createAccount && username) {
      const existingUser = await prisma.user.findUnique({
        where: { username }
      });
      
      if (existingUser) {
        return NextResponse.json({ error: '用戶名已存在' }, { status: 400 });
      }
    }

    // 開始事務處理
    const result = await prisma.$transaction(async (tx) => {
      // 建立員工記錄
      const employee = await tx.employee.create({
        data: {
          employeeId,
          name,
          birthday: new Date(birthday),
          phone,
          address,
          emergencyContact,
          emergencyPhone,
          hireDate: new Date(hireDate),
          baseSalary: parseFloat(baseSalary),
          hourlyRate: parseFloat(hourlyRate),
          department,
          position
        }
      });

      // 如果需要創建帳號
      if (createAccount && username && password) {
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        await tx.user.create({
          data: {
            username,
            passwordHash: hashedPassword,
            role: 'EMPLOYEE',
            employeeId: employee.id,
            isActive: true
          }
        });
      }

      return employee;
    });

    console.log('✅ 員工創建成功:', result);
    return NextResponse.json({ 
      message: '員工已新增',
      employee: result
    }, { status: 201 });

  } catch (error) {
    console.error('💥 新增員工失敗:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '系統錯誤' 
    }, { status: 500 });
  }
}
