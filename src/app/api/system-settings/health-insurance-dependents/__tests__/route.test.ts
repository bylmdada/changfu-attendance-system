jest.mock('@/lib/database', () => ({
  prisma: {
    employee: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    healthInsuranceDependent: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    dependentHistoryLog: {
      create: jest.fn(),
    },
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/database';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCSRF } from '@/lib/csrf';
import { GET, POST, DELETE } from '../route';

const mockPrisma = prisma as unknown as DeepMocked<typeof prisma>;
const mockGetUserFromRequest = getUserFromRequest as jest.MockedFunction<typeof getUserFromRequest>;
const mockCheckRateLimit = checkRateLimit as jest.MockedFunction<typeof checkRateLimit>;
const mockValidateCSRF = validateCSRF as jest.MockedFunction<typeof validateCSRF>;

describe('health insurance dependents route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCheckRateLimit.mockResolvedValue({ allowed: true } as never);
    mockValidateCSRF.mockResolvedValue({ valid: true });
    mockGetUserFromRequest.mockResolvedValue({
      role: 'ADMIN',
      username: 'admin',
      employee: { name: '管理員' },
    } as never);
  });

  it('accepts shared token cookie extraction on GET requests', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([
      {
        id: 1,
        employeeId: 'A001',
        name: '王小明',
        department: 'HR',
        position: 'Manager',
      },
    ] as never);
    mockPrisma.healthInsuranceDependent.findMany.mockResolvedValue([
      {
        id: 10,
        employeeId: 1,
        dependentName: '王小華',
        relationship: 'CHILD',
        idNumber: 'A123456789',
        birthDate: new Date('2015-01-01T00:00:00.000Z'),
        isActive: true,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: null,
        remarks: null,
      },
    ] as never);

    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      headers: {
        cookie: 'token=shared-session-token',
      },
    });

    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.dependentSummaries).toHaveLength(1);
    expect(payload.dependentSummaries[0].dependentCount).toBe(1);
  });

  it('accepts shared token cookie extraction on POST requests', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({ id: 1, name: '王小明' } as never);
    mockPrisma.healthInsuranceDependent.findFirst.mockResolvedValue(null as never);
    mockPrisma.healthInsuranceDependent.create.mockResolvedValue({
      id: 10,
      employeeId: 1,
      dependentName: '王小華',
      relationship: 'CHILD',
      idNumber: 'A123456789',
      birthDate: new Date('2015-01-01T00:00:00.000Z'),
      isActive: true,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: null,
      remarks: null,
      employee: { name: '王小明' },
    } as never);
    mockPrisma.dependentHistoryLog.create.mockResolvedValue({ id: 1 } as never);

    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 1,
        dependentName: '王小華',
        relationship: 'CHILD',
        idNumber: 'A123456789',
        birthDate: '2015-01-01',
        isActive: true,
        startDate: '2024-01-01',
        endDate: null,
        remarks: '',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.dependent.dependentName).toBe('王小華');
  });

  it('rejects invalid employee ids on POST before querying employees', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 'abc',
        dependentName: '王小華',
        relationship: 'CHILD',
        idNumber: 'A123456789',
        birthDate: '2015-01-01',
        isActive: true,
        startDate: '2024-01-01',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('員工 ID 格式無效');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid date values on POST before writing dependents', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: JSON.stringify({
        employeeId: 1,
        dependentName: '王小華',
        relationship: 'CHILD',
        idNumber: 'A123456789',
        birthDate: 'not-a-date',
        isActive: true,
        startDate: '2024-01-01',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('日期格式無效');
    expect(mockPrisma.healthInsuranceDependent.create).not.toHaveBeenCalled();
  });

  it('rejects null POST bodies before validating dependent payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: 'null',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('請提供有效的眷屬資料');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.healthInsuranceDependent.create).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON bodies before validating dependent payload fields', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'token=shared-session-token',
      },
      body: '{"employeeId":',
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('無效的 JSON 格式');
    expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.healthInsuranceDependent.create).not.toHaveBeenCalled();
  });

  it('accepts shared token cookie extraction on DELETE requests', async () => {
    mockPrisma.healthInsuranceDependent.findUnique.mockResolvedValue({
      id: 10,
      dependentName: '王小華',
    } as never);
    mockPrisma.dependentHistoryLog.create.mockResolvedValue({ id: 2 } as never);
    mockPrisma.healthInsuranceDependent.delete.mockResolvedValue({ id: 10 } as never);

    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents?id=10', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'content-type': 'application/json',
      },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.message).toBe('眷屬資料已刪除');
  });

  it('rejects invalid ids on DELETE before querying dependents', async () => {
    const request = new NextRequest('http://localhost/api/system-settings/health-insurance-dependents?id=abc', {
      method: 'DELETE',
      headers: {
        cookie: 'token=shared-session-token',
        'content-type': 'application/json',
      },
    });

    const response = await DELETE(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('眷屬 ID 格式無效');
    expect(mockPrisma.healthInsuranceDependent.findUnique).not.toHaveBeenCalled();
  });
});