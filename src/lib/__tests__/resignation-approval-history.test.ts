import {
  buildResignationHistoryFromRecord,
  recordResignationDecision,
} from '../resignation-approval-history';

function makeTx(existing: Record<string, unknown> | null = null, updatedCount = 1) {
  return {
    approvalInstance: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: 70 }),
      updateMany: jest.fn().mockResolvedValue({ count: updatedCount }),
    },
    approvalReview: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };
}

const baseParams = {
  recordId: 5,
  applicant: { id: 10, name: '王小明', department: '照護部' },
  reviewer: { employeeId: 1, name: '人資甲', role: 'HR' },
  comment: '同意離職',
  workflow: { approvalLevel: 2, requireManager: true },
};

describe('recordResignationDecision', () => {
  it('creates a finished instance and a review at the final level when the record has no instance yet', async () => {
    const tx = makeTx();

    await recordResignationDecision(tx as never, { ...baseParams, action: 'APPROVE' });

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: {
        requestType: 'RESIGNATION',
        requestId: 5,
        applicantId: 10,
        applicantName: '王小明',
        department: '照護部',
        currentLevel: 2,
        maxLevel: 2,
        requireManager: true,
        status: 'APPROVED',
      },
    });
    expect(tx.approvalReview.create).toHaveBeenCalledWith({
      data: {
        instanceId: 70,
        level: 2,
        reviewerId: 1,
        reviewerName: '人資甲',
        reviewerRole: 'HR',
        action: 'APPROVE',
        comment: '同意離職',
      },
    });
  });

  it('records a rejection as REJECTED with the reason as comment', async () => {
    const tx = makeTx();

    await recordResignationDecision(tx as never, { ...baseParams, action: 'REJECT', comment: '交接期不足' });

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'REJECTED' }),
    });
    expect(tx.approvalReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'REJECT', comment: '交接期不足' }),
    });
  });

  it('reuses an existing instance: review at its current level, then close it with a compare-and-set', async () => {
    const tx = makeTx({ id: 33, currentLevel: 1, maxLevel: 2, status: 'LEVEL1_REVIEWING' });

    await recordResignationDecision(tx as never, { ...baseParams, action: 'APPROVE' });

    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.approvalReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ instanceId: 33, level: 1, action: 'APPROVE' }),
    });
    expect(tx.approvalInstance.updateMany).toHaveBeenCalledWith({
      where: { id: 33, currentLevel: 1, status: 'LEVEL1_REVIEWING' },
      data: { status: 'APPROVED', currentLevel: 2 },
    });
  });

  it('fails when the existing instance changed meanwhile so the whole transaction rolls back', async () => {
    const tx = makeTx({ id: 33, currentLevel: 1, maxLevel: 2, status: 'LEVEL1_REVIEWING' }, 0);

    await expect(
      recordResignationDecision(tx as never, { ...baseParams, action: 'APPROVE' })
    ).rejects.toThrow('審核流程狀態已變更');
  });
});

describe('buildResignationHistoryFromRecord', () => {
  const approvedAt = new Date('2026-11-10T02:30:00.000Z');
  const reviewer = { name: '人資甲', role: 'HR' };

  it('rebuilds an approved decision from the record, with reviewer, time and note', () => {
    const history = buildResignationHistoryFromRecord(
      { status: 'APPROVED', approvedAt, rejectionReason: null, notes: '請完成交接' },
      reviewer,
      2
    );

    expect(history).toEqual({
      currentLevel: 2,
      maxLevel: 2,
      status: 'APPROVED',
      reviews: [
        {
          level: 2,
          reviewerName: '人資甲',
          reviewerRole: 'HR',
          status: 'APPROVED',
          comment: '請完成交接',
          reviewedAt: '2026-11-10T02:30:00.000Z',
        },
      ],
    });
  });

  it('rebuilds a rejection with the rejection reason', () => {
    const history = buildResignationHistoryFromRecord(
      { status: 'REJECTED', approvedAt, rejectionReason: '交接期不足', notes: null },
      reviewer,
      2
    );

    expect(history?.status).toBe('REJECTED');
    expect(history?.reviews[0]).toEqual(
      expect.objectContaining({ status: 'REJECTED', comment: '交接期不足' })
    );
  });

  it.each(['IN_HANDOVER', 'COMPLETED'])('keeps the original approval once the record is %s', (status) => {
    const history = buildResignationHistoryFromRecord(
      { status, approvedAt, rejectionReason: null, notes: null },
      reviewer,
      2
    );

    expect(history?.status).toBe('APPROVED');
    expect(history?.reviews).toHaveLength(1);
  });

  it('has nothing to show while pending or when no decision time was stored', () => {
    expect(buildResignationHistoryFromRecord(
      { status: 'PENDING', approvedAt: null, rejectionReason: null, notes: null }, reviewer, 2
    )).toBeNull();
    expect(buildResignationHistoryFromRecord(
      { status: 'APPROVED', approvedAt: null, rejectionReason: null, notes: null }, reviewer, 2
    )).toBeNull();
  });
});
