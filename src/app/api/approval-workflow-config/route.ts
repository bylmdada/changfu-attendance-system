/**
 * 審核流程設定公開 API
 * 讓前端獲取各申請類型的審核流程層級設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';

// 層級標籤映射
const getLevelLabels = (approvalLevel: number, requireManager: boolean) => {
  const labels: Record<number, { name: string; role: string }> = {};
  
  if (requireManager) {
    labels[1] = { name: '一階', role: '部門主管' };
    labels[2] = { name: '二階', role: '管理員決核' };
  } else {
    // 不需主管，直接 Admin 審核
    labels[1] = { name: '一階', role: '管理員決核' };
  }
  
  return labels;
};

// GET: 取得指定類型的審核流程設定
export async function GET(request: NextRequest) {
  try {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workflowType = searchParams.get('type');

    if (!workflowType) {
      return NextResponse.json({ error: '請指定 type 參數' }, { status: 400 });
    }

    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { workflowType }
    });

    if (!workflow) {
      // 返回預設設定
      return NextResponse.json({
        success: true,
        workflowType,
        approvalLevel: 2,
        requireManager: true,
        maxLevel: 2,
        labels: {
          1: { name: '一階', role: '部門主管' },
          2: { name: '二階', role: '管理員決核' }
        }
      });
    }

    // 根據設定計算實際層級
    const maxLevel = workflow.requireManager ? 2 : 1;

    return NextResponse.json({
      success: true,
      workflowType: workflow.workflowType,
      workflowName: workflow.workflowName,
      approvalLevel: workflow.approvalLevel,
      requireManager: workflow.requireManager,
      finalApprover: workflow.finalApprover,
      maxLevel,
      labels: getLevelLabels(workflow.approvalLevel, workflow.requireManager)
    });

  } catch (error) {
    console.error('取得審核流程設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
