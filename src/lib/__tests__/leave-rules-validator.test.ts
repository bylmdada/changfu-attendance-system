jest.mock('@/lib/database', () => ({
  prisma: {
    leaveRulesConfig: {
      findFirst: jest.fn(),
    },
    leaveRequest: {
      aggregate: jest.fn(),
    },
  },
}));

import { prisma } from '@/lib/database';
import { validateLeaveRequest } from '@/lib/leave-rules-validator';

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;

describe('leave rules validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.leaveRulesConfig.findFirst.mockResolvedValue(null as never);
    mockedPrisma.leaveRequest.aggregate.mockResolvedValue({
      _sum: {
        totalDays: 7,
      },
    } as never);
  });

  it('rejects family care leave overflow because excess time is not auto-converted to personal leave', async () => {
    const result = await validateLeaveRequest(1, 'FAMILY_CARE', 1, 2026);

    expect(result).toEqual({
      valid: false,
      error: '家庭照顧假年度上限為 7 天，您已使用 7 天。超出部分請改以事假另行申請（系統不會自動轉換，年度最多 56 小時）',
      rulesApplied: ['familyCareLeaveMaxDays', 'familyCareHourlyEnabled', 'familyCareHourlyMaxHours'],
    });
  });
});
