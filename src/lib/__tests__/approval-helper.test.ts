jest.mock('@/lib/database', () => ({
  prisma: {
    approvalInstance: {
      create: jest.fn()
    },
    systemSettings: {
      findFirst: jest.fn()
    }
  }
}));

jest.mock('@/lib/approval-workflow', () => ({
  getApprovalWorkflow: jest.fn()
}));

import { prisma } from '@/lib/database';
import { getApprovalWorkflow } from '@/lib/approval-workflow';
import { createApprovalForRequest } from '@/lib/approval-helper';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetApprovalWorkflow = getApprovalWorkflow as jest.MockedFunction<typeof getApprovalWorkflow>;

describe('createApprovalForRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts direct-admin workflows at level one with a single effective stage', async () => {
    mockGetApprovalWorkflow.mockResolvedValue({
      workflowType: 'ANNOUNCEMENT',
      workflowName: '公告審核',
      approvalLevel: 1,
      requireManager: false,
      finalApprover: 'ADMIN',
      deadlineMode: 'FIXED',
      deadlineHours: 24,
      enableForward: false,
      enableCC: false
    });
    mockPrisma.approvalInstance.create.mockResolvedValue({ id: 15 } as never);

    const result = await createApprovalForRequest({
      requestType: 'ANNOUNCEMENT',
      requestId: 99,
      applicantId: 5,
      applicantName: '申請人',
      department: null
    });

    expect(result.success).toBe(true);
    expect(mockPrisma.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        currentLevel: 1,
        maxLevel: 1,
        requireManager: false,
        status: 'LEVEL1_REVIEWING'
      })
    });
  });
});
