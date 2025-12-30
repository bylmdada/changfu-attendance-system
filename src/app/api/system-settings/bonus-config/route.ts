/**
 * 獎金配置 API
 * GET: 取得獎金配置
 * POST: 儲存獎金配置
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { validateCSRF } from '@/lib/csrf';

export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'HR')) {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const configs = await prisma.bonusConfiguration.findMany({
      orderBy: { bonusType: 'asc' }
    });

    // 解析 JSON 欄位
    const parsedConfigs = configs.map(config => ({
      ...config,
      eligibilityRules: config.eligibilityRules
        ? (typeof config.eligibilityRules === 'string'
            ? JSON.parse(config.eligibilityRules)
            : config.eligibilityRules)
        : {},
      paymentSchedule: config.paymentSchedule
        ? (typeof config.paymentSchedule === 'string'
            ? JSON.parse(config.paymentSchedule)
            : config.paymentSchedule)
        : {}
    }));

    return NextResponse.json({
      success: true,
      configs: parsedConfigs
    });

  } catch (error) {
    console.error('取得獎金配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF 驗證失敗' }, { status: 403 });
    }

    const user = getUserFromRequest(request);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: '無權限' }, { status: 403 });
    }

    const data = await request.json();
    const { yearEndConfig, festivalConfig } = data;

    // 儲存年終獎金設定
    if (yearEndConfig) {
      await prisma.bonusConfiguration.upsert({
        where: { bonusType: 'YEAR_END' },
        update: {
          bonusTypeName: yearEndConfig.bonusTypeName || '年終獎金',
          eligibilityRules: JSON.stringify(yearEndConfig.eligibilityRules || {}),
          paymentSchedule: JSON.stringify(yearEndConfig.paymentSchedule || {}),
          isActive: true
        },
        create: {
          bonusType: 'YEAR_END',
          bonusTypeName: yearEndConfig.bonusTypeName || '年終獎金',
          eligibilityRules: JSON.stringify(yearEndConfig.eligibilityRules || {}),
          paymentSchedule: JSON.stringify(yearEndConfig.paymentSchedule || {}),
          isActive: true
        }
      });
    }

    // 儲存三節獎金設定
    if (festivalConfig) {
      await prisma.bonusConfiguration.upsert({
        where: { bonusType: 'FESTIVAL' },
        update: {
          bonusTypeName: festivalConfig.bonusTypeName || '三節獎金',
          eligibilityRules: JSON.stringify(festivalConfig.eligibilityRules || {}),
          paymentSchedule: JSON.stringify(festivalConfig.paymentSchedule || {}),
          isActive: true
        },
        create: {
          bonusType: 'FESTIVAL',
          bonusTypeName: festivalConfig.bonusTypeName || '三節獎金',
          eligibilityRules: JSON.stringify(festivalConfig.eligibilityRules || {}),
          paymentSchedule: JSON.stringify(festivalConfig.paymentSchedule || {}),
          isActive: true
        }
      });
    }

    return NextResponse.json({
      success: true,
      message: '設定已儲存'
    });

  } catch (error) {
    console.error('儲存獎金配置失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
