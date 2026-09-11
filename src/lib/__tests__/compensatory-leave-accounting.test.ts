import {
  applyCompensatoryLeaveUse,
  reverseCompensatoryLeaveUse,
} from '@/lib/compensatory-leave-accounting';

function buildTx() {
  return {
    compLeaveBalance: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

describe('compensatory leave accounting', () => {
  it('records pending comp-leave use when approving compensatory leave', async () => {
    const tx = buildTx();
    tx.compLeaveBalance.findUnique.mockResolvedValue({
      employeeId: 10,
      balance: 4,
      pendingEarn: 6,
      pendingUse: 1,
    });

    await applyCompensatoryLeaveUse(tx as never, {
      id: 8,
      employeeId: 10,
      leaveType: 'COMPENSATORY',
      totalDays: 0.5,
      startDate: new Date('2026-07-08T00:00:00.000Z'),
      reason: '加班補休',
    });

    expect(tx.compLeaveTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 10,
        transactionType: 'USE',
        hours: 4,
        referenceId: 8,
        referenceType: 'LEAVE',
        yearMonth: '2026-07',
      }),
    });
    expect(tx.compLeaveBalance.update).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      data: { pendingUse: { increment: 4 } },
    });
  });

  it('rejects approval when available comp leave is insufficient', async () => {
    const tx = buildTx();
    tx.compLeaveBalance.findUnique.mockResolvedValue({
      employeeId: 10,
      balance: 1,
      pendingEarn: 0,
      pendingUse: 0,
    });

    await expect(applyCompensatoryLeaveUse(tx as never, {
      id: 8,
      employeeId: 10,
      leaveType: 'COMPENSATORY',
      totalDays: 0.5,
      startDate: new Date('2026-07-08T00:00:00.000Z'),
    })).rejects.toThrow('補休餘額不足');
  });

  it('offsets the original use transaction when cancelling compensatory leave', async () => {
    const tx = buildTx();
    tx.compLeaveTransaction.findFirst.mockResolvedValue({
      id: 20,
      employeeId: 10,
      hours: 4,
      isFrozen: false,
      yearMonth: '2026-07',
    });

    await reverseCompensatoryLeaveUse(tx as never, {
      id: 8,
      employeeId: 10,
      leaveType: 'COMPENSATORY',
    }, 'LEAVE_CANCEL');

    expect(tx.compLeaveTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 10,
        transactionType: 'EARN',
        hours: 4,
        referenceId: 8,
        referenceType: 'LEAVE_CANCEL',
        yearMonth: '2026-07',
      }),
    });
    expect(tx.compLeaveBalance.upsert).toHaveBeenCalledWith({
      where: { employeeId: 10 },
      update: { pendingEarn: { increment: 4 } },
      create: { employeeId: 10, pendingEarn: 4 },
    });
  });
});
