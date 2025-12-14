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
      // 如果檔案不存在，建立預設模版
      const defaultTemplates: WeeklyTemplate[] = [
        {
          id: 1,
          name: '標準工作週',
          description: '週一到週五A班，週末休息',
          monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
          saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
          sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        },
        {
          id: 2,
          name: '輪班制度',
          description: 'B班輪班制度',
          monday: { shiftType: 'B', startTime: '08:00', endTime: '17:00', breakTime: 60 },
          tuesday: { shiftType: 'B', startTime: '08:00', endTime: '17:00', breakTime: 60 },
          wednesday: { shiftType: 'B', startTime: '08:00', endTime: '17:00', breakTime: 60 },
          thursday: { shiftType: 'B', startTime: '08:00', endTime: '17:00', breakTime: 60 },
          friday: { shiftType: 'B', startTime: '08:00', endTime: '17:00', breakTime: 60 },
          saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
          sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z'
        }
      ];
      saveTemplates(defaultTemplates);
      return defaultTemplates;
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

// GET - 獲取排程模板列表
export async function GET() {
  try {
    const templates = loadTemplates();
    return NextResponse.json({
      success: true,
      templates: templates
    });
  } catch (error) {
    console.error('獲取排程模板失敗:', error);
    return NextResponse.json(
      { success: false, error: '獲取排程模板失敗', templates: [] },
      { status: 500 }
    );
  }
}

// POST - 建立新的週模版
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, monday, tuesday, wednesday, thursday, friday, saturday, sunday } = body;

    if (!name) {
      return NextResponse.json({ error: '缺少模版名稱' }, { status: 400 });
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

    // 獲取現有模版列表
    const templates = loadTemplates();
    
    // 生成新的 ID
    const newId = templates.length > 0 ? Math.max(...templates.map(t => t.id)) + 1 : 1;

    // 模擬建立模版成功
    const newTemplate: WeeklyTemplate = {
      id: newId,
      name,
      description: description || '',
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 將新模版加入到列表中並儲存
    templates.push(newTemplate);
    saveTemplates(templates);

    return NextResponse.json({ 
      message: '週模版建立成功',
      template: newTemplate 
    });
  } catch (error) {
    console.error('建立週模版失敗:', error);
    return NextResponse.json({ error: '建立週模版失敗' }, { status: 500 });
  }
}
