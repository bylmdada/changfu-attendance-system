const mockPrisma = {
  approvalWorkflow: {
    findMany: jest.fn()
  }
};

jest.mock('@/lib/database', () => ({
  prisma: mockPrisma
}));

import { clearWorkflowCache, getApprovalWorkflow } from '@/lib/approval-workflow';

describe('approval workflow config normalization', () => {
  beforeEach(() => {
    clearWorkflowCache();
    jest.clearAllMocks();
  });

  it('normalizes direct-admin workflows to one approval level and admin as final approver', async () => {
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([{
      workflowType: 'ANNOUNCEMENT',
      department: '__ALL__',
      workflowName: '公告審核',
      approvalLevel: 3,
      requireManager: false,
      finalApprover: 'MANAGER',
      deadlineMode: 'FIXED',
      deadlineHours: 24,
      enableForward: true,
      enableCC: false,
      isActive: true
    }]);

    await expect(getApprovalWorkflow('ANNOUNCEMENT')).resolves.toEqual({
      workflowType: 'ANNOUNCEMENT',
      department: '__ALL__',
      workflowName: '公告審核',
      approvalLevel: 1,
      requireManager: false,
      finalApprover: 'ADMIN',
      deadlineMode: 'FIXED',
      deadlineHours: 24,
      enableForward: true,
      enableCC: false
    });
  });

  it('uses a department workflow before falling back to the company default', async () => {
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([
      {
        workflowType: 'LEAVE',
        department: '__ALL__',
        workflowName: '請假審核',
        approvalLevel: 2,
        requireManager: true,
        finalApprover: 'ADMIN',
        deadlineMode: 'FIXED',
        deadlineHours: 48,
        enableForward: false,
        enableCC: false,
        isActive: true
      },
      {
        workflowType: 'LEAVE',
        department: '溪北輔具中心',
        workflowName: '請假審核',
        approvalLevel: 1,
        requireManager: false,
        finalApprover: 'ADMIN',
        deadlineMode: 'FIXED',
        deadlineHours: 12,
        enableForward: true,
        enableCC: true,
        isActive: true
      }
    ]);

    await expect(getApprovalWorkflow('LEAVE', { department: '溪北輔具中心' })).resolves.toMatchObject({
      workflowType: 'LEAVE',
      department: '溪北輔具中心',
      approvalLevel: 1,
      requireManager: false,
      deadlineHours: 12,
      enableForward: true,
      enableCC: true
    });
  });

  it('clamps unsupported third-level workflows to the implemented two-step flow', async () => {
    mockPrisma.approvalWorkflow.findMany.mockResolvedValue([{
      workflowType: 'LEAVE',
      department: '__ALL__',
      workflowName: '請假審核',
      approvalLevel: 3,
      requireManager: true,
      finalApprover: 'ADMIN',
      deadlineMode: 'FIXED',
      deadlineHours: 48,
      enableForward: false,
      enableCC: false,
      isActive: true
    }]);

    await expect(getApprovalWorkflow('LEAVE')).resolves.toMatchObject({
      approvalLevel: 2,
      requireManager: true
    });
  });
});
