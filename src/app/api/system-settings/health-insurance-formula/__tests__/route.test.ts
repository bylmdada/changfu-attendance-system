import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/system-settings/health-insurance-formula/route';
import { prisma } from '@/lib/database';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { getUserFromRequest } from '@/lib/auth';

jest.mock('@/lib/database', () => ({
  prisma: {
    healthInsuranceConfig: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    healthInsuranceSalaryLevel: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
}));

jest.mock('@/lib/csrf', () => ({
  validateCSRF: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: jest.fn(),
}));

const mockedPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockedRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockedValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;
const mockedGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;

describe('health insurance formula route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockedPrisma.healthInsuranceConfig.findFirst.mockResolvedValue({
      id: 10,
      premiumRate: 0.0517,
      employeeContributionRatio: 0.3,
      maxDependents: 3,
      supplementaryRate: 0.0211,
      supplementaryThreshold: 4,
      effectiveDate: new Date('2026-01-01T00:00:00.000Z'),
      isActive: true,
      salaryLevels: [
        {
          id: 101,
          level: 1,
          minSalary: 0,
          maxSalary: 25000,
          insuredAmount: 25200,
        },
      ],
    } as never);

    mockedPrisma.$transaction.mockImplementation(async (callback) => callback({
      healthInsuranceConfig: {
        update: jest.fn().mockResolvedValue({
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 5,
          effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
          isActive: true,
        }),
        create: jest.fn(),
      },
      healthInsuranceSalaryLevel: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 999 }),
      },
    } as never));

    mockedRateLimit.mockResolvedValue({
      allowed: true,
      remainingRequests: 10,
      resetTime: Date.now() + 60_000,
    });
    mockedValidateCSRF.mockResolvedValue({ valid: true });
    mockedGetUserFromRequest.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      employee: null,
    } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config).toMatchObject({
      id: 10,
      premiumRate: 0.0517,
      employeeContributionRatio: 0.3,
    });
    expect(data.salaryLevels).toHaveLength(1);
  });

  it('allows authenticated non-admin GET requests for payroll calculations', async () => {
    mockedGetUserFromRequest.mockResolvedValueOnce({
      id: 2,
      username: 'employee',
      role: 'EMPLOYEE',
      employee: { id: 2, employeeId: 'E002', name: '員工' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config).toMatchObject({
      id: 10,
      premiumRate: 0.0517,
      employeeContributionRatio: 0.3,
    });
  });

  it('returns defaults without persisting when no config exists yet', async () => {
    mockedPrisma.healthInsuranceConfig.findFirst.mockResolvedValueOnce(null as never);

    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config).toMatchObject({
      id: 0,
      premiumRate: 0.0517,
      employeeContributionRatio: 0.3,
      maxDependents: 3,
    });
    expect(data.salaryLevels).toHaveLength(15);
    expect(mockedPrisma.healthInsuranceConfig.create).not.toHaveBeenCalled();
    expect(mockedPrisma.healthInsuranceSalaryLevel.create).not.toHaveBeenCalled();
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        config: {
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 5,
          effectiveDate: '2026-02-01',
          isActive: true,
        },
        salaryLevels: [
          {
            level: 1,
            minSalary: 0,
            maxSalary: 26000,
            insuredAmount: 26200,
          },
        ],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.config).toMatchObject({
      id: 10,
      premiumRate: 0.052,
      employeeContributionRatio: 0.31,
      maxDependents: 4,
    });
  });

  it('rejects malformed JSON bodies before validating health insurance payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"config":',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '無效的 JSON 格式' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects null bodies on POST before destructuring health insurance payload', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '請提供有效的設定資料' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-array salaryLevels before opening a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        config: {
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 5,
          effectiveDate: '2026-02-01',
          isActive: true,
        },
        salaryLevels: { level: 1 },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '薪資級距資料格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects salaryLevels containing malformed entries before opening a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        config: {
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 5,
          effectiveDate: '2026-02-01',
          isActive: true,
        },
        salaryLevels: [null],
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '薪資級距資料格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid effective dates before opening a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        config: {
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 5,
          effectiveDate: '2026-02-30',
          isActive: true,
        },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '生效日期格式無效' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects negative supplementary thresholds before opening a transaction', async () => {
    const request = new NextRequest('http://localhost:3000/api/system-settings/health-insurance-formula', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        config: {
          id: 10,
          premiumRate: 0.052,
          employeeContributionRatio: 0.31,
          maxDependents: 4,
          supplementaryRate: 0.022,
          supplementaryThreshold: 0,
          effectiveDate: '2026-02-01',
          isActive: true,
        },
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: '補充保費免扣門檻倍數必須大於 0' });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
