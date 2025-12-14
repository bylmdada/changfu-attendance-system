import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // 讀取資料庫維護控制台 HTML 文件
    const filePath = join(process.cwd(), 'database-maintenance-dashboard.html');
    const htmlContent = readFileSync(filePath, 'utf8');
    
    return new NextResponse(htmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('讀取資料庫維護控制台文件錯誤:', error);
    
    // 如果文件不存在，返回一個簡單的重定向頁面
    const fallbackHtml = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>資料庫維護控制台</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            color: white;
        }
        .container {
            text-align: center;
            background: rgba(0,0,0,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        .btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 25px;
            font-size: 1.1rem;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin: 10px;
            transition: all 0.3s ease;
        }
        .btn:hover {
            background: #2980b9;
            transform: translateY(-2px);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 資料庫維護控制台</h1>
        <p>資料庫維護控制台檔案未找到</p>
        <p>請使用以下方式訪問：</p>
        <br>
        <a href="/system-monitoring" class="btn">🔧 系統監控</a>
        <a href="/" class="btn">🏠 回到首頁</a>
        <br><br>
        <p>或直接訪問檔案：</p>
        <code>file:///Users/feng/changfu-attendance-system/database-maintenance-dashboard.html</code>
    </div>
</body>
</html>`;
    
    return new NextResponse(fallbackHtml, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }
}
