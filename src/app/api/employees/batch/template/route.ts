import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';

// GET - 下載 CSV 範本
export async function GET(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, '/api/employees/batch/template');
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter?.toString() || '60' } }
      );
    }

    // 認證和權限檢查
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: '需要管理員權限' }, { status: 403 });
    }

    // CSV 範本內容（使用 BOM 確保 Excel 正確識別 UTF-8）
    const BOM = '\uFEFF';
    const headers = '員工編號,姓名,生日,電話,地址,緊急聯絡人,緊急聯絡電話,到職日期,底薪,時薪,部門,職位,員工類型,參加勞保';
    const exampleRow1 = '202501001,王小明,1990-01-15,0912345678,台北市信義區信義路100號,王大明,0911111111,2025-01-01,32000,133,照顧服務部,照顧服務員,MONTHLY,是';
    const exampleRow2 = ',李小華,1985-06-20,0923456789,新北市板橋區文化路50號,李大華,0922222222,2025-01-01,0,200,居家服務部,居服員,HOURLY,否';
    const noteRow1 = '# 說明：員工編號留空則系統自動生成';
    const noteRow2 = '# 員工類型：MONTHLY（月薪人員）、HOURLY（計時人員）';
    const noteRow3 = '# 參加勞保：是/否（計時人員可填「否」表示不參加）';
    const noteRow4 = '# 計時人員底薪可填0，系統將以「時薪×實際工時」計算薪資';
    
    const csvContent = BOM + [headers, exampleRow1, exampleRow2, noteRow1, noteRow2, noteRow3, noteRow4].join('\n');

    // 返回 CSV 檔案
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="employee_import_template.csv"'
      }
    });

  } catch (error) {
    console.error('下載範本失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
