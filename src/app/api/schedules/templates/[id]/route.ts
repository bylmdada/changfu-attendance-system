import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface WeeklyTemplate {
  id: number;
  name: string;
  description: string;
  monday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  tuesday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  wednesday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  thursday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  friday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  saturday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  sunday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  createdAt?: string;
  updatedAt?: string;
}

// 資料檔案路徑
const TEMPLATES_FILE = path.join(process.cwd(), 'data', 'weekly-templates.json');

// 確保資料目錄存在
function ensureDataDirectory() {
  const dataDir = path.dirname(TEMPLATES_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// 讀取模版資料
function loadTemplates(): WeeklyTemplate[] {
  try {
    ensureDataDirectory();
    if (!fs.existsSync(TEMPLATES_FILE)) {
      return [];
    }
    
    const data = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('讀取模版失敗:', error);
    return [];
  }
}

// 儲存模版資料
function saveTemplates(templates: WeeklyTemplate[]): void {
  try {
    ensureDataDirectory();
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  } catch (error) {
    console.error('儲存模版失敗:', error);
  }
}

// PUT - 更新週模版
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id);
    const body = await request.json();
    const { name, description, monday, tuesday, wednesday, thursday, friday, saturday, sunday } = body;

    if (!name) {
      return NextResponse.json({ error: '缺少模版名稱' }, { status: 400 });
    }

    // 載入現有模版
    const templates = loadTemplates();
    
    // 找到要更新的模版
    const templateIndex = templates.findIndex((t: WeeklyTemplate) => t.id === templateId);
    if (templateIndex === -1) {
      return NextResponse.json({ error: '找不到指定的模版' }, { status: 404 });
    }

    // 驗證每日班表資料
    const weekdays = { monday, tuesday, wednesday, thursday, friday, saturday, sunday };
    for (const [day, schedule] of Object.entries(weekdays)) {
      if (!schedule || typeof schedule !== 'object') {
        return NextResponse.json({ error: `${day} 班表資料格式錯誤` }, { status: 400 });
      }
      if (!schedule.shiftType) {
        return NextResponse.json({ error: `${day} 缺少班別類型` }, { status: 400 });
      }
    }

    // 更新模版
    const updatedTemplate: WeeklyTemplate = {
      ...templates[templateIndex],
      name,
      description: description || '',
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      updatedAt: new Date().toISOString()
    };

    templates[templateIndex] = updatedTemplate;
    saveTemplates(templates);

    return NextResponse.json({ 
      message: '週模版更新成功',
      template: updatedTemplate 
    });
  } catch (error) {
    console.error('更新週模版失敗:', error);
    return NextResponse.json({ error: '更新週模版失敗' }, { status: 500 });
  }
}

// DELETE - 刪除週模版
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id);

    if (!templateId) {
      return NextResponse.json({ error: '無效的模版ID' }, { status: 400 });
    }

    // 載入現有模版
    const templates = loadTemplates();
    
    // 找到要刪除的模版
    const templateIndex = templates.findIndex((t: WeeklyTemplate) => t.id === templateId);
    if (templateIndex === -1) {
      return NextResponse.json({ error: '找不到指定的模版' }, { status: 404 });
    }

    // 刪除模版
    templates.splice(templateIndex, 1);
    saveTemplates(templates);

    return NextResponse.json({ 
      message: '週模版刪除成功'
    });
  } catch (error) {
    console.error('刪除週模版失敗:', error);
    return NextResponse.json({ error: '刪除週模版失敗' }, { status: 500 });
  }
}
