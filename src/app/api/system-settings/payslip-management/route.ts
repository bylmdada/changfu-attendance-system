import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { safeParseJSON } from '@/lib/validation';

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
    const user = await getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return null;
    }

    return user;
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

    const templates = templatesRecord ? JSON.parse(templatesRecord.value) : [];

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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      );
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { error: '請提供有效的設定資料' },
        { status: 400 }
      );
    }

    const bodyRecord = body as Record<string, unknown>;
    const type = bodyRecord.type;
    const data = bodyRecord.data;
    const dataRecord = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null;
    
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
      if (!dataRecord) {
        return NextResponse.json(
          { error: '請提供有效的範本資料' },
          { status: 400 }
        );
      }

      // 儲存薪資條範本
      const templatesRecord = await prisma.systemSettings.findUnique({
        where: { key: 'payslip_templates' }
      });

      let templates = templatesRecord ? JSON.parse(templatesRecord.value) : [];

      const templateId = typeof dataRecord.id === 'number' ? dataRecord.id : null;
      const isDefault = Boolean(dataRecord.isDefault);
      let targetTemplateId = templateId;

      if (templateId) {
        // 更新現有範本
        const index = templates.findIndex((t: PayslipTemplate) => t.id === templateId);
        if (index !== -1) {
          templates[index] = dataRecord as unknown as PayslipTemplate;
        }
      } else {
        // 新增範本
        const newId = Math.max(...templates.map((t: PayslipTemplate) => t.id || 0), 0) + 1;
        targetTemplateId = newId;
        templates.push({ ...dataRecord, id: newId } as PayslipTemplate);
      }

      // 如果設為預設範本，清除其他預設設定
      if (isDefault) {
        templates = templates.map((t: PayslipTemplate) => ({
          ...t,
          isDefault: t.id === targetTemplateId
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
        template: dataRecord,
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

    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      const errorMessage = parseResult.error === 'empty_body'
        ? '請提供有效的設定資料'
        : '無效的 JSON 格式';

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    const body = parseResult.data;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: '請提供有效的設定資料' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const templateValue = bodyRecord.template;
    const template = templateValue && typeof templateValue === 'object' && !Array.isArray(templateValue)
      ? templateValue as Record<string, unknown>
      : null;

    const templateId = typeof template?.id === 'number' ? template.id : null;

    if (!template || !templateId) {
      return NextResponse.json({ error: '缺少範本資料' }, { status: 400 });
    }

    const templatesRecord = await prisma.systemSettings.findUnique({
      where: { key: 'payslip_templates' }
    });

    if (!templatesRecord) {
      return NextResponse.json({ error: '找不到薪資條範本' }, { status: 404 });
    }

    let templates = JSON.parse(templatesRecord.value);
    const index = templates.findIndex((t: PayslipTemplate) => t.id === templateId);

    if (index === -1) {
      return NextResponse.json({ error: '範本不存在' }, { status: 404 });
    }

    // 更新範本
    templates[index] = { ...templates[index], ...template };

    // 如果設為預設範本，清除其他預設設定
    if (template.isDefault) {
      templates = templates.map((t: PayslipTemplate) => ({
        ...t,
        isDefault: t.id === templateId
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
