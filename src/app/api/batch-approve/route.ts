import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

// POST - 批次審核
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimit(request);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const csrfResult = await validateCSRF(request);
    if (!csrfResult.valid) {
      return NextResponse.json({ error: 'CSRF驗證失敗' }, { status: 403 });
    }

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  request.cookies.get('auth-token')?.value;
    
    if (!token) {
      return NextResponse.json({ error: '未授權訪問' }, { status: 401 });
    }

    const decoded = await getUserFromToken(token);
    if (!decoded || !['ADMIN', 'HR', 'SUPERVISOR'].includes(decoded.role)) {
      return NextResponse.json({ error: '需要審核權限' }, { status: 403 });
    }

    const body = await request.json();
    const { resourceType, ids, action, notes } = body;

    // 驗證
    if (!resourceType || !ids || !action) {
      return NextResponse.json({ error: '缺少必要欄位' }, { status: 400 });
    }

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json({ error: '無效的審核動作' }, { status: 400 });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '請選擇至少一筆申請' }, { status: 400 });
    }

    if (ids.length > 50) {
      return NextResponse.json({ error: '單次最多審核 50 筆' }, { status: 400 });
    }

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const results: { id: number; success: boolean; error?: string }[] = [];
    const now = new Date();

    // 根據資源類型進行批次更新
    switch (resourceType) {
      case 'LEAVE':
        for (const id of ids) {
          try {
            const existing = await prisma.leaveRequest.findUnique({
              where: { id: parseInt(id) }
            });
            if (!existing || existing.status !== 'PENDING') {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }
            await prisma.leaveRequest.update({
              where: { id: parseInt(id) },
              data: {
                status,
                approvedBy: decoded.employeeId,
                approvedAt: now
              }
            });
            results.push({ id, success: true });
          } catch {
            results.push({ id, success: false, error: '更新失敗' });
          }
        }
        break;

      case 'OVERTIME':
        for (const id of ids) {
          try {
            const existing = await prisma.overtimeRequest.findUnique({
              where: { id: parseInt(id) }
            });
            if (!existing || existing.status !== 'PENDING') {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }
            await prisma.overtimeRequest.update({
              where: { id: parseInt(id) },
              data: {
                status,
                approvedBy: decoded.employeeId,
                approvedAt: now
              }
            });
            
            // 如果核准且是補休類型，累積補休時數
            if (status === 'APPROVED' && existing.compensationType === 'COMP_LEAVE') {
              const yearMonth = `${existing.overtimeDate.getFullYear()}-${String(existing.overtimeDate.getMonth() + 1).padStart(2, '0')}`;
              
              await prisma.compLeaveTransaction.create({
                data: {
                  employeeId: existing.employeeId,
                  transactionType: 'EARN',
                  hours: existing.totalHours,
                  isFrozen: false,
                  referenceId: existing.id,
                  referenceType: 'OVERTIME',
                  yearMonth,
                  description: `加班申請 #${existing.id} 核准（批次審核）`
                }
              });

              await prisma.compLeaveBalance.upsert({
                where: { employeeId: existing.employeeId },
                update: {
                  pendingEarn: { increment: existing.totalHours }
                },
                create: {
                  employeeId: existing.employeeId,
                  totalEarned: 0,
                  totalUsed: 0,
                  balance: 0,
                  pendingEarn: existing.totalHours,
                  pendingUse: 0
                }
              });
            }
            
            results.push({ id, success: true });
          } catch {
            results.push({ id, success: false, error: '更新失敗' });
          }
        }
        break;

      case 'SHIFT_EXCHANGE':
        for (const id of ids) {
          try {
            const existing = await prisma.shiftExchangeRequest.findUnique({
              where: { id: parseInt(id) }
            });
            if (!existing || existing.status !== 'PENDING') {
              results.push({ id, success: false, error: '申請不存在或已審核' });
              continue;
            }
            await prisma.shiftExchangeRequest.update({
              where: { id: parseInt(id) },
              data: {
                status,
                approvedBy: decoded.employeeId,
                approvedAt: now
              }
            });
            results.push({ id, success: true });
          } catch {
            results.push({ id, success: false, error: '更新失敗' });
          }
        }
        break;

      default:
        return NextResponse.json({ error: '不支援的資源類型' }, { status: 400 });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    // 記錄審計日誌
    await prisma.auditLog.create({
      data: {
        userId: decoded.userId,
        employeeId: decoded.employeeId,
        action: 'BATCH_APPROVE',
        targetType: resourceType,
        description: `批次${action === 'APPROVE' ? '核准' : '拒絕'} ${successCount}/${ids.length} 筆${notes ? ` - ${notes}` : ''}`,
        newValue: JSON.stringify({ ids, action, results }),
        success: failCount === 0
      }
    });

    return NextResponse.json({
      success: true,
      message: `批次審核完成：成功 ${successCount} 筆，失敗 ${failCount} 筆`,
      summary: {
        total: ids.length,
        success: successCount,
        failed: failCount
      },
      results
    });
  } catch (error) {
    console.error('批次審核失敗:', error);
    return NextResponse.json({ error: '系統錯誤' }, { status: 500 });
  }
}
