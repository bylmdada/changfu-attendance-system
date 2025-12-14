import { NextResponse } from 'next/server';

// 預設使用「聯繫管理員」模式
// 管理員可在系統設定中開啟 Email 重設功能

export async function GET() {
  try {
    // TODO: 從資料庫讀取設定
    // 目前預設為聯繫管理員模式
    return NextResponse.json({
      emailResetEnabled: false,  // 預設關閉 Email 重設
      adminContact: '請聯繫系統管理員'
    });
  } catch (error) {
    console.error('讀取密碼重設設定失敗:', error);
    return NextResponse.json(
      { error: '讀取設定失敗' },
      { status: 500 }
    );
  }
}
