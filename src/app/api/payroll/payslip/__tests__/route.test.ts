jest.mock('@/lib/database', () => ({
  prisma: {
    payrollRecord: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { GET } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('payroll payslip route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
  });

  it('rejects mixed payroll ids before querying prisma', async () => {
    const request = new NextRequest('http://localhost/api/payroll/payslip?payrollId=12abc');

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('薪資記錄ID格式無效');
    expect(mockPrisma.payrollRecord.findUnique).not.toHaveBeenCalled();
  });
});
