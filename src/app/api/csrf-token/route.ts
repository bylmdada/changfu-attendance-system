import { NextRequest, NextResponse } from 'next/server';
import { generateCSRFTokenForUser } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const { token, sessionId } = await generateCSRFTokenForUser(request);
    
    if (!sessionId) {
      return NextResponse.json({ 
        error: '無法生成CSRF令牌：會話未找到' 
      }, { status: 400 });
    }
    
    const response = NextResponse.json({
      success: true,
      csrfToken: token
    });
    
    // 設置CSRF令牌到Cookie（僅用於客戶端讀取）
    response.cookies.set('csrf-token', token, {
      httpOnly: false, // 允許JavaScript讀取
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 // 24小時
    });
    
    return response;
  } catch (error) {
    console.error('生成CSRF令牌失敗:', error);
    return NextResponse.json({ 
      error: '生成CSRF令牌失敗' 
    }, { status: 500 });
  }
}
