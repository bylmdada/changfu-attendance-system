import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// 定義薪條範本類型
interface PayslipTemplate {
  id?: number;
  name: string;
  fields: unknown[];
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// 驗證 admin 權限
async function verifyAdmin(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        employee: true
      }
    });

    return user?.role === 'ADMIN' ? user : null;
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// 取得預設薪資條設定
function getDefaultPayslipSettings() {
  return {
    autoGeneration: {
      enabled: false,
      scheduleDay: 25,
      scheduleTime: '17:00'
    },
    distribution: {
      method: 'email',
      emailSubject: '薪資條 - {{month}}月份',
      emailTemplate: '親愛的 {{employeeName}}，\n\n請查收您的 {{month}} 月份薪資條。\n\n謝謝！'
    },
    retention: {
      keepMonths: 36,
      archiveAfterMonths: 12
    },
    security: {
      passwordProtected: true,
      requireEmployeeConsent: false
    }
  };
}

// 取得預設薪資條範本
function getDefaultPayslipTemplate() {
  return {
    name: '標準薪資條範本',
    description: '標準格式薪資條',
    isDefault: true,
    isActive: true,
    headerConfig: {
      companyName: '長富股份有限公司',
      companyAddress: '台北市信義區信義路五段7號',
      showLogo: true,
      logoPosition: 'left'
    },
    employeeSection: {
      showEmployeeId: true,
      showDepartment: true,
      showPosition: true,
      showHireDate: true,
      showBankAccount: false
    },
    earningsSection: {
      items: [
        { id: 'base_salary', label: '基本薪資', code: 'BASE_SALARY', type: 'earning', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 1 },
        { id: 'overtime_pay', label: '加班費', code: 'OVERTIME_PAY', type: 'earning', isVisible: true, showAmount: true, showQuantity: true, showRate: true, sortOrder: 2 },
        { id: 'bonus', label: '獎金', code: 'BONUS', type: 'earning', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 3 }
      ],
      showSubtotal: true
    },
    deductionsSection: {
      items: [
        { id: 'labor_insurance', label: '勞工保險', code: 'LABOR_INSURANCE', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 1 },
        { id: 'health_insurance', label: '健康保險', code: 'HEALTH_INSURANCE', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 2 },
        { id: 'income_tax', label: '所得稅', code: 'INCOME_TAX', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 3 }
      ],
      showSubtotal: true
    },
    summarySection: {
      showGrossPay: true,
      showTotalDeductions: true,
      showNetPay: true,
      showYtdTotals: false
    },
    footerConfig: {
      showGeneratedDate: true,
      showSignature: false,
      customText: '此薪資條僅供參考，如有疑問請洽人事部門。'
    },
    formatting: {
      fontSize: 12,
      fontFamily: 'Arial',
      pageSize: 'A4',
      orientation: 'portrait',
      margins: {
        top: 20,
        bottom: 20,
        left: 20,
        right: 20
      }
    }
  };
}

// GET - 取得薪資條設定和範本
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // 取得薪資條設定
    const settingsRecord = await prisma.systemSettings.findUnique({
      where: { key: 'payslip_settings' }
    });

    const settings = settingsRecord 
      ? JSON.parse(settingsRecord.value)
      : getDefaultPayslipSettings();

    // 取得薪資條範本
    const templatesRecord = await prisma.systemSettings.findUnique({
      where: { key: 'payslip_templates' }
    });

    let templates = [];
    if (templatesRecord) {
      templates = JSON.parse(templatesRecord.value);
    } else {
      // 創建預設範本
      const defaultTemplate = getDefaultPayslipTemplate();
      templates = [{ ...defaultTemplate, id: 1 }];
      
      await prisma.systemSettings.create({
        data: {
          key: 'payslip_templates',
          value: JSON.stringify(templates),
          description: '薪資條範本設定'
        }
      });
    }

    return NextResponse.json({
      success: true,
      templates,
      settings
    });

  } catch (error) {
    console.error('取得薪資條設定失敗:', error);
    return NextResponse.json(
      { error: '伺服器錯誤' },
      { status: 500 }
    );
  }
}

