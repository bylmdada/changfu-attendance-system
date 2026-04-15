import { NextResponse } from 'next/server';

const deprecationResponse = () => NextResponse.json({
  error: '舊版 2FA API 已停用，請改用 /api/auth/2fa/* 安全端點'
}, { status: 410 });

export async function GET() {
  return deprecationResponse();
}

export async function POST() {
  return deprecationResponse();
}
