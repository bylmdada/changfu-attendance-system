const mockPrisma = {
  approvalWorkflow: {
    findUnique: jest.fn()
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
    mockPrisma.approvalWorkflow.findUnique.mockResolvedValue({
      workflowType: 'ANNOUNCEMENT',
      workflowName: '公告審核',
      approvalLevel: 3,
      requireManager: false,
      finalApprover: 'MANAGER',
      deadlineMode: 'FIXED',
      deadlineHours: 24,
      enableForward: true,
      enableCC: false,
      isActive: true
    });

    await expect(getApprovalWorkflow('ANNOUNCEMENT')).resolves.toEqual({
      workflowType: 'ANNOUNCEMENT',
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
});