// POST - 儲存薪資條設定或範本
export async function POST(request: NextRequest) {
  try {
    // 1. 速率限制檢查
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/payslip-management');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: '薪條設定操作過於頻繁，請稍後再試',
          retryAfter: rateLimitResult.retryAfter 
        },
        { 
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter?.toString() || '60'
          }
        }
      );
    }

    // 2. CSRF保護檢查
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json(
        { error: 'CSRF驗證失敗，請重新操作' },
        { status: 403 }
      );
    }

    // 3. 管理員權限驗證
    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { type, data } = await request.json();
    
    // 4. 資料大小驗證
    const jsonString = JSON.stringify({ type, data });
    if (jsonString.length > 20000) { // 薪條範本可能較大，20KB限制
      return NextResponse.json(
        { error: '薪條設定資料過大' },
        { status: 400 }
      );
    }

    if (type === 'settings') {
      // 儲存薪資條設定
      await prisma.systemSettings.upsert({
        where: { key: 'payslip_settings' },
        update: {
          value: JSON.stringify(data),
          updatedAt: new Date()
        },
        create: {
          key: 'payslip_settings',
          value: JSON.stringify(data),
          description: '薪資條系統設定'
        }
      });

      return NextResponse.json({
        success: true,
        message: '薪資條設定已儲存'
      });

    } else if (type === 'template') {
      // 儲存薪資條範本
      const templatesRecord = await prisma.systemSettings.findUnique({
        where: { key: 'payslip_templates' }
      });

      let templates = templatesRecord ? JSON.parse(templatesRecord.value) : [];

      if (data.id) {
        // 更新現有範本
        const index = templates.findIndex((t: PayslipTemplate) => t.id === data.id);
        if (index !== -1) {
          templates[index] = data;
        }
      } else {
        // 新增範本
        const newId = Math.max(...templates.map((t: PayslipTemplate) => t.id || 0), 0) + 1;
        templates.push({ ...data, id: newId });
      }

      // 如果設為預設範本，清除其他預設設定
      if (data.isDefault) {
        templates = templates.map((t: PayslipTemplate) => ({
          ...t,
          isDefault: t.id === data.id
        }));
      }

      await prisma.systemSettings.upsert({
        where: { key: 'payslip_templates' },
        update: {
          value: JSON.stringify(templates),
          updatedAt: new Date()
        },
        create: {
          key: 'payslip_templates',
          value: JSON.stringify(templates),
          description: '薪資條範本設定'
        }
      });

      return NextResponse.json({
        success: true,
        template: data,
        message: '薪資條範本已儲存'
      });

    } else {
      return NextResponse.json(
        { error: '無效的操作類型' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('儲存薪資條設定失敗:', error);
    return NextResponse.json(
      { error: '儲存失敗，請檢查資料格式' },
      { status: 500 }
    );
  }
}

// PUT - 更新薪資條範本（切換啟用/停用狀態等）
export async function PUT(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/payslip-management');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '薪條設定操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { template } = await request.json();

    if (!template || !template.id) {
      return NextResponse.json({ error: '缺少範本資料' }, { status: 400 });
    }

    const templatesRecord = await prisma.systemSettings.findUnique({
      where: { key: 'payslip_templates' }
    });

    if (!templatesRecord) {
      return NextResponse.json({ error: '找不到薪資條範本' }, { status: 404 });
    }

    let templates = JSON.parse(templatesRecord.value);
    const index = templates.findIndex((t: PayslipTemplate) => t.id === template.id);

    if (index === -1) {
      return NextResponse.json({ error: '範本不存在' }, { status: 404 });
    }

    // 更新範本
    templates[index] = { ...templates[index], ...template };

    // 如果設為預設範本，清除其他預設設定
    if (template.isDefault) {
      templates = templates.map((t: PayslipTemplate) => ({
        ...t,
        isDefault: t.id === template.id
      }));
    }

    await prisma.systemSettings.update({
      where: { key: 'payslip_templates' },
      data: {
        value: JSON.stringify(templates),
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      template: templates[index],
      message: '薪資條範本已更新'
    });

  } catch (error) {
    console.error('更新薪資條範本失敗:', error);
    return NextResponse.json({ error: '更新失敗' }, { status: 500 });
  }
}

// DELETE - 刪除薪資條範本
export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/system-settings/payslip-management');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '薪條設定操作過於頻繁，請稍後再試', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // CSRF protection
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗，請重新操作' }, { status: 403 });
    }

    const user = await verifyAdmin(request);
    if (!user) {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少範本 ID' },
        { status: 400 }
      );
    }

    const templatesRecord = await prisma.systemSettings.findUnique({
      where: { key: 'payslip_templates' }
    });

    if (!templatesRecord) {
      return NextResponse.json(
        { error: '找不到薪資條範本' },
        { status: 404 }
      );
    }

    const templates = JSON.parse(templatesRecord.value);
    const templateToDelete = templates.find((t: PayslipTemplate) => t.id === parseInt(id));

    if (!templateToDelete) {
      return NextResponse.json(
        { error: '範本不存在' },
        { status: 404 }
      );
    }

    // 不允許刪除預設範本
    if (templateToDelete.isDefault) {
      return NextResponse.json(
        { error: '無法刪除預設範本' },
        { status: 400 }
      );
    }

    // 移除範本
    const updatedTemplates = templates.filter((t: PayslipTemplate) => t.id !== parseInt(id));

    await prisma.systemSettings.update({
      where: { key: 'payslip_templates' },
      data: {
        value: JSON.stringify(updatedTemplates),
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      success: true,
      message: '薪資條範本已刪除'
    });

  } catch (error) {
    console.error('刪除薪資條範本失敗:', error);
    return NextResponse.json(
      { error: '刪除失敗' },
      { status: 500 }
    );
  }
}
