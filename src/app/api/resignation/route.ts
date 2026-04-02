/**
 * 離職申請 API
 * GET: 取得離職申請列表（管理員看全部，員工看自己）
 * POST: 提交離職申請
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 預設交接項目
const DEFAULT_HANDOVER_ITEMS = [
  // 設備類
  { category: 'EQUIPMENT', description: '公司電腦（筆電/桌機）' },
  { category: 'EQUIPMENT', description: '門禁卡/識別證' },
  { category: 'EQUIPMENT', description: '辦公室/抽屜鑰匙' },
  // 資料類
  { category: 'DATA', description: '工作文件/專案資料移交' },
  { category: 'DATA', description: '客戶聯絡資訊移交' },
  { category: 'DATA', description: '電子郵件設定自動轉寄' },
  // 權限類
  { category: 'PERMISSION', description: '停用系統帳號' },
  { category: 'PERMISSION', description: '停用公司郵件' },
  { category: 'PERMISSION', description: '撤銷 VPN/遠端存取權限' },
  // 文件類
  { category: 'DOCUMENT', description: '開立離職證明' },
  { category: 'DOCUMENT', description: '結算剩餘薪資/加班費' },
  { category: 'DOCUMENT', description: '辦理勞健保轉出' },
];

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const year = searchParams.get('year');

    // 建立查詢條件
    const where: Record<string, unknown> = {};

    // 員工只能看自己的申請
    if (user.role !== 'ADMIN' && user.role !== 'HR') {
      where.employeeId = user.employeeId;
    }

    if (status) {
      where.status = status;
    }

    if (year) {
      const yearInt = parseInt(year);
      where.applicationDate = {
        gte: new Date(`${yearInt}-01-01`),
        lt: new Date(`${yearInt + 1}-01-01`)
      };
    }

    const records = await prisma.resignationRecord.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true,
            position: true
          }
        },
        handoverItems: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json({
      success: true,
      records,
      count: records.length
    });

  } catch (error) {
    console.error('取得離職申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // 速率限制
    const rateLimitResult = await checkRateLimit(request, '/api/resignation');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429 }
      );
    }

    // CSRF 驗證
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const data = await request.json();
    const { expectedDate, reason, reasonType, notes } = data;

    // 驗證必填欄位
    if (!expectedDate || !reason) {
      return NextResponse.json({ error: '請填寫預計離職日和離職原因' }, { status: 400 });
    }

    // 檢查是否已有進行中的離職申請
    const existing = await prisma.resignationRecord.findFirst({
      where: {
        employeeId: user.employeeId,
        status: { in: ['PENDING', 'APPROVED', 'IN_HANDOVER'] }
      }
    });

    if (existing) {
      return NextResponse.json({ error: '您已有進行中的離職申請' }, { status: 400 });
    }

    // 建立離職申請（含預設交接項目）
    const record = await prisma.resignationRecord.create({
      data: {
        employeeId: user.employeeId,
        expectedDate: new Date(expectedDate),
        reason,
        reasonType: reasonType || 'VOLUNTARY',
        notes,
        handoverItems: {
          create: DEFAULT_HANDOVER_ITEMS.map(item => ({
            category: item.category,
            description: item.description
          }))
        }
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            name: true,
            department: true
          }
        },
        handoverItems: true
      }
    });

    return NextResponse.json({
      success: true,
      record,
      message: '離職申請已提交'
    });

  } catch (error) {
    console.error('提交離職申請失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
