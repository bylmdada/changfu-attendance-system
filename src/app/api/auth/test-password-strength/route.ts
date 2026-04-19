import { NextRequest, NextResponse } from 'next/server';
import { safeParseJSON } from '@/lib/validation';
import { evaluatePasswordStrength, isPasswordPolicy } from '@/lib/password-policy';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const parseResult = await safeParseJSON(request);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error === 'empty_body' ? '密碼不能為空' : '無效的 JSON 格式' },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const password = isPlainObject(body) && typeof body.password === 'string' ? body.password : '';
    const policy = isPlainObject(body) ? body.policy : null;

    if (!password) {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    if (!isPasswordPolicy(policy)) {
      return NextResponse.json({ error: '密碼政策設定無效' }, { status: 400 });
    }

    return NextResponse.json(evaluatePasswordStrength(password, policy));

  } catch (error) {
    console.error('密碼強度測試失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
