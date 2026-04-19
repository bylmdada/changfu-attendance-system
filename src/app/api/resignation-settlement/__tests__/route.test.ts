import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { GET, POST } from '@/app/api/resignation-settlement/route';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';

jest.mock('@/lib/database', () => ({
  prisma: {
    resignationRecord: {
      findFirst: jest.fn(),
    },
    employee: {
      findUnique: jest.fn(),
    },
    compLeaveBalance: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    annualLeave: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    systemSettings: {
      findUnique: jest.fn(),
    },
    resignationSettlement: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    compLeaveTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

const transactionClient = {
  resignationSettlement: {
    create: jest.fn(),
  },
  compLeaveTransaction: {
    create: jest.fn(),
  },
  compLeaveBalance: {
    update: jest.fn(),
  },
  annualLeave: {
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('resignation settlement auth guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true } as never);
    mockPrisma.resignationRecord.findFirst.mockResolvedValue({
      id: 9,
      employeeId: 3,
      status: 'COMPLETED',
    } as never);
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(transactionClient as never) as never);
  });

  it('returns 401 on GET when request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement');
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
  });

  it('returns 401 on POST when request auth cannot resolve a user', async () => {
    mockGetUserFromRequest.mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 1 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('未授權訪問');
    expect(mockGetUserFromRequest).toHaveBeenCalledWith(request);
  });

  it('returns 400 on POST when request JSON is malformed', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"employeeId":1',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請求內容格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationSettlement.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when the acting admin account has no employee profile id', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: null } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 3 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('當前帳號缺少員工資料，無法執行離職結算');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when employeeId is not a clean positive integer', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: '12abc' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工ID格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resignationSettlement.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 on POST when the employee has not completed resignation yet', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 1 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 3,
      baseSalary: 48000,
    } as never);
    mockPrisma.resignationRecord.findFirst.mockResolvedValue(null as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 3 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('該員工尚未完成離職流程，無法進行結算');
    expect(mockPrisma.resignationSettlement.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('wraps settlement creation and leave clearing writes in a transaction', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 9 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 3,
      baseSalary: 48000,
    } as never);
    mockPrisma.resignationSettlement.findUnique.mockResolvedValue(null as never);
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue({
      employeeId: 3,
      totalEarned: 10,
      totalUsed: 2,
      pendingEarn: 1,
      pendingUse: 1,
    } as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([
      { id: 21, remainingDays: 2 },
    ] as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ monthlyBasicHours: 240 }),
    } as never);
    transactionClient.resignationSettlement.create.mockResolvedValue({
      id: 88,
      employee: { id: 3, employeeId: 'E003', name: 'Test', department: 'HR', position: 'Staff', baseSalary: 48000 },
      processor: { id: 9, name: 'Admin' },
    } as never);
    transactionClient.compLeaveTransaction.create.mockResolvedValue({ id: 1 } as never);
    transactionClient.compLeaveBalance.update.mockResolvedValue({ employeeId: 3 } as never);
    transactionClient.annualLeave.update.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 3, notes: '離職結算' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.resignationSettlement.create).not.toHaveBeenCalled();
    expect(transactionClient.resignationSettlement.create).toHaveBeenCalled();
    expect(transactionClient.compLeaveTransaction.create).toHaveBeenCalled();
    expect(transactionClient.compLeaveBalance.update).toHaveBeenCalled();
    expect(transactionClient.annualLeave.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: {
        usedDays: { increment: 2 },
        remainingDays: 0,
      }
    });
  });

  it('settles each annual leave record using its own remaining balance instead of incrementing all rows by the total', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 9 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 3,
      baseSalary: 48000,
    } as never);
    mockPrisma.resignationSettlement.findUnique.mockResolvedValue(null as never);
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue(null as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([
      { id: 11, remainingDays: 2 },
      { id: 12, remainingDays: 3 },
    ] as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ monthlyBasicHours: 240 }),
    } as never);
    transactionClient.resignationSettlement.create.mockResolvedValue({
      id: 88,
      employee: { id: 3, employeeId: 'E003', name: 'Test', department: 'HR', position: 'Staff', baseSalary: 48000 },
      processor: { id: 9, name: 'Admin' },
    } as never);
    transactionClient.annualLeave.update.mockResolvedValue({ id: 11 } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 3, notes: '離職結算' }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(transactionClient.annualLeave.update).toHaveBeenNthCalledWith(1, {
      where: { id: 11 },
      data: {
        usedDays: { increment: 2 },
        remainingDays: 0,
      }
    });
    expect(transactionClient.annualLeave.update).toHaveBeenNthCalledWith(2, {
      where: { id: 12 },
      data: {
        usedDays: { increment: 3 },
        remainingDays: 0,
      }
    });
  });

  it('returns 400 when settlement creation hits the unique employee constraint during a race', async () => {
    mockGetUserFromRequest.mockResolvedValue({ role: 'ADMIN', employeeId: 9 } as never);
    mockPrisma.employee.findUnique.mockResolvedValue({
      id: 3,
      baseSalary: 48000,
    } as never);
    mockPrisma.resignationSettlement.findUnique.mockResolvedValue(null as never);
    mockPrisma.compLeaveBalance.findUnique.mockResolvedValue(null as never);
    mockPrisma.annualLeave.findMany.mockResolvedValue([
      { id: 11, remainingDays: 2 },
    ] as never);
    mockPrisma.systemSettings.findUnique.mockResolvedValue({
      value: JSON.stringify({ monthlyBasicHours: 240 }),
    } as never);
    transactionClient.resignationSettlement.create.mockRejectedValue({
      code: 'P2002',
      message: 'Unique constraint failed',
    } as never);

    const request = new NextRequest('http://localhost:3000/api/resignation-settlement', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ employeeId: 3 }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: '該員工已進行過離職結算' });
  });
});
