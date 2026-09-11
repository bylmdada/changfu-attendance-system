/**
 * 審核流程設定公開 API
 * 讓前端獲取各申請類型的審核流程層級設定
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getApprovalWorkflow } from '@/lib/approval-workflow';

// 層級標籤映射
const getLevelLabels = (approvalLevel: number, requireManager: boolean) => {
  const labels: Record<number, { name: string; role: string }> = {};
  const effectiveLevel = Math.min(Math.max(approvalLevel, 1), 2);
  
  if (requireManager) {
    labels[1] = { name: '一階', role: '部門主管' };

    if (effectiveLevel >= 2) {
      labels[2] = { name: '二階', role: '管理員決核' };
    }
  } else {
    // 不需主管，直接 Admin 審核
    labels[1] = { name: '一階', role: '管理員決核' };
  }
  
  return labels;
};

// GET: 取得指定類型的審核流程設定
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: '未授權' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const workflowType = searchParams.get('type');
    const department = searchParams.get('department');

    if (!workflowType) {
      return NextResponse.json({ error: '請指定 type 參數' }, { status: 400 });
    }

    const workflow = await getApprovalWorkflow(workflowType, { department });

    if (!workflow) {
      return NextResponse.json({ error: '找不到審核流程設定' }, { status: 404 });
    }

    // 根據目前已實作的狀態機計算實際層級
    const maxLevel = Math.min(Math.max(workflow.approvalLevel, 1), 2);

    return NextResponse.json({
      success: true,
      workflowType: workflow.workflowType,
      department: workflow.department,
      workflowName: workflow.workflowName,
      approvalLevel: maxLevel,
      requireManager: workflow.requireManager,
      finalApprover: workflow.finalApprover,
      enableForward: workflow.enableForward,
      enableCC: workflow.enableCC,
      maxLevel,
      labels: getLevelLabels(maxLevel, workflow.requireManager)
    });

  } catch (error) {
    console.error('取得審核流程設定失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
